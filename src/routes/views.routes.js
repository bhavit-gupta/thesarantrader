/* -------------------------------------------------------------------------- */
/*                          VIEW ROUTE DEFINITIONS                           */
/* -------------------------------------------------------------------------- */
/*
 * This file defines all routes that render EJS templates (page views).
 * 
 * Security Features:
 * - CSRF protection on logout
 * - CourseId validation
 * - Open redirect prevention
 * - Session validation
 * - Rate limiting
 * - Admin role re-validation
 * 
 * Route Categories:
 * 1. Public Pages - Accessible to all visitors
 * 2. Authentication Pages - Login, signup, password reset
 * 3. User Dashboard - User course management
 * 4. Admin Dashboard - Administrative panel
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const { withTimeout } = require('../utils/prisma');
const { getUserPurchasedCourses } = require('../utils/helpers');
const csrfProtection = require('../middleware/csrfProtection');
const { authLimiter } = require('../middleware/rateLimiter');
const { generateSignature, getZAKToken } = require('../utils/zoom');
const { isAuthenticated, isAdmin: isUserAdmin } = require('../middleware/auth.middleware');
const courseController = require('../controllers/course.controller');


/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                */
/* -------------------------------------------------------------------------- */

const CONFIG = {
    OBJECTID_REGEX: /^[0-9a-fA-F]{24}$/,
    MAX_URL_LENGTH: 2000,
    QUERY_TIMEOUT: 5000, // 5 second timeout
    VALID_REDIRECTS: new Set(['/', '/dashboard', '/courses', '/admin/dashboard'])
};

// URL constants for maintainability
const URLS = {
    LOGIN: '/login',
    DASHBOARD: '/dashboard',
    ADMIN_DASHBOARD: '/admin/dashboard',
    COURSES: '/courses',
    HOME: '/'
};

// Generic error messages
const STRINGS = {
    SERVER_ERROR: 'An error occurred. Please try again.',
    INVALID_COURSE_ID: 'Invalid course identifier.',
    COURSE_NOT_FOUND: 'Course not found.',
    UNAUTHORIZED: 'Authentication required.'
};

/* -------------------------------------------------------------------------- */
/*                           VALIDATION UTILITIES                            */
/* -------------------------------------------------------------------------- */

// Validate ObjectId format
function isValidObjectId(id) {
    return id && typeof id === 'string' && CONFIG.OBJECTID_REGEX.test(id);
}

// Validate redirect URL is same-origin
function isValidRedirect(url) {
    if (!url || typeof url !== 'string') return false;
    // Must start with / and not contain protocol or double slashes
    return url.startsWith('/') && !url.startsWith('//') && !url.includes('://');
}

// Validate session user
function isValidSession(session) {
    return session &&
        session.user &&
        session.user.id &&
        typeof session.user.id === 'string' &&
        CONFIG.OBJECTID_REGEX.test(session.user.id);
}

// Validate URL length
function validateUrlLength(url) {
    return url && url.length <= CONFIG.MAX_URL_LENGTH;
}

/* -------------------------------------------------------------------------- */
/*                              MIDDLEWARE                                   */
/* -------------------------------------------------------------------------- */

// Validate courseId parameter
function validateCourseId(req, res, next) {
    const { courseId } = req.params;

    if (!isValidObjectId(courseId)) {
        return res.redirect(`${URLS.COURSES}?error=invalid_course`);
    }

    next();
}

// Redirect authenticated users away from auth pages (Strict Redirect)
function redirectIfAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
        const role = String(req.session.user.role || "USER").toUpperCase();
        if (role === 'ADMIN') {
            return res.redirect(URLS.ADMIN_DASHBOARD);
        }
        return res.redirect(URLS.DASHBOARD);
    }
    next();
}

// Verify admin in database
async function verifyAdminInDatabase(req, res, next) {
    if (!isValidSession(req.session)) {
        return res.redirect(URLS.LOGIN);
    }

    const role = String(req.session.user.role).toUpperCase();
    if (role !== 'ADMIN') {
        return res.redirect(URLS.DASHBOARD);
    }

    try {
        // Re-validate admin status in database
        const user = await prisma.user.findUnique({
            where: { id: req.session.user.id },
            select: { role: true }
        });

        if (!user || String(user.role).toUpperCase() !== 'ADMIN') {
            return res.redirect(URLS.DASHBOARD);
        }
        next();
    } catch (error) {
        console.error('[Views] Admin verification error:', error.message);
        return res.redirect(URLS.LOGIN);
    }
}

/* -------------------------------------------------------------------------- */
/*                              PUBLIC PAGES                                 */
/* -------------------------------------------------------------------------- */

// Show landing page for guests, redirect authenticated users to dashboard
router.get('/', authLimiter, (req, res) => {
    if (req.session && req.session.user) {
        return res.redirect(URLS.DASHBOARD);
    }
    res.render("layouts/index");
});

// Course catalog
// Caching and pagination handled at app level
router.get('/courses', authLimiter, (req, res) => {
    // Course data escaped by EJS templates
    res.render("layouts/courses", { courses: res.locals.courses });
});

// Community forum page
router.get('/community', authLimiter, (req, res) => res.render("layouts/community"));

// Testimonials/reviews page
router.get('/testimonials', authLimiter, (req, res) => res.render("layouts/testimonials"));

// Features showcase page
router.get('/features', authLimiter, (req, res) => res.render("layouts/features"));
// About Us page
router.get('/about', authLimiter, (req, res) => res.render("layouts/about"));

// Legal Pages
router.get('/privacy-policy', authLimiter, (req, res) => res.render("layouts/privacy"));
router.get('/terms-and-conditions', authLimiter, (req, res) => res.render("layouts/terms"));
router.get('/our-mission', authLimiter, (req, res) => res.render("layouts/mission"));
router.get('/refund-policy', authLimiter, (req, res) => res.render("layouts/refund"));

/* -------------------------------------------------------------------------- */
/*                         AUTHENTICATION PAGES                              */
/* -------------------------------------------------------------------------- */

// Login page
// Using middleware for consistency
router.get('/login', redirectIfAuthenticated, (req, res) => {
    res.render("auth/login", { error: req.query.error });
});

// Signup/registration page
router.get('/signup', redirectIfAuthenticated, (req, res) => {
    res.render("auth/signup", { error: req.query.error });
});

// Password reset request page
router.get('/forgetPassword', (req, res) => res.render("auth/forgetPassword"));

