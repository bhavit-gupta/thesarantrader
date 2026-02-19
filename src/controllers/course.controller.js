/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require('../utils/prisma');

/* -------------------------------------------------------------------------- */
/*                                COURSE LOGIC                                */
/* -------------------------------------------------------------------------- */

/**
 * Public API: Returns all courses that haven't ended yet or have no end date.
 */
exports.getAllCourses = async (req, res) => {
    try {
        const now = new Date();
        const courses = await prisma.course.findMany({
            where: {
                OR: [
                    { endDate: { gte: now } },
                    { endDate: null }
                ]
            },
            orderBy: { startDate: 'asc' }
        });
        res.json(courses);
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        res.status(500).json({ success: false, message: "Error fetching courses" });
    }
};

/* -------------------------------------------------------------------------- */
/*                                 ADMIN ONLY                                 */
/* -------------------------------------------------------------------------- */

/**
 * Admin API: Renders the course management dashboard.
 */
exports.getAdminCourses = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/dashboard');

    try {
        const courses = await prisma.course.findMany();
        res.render("dashboard/admin_courses", { courses, user: req.session.user });
    } catch (e) {
        console.error("❌ Admin Fetch Error:", e);
        res.status(500).send("Error loading admin dashboard");
    }
};

/**
 * Admin API: Creates a new course.
 */
exports.addCourse = async (req, res) => {
    const { title, description, price, originalPrice, icon, colorTheme, liveLink, startDate, endDate, enrollmentDeadline } = req.body;

    const parsedPrice = parseInt(price);
    const parsedOriginalPrice = parseInt(originalPrice);

    if (isNaN(parsedPrice) || parsedPrice < 0 || isNaN(parsedOriginalPrice) || parsedOriginalPrice < 0) {
        return res.status(400).send("Prices must be valid positive numbers");
    }

    try {
        const newCourse = await prisma.course.create({
            data: {
                title,
                description,
                price: parsedPrice,
                originalPrice: parsedOriginalPrice,
                rating: 5.0,
                students: 0,
                icon: icon || "📚",
                iconBg: `${colorTheme || 'blue'}-50`,
                iconColor: `${colorTheme || 'blue'}-500`,
                badge: "New",
                badgeColor: "green",
                liveLink: liveLink || "",
                startDate: startDate ? new Date(startDate) : null,
                endDate: endDate ? new Date(endDate) : null,
                enrollmentDeadline: enrollmentDeadline ? new Date(enrollmentDeadline) : null
            }
        });

        console.log(`✅ [NEW COURSE] Added: ${title} (#${newCourse.id})`);
        res.redirect('/admin/courses');
    } catch (e) {
        console.error("❌ Course Addition Error:", e);
        res.status(500).send("Error adding course: " + e.message);
    }
};

/**
 * Admin API: Deletes a course.
 * Performs a transaction to clean up messages and user enrollments while retaining purchase records.
 */
exports.deleteCourse = async (req, res) => {
    const courseId = req.params.id;

    try {
        await prisma.$transaction(async (tx) => {
            // 1. Delete associated chat messages
            await tx.chatMessage.deleteMany({ where: { courseId } });

            // 2. Remove course from user enrollment lists (revoke access)
            const usersWithCourse = await tx.user.findMany({
                where: { purchasedCourseIds: { has: courseId } },
                select: { id: true, purchasedCourseIds: true }
            });

            for (const user of usersWithCourse) {
                const newIds = user.purchasedCourseIds.filter(id => id !== courseId);
                await tx.user.update({
                    where: { id: user.id },
                    data: { purchasedCourseIds: newIds }
                });
            }

            // 3. Delete the course record
            await tx.course.delete({ where: { id: courseId } });
        });

        console.log(`🗑️ [COURSE DELETED] ${courseId}. (Purchase records preserved for finance history)`);
        res.redirect('/admin/courses');
    } catch (e) {
        console.error("❌ Course Deletion Error:", e);
        res.status(500).send("Error deleting course: " + e.message);
    }
};

