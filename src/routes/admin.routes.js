const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');

// Middleware to ensure admin
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ success: false, message: "Access denied" });
    }
};

// Approve Payment
router.post('/api/admin/approve-payment', isAdmin, async (req, res) => {
    try {
        const { purchaseId } = req.body;

        const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
        if (!purchase) {
            return res.status(404).json({ success: false, message: "Purchase not found" });
        }

        if (purchase.status === 'completed') {
            return res.status(400).json({ success: false, message: "Purchase already completed" });
        }

        // Update Purchase Status, User Enrollment, and Course Student Count in a transaction
        await prisma.$transaction([
            prisma.purchase.update({
                where: { id: purchaseId },
                data: { status: 'completed' }
            }),
            prisma.user.update({
                where: { id: purchase.userId },
                data: { purchasedCourseIds: { push: purchase.courseId } }
            }),
            prisma.course.update({
                where: { id: purchase.courseId },
                data: { students: { increment: 1 } }
            })
        ]);

        console.log(`✅ [Manual Approval] User ${purchase.userId} enrolled in ${purchase.courseId}. Student count incremented.`);
        res.json({ success: true, message: "Payment approved and user enrolled." });

    } catch (error) {
        console.error("Approve Payment Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// Reject Payment
router.post('/api/admin/reject-payment', isAdmin, async (req, res) => {
    try {
        const { purchaseId } = req.body;

        await prisma.purchase.update({
            where: { id: purchaseId },
            data: { status: 'rejected' }
        });

        res.json({ success: true, message: "Payment rejected." });

    } catch (error) {
        console.error("Reject Payment Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// ---- USER MANAGEMENT ----

// List all users
router.get('/admin/users', isAdmin, async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            orderBy: { createdAt: 'desc' }
        });

        // SANITIZE USER LIST (Exclude password)
        const sanitizedUsers = (users || []).map(user => {
            const { password, ...rest } = user;
            return {
                ...rest,
                id: user.id || user._id || '',
                name: user.name || user.username || 'N/A',
                username: user.username || 'unknown',
                email: user.email || 'N/A',
                phone: user.phone || 'N/A',
                role: user.role || 'user',
                createdAt: user.createdAt || new Date(),
                purchasedCourseIds: user.purchasedCourseIds || []
            };
        });

        res.render('dashboard/admin_users', { users: sanitizedUsers }, (err, html) => {
            if (err) {
                console.error('SERVER-SIDE EJS ERROR (admin_users):', err);
                return res.status(500).send(`RENDER_ERROR: ${err.message}`);
            }
            res.send(html);
        });
    } catch (e) {
        console.error('Admin users list error:', e);
        res.status(500).send('Error loading users: ' + e.message);
    }
});

// Single user detail
router.get('/admin/users/:id', isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;

        // Basic ID validation for MongoDB ObjectId
        if (!userId || userId.length !== 24) {
            return res.status(400).send('Invalid User ID format');
        }

        const [user, purchases, posts, testimonials] = await Promise.all([
            prisma.user.findUnique({ where: { id: userId } }),
            prisma.purchase.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
            prisma.communityPost.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
            prisma.testimonial.findMany({ where: { userId }, orderBy: { submittedAt: 'desc' } })
        ]);

        if (!user) return res.status(404).send('User not found');

        // SANITIZE USER DATA (Exclude password)
        const { password, ...rest } = user;
        const sanitizedProfileUser = {
            ...rest,
            id: user.id || user._id || '',
            name: user.name || 'N/A',
            username: user.username || 'unknown',
            email: user.email || 'N/A',
            phone: user.phone || 'N/A',
            createdAt: user.createdAt || new Date(),
            purchasedCourseIds: user.purchasedCourseIds || []
        };

        // Enrich purchases with course title and safe defaults
        const enrichedPurchases = await Promise.all((purchases || []).map(async (p) => {
            const course = await prisma.course.findUnique({ where: { id: p.courseId } }).catch(() => null);
            return {
                ...p,
                courseTitle: course ? course.title : '(deleted course)',
                amount: p.amount || 0,
                date: p.date || new Date(),
                paymentMethod: p.paymentMethod || 'unknown',
                status: p.status || 'pending'
            };
        }));

        // Enrich enrolled courses
        const enrolledCourses = await Promise.all((sanitizedProfileUser.purchasedCourseIds || []).map(async (cid) => {
            return prisma.course.findUnique({ where: { id: cid } }).catch(() => null);
        }));

        res.render('dashboard/admin_user_detail', {
            profileUser: sanitizedProfileUser,
            purchases: enrichedPurchases,
            posts: posts || [],
            testimonials: testimonials || [],
            enrolledCourses: enrolledCourses.filter(Boolean)
        }, (err, html) => {
            if (err) {
                console.error('SERVER-SIDE EJS ERROR (admin_user_detail):', err);
                return res.status(500).send(`RENDER_ERROR: ${err.message}`);
            }
            res.send(html);
        });
    } catch (e) {
        console.error('Admin user detail error:', e);
        res.status(500).send('Error loading user detail: ' + e.message);
    }
});

module.exports = router;
