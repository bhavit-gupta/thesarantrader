/* ---------------- DEPENDENCIES ---------------- */
const prisma = require('../utils/prisma');
const { getUserPurchasedCourses } = require('../utils/helpers');



/* ---------------- ROOM LOGIC ---------------- */
exports.getChatRooms = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        if (req.session.user.role === 'admin') {
            const courses = await prisma.course.findMany();
            res.render('layouts/chat-rooms', {
                user: req.session.user,
                // liveSessions, // Removed as per DB persistence change
                purchasedCourses: courses,
                isAdmin: true
            });
            return;
        }

        if (!req.session.user.id) {
            return res.redirect('/login');
        }

        const purchasedIds = await getUserPurchasedCourses(req.session.user.id);

        if (purchasedIds.length === 0) {
            return res.redirect('/courses?message=purchase_required');
        }

        const purchasedCourses = await prisma.course.findMany({
            where: {
                id: { in: purchasedIds }
            }
        });

        res.render('layouts/chat-rooms', {
            user: req.session.user,
            // liveSessions, // Removed
            purchasedCourses,
            isAdmin: false
        });
    } catch (error) {
        console.error("Error fetching chat rooms:", error);
        res.status(500).send("Error loading chat rooms");
    }
};

exports.getCourseChat = async (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const courseId = req.params.courseId;
    const isAdmin = req.session.user.role === 'admin';

    try {
        const course = await prisma.course.findUnique({ where: { id: courseId } });

        if (!course) {
            return res.status(404).send('Course not found');
        }

        res.render('layouts/chat-room', {
            user: req.session.user,
            // liveSessions, // Removed
            course,
            isAdmin
        });
    } catch (error) {
        console.error("Error loading chat room:", error);
        res.status(500).send("Error loading chat room");
    }
};

/* ---------------- MESSAGE LOGIC ---------------- */
exports.getMessages = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const courseId = req.params.courseId;
    const { before, limit } = req.query;
    const messageLimit = parseInt(limit) || 50;

    try {
        const query = {
            where: { courseId: courseId },
            orderBy: { timestamp: 'desc' },
            take: messageLimit
        };

        if (before) {
            query.where.timestamp = { lt: new Date(before) };
        }

        // Smart Polling: Fetch messages after a specific timestamp
        if (req.query.after) {
            query.where.timestamp = { gt: new Date(parseInt(req.query.after)) };
            // For 'after', we want the oldest first (ascending) to append correctly, 
            // but our query is desc. We'll reverse them later as usual.
        }

        const messages = await prisma.chatMessage.findMany(query);

        // Reverse to return in chronological order (oldest -> newest)
        messages.reverse();

        res.json({ success: true, messages });
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ success: false, message: "Error fetching messages" });
    }
};

exports.sendMessage = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const courseId = req.params.courseId;
    const isAdmin = req.session.user.role === 'admin';

    // Access is already verified by middleware
    const { message } = req.body;

    if (!message || message.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    if (message.length > 500) {
        return res.status(400).json({ success: false, message: 'Message must be less than 500 characters' });
    }

    try {
        const newMessage = await prisma.chatMessage.create({
            data: {
                courseId,
                userId: req.session.user.id,
                userName: req.session.user.name,
                message: message.trim()
            }
        });

        console.log(`💬 New message in course ${courseId} by ${newMessage.userName}`);
        res.json({ success: true, message: 'Message sent!', chatMessage: newMessage });
    } catch (error) {
        console.error("Error sending message:", error);
        res.status(500).json({ success: false, message: "Error sending message" });
    }
};

/* ---------------- CLEANUP LOGIC ---------------- */
// Cleanup Logic: Delete messages older than 7 days & messages from ended courses
exports.cleanupOldMessages = async () => {
    try {
        const now = new Date();
        const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

        // 1. Delete messages older than 7 days
        const deletedOld = await prisma.chatMessage.deleteMany({
            where: {
                timestamp: { lt: sevenDaysAgo }
            }
        });

        // 2. Delete messages from courses that have ended
        // First, find all courses that have ended
        const endedCourses = await prisma.course.findMany({
            where: {
                endDate: { lt: now }
            },
            select: { id: true }
        });

        const endedCourseIds = endedCourses.map(c => c.id);

        if (endedCourseIds.length > 0) {
            const deletedEnded = await prisma.chatMessage.deleteMany({
                where: {
                    courseId: { in: endedCourseIds }
                }
            });
            console.log(`🧹 Chat Cleanup: Removed ${deletedOld.count} old messages and ${deletedEnded.count} messages from ${endedCourseIds.length} ended courses.`);
        } else {
            console.log(`🧹 Chat Cleanup: Removed ${deletedOld.count} old messages.`);
        }

    } catch (error) {
        console.error("Error running chat cleanup:", error);
    }
};