// OTP verification page (for signup and password reset)
router.get('/verifyOTP', (req, res) => res.render("auth/verifyOTP"));

// Course enrollment information page
router.get('/enroll', (req, res) => res.render("courses/enroll"));

/* -------------------------------------------------------------------------- */
/*                         CHECKOUT & PAYMENT PAGES                          */
/* -------------------------------------------------------------------------- */

/**
 * Course checkout page for payment submission.
 * 
 * Security:
 * 
 * 
 * @route GET /checkout/:courseId
 * @access Private (requires authentication)
 */
router.get('/checkout/:courseId',
    authLimiter, // Rate limiting
    validateCourseId, // CourseId validation
    async (req, res) => {
        // Deep session validation
        if (!isValidSession(req.session)) {
            // Validate redirect URL
            const originalUrl = req.originalUrl;
            if (!validateUrlLength(originalUrl) || !isValidRedirect(originalUrl)) {
                return res.redirect(URLS.LOGIN);
            }
            return res.redirect(`${URLS.LOGIN}?redirect=${encodeURIComponent(originalUrl)}`);
        }

        const { courseId } = req.params;
        const userId = req.session.user.id;

        try {
            // Query with timeout consideration
            const course = await prisma.course.findUnique({
                where: { id: courseId }
            });

            if (!course) {
                return res.redirect(`${URLS.COURSES}?error=course_not_found`);
            }

            // Get purchased courses with validation
            const purchasedIds = await getUserPurchasedCourses(userId);
            if (purchasedIds.has(courseId)) {
                return res.redirect(URLS.DASHBOARD);
            }

            // Check for pending payment
            const pendingPurchase = await prisma.purchase.findFirst({
                where: {
                    userId: userId,
                    courseId: courseId,
                    status: 'PENDING'
                }
            });

            // Log without exposing full userId
            console.log(`[Checkout] User: ${userId.slice(-6)} - Course: ${courseId.slice(-6)} - Pending: ${Boolean(pendingPurchase)}`);

            if (pendingPurchase) {
                return res.redirect(`${URLS.DASHBOARD}?info=payment_pending`);
            }

            // Data passed to template - EJS escapes by default
            res.render("courses/checkout", {
                course,
                user: req.session.user,
                csrfToken: res.locals.csrfToken
            });
        } catch (error) {
            // Generic error message, detailed logging
            console.error('[Checkout] Error:', error.message);
            res.status(500).send(STRINGS.SERVER_ERROR);
        }
    }
);

/* -------------------------------------------------------------------------- */
/*                          USER DASHBOARD                                   */
/* -------------------------------------------------------------------------- */

// My Courses Portal (Unified)
router.get('/my-courses',
    isAuthenticated,
    async (req, res) => {
        await courseController.renderMyCourses(req, res);
    }
);

/**
 * User dashboard - Main page for enrolled users.
 * 
 * Security:
 * - Session validation
 * - Rate limiting
 * 
 * @route GET /dashboard
 * @access Private (users)
 */
router.get('/dashboard',
    authLimiter, // Rate limiting
    async (req, res) => {
        // Deep session validation
        if (!isValidSession(req.session)) {
            return res.redirect(URLS.LOGIN);
        }

        // Redirect admins to their dashboard
        if (req.session.user.role === 'ADMIN') {
            return res.redirect(URLS.ADMIN_DASHBOARD);
        }

        try {
            // All necessary data (liveSessions, courses, purchasedCourseIds, etc.)
            // is already populated in res.locals by the viewData middleware.
            res.render("dashboard/user", {
                // Pass locals explicitly if needed, though they are available automatically
                liveSessions: res.locals.liveSessions,
                courses: res.locals.courses,
                purchasedCourseIds: res.locals.purchasedCourseIds,
                pendingCourseIds: res.locals.pendingCourseIds,
                rejectedPurchases: res.locals.rejectedPurchases
            });
        } catch (error) {
            console.error('[User Dashboard] Error:', error.message);
            res.status(500).send(STRINGS.SERVER_ERROR);
        }
    }
);

/**
 * Live Meeting Page - Renders the Zoom SDK interface.
 * 
 * @route GET /live-meeting
 * @access Private (authenticated users)
 */
router.get('/live-meeting',
    authLimiter,
    async (req, res) => {
        if (!isValidSession(req.session)) {
            return res.redirect(URLS.LOGIN);
        }

        try {
            // Get meeting details from query params and clean them
            const meetingNumber = (req.query.id || '').replace(/\s/g, '');
            const password = (req.query.pwd || '').replace(/\s/g, '');
            
            // --- ZOOM SDK TOGGLE LOGIC ---
            // If the toggle is missing or not explicitly "true", fallback to direct Zoom redirect
            if (process.env.USE_ZOOM_SDK !== 'true') {
                const zoomJoinUrl = `https://zoom.us/j/${meetingNumber}?pwd=${password}`;
                console.log(`[Live Meeting] SDK Disabled - Redirecting to Zoom: ${meetingNumber}`);
                return res.redirect(zoomJoinUrl);
            }
            // -----------------------------

            // Default to Participant (Role 0) for the browser console to avoid 
            // errorCode: 1 conflicts with the Zoom Desktop App.
            // Identify Role: Admin = 1 (Host), Student = 0 (Attendee)
            const isAdmin = req.session.user.role === 'ADMIN';
            const role = isAdmin ? 1 : 0;
            
            const signature = generateSignature(meetingNumber, role);

            // Fetch ZAK token for admin hosts (required since March 2026)
            // Pass the admin's Zoom email so the ZAK token is for the correct host user.
            let zakToken = '';
            let hostEmailForZAK = req.session.user.email || '';
            
            if (isAdmin) {
                hostEmailForZAK = process.env.ZOOM_HOST_EMAIL || req.session.user.email || '';
                zakToken = await getZAKToken(hostEmailForZAK);
                if (zakToken) {
                    console.log('[Live Meeting] ZAK token fetched successfully for host:', hostEmailForZAK);
                } else {
                    console.warn('[Live Meeting] ZAK token unavailable, host join may fail');
                }
            }

            // Fetch course details for context (Admin link to content)
            const course = await prisma.course.findFirst({
                where: { zoomMeetingId: meetingNumber },
                select: { id: true, title: true }
            });

            // Render integrated dashboard view
            const viewPath = isAdmin ? 'dashboard/admin_live_studio' : 'dashboard/user_live_room';

            console.log(`[Trace:Handshake] Key on Server: ${process.env.ZOOM_SDK_KEY}`);
            res.render(viewPath, {
                sdkKey: process.env.ZOOM_SDK_KEY,
                signature: signature,
                meetingNumber: meetingNumber,
                password: password,
                userName: req.session.user.name || 'Trader Admin',
                // CRITICAL FIX: The userEmail provided to the SDK MUST match the owner of the ZAK token
                userEmail: isAdmin ? hostEmailForZAK : (req.session.user.email || ''),
                role: role,
                zakToken: zakToken,
                courseId: course?.id || null,
                courseTitle: course?.title || null
            });
        } catch (error) {
            console.error('[Live Meeting] Error:', error.message);
            res.status(500).send('Error initializing meeting session.');
        }
    }
);


