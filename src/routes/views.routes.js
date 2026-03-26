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

// Redirect authenticated users away from auth pages
function redirectIfAuthenticated(req, res, next) {
    if (req.session && req.session.user) {
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

// Landing page
// Rate limiting on public pages
router.get('/', authLimiter, async (req, res) => {
    try {
        // Fetch custom hero image if set by admin
        const heroSetting = await prisma.siteSetting.findUnique({
            where: { key: 'hero_image' }
        });
        
        const heroImage = heroSetting ? heroSetting.value : '/images/hero-image.png';
        
        res.render("layouts/index", { heroImage });
    } catch (error) {
        // Fallback to default if database fails
        console.error('[Views] Home error:', error.message);
        res.render("layouts/index", { heroImage: '/images/hero-image.png' });
    }
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
            const userId = req.session.user.id;

            const [userDb, pendingPurchases, rejectedPurchases] = await Promise.all([
                prisma.user.findUnique({ where: { id: userId }, select: { purchasedCourseIds: true } }),
                prisma.purchase.findMany({ where: { userId, status: 'PENDING' } }),
                prisma.purchase.findMany({ where: { userId, status: 'REJECTED' } })
            ]);

            const purchasedCourseIds = userDb?.purchasedCourseIds || [];
            const pendingCourseIds = pendingPurchases.map(p => p.courseId);

            res.render("dashboard/user", {
                liveSessions: res.locals.liveSessions,
                courses: res.locals.courses,
                purchasedCourseIds,
                pendingCourseIds,
                rejectedPurchases
            });
        } catch (error) {
            console.error('[User Dashboard] Error:', error.message);
            res.status(500).send(STRINGS.SERVER_ERROR);
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
                allEnrollmentsResult,
                heroSettingResult
            ] = await Promise.allSettled([
                prisma.course.findMany({ orderBy: { startDate: 'asc' } }),
                prisma.user.count({ where: { purchasedCourseIds: { isEmpty: false } } }),
                prisma.purchase.findMany({ where: { status: 'PENDING' }, orderBy: { date: 'desc' } }).catch(() => prisma.purchase.findMany({ where: { status: 'PENDING' } })), // Fallback if date sorting fails
                prisma.user.count(),
                prisma.user.findMany({ where: { purchasedCourseIds: { isEmpty: false } }, select: { purchasedCourseIds: true } }),
                prisma.siteSetting.findUnique({ where: { key: 'hero_image' } })
            ]);

            // Extract results with default fallbacks
            const courses = coursesResult.status === 'fulfilled' ? coursesResult.value : [];
            const totalPaidUsers = totalPaidUsersResult.status === 'fulfilled' ? totalPaidUsersResult.value : 0;
            const pendingPurchases = pendingPurchasesResult.status === 'fulfilled' ? pendingPurchasesResult.value : [];
            const totalUsers = totalUsersResult.status === 'fulfilled' ? totalUsersResult.value : 0;
            const allEnrollments = allEnrollmentsResult.status === 'fulfilled' ? allEnrollmentsResult.value : [];
            const heroSetting = heroSettingResult.status === 'fulfilled' ? heroSettingResult.value : null;
            const heroImage = heroSetting ? heroSetting.value : '/images/hero-image.png';

            if (totalPaidUsersResult.status === 'rejected') console.error('[Dashboard] totalPaidUsers failed:', totalPaidUsersResult.reason.message);
            if (pendingPurchasesResult.status === 'rejected') console.error('[Dashboard] pendingPurchases failed:', pendingPurchasesResult.reason.message);
            if (allEnrollmentsResult.status === 'rejected') console.error('[Dashboard] allEnrollments failed:', allEnrollmentsResult.reason.message);

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

            res.render("dashboard/admin", {
                liveSessions: res.locals.liveSessions,
                courses: enrichedCourses,
                ongoingCourses,
                upcomingCourses,
                expiredCourses,
                pendingPurchases: enrichedPendingPurchases,
                heroImage,
                stats: {
                    totalPaidUsers,
                    totalUsers
                }
            });
        } catch (error) {
            console.error('[Admin Dashboard] Critical Error:', error.message);
            res.status(500).send(STRINGS.SERVER_ERROR);
        }
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
