const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const fs = require('fs');
const path = require('path');

/**
 * Safely deletes a payment screenshot from the filesystem.
 * @param {string} screenshotUrl - Relative URL from the DB.
 */
const deleteScreenshot = (screenshotUrl) => {
    if (!screenshotUrl) return;
    try {
        const filePath = path.join(__dirname, '../public', screenshotUrl);
        if (fs.existsSync(filePath)) {
            fs.unlink(filePath, (err) => {
                if (err) console.error(`❌ [Cleanup] Failed to delete: ${filePath}`, err);
                else console.log(`🗑️ [Cleanup] Deleted screenshot: ${filePath}`);
            });
        }
    } catch (err) {
        console.error("❌ [Cleanup] Error during file deletion:", err);
    }
};

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

        // Cleanup: Delete the screenshot after successful processing
        if (purchase.screenshotUrl) {
            deleteScreenshot(purchase.screenshotUrl);
        }

        res.json({ success: true, message: "Payment approved and user enrolled." });

    } catch (error) {
        console.error("Approve Payment Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// Reject Payment
router.post('/api/admin/reject-payment', isAdmin, async (req, res) => {
    try {
        const { purchaseId, reason } = req.body;
        // Fetch purchase details to get the screenshot URL before status update
        const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });

        if (purchase) {
            await prisma.purchase.update({
                where: { id: purchaseId },
                data: {
                    status: 'rejected',
                    rejectionReason: reason || 'Payment proof was not clear or invalid.'
                }
            });

            // Cleanup: Delete the screenshot upon rejection
            if (purchase.screenshotUrl) {
                deleteScreenshot(purchase.screenshotUrl);
            }

            res.json({ success: true, message: "Payment rejected." });
        } else {
            res.status(404).json({ success: false, message: "Purchase record missing" });
        }

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

// ---------------- COURSE VIDEO MANAGEMENT ----------------

// Render Video Management Page
router.get('/admin/courses/:id/videos', isAdmin, async (req, res) => {
    try {
        const courseId = req.params.id;
        const course = await prisma.course.findUnique({
            where: { id: courseId }
        });

        if (!course) {
            return res.status(404).render('error', { message: "Course not found" });
        }

        const videos = await prisma.courseVideo.findMany({
            where: { courseId: courseId },
            orderBy: { order: 'asc' }
        });

        res.render('dashboard/admin_course_videos', {
            user: req.session.user,
            course: course,
            videos: videos,
            path: '/admin/courses'
        });
    } catch (error) {
        console.error("View Course Videos Error:", error);
        res.status(500).render('error', { message: "Internal Server Error" });
    }
});

// Add New Video
router.post('/api/admin/courses/:id/videos', isAdmin, async (req, res) => {
    try {
        const courseId = req.params.id;
        const { title, description, youtubeUrl } = req.body;

        if (!title || !youtubeUrl) {
            return res.status(400).json({ success: false, message: "Title and YouTube URL are required" });
        }

        // Simple validation for youtube link (optional, but good)
        if (!youtubeUrl.includes('youtube.com') && !youtubeUrl.includes('youtu.be')) {
            return res.status(400).json({ success: false, message: "Invalid YouTube URL" });
        }

        const videoCount = await prisma.courseVideo.count({ where: { courseId: courseId } });

        const video = await prisma.courseVideo.create({
            data: {
                courseId: courseId,
                title: title,
                description: description || "",
                youtubeUrl: youtubeUrl,
                order: videoCount + 1
            }
        });

        res.json({ success: true, message: "Video added successfully", video: video });
    } catch (error) {
        console.error("Add Course Video Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// Update Video
router.post('/api/admin/courses/:id/videos/:videoId/update', isAdmin, async (req, res) => {
    try {
        const { title, description, youtubeUrl } = req.body;
        const { videoId } = req.params;

        if (!title || !youtubeUrl) {
            return res.status(400).json({ success: false, message: "Title and YouTube URL are required" });
        }

        await prisma.courseVideo.update({
            where: { id: videoId },
            data: {
                title: title,
                description: description || "",
                youtubeUrl: youtubeUrl
            }
        });

        res.json({ success: true, message: "Video updated successfully" });
    } catch (error) {
        console.error("Update Course Video Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

// Delete Video
router.delete('/api/admin/courses/:courseId/videos/:videoId', isAdmin, async (req, res) => {
    try {
        const { videoId } = req.params;

        await prisma.courseVideo.delete({
            where: { id: videoId }
        });

        res.json({ success: true, message: "Video deleted successfully" });
    } catch (error) {
        console.error("Delete Course Video Error:", error);
        res.status(500).json({ success: false, message: "Internal Server Error" });
    }
});

module.exports = router;