/* -------------------------------------------------------------------------- */
/*                           ADMIN DASHBOARD                                 */
/* -------------------------------------------------------------------------- */

/**
 * Admin dashboard - Central management panel for administrators.
 * 
 * Security:
 * - Database role re-validation
 * - Session validation
 * 
 * Performance:
 * - Promise.allSettled for error resilience
 * - Date validation
 * 
 * @route GET /admin/dashboard
 * @access Admin only
 */
router.get('/admin/dashboard',
    verifyAdminInDatabase,
    async (req, res) => {
        try {
            // Fetch all data in parallel with error resilience
            const [
                coursesResult,
                totalPaidUsersResult,
                pendingPurchasesResult,
                totalUsersResult,
                heroSettingResult,
                totalRevenueResult,
                customScheduleResult
            ] = await Promise.allSettled([
                prisma.course.findMany({ orderBy: { startDate: 'asc' } }),
                prisma.user.count({ where: { purchasedCourseIds: { isEmpty: false } } }),
                prisma.purchase.findMany({ where: { status: 'PENDING' }, orderBy: { date: 'desc' } }).catch(() => prisma.purchase.findMany({ where: { status: 'PENDING' } })), // Fallback if date sorting fails
                prisma.user.count(),
                prisma.siteSetting.findUnique({ where: { key: 'hero_image' } }),
                prisma.purchase.aggregate({
                    where: { status: 'COMPLETED' },
                    _sum: { amount: true }
                }),
                prisma.siteSetting.findUnique({ where: { key: 'admin_custom_schedule' } })
            ]);

            // Extract results with default fallbacks
            const courses = coursesResult.status === 'fulfilled' ? coursesResult.value : [];
            const totalPaidUsers = totalPaidUsersResult.status === 'fulfilled' ? totalPaidUsersResult.value : 0;
            const pendingPurchases = pendingPurchasesResult.status === 'fulfilled' ? pendingPurchasesResult.value : [];
            const totalUsers = totalUsersResult.status === 'fulfilled' ? totalUsersResult.value : 0;
            const heroSetting = heroSettingResult.status === 'fulfilled' ? heroSettingResult.value : null;
            const customScheduleSetting = customScheduleResult.status === 'fulfilled' ? customScheduleResult.value : null;
            
            // Extract total revenue safely
            const totalRevenue = totalRevenueResult.status === 'fulfilled' ? 
                (totalRevenueResult.value?._sum?.amount || 0) : 0;
            const heroImage = heroSetting ? heroSetting.value : '/images/about_us.jpeg';

            if (totalPaidUsersResult.status === 'rejected') console.error('[Dashboard] totalPaidUsers failed:', totalPaidUsersResult.reason.message);
            if (pendingPurchasesResult.status === 'rejected') console.error('[Dashboard] pendingPurchases failed:', pendingPurchasesResult.reason.message);

            const now = new Date();
            const ongoingCourses = [];
            const upcomingCourses = [];
            const expiredCourses = [];

            // 1. Efficiently Enrich pending purchases (Bulk fetch instead of N+1)
            let enrichedPendingPurchases = [];
            if (pendingPurchases.length > 0) {
                const userIds = [...new Set(pendingPurchases.map(p => p.userId))];
                const courseIds = [...new Set(pendingPurchases.map(p => p.courseId))];

                const [users, purchaseCourses] = await Promise.all([
                    prisma.user.findMany({
                        where: { id: { in: userIds } },
                        select: { id: true, name: true, email: true, username: true }
                    }),
                    prisma.course.findMany({
                        where: { id: { in: courseIds } },
                        select: { id: true, title: true, price: true }
                    })
                ]);

                const userMap = users.reduce((acc, u) => ({ ...acc, [u.id]: u }), {});
                const courseMap = purchaseCourses.reduce((acc, c) => ({ ...acc, [c.id]: c }), {});

                enrichedPendingPurchases = pendingPurchases.map(p => ({
                    ...p,
                    user: userMap[p.userId] || null,
                    course: courseMap[p.courseId] || null
                }));
            }

            // 2. Map courses and categorize
            const enrichedCourses = courses.map(course => {
                const start = course.startDate ? new Date(course.startDate) : null;
                const end = course.endDate ? new Date(course.endDate) : null;
                const startValid = start && !isNaN(start.getTime());
                const endValid = end && !isNaN(end.getTime());

                if (startValid && start > now) {
                    upcomingCourses.push(course);
                } else if (endValid && end < now) {
                    expiredCourses.push(course);
                } else {
                    ongoingCourses.push(course);
                }

                return course;
            });

            // Build unified adminSchedule: courses with dailyLiveTime + custom events
            const courseScheduleItems = enrichedCourses
                .filter(c => c.dailyLiveTime)
                .map(c => ({ id: c.id, label: c.title, time: c.dailyLiveTime, type: 'course', icon: c.icon || '📚' }));
            const customEvents = customScheduleSetting ? JSON.parse(customScheduleSetting.value) : [];
            const adminSchedule = [
                ...courseScheduleItems,
                ...customEvents.map(e => ({ ...e, icon: e.type === 'youtube' ? '▶️' : '📡' }))
            ];

            res.render("dashboard/admin", {
                liveSessions: res.locals.liveSessions,
                courses: enrichedCourses,
                ongoingCourses,
                upcomingCourses,
                expiredCourses,
                pendingPurchases: enrichedPendingPurchases,
                heroImage,
                adminSchedule,
                stats: {
                    totalPaidUsers,
                    totalUsers,
                    totalRevenue
                }
            });
        } catch (error) {
            console.error('[Admin Dashboard] Critical Error:', error.message);
            res.status(500).send(STRINGS.SERVER_ERROR);
        }
    }
);

