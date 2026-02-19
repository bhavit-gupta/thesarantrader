/* ---------------- DEPENDENCIES ---------------- */
const prisma = require('../utils/prisma');
const { getUserPurchasedCourses } = require('../utils/helpers');

/* ---------------- CACHE CONFIGURATION ---------------- */
// Simple in-memory cache
let courseCache = {
    data: null,
    lastFetch: 0,
    TTL: 30 * 1000 // 30 seconds
};

/* ---------------- MIDDLEWARE LOGIC ---------------- */
const viewDataMiddleware = async (req, res, next) => {
    try {
        const now = Date.now();

        // Check cache for global course data
        if (!courseCache.data || (now - courseCache.lastFetch > courseCache.TTL)) {
            // Fetch courses and dynamically calculate live student counts
            const [allCourses, allEnrollments] = await Promise.all([
                prisma.course.findMany({ orderBy: { startDate: 'asc' } }),
                prisma.user.findMany({
                    where: { purchasedCourseIds: { isEmpty: false } },
                    select: { purchasedCourseIds: true }
                })
            ]);

            // Recalculate counts in memory for speed
            const enrollmentMap = {};
            allEnrollments.forEach(u => {
                u.purchasedCourseIds.forEach(cid => {
                    enrollmentMap[cid] = (enrollmentMap[cid] || 0) + 1;
                });
            });

            // Merge calculated counts into course objects
            const coursesWithLiveCounts = allCourses.map(c => ({
                ...c,
                students: enrollmentMap[c.id] || 0
            }));

            courseCache.data = coursesWithLiveCounts;
            courseCache.lastFetch = now;
            console.log("🔄 [Cache] Global course data refreshed with live enrollment counts");
        }

        const courses = courseCache.data;
        const currentDate = new Date();

        // Filter courses (IN-MEMORY operation)
        const ongoingCourses = [];
        const upcomingCourses = [];
        const expiredCourses = [];

        courses.forEach(course => {
            const start = course.startDate ? new Date(course.startDate) : null;
            const end = course.endDate ? new Date(course.endDate) : null;

            if (start && start > currentDate) {
                upcomingCourses.push(course);
            } else if (end && end < currentDate) {
                expiredCourses.push(course);
            } else {
                ongoingCourses.push(course);
            }
        });

        // User Data
        const user = req.session.user || null;
        let purchasedCourseIds = [];
        let hasPurchasedCourses = false;
        let pendingCourseIds = [];

        if (user) {
            purchasedCourseIds = await getUserPurchasedCourses(user.id);
            hasPurchasedCourses = purchasedCourseIds.length > 0;

            // Fetch pending purchases for this user
            const pendingPurchases = await prisma.purchase.findMany({
                where: { userId: user.id, status: 'pending' },
                select: { courseId: true }
            });
            pendingCourseIds = pendingPurchases.map(p => p.courseId);
        }

        // Set Locals
        res.locals.user = user;
        res.locals.path = req.path;
        res.locals.courses = courses;
        res.locals.ongoingCourses = ongoingCourses;
        res.locals.upcomingCourses = upcomingCourses;
        res.locals.expiredCourses = expiredCourses;
        // Build live sessions map from DB
        const liveCourses = await prisma.course.findMany({
            where: { isLive: true },
            select: { id: true, lastLiveStartedAt: true }
        });
        const liveSessions = {};
        liveCourses.forEach(c => {
            liveSessions[c.id] = {
                isLive: true,
                startTime: c.lastLiveStartedAt ? c.lastLiveStartedAt.getTime() : null
            };
        });
        res.locals.liveSessions = liveSessions;

        res.locals.purchasedCourseIds = purchasedCourseIds;
        res.locals.hasPurchasedCourses = hasPurchasedCourses;
        res.locals.pendingCourseIds = pendingCourseIds;

        next();
    } catch (error) {
        console.error("Error in viewDataMiddleware:", error);
        // Fail safe
        res.locals.user = req.session.user || null;
        res.locals.path = req.path;
        res.locals.courses = [];
        res.locals.ongoingCourses = [];
        res.locals.upcomingCourses = [];
        res.locals.expiredCourses = [];
        res.locals.liveSessions = {};
        res.locals.purchasedCourseIds = [];
        res.locals.hasPurchasedCourses = false;
        res.locals.pendingCourseIds = [];
        next();
    }
};

module.exports = viewDataMiddleware;