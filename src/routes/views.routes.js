/* ---------------- DEPENDENCIES ---------------- */
const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const { getUserPurchasedCourses } = require('../utils/helpers');



/* ---------------- PUBLIC ROUTES ---------------- */
router.get('/', (req, res) => res.render("layouts/index"));

router.get('/courses', (req, res) => {
    // courses are available in res.locals
    res.render("layouts/courses", { courses: res.locals.courses });
});

router.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render("auth/login");
});

router.get('/signup', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render("auth/signup");
});

router.get('/forgetPassword', (req, res) => res.render("auth/forgetPassword"));
router.get('/verifyOTP', (req, res) => res.render("auth/verifyOTP"));
router.get('/enroll', (req, res) => res.render("courses/enroll"));

// CHECKOUT PAGE
router.get('/checkout/:courseId', async (req, res) => {
    if (!req.session.user) {
        return res.redirect(`/login?redirect=${encodeURIComponent(req.originalUrl)}`);
    }

    const { courseId } = req.params;

    try {
        const course = await prisma.course.findUnique({
            where: { id: courseId }
        });

        if (!course) {
            return res.redirect('/courses?error=course_not_found');
        }

        // Check if already enrolled
        const purchasedIds = await getUserPurchasedCourses(req.session.user.id);
        if (purchasedIds.includes(courseId)) {
            return res.redirect('/dashboard');
        }

        // Check if payment is already pending verification
        const pendingPurchase = await prisma.purchase.findFirst({
            where: { userId: req.session.user.id, courseId: courseId, status: 'pending' }
        });

        console.log(`[Checkout] User ${req.session.user.id} - Course ${courseId} - Pending Purchase Found:`, !!pendingPurchase);

        if (pendingPurchase) {
            console.log(`[Checkout] Redirecting to dashboard due to pending purchase`);
            return res.redirect('/dashboard?info=payment_pending');
        }

        res.render("courses/checkout", {
            course,
            user: req.session.user,
            csrfToken: req.csrfToken ? req.csrfToken() : ''
        });
    } catch (e) {
        console.error("Error loading checkout page:", e);
        res.status(500).send("Internal Server Error");
    }
});

router.get('/testimonials', (req, res) => res.render("layouts/testimonials"));
router.get('/features', (req, res) => res.render("layouts/features"));
router.get('/community', (req, res) => res.render("layouts/community"));

/* ---------------- USER DASHBOARD ---------------- */
// Dashboard (protected)
router.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    if (req.session.user.role === 'admin') return res.redirect('/admin/dashboard');
    res.render("dashboard/user", { liveSessions: res.locals.liveSessions, courses: res.locals.courses });
});

// Admin Dashboard (protected, admin only)
/* ---------------- ADMIN DASHBOARD ---------------- */
// Admin Dashboard (protected, admin only)
router.get('/admin/dashboard', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    if (req.session.user.role !== 'admin') return res.redirect('/dashboard');

    try {
        const courses = await prisma.course.findMany({
            orderBy: { startDate: 'asc' }
        });

        const now = new Date();
        const ongoingCourses = [];
        const upcomingCourses = [];
        const expiredCourses = [];

        // Count unique users who have purchased at least one course
        const totalStudents = await prisma.user.count({
            where: {
                purchasedCourseIds: {
                    isEmpty: false
                }
            }
        });

        // Fetch Pending Payments
        const pendingPurchases = await prisma.purchase.findMany({
            where: { status: 'pending' },
            orderBy: { date: 'desc' }
        });

        // Enrich pending purchases with User and Course details
        const enrichedPendingPurchases = await Promise.all(pendingPurchases.map(async (p) => {
            const user = await prisma.user.findUnique({ where: { id: p.userId } });
            const course = await prisma.course.findUnique({ where: { id: p.courseId } });
            return {
                ...p,
                user,
                course
            };
        }));

        // Sum actual completed purchase amounts for accurate revenue
        const revenueResult = await prisma.purchase.aggregate({
            _sum: { amount: true },
            where: { status: 'completed' }
        });
        const totalRevenue = revenueResult._sum.amount || 0;

        const totalUsers = await prisma.user.count();

        courses.forEach(course => {

            // Filtering
            const start = course.startDate ? new Date(course.startDate) : null;
            const end = course.endDate ? new Date(course.endDate) : null;

            if (start && start > now) {
                upcomingCourses.push(course);
            } else if (end && end < now) {
                expiredCourses.push(course);
            } else {
                // If no start date, or start date is past/today AND (no end date or end date is future)
                // This covers:
                // 1. Started in past, no end date (Ongoing forever)
                // 2. Started in past, ends in future (Ongoing)
                // 3. No start date (maybe verify this? For now treating as available/ongoing if not upcoming/expired)
                ongoingCourses.push(course);
            }
        });

        res.render("dashboard/admin", {
            liveSessions: res.locals.liveSessions,
            courses: courses, // Keep for raw list if needed
            ongoingCourses,
            upcomingCourses,
            expiredCourses,
            pendingPurchases: enrichedPendingPurchases,
            stats: {
                totalStudents,
                totalRevenue,
                totalUsers // Renamed from onlineUsers to reflect actual data
            }
        });
    } catch (e) {
        console.error("Error loading admin dashboard:", e);
        res.status(500).send("Internal Server Error");
    }
});

// Logout (handled by auth routes primarily, but keeping for compatibility if linked directly)
router.post('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

module.exports = router;