/**
 * Admin Management Hub - Central entry point for administrative tools.
 * 
 * @route GET /admin/management
 * @access Admin only
 */
router.get('/admin/management',
    verifyAdminInDatabase,
    (req, res) => {
        res.render('dashboard/admin_management', {
            user: req.session.user,
            path: '/admin/management'
        });
    }
);

/* -------------------------------------------------------------------------- */
/*                           ADMIN TESTIMONIALS                              */
/* -------------------------------------------------------------------------- */

/**
 * Admin testimonials dashboard
 * 
 * @route GET /admin/testimonials
 * @access Admin only
 */
router.get('/admin/testimonials',
    verifyAdminInDatabase,
    async (req, res) => {
        try {
            const testimonials = await prisma.testimonial.findMany({
                orderBy: { submittedAt: 'desc' }
            });

            const pendingTestimonials = testimonials.filter(t => t.status === 'PENDING' || t.status === 'pending');
            const approvedTestimonials = testimonials.filter(t => t.status === 'APPROVED' || t.status === 'approved');
            const rejectedTestimonials = testimonials.filter(t => t.status === 'REJECTED' || t.status === 'rejected');

            res.render('dashboard/admin_testimonials', {
                user: req.session.user,
                pendingTestimonials,
                approvedTestimonials,
                rejectedTestimonials
            });
        } catch (error) {
            console.error("❌ Admin Testimonials Fetch Error:", error);
            res.status(500).send("Error loading testimonials dashboard");
        }
    }
);

/**
 * Admin Live Control - Specialized dashboard for managing course broadcasts.
 * 
 * @route GET /admin/live
 * @access Admin only
 */
router.get('/admin/live',
    verifyAdminInDatabase,
    csrfProtection,
    courseController.renderLiveControlPage
);

/**
 * Admin Landing Page Management - Control site-wide branding and hero imagery.
 * 
 * @route GET /admin/landing-page
 * @access Admin only
 */
router.get('/admin/landing-page',
    verifyAdminInDatabase,
    courseController.renderLandingPageManagement
);

/**
 * Admin Verifications - Specialized queue for handling pending payment requests.
 * 
 * @route GET /admin/verifications
 * @access Admin only
 */
router.get('/admin/verifications', verifyAdminInDatabase, async (req, res) => {
    try {
        const pendingPurchases = await prisma.purchase.findMany({
            where: { status: 'PENDING' },
            orderBy: { date: 'desc' }
        });

        const uIds = [...new Set(pendingPurchases.map(p => p.userId))];
        const cIds = [...new Set(pendingPurchases.map(p => p.courseId))];

        const [users, courses] = await Promise.all([
            prisma.user.findMany({ where: { id: { in: uIds } }, select: { id: true, name: true, username: true, email: true } }),
            prisma.course.findMany({ where: { id: { in: cIds } }, select: { id: true, title: true, price: true } })
        ]);

        const uMap = users.reduce((a, u) => ({ ...a, [u.id]: u }), {});
        const cMap = courses.reduce((a, c) => ({ ...a, [c.id]: c }), {});

        const enrichedPending = pendingPurchases.map(p => ({
            ...p,
            userName: uMap[p.userId]?.name || uMap[p.userId]?.username || 'Unknown',
            userEmail: uMap[p.userId]?.email || '',
            courseTitle: cMap[p.courseId]?.title || 'Unknown Course',
            coursePrice: cMap[p.courseId]?.price || 0
        }));

        res.render('dashboard/admin_verifications', {
            path: '/admin/verifications',
            pending: enrichedPending,
            csrfToken: res.locals.csrfToken || ''
        });
    } catch (err) {
        console.error('[Verification] Render error:', err);
        res.status(500).send('Error loading verification queue');
    }
});


/* -------------------------------------------------------------------------- */
/*                         ADMIN ANALYTICS ROUTES                            */
/* -------------------------------------------------------------------------- */

/**
 * Analytics Overview — 16 KPI cards + 5 charts + activity feed
 * @route GET /admin/analytics
 */