/**
 * Admin API: Updates an existing course.
 */
exports.editCourse = async (req, res) => {
    const courseId = req.params.id;
    const { title, description, price, originalPrice, icon, colorTheme, liveLink, startDate, endDate, enrollmentDeadline } = req.body;

    const parsedPrice = parseInt(price);
    const parsedOriginalPrice = parseInt(originalPrice);

    if (isNaN(parsedPrice) || parsedPrice < 0 || isNaN(parsedOriginalPrice) || parsedOriginalPrice < 0) {
        return res.status(400).send("Prices must be valid positive numbers");
    }

    const updateData = {
        title, description, price: parsedPrice, originalPrice: parsedOriginalPrice,
        liveLink: liveLink || "",
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        enrollmentDeadline: enrollmentDeadline ? new Date(enrollmentDeadline) : null
    };

    if (icon) updateData.icon = icon;
    if (colorTheme) {
        updateData.iconBg = `${colorTheme}-50`;
        updateData.iconColor = `${colorTheme}-500`;
    }

    try {
        await prisma.course.update({ where: { id: courseId }, data: updateData });
        console.log(`✏️ [COURSE UPDATED] ${courseId}`);
        res.redirect('/admin/courses');
    } catch (e) {
        console.error("❌ Update Error:", e);
        res.status(500).send("Error updating course");
    }
};

/**
 * Fetches the live-status (isLive, startTime) for all courses that are currently active.
 */
exports.getLiveStatus = async (req, res) => {
    try {
        const liveCourses = await prisma.course.findMany({ where: { isLive: true } });
        const liveSessions = {};
        liveCourses.forEach(c => {
            liveSessions[c.id] = {
                isLive: true,
                startTime: c.lastLiveStartedAt ? c.lastLiveStartedAt.getTime() : null
            };
        });
        res.json({ liveSessions });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error fetching status" });
    }
};

/**
 * Admin API: Toggles the live stream status of a course.
 */
exports.toggleLiveStatus = async (req, res) => {
    const { courseId } = req.body;
    if (!courseId) return res.status(400).json({ success: false, message: "Invalid ID" });

    try {
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) return res.status(404).json({ success: false, message: "Course not found" });

        const newIsLive = !course.isLive;
        const newStartTime = newIsLive ? new Date() : null;

        await prisma.course.update({
            where: { id: courseId },
            data: { isLive: newIsLive, lastLiveStartedAt: newStartTime }
        });

        console.log(`🔴 [LIVE TOGGLE] Course ${courseId} is now ${newIsLive ? 'LIVE' : 'OFFLINE'}`);
        res.json({ success: true, courseId, isLive: newIsLive, startTime: newStartTime ? newStartTime.getTime() : null });

    } catch (error) {
        res.status(500).json({ success: false, message: "Toggle failed" });
    }
};

/**
 * Manually enrolls a user in a course (for testing or direct admin actions).
 */
exports.enrollCourse = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: "Login required" });

    const { courseId } = req.body;
    const userId = req.session.user.id;

    try {
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) return res.status(404).json({ success: false, message: "Course not found" });

        const user = await prisma.user.findUnique({ where: { id: userId }, select: { purchasedCourseIds: true } });
        if (user.purchasedCourseIds.includes(courseId)) {
            return res.status(400).json({ success: false, message: "Already enrolled" });
        }

        await prisma.$transaction(async (tx) => {
            await tx.user.update({ where: { id: userId }, data: { purchasedCourseIds: { push: courseId } } });
            await tx.purchase.create({
                data: { userId, courseId, amount: course.price, status: 'completed', date: new Date() }
            });
            await tx.course.update({ where: { id: courseId }, data: { students: { increment: 1 } } });
        });

        console.log(`🎓 [ENROLLMENT] ${req.session.user.name} joined ${course.title}`);
        res.json({ success: true, message: "Successfully enrolled!" });

    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to enroll" });
    }
};
