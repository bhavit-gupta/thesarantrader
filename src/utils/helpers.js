/* ---------------- DEPENDENCIES ---------------- */
const prisma = require('./prisma');

/**
 * Fetch purchased course IDs for a specific user
 * @param {string} userId 
 * @returns {Promise<string[]>} Array of course IDs
 */
/* ---------------- HELPER FUNCTIONS ---------------- */
async function getUserPurchasedCourses(userId) {
    if (!userId) return [];

    try {
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { purchasedCourseIds: true }
        });
        return user ? user.purchasedCourseIds : [];
    } catch (e) {
        console.error("Error fetching purchased courses:", e);
        return [];
    }
}

/**
 * Middleware to check if user has purchased a specific course
 * @param {string} courseIdParam - The name of the req.params key for courseId (default: 'courseId')
 */
function requireCoursePurchase(courseIdParam = 'courseId') {
    return async (req, res, next) => {
        const acceptHeader = req.headers.accept || '';

        if (!req.session.user) {
            if (req.xhr || acceptHeader.includes('json')) {
                return res.status(401).json({ success: false, message: 'Please log in' });
            }
            return res.redirect('/login');
        }

        if (req.session.user.role === 'admin') {
            return next();
        }

        const courseId = req.params[courseIdParam];
        const purchasedIds = await getUserPurchasedCourses(req.session.user.id);

        if (purchasedIds.includes(courseId)) {
            return next();
        }

        if (req.xhr || acceptHeader.includes('json')) {
            return res.status(403).json({ success: false, message: 'You must purchase this course to access' });
        }
        return res.redirect('/courses?message=purchase_required');
    };
}

/* ---------------- EXPORTS ---------------- */
module.exports = {
    getUserPurchasedCourses,
    requireCoursePurchase
};