router.get('/admin/analytics', verifyAdminInDatabase, async (req, res) => {
    try {
        const [
            totalRevenueRes, pendingRevenueRes, rejectedRevenueRes,
            totalUsersRes, payingUsersRes, pendingUsersRes,
            allCoursesRes, purchasesGroupRes,
            communityStatsRes, totalLikesRes, chatCountRes, avgRatingRes,
            recentActivityRes, monthlyRevenueRes, userGrowthRes,
            paymentMethodRes, ratingDistRes
        ] = await Promise.allSettled([
            // Revenue
            prisma.purchase.aggregate({ where: { status: 'COMPLETED' }, _sum: { amount: true } }),
            prisma.purchase.aggregate({ where: { status: 'PENDING' }, _sum: { amount: true } }),
            prisma.purchase.aggregate({ where: { status: 'REJECTED' }, _sum: { amount: true } }),
            // Users
            prisma.user.count({ where: { role: 'USER' } }),
            prisma.user.count({ where: { role: 'USER', purchasedCourseIds: { isEmpty: false } } }),
            prisma.purchase.findMany({ where: { status: 'PENDING' }, select: { userId: true } }),
            // Courses
            prisma.course.findMany({ select: { id: true, title: true, users: true, icon: true, deletedAt: true } }),
            prisma.purchase.groupBy({ by: ['courseId'], where: { status: 'COMPLETED' }, _sum: { amount: true }, orderBy: { _sum: { amount: 'desc' } } }),
            // Engagement
            prisma.communityPost.count(),
            prisma.communityPost.aggregate({ _sum: { likes: true } }),
            prisma.chatMessage.count(),
            prisma.testimonial.aggregate({ where: { status: 'APPROVED' }, _avg: { rating: true } }),
            // Recent activity
            prisma.purchase.findMany({ where: { status: 'COMPLETED' }, orderBy: { date: 'desc' }, take: 10 }),
            // Monthly revenue (all purchases with dates)
            prisma.purchase.findMany({ where: { status: 'COMPLETED' }, select: { amount: true, date: true }, orderBy: { date: 'asc' } }),
            // User growth
            prisma.user.findMany({ select: { createdAt: true }, orderBy: { createdAt: 'asc' } }),
            // Payment method split
            prisma.purchase.groupBy({ by: ['paymentMethod'], where: { status: 'COMPLETED' }, _sum: { amount: true }, _count: { _all: true } }),
            // Rating distribution
            prisma.testimonial.groupBy({ by: ['rating'], where: { status: 'APPROVED' }, _count: { _all: true } })
        ]);

        const g = (r, fallback) => r.status === 'fulfilled' ? r.value : fallback;

        const totalRevenue = g(totalRevenueRes, { _sum: { amount: 0 } })?._sum?.amount || 0;
        const pendingRevenue = g(pendingRevenueRes, { _sum: { amount: 0 } })?._sum?.amount || 0;
        const rejectedRevenue = g(rejectedRevenueRes, { _sum: { amount: 0 } })?._sum?.amount || 0;
        const totalUsers = g(totalUsersRes, 0);
        const payingUsers = g(payingUsersRes, 0);
        const pendingUserIds = [...new Set((g(pendingUsersRes, [])).map(p => p.userId))];
        const allCourses = g(allCoursesRes, []);
        const purchaseGroups = g(purchasesGroupRes, []);
        const communityPostCount = g(communityStatsRes, 0);
        const totalLikes = g(totalLikesRes, { _sum: { likes: 0 } })?._sum?.likes || 0;
        const chatCount = g(chatCountRes, 0);
        const avgRating = g(avgRatingRes, { _avg: { rating: 0 } })?._avg?.rating || 0;
        const recentActivity = g(recentActivityRes, []);
        const allPaidPurchases = g(monthlyRevenueRes, []);
        const allUsers = g(userGrowthRes, []);
        const paymentMethods = g(paymentMethodRes, []);
        const ratingDist = g(ratingDistRes, []);

        // Enrich recent activity with user/course names
        const recentActivityUserIds = [...new Set(recentActivity.map(p => p.userId))];
        const recentActivityCourseIds = [...new Set(recentActivity.map(p => p.courseId))];
        const [activityUsers, activityCourses] = await Promise.all([
            prisma.user.findMany({ where: { id: { in: recentActivityUserIds } }, select: { id: true, name: true, username: true } }),
            prisma.course.findMany({ where: { id: { in: recentActivityCourseIds } }, select: { id: true, title: true } })
        ]);
        const auMap = activityUsers.reduce((a, u) => ({ ...a, [u.id]: u }), {});
        const acMap = activityCourses.reduce((a, c) => ({ ...a, [c.id]: c }), {});
        const enrichedActivity = recentActivity.map(p => ({
            ...p,
            userName: auMap[p.userId]?.name || auMap[p.userId]?.username || 'Unknown',
            courseTitle: acMap[p.courseId]?.title || 'Unknown Course'
        }));

        // Revenue per course map
        const revenueMap = purchaseGroups.reduce((a, g) => ({ ...a, [g.courseId]: g._sum.amount || 0 }), {});

        // Monthly revenue buckets (last 12 months)
        const monthlyRevenue = {};
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyRevenue[key] = 0;
        }
        allPaidPurchases.forEach(p => {
            const d = new Date(p.date);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (monthlyRevenue[key] !== undefined) monthlyRevenue[key] += (p.amount || 0);
        });

        // User growth buckets (last 12 months)
        const userGrowth = {};
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            userGrowth[key] = 0;
        }
        allUsers.forEach(u => {
            const d = new Date(u.createdAt);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (userGrowth[key] !== undefined) userGrowth[key]++;
        });

        // Top course by revenue
        const topRevenueEntry = purchaseGroups[0];
        const topRevenueCourse = topRevenueEntry ? allCourses.find(c => c.id === topRevenueEntry.courseId) : null;
        const completedPurchaseCount = allPaidPurchases.length;
        const rejectedCount = await prisma.purchase.count({ where: { status: 'REJECTED' } });
        const avgOrderValue = completedPurchaseCount > 0 ? Math.round(totalRevenue / completedPurchaseCount) : 0;
        const totalEnrollments = allCourses.reduce((s, c) => s + (c.users || 0), 0);

        res.render('dashboard/admin_analytics_overview', {
            path: '/admin/analytics',
            // Revenue
            totalRevenue, pendingRevenue, rejectedRevenue, avgOrderValue,
            // Users
            totalUsers, payingUsers, pendingUserCount: pendingUserIds.length,
            conversionRate: totalUsers > 0 ? ((payingUsers / totalUsers) * 100).toFixed(1) : '0.0',
            // Courses
            allCourses, totalCourses: allCourses.length,
            activeCourses: allCourses.filter(c => !c.deletedAt).length,
            totalEnrollments, topRevenueCourse,
            topRevenueCourseRevenue: topRevenueEntry?._sum?.amount || 0,
            revenueMap,
            // Engagement
            communityPostCount, totalLikes, chatCount,
            avgRating: avgRating ? avgRating.toFixed(1) : '0.0',
            // Charts data
            monthlyRevenue, userGrowth,
            paymentMethods,
            ratingDist,
            // Activity
            enrichedActivity
        });
    } catch (err) {
        console.error('[Analytics] Overview error:', err);
        res.status(500).send('Error loading analytics');
    }
});

/**
 * Revenue & Payments analytics
 * @route GET /admin/analytics/revenue
 */
router.get('/admin/analytics/revenue', verifyAdminInDatabase, async (req, res) => {
    try {
        const [
            completedRes, pendingRes, rejectedRes,
            methodGroupRes, monthlyRes, perCourseRes,
            highestRes, allCoursesRes, expensesRes
        ] = await Promise.allSettled([
            prisma.purchase.findMany({ where: { status: 'COMPLETED' }, orderBy: { date: 'desc' } }),
            prisma.purchase.findMany({ where: { status: 'PENDING' }, orderBy: { date: 'desc' } }),
            prisma.purchase.findMany({ where: { status: 'REJECTED' }, orderBy: { date: 'desc' } }),
            prisma.purchase.groupBy({ by: ['paymentMethod'], where: { status: 'COMPLETED' }, _sum: { amount: true }, _count: { _all: true } }),
            prisma.purchase.findMany({ where: { status: 'COMPLETED' }, select: { amount: true, date: true } }),
            prisma.purchase.groupBy({ by: ['courseId'], where: { status: 'COMPLETED' }, _sum: { amount: true }, _count: { _all: true }, orderBy: { _sum: { amount: 'desc' } } }),
            prisma.purchase.findFirst({ where: { status: 'COMPLETED' }, orderBy: { amount: 'desc' }, select: { amount: true, userId: true, courseId: true, date: true } }),
            prisma.course.findMany({ select: { id: true, title: true, icon: true } }),
            prisma.expense.findMany({ orderBy: { date: 'desc' } })
        ]);

        const g = (r, fb) => r.status === 'fulfilled' ? r.value : fb;
        const completed = g(completedRes, []);
        const pending = g(pendingRes, []);
        const rejected = g(rejectedRes, []);
        const methodGroups = g(methodGroupRes, []);
        const monthlyPurchases = g(monthlyRes, []);
        const perCourseGroups = g(perCourseRes, []);
        const highest = g(highestRes, null);
        const allCourses = g(allCoursesRes, []);
        const expenses = g(expensesRes, []);
        const courseMap = allCourses.reduce((a, c) => ({ ...a, [c.id]: c }), {});

        // Enrich all purchase lists with user + course
        const allPurchases = [...completed, ...pending, ...rejected];
        const uIds = [...new Set(allPurchases.map(p => p.userId))];
        const cIds = [...new Set(allPurchases.map(p => p.courseId))];
        const [users, courses] = await Promise.all([
            prisma.user.findMany({ where: { id: { in: uIds } }, select: { id: true, name: true, username: true, email: true } }),
            prisma.course.findMany({ where: { id: { in: cIds } }, select: { id: true, title: true } })
        ]);
        const uMap = users.reduce((a, u) => ({ ...a, [u.id]: u }), {});
        const cMap = courses.reduce((a, c) => ({ ...a, [c.id]: c }), {});
        const enrich = list => list.map(p => ({
            ...p,
            userName: uMap[p.userId]?.name || uMap[p.userId]?.username || 'Unknown',
            userEmail: uMap[p.userId]?.email || '',
            courseTitle: cMap[p.courseId]?.title || 'Unknown Course'
        }));

        const totalRevenue = completed.reduce((s, p) => s + (p.amount || 0), 0);
        const pendingRevenue = pending.reduce((s, p) => s + (p.amount || 0), 0);
        const rejectedRevenue = rejected.reduce((s, p) => s + (p.amount || 0), 0);
        const totalExpenses = expenses.reduce((s, e) => s + (e.amount || 0), 0);
        const lostRevenue = rejectedRevenue + totalExpenses;

        const approvalRate = (completed.length + rejected.length) > 0
            ? ((completed.length / (completed.length + rejected.length)) * 100).toFixed(1) : '0.0';

        // Monthly revenue
        const now = new Date();
        const monthlyRevenue = {};
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyRevenue[key] = 0;
        }
        monthlyPurchases.forEach(p => {
            const d = new Date(p.date);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (monthlyRevenue[key] !== undefined) monthlyRevenue[key] += (p.amount || 0);
        });

        const perCourseRevenue = perCourseGroups.map(g => ({
            courseTitle: courseMap[g.courseId]?.title || 'Unknown',
            icon: courseMap[g.courseId]?.icon || '📚',
            revenue: g._sum.amount || 0,
            count: g._count._all || 0
        }));

        res.render('dashboard/admin_analytics_revenue', {
            path: '/admin/analytics/revenue',
            tab: req.query.tab || 'completed',
            totalRevenue, pendingRevenue, rejectedRevenue, totalExpenses, lostRevenue, approvalRate,
            avgOrderValue: completed.length > 0 ? Math.round(totalRevenue / completed.length) : 0,
            highestTransaction: highest?.amount || 0,
            completed: enrich(completed), pending: enrich(pending), rejected: enrich(rejected),
            methodGroups, monthlyRevenue, perCourseRevenue, expenses
        });
    } catch (err) {
        console.error('[Analytics] Revenue error:', err);
        res.status(500).send('Error loading revenue analytics');
    }
});

/**
 * Course Performance analytics
 * @route GET /admin/analytics/courses
 */
router.get('/admin/analytics/courses', verifyAdminInDatabase, async (req, res) => {
    try {
        const [allCoursesRes, purchaseGroupRes, foldersRes, resourcesRes] = await Promise.allSettled([
            prisma.course.findMany({ orderBy: { createdAt: 'desc' } }), // ALL courses including deleted
            prisma.purchase.groupBy({ by: ['courseId'], where: { status: 'COMPLETED' }, _sum: { amount: true }, _count: { _all: true } }),
            prisma.courseFolder.findMany({ select: { courseId: true } }),
            prisma.courseResource.findMany({ select: { courseId: true, type: true } })
        ]);

        const g = (r, fb) => r.status === 'fulfilled' ? r.value : fb;
        const allCourses = g(allCoursesRes, []);
        const purchaseGroups = g(purchaseGroupRes, []);
        const folders = g(foldersRes, []);
        const resources = g(resourcesRes, []);

        const revenueMap = purchaseGroups.reduce((a, p) => ({ ...a, [p.courseId]: { revenue: p._sum.amount || 0, count: p._count._all || 0 } }), {});
        const folderMap = folders.reduce((a, f) => ({ ...a, [f.courseId]: (a[f.courseId] || 0) + 1 }), {});
        const resourceMap = resources.reduce((a, r) => ({ ...a, [r.courseId]: (a[r.courseId] || 0) + 1 }), {});

        const enrichedCourses = allCourses.map(c => ({
            ...c,
            revenue: revenueMap[c.id]?.revenue || 0,
            purchaseCount: revenueMap[c.id]?.count || 0,
            revenuePerSeat: (c.users > 0 && revenueMap[c.id]?.revenue) ? Math.round(revenueMap[c.id].revenue / c.users) : 0,
            folderCount: folderMap[c.id] || 0,
            resourceCount: resourceMap[c.id] || 0,
            discountPct: c.originalPrice > c.price ? Math.round(((c.originalPrice - c.price) / c.originalPrice) * 100) : 0,
            isDeleted: !!c.deletedAt
        }));

        const sort = req.query.sort || 'revenue';
        const filter = req.query.filter || 'all';

        let filtered = enrichedCourses;
        if (filter === 'active') filtered = enrichedCourses.filter(c => !c.deletedAt);
        else if (filter === 'deleted') filtered = enrichedCourses.filter(c => c.deletedAt);
        else if (filter === 'published') filtered = enrichedCourses.filter(c => !c.deletedAt && c.isPublished);
        else if (filter === 'unpublished') filtered = enrichedCourses.filter(c => !c.isPublished);
        else if (filter === 'promoted') filtered = enrichedCourses.filter(c => c.isPromoted);
        else if (filter === 'live') filtered = enrichedCourses.filter(c => c.isLive);

        if (sort === 'revenue') filtered.sort((a, b) => b.revenue - a.revenue);
        else if (sort === 'enrollments') filtered.sort((a, b) => b.users - a.users);
        else if (sort === 'revenuePerSeat') filtered.sort((a, b) => b.revenuePerSeat - a.revenuePerSeat);
        else if (sort === 'newest') filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        else if (sort === 'oldest') filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        else if (sort === 'price') filtered.sort((a, b) => b.price - a.price);

        const totalRevenue = enrichedCourses.reduce((s, c) => s + c.revenue, 0);
        const totalEnrollments = enrichedCourses.reduce((s, c) => s + (c.users || 0), 0);

        res.render('dashboard/admin_analytics_courses', {
            path: '/admin/analytics/courses',
            courses: filtered, allCourses: enrichedCourses,
            sort, filter,
            totalRevenue, totalEnrollments,
            activeCourses: enrichedCourses.filter(c => !c.deletedAt).length,
            deletedCourses: enrichedCourses.filter(c => c.deletedAt).length,
            avgRevenue: enrichedCourses.length > 0 ? Math.round(totalRevenue / enrichedCourses.length) : 0,
            avgEnrollments: enrichedCourses.length > 0 ? Math.round(totalEnrollments / enrichedCourses.length) : 0
        });
    } catch (err) {
        console.error('[Analytics] Courses error:', err);
        res.status(500).send('Error loading course analytics');
    }
});

/**
 * User Analytics & Leaderboard
 * @route GET /admin/analytics/users
 */
router.get('/admin/analytics/users', verifyAdminInDatabase, async (req, res) => {
    try {
        const [allUsersRes, purchaseGroupRes, communityPostsRes, chatMsgsRes] = await Promise.allSettled([
            prisma.user.findMany({ orderBy: { createdAt: 'desc' } }),
            prisma.purchase.groupBy({ by: ['userId'], where: { status: 'COMPLETED' }, _sum: { amount: true }, _count: { _all: true } }),
            prisma.communityPost.findMany({ select: { userId: true, userName: true, likes: true, comments: true } }),
            prisma.chatMessage.groupBy({ by: ['userId'], _count: { _all: true }, orderBy: { _count: { _all: 'desc' } }, take: 20 })
        ]);

        const g = (r, fb) => r.status === 'fulfilled' ? r.value : fb;
        const allUsers = g(allUsersRes, []);
        const purchaseGroups = g(purchaseGroupRes, []);
        const communityPosts = g(communityPostsRes, []);
        const chatGroups = g(chatMsgsRes, []);

        const spendMap = purchaseGroups.reduce((a, p) => ({ ...a, [p.userId]: { total: p._sum.amount || 0, count: p._count._all || 0 } }), {});

        // Community activity per user
        const postCountMap = {};
        const commentCountMap = {};
        communityPosts.forEach(p => {
            postCountMap[p.userId] = (postCountMap[p.userId] || 0) + 1;
            (p.comments || []).forEach(c => {
                commentCountMap[c.userId] = (commentCountMap[c.userId] || 0) + 1;
            });
        });

        const enrichedUsers = allUsers.map(u => {
            const { password, ...safe } = u;
            return {
                ...safe,
                totalSpent: spendMap[u.id]?.total || 0,
                purchaseCount: spendMap[u.id]?.count || 0,
                enrollmentCount: (u.purchasedCourseIds || []).length,
                postCount: postCountMap[u.id] || 0,
                commentCount: commentCountMap[u.id] || 0,
                isDeleted: !!u.deletedAt
            };
        });

        const payingUsers = enrichedUsers.filter(u => u.enrollmentCount > 0);
        const totalRevenue = payingUsers.reduce((s, u) => s + u.totalSpent, 0);
        const avgSpend = payingUsers.length > 0 ? Math.round(totalRevenue / payingUsers.length) : 0;

        // Leaderboards
        const topBuyers = [...enrichedUsers].sort((a, b) => b.totalSpent - a.totalSpent).slice(0, 20);
        const topEnrollers = [...enrichedUsers].sort((a, b) => b.enrollmentCount - a.enrollmentCount).slice(0, 20);
        const topCommunity = [...enrichedUsers].sort((a, b) => (b.postCount + b.commentCount) - (a.postCount + a.commentCount)).slice(0, 20);

        // Geographic breakdown
        const stateMap = {};
        const cityMap = {};
        allUsers.forEach(u => {
            if (u.state) stateMap[u.state] = (stateMap[u.state] || 0) + 1;
            if (u.city) cityMap[u.city] = (cityMap[u.city] || 0) + 1;
        });
        const stateData = Object.entries(stateMap).sort((a, b) => b[1] - a[1]).slice(0, 15);
        const cityData = Object.entries(cityMap).sort((a, b) => b[1] - a[1]).slice(0, 10);

        // Monthly registration
        const now = new Date();
        const userGrowth = {};
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            userGrowth[key] = 0;
        }
        allUsers.forEach(u => {
            const d = new Date(u.createdAt);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (userGrowth[key] !== undefined) userGrowth[key]++;
        });

        // Most active state/city
        const topState = stateData[0]?.[0] || 'N/A';
        const topCity = cityData[0]?.[0] || 'N/A';

        res.render('dashboard/admin_analytics_users', {
            path: '/admin/analytics/users',
            tab: req.query.tab || 'buyers',
            allUsers: enrichedUsers,
            totalUsers: allUsers.length,
            payingCount: payingUsers.length,
            nonPayingCount: allUsers.length - payingUsers.length,
            conversionRate: allUsers.length > 0 ? ((payingUsers.length / allUsers.length) * 100).toFixed(1) : '0.0',
            totalRevenue, avgSpend,
            topBuyers, topEnrollers, topCommunity,
            stateData, cityData, userGrowth,
            topState, topCity
        });
    } catch (err) {
        console.error('[Analytics] Users error:', err);
        res.status(500).send('Error loading user analytics');
    }
});

/**
 * Engagement — Community, Chat & Testimonials
 * @route GET /admin/analytics/engagement
 */
router.get('/admin/analytics/engagement', verifyAdminInDatabase, async (req, res) => {
    try {
        const [
            allPostsRes, chatGroupRes, testimonialsRes,
            chatImagesRes, totalChatRes, activeRoomsCountRes
        ] = await Promise.allSettled([
            prisma.communityPost.findMany({ orderBy: { likes: 'desc' } }),
            prisma.chatMessage.groupBy({ by: ['courseId'], _count: { _all: true }, orderBy: { _count: { _all: 'desc' } } }),
            prisma.testimonial.findMany({ orderBy: { submittedAt: 'desc' } }),
            prisma.chatMessage.count({ where: { imageUrl: { not: null } } }),
            prisma.chatMessage.count(),
            prisma.course.count({ where: { deletedAt: null } })
        ]);

        const g = (r, fb) => r.status === 'fulfilled' ? r.value : fb;
        const allPosts = g(allPostsRes, []);
        const chatGroups = g(chatGroupRes, []);
        const testimonials = g(testimonialsRes, []);
        const chatImages = g(chatImagesRes, 0);
        const totalChat = g(totalChatRes, 0);
        const activeRoomsCount = g(activeRoomsCountRes, 0);

        // Community stats
        const totalComments = allPosts.reduce((s, p) => s + (p.comments?.length || 0), 0);
        const totalLikes = allPosts.reduce((s, p) => s + (p.likes || 0), 0);
        const postsWithImages = allPosts.filter(p => p.imageUrl).length;
        const avgCommentsPerPost = allPosts.length > 0 ? (totalComments / allPosts.length).toFixed(1) : '0.0';
        const avgLikesPerPost = allPosts.length > 0 ? (totalLikes / allPosts.length).toFixed(1) : '0.0';

        // Most active poster
        const posterMap = {};
        allPosts.forEach(p => { posterMap[p.userId] = { name: p.userName, count: (posterMap[p.userId]?.count || 0) + 1 }; });
        const topPoster = Object.values(posterMap).sort((a, b) => b.count - a.count)[0] || null;
        const topPost = allPosts[0] || null;

        // Monthly posts trend
        const now = new Date();
        const monthlyPosts = {};
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyPosts[key] = 0;
        }
        allPosts.forEach(p => {
            const d = new Date(p.createdAt);
            const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            if (monthlyPosts[key] !== undefined) monthlyPosts[key]++;
        });

        // Enrich chat groups with course names
        const chatCourseIds = chatGroups.map(g => g.courseId);
        const chatCourses = await prisma.course.findMany({ where: { id: { in: chatCourseIds } }, select: { id: true, title: true, icon: true } });
        const chatCourseMap = chatCourses.reduce((a, c) => ({ ...a, [c.id]: c }), {});
        const enrichedChatGroups = chatGroups.map(g => ({
            courseId: g.courseId,
            count: g._count._all,
            title: chatCourseMap[g.courseId]?.title || 'Unknown Course',
            icon: chatCourseMap[g.courseId]?.icon || '💬'
        }));

        // Testimonial breakdown
        const approvedTests = testimonials.filter(t => t.status === 'APPROVED');
        const pendingTests = testimonials.filter(t => t.status === 'PENDING');
        const rejectedTests = testimonials.filter(t => t.status === 'REJECTED');
        const avgRating = approvedTests.length > 0 ? (approvedTests.reduce((s, t) => s + t.rating, 0) / approvedTests.length).toFixed(1) : '0.0';
        const ratingDist = [1, 2, 3, 4, 5].map(r => ({ rating: r, count: approvedTests.filter(t => t.rating === r).length }));
        const approvalRate = (approvedTests.length + rejectedTests.length) > 0
            ? ((approvedTests.length / (approvedTests.length + rejectedTests.length)) * 100).toFixed(1) : '0.0';

        res.render('dashboard/admin_analytics_engagement', {
            path: '/admin/analytics/engagement',
            tab: req.query.tab || 'community',
            // Community
            allPosts: allPosts.slice(0, 20), totalPosts: allPosts.length,
            totalComments, totalLikes, postsWithImages,
            avgCommentsPerPost, avgLikesPerPost, topPoster, topPost,
            monthlyPosts,
            // Chat
            enrichedChatGroups, totalChat, chatImages, activeRoomsCount,
            // Testimonials
            approvedTests, pendingTests, rejectedTests,
            avgRating, ratingDist, approvalRate,
            featuredCount: approvedTests.filter(t => t.isFeatured).length
        });
    } catch (err) {
        console.error('[Analytics] Engagement error:', err);
        res.status(500).send('Error loading engagement analytics');
    }
});

/**
 * Add an expense entry
 * @route POST /admin/analytics/expense
 */
router.post('/admin/analytics/expense', verifyAdminInDatabase, async (req, res) => {
    try {
        const amount = parseInt(req.body.amount, 10);
        const description = (req.body.description || '').trim();

        if (isNaN(amount) || amount <= 0 || !description) {
            return res.status(400).json({ success: false, message: 'Invalid amount or missing description.' });
        }

        await prisma.expense.create({
            data: {
                amount,
                description,
                date: new Date()
            }
        });

        res.redirect('/admin/analytics/revenue');
    } catch (err) {
        console.error('[Analytics] Add expense error:', err);
        res.status(500).send('Error adding expense');
    }
});

/* -------------------------------------------------------------------------- */
/*                              SESSION LOGOUT                               */
/* -------------------------------------------------------------------------- */

/**
 * Logout route - Destroys user session.
 * 
 * Security:
 * - CSRF protection
 * 
 * @route POST /logout
 * @access Public (but requires session to be meaningful)
 */
router.post('/logout',
    csrfProtection,
    (req, res) => {
        if (!req.session) {
            return res.redirect(URLS.HOME);
        }

        const userId = req.session.user?.id;
        
        req.session.destroy((err) => {
            if (err) {
                console.error('[Logout] Session destroy error:', err.message);
            }
            // Clear the session cookie explicitly
            res.clearCookie('thesarantrader.sid');
            
            if (userId) {
                console.log(`[Logout] User ${userId.slice(-6)} logged out`);
            }
            
            res.redirect(URLS.HOME + '?loggedOut=true');
        });
    }
);

module.exports = router;

// Export utilities for testing
module.exports.isValidObjectId = isValidObjectId;
module.exports.isValidRedirect = isValidRedirect;
module.exports.CONFIG = CONFIG;
module.exports.URLS = URLS;
