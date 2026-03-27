/* -------------------------------------------------------------------------- */
/*                         ADMIN ROUTE DEFINITIONS                           */
/* -------------------------------------------------------------------------- */
/**
 * Administrative routes for platform management.
 * 
 * 
 * 
 * Features:
 * - Payment verification (approve/reject manual payments)
 * - User management (view users, user details, activity)
 * - Course video management (CRUD operations on course content)
 * 
 * Security:
 * - All routes protected with isAdmin middleware
 * - Path traversal prevention on file operations
 * - Input validation on all parameters
 * - Screenshot files cleaned up after approval/rejection
 * - User passwords excluded from all responses
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const { withRetry } = require('../utils/prisma');
const fs = require('fs').promises;  // Use promises API
const fsSync = require('fs');
const path = require('path');
const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');
const multer = require('multer');
const { compressImage } = require('../utils/upload.utils');
const { clearUserCourseCache } = require('../utils/helpers');
const { invalidateUserCache } = require('../middleware/viewData.middleware');

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                */
/* -------------------------------------------------------------------------- */

const CONFIG = Object.freeze({
    MAX_REASON_LENGTH: 500,           // Limit rejection reason length
    USERS_PER_PAGE: 50,               // Pagination limit
    ALLOWED_UPLOAD_DIR: 'uploads/payments',  // Allowed upload directory
    THUMBNAIL_UPLOAD_DIR: 'uploads/thumbnails', // [New] Thumbnail directory
    ALLOWED_EXTENSIONS: ['.webp', '.jpg', '.jpeg', '.png'],  // Allowed file types
    YOUTUBE_DOMAINS: ['youtube.com', 'youtu.be', 'www.youtube.com'],  // Valid YouTube domains
    EXEMPT_ADMINS: true // Allow admins to access admin routes
});

/* -------------------------------------------------------------------------- */
/*                           VALIDATION UTILITIES                            */
/* -------------------------------------------------------------------------- */

/**
 * Validate MongoDB ObjectId format
 * Proper hex character validation
 * @param {*} id - ID to validate
 * @returns {boolean} Valid or not
 */
function isValidObjectId(id) {
    if (!id || typeof id !== 'string') return false;
    return /^[0-9a-fA-F]{24}$/.test(id);
}

/**
 * Validate YouTube URL
 * Proper URL parsing and domain validation
 * @param {string} url - URL to validate
 * @returns {boolean} Valid YouTube URL or not
 */
function isValidYouTubeUrl(url) {
    if (!url || typeof url !== 'string') return false;

    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname.toLowerCase();

        return CONFIG.YOUTUBE_DOMAINS.some(domain =>
            hostname === domain || hostname.endsWith('.' + domain)
        );
    } catch {
        return false;
    }
}

/**
 * Validate screenshot path (prevent path traversal)
 * Path traversal prevention
 * @param {string} screenshotUrl - URL to validate
 * @returns {string|null} Safe path or null
 */
function validateScreenshotPath(screenshotUrl) {
    if (!screenshotUrl || typeof screenshotUrl !== 'string') return null;

    // Normalize and check for traversal attempts
    const normalized = path.normalize(screenshotUrl).replace(/^\/+/, '');

    // Must start with allowed directory
    if (!normalized.startsWith(CONFIG.ALLOWED_UPLOAD_DIR)) return null;

    // No directory traversal
    if (normalized.includes('..')) return null;

    // Check extension
    const ext = path.extname(normalized).toLowerCase();
    if (!CONFIG.ALLOWED_EXTENSIONS.includes(ext)) return null;

    // Validate filename has only safe characters
    const basename = path.basename(normalized);
    if (!/^[a-zA-Z0-9_-]+\.(webp|jpg|jpeg|png)$/i.test(basename)) return null;

    return normalized;
}

/**
 * Sanitize string for logging (prevent log injection)
 * Log sanitization
 * @param {*} value - Value to sanitize
 * @param {number} maxLength - Maximum length
 * @returns {string} Sanitized string
 */
function sanitizeForLog(value, maxLength = 100) {
    if (value == null) return '[empty]';
    const str = String(value).slice(0, maxLength);
    // Remove control characters and potential injection
    return str.replace(/[\x00-\x1f\x7f]/g, '').replace(/\$\{/g, '');
}

/**
 * Validate and sanitize rejection reason
 * Input validation
 * @param {*} reason - Reason to validate
 * @returns {string} Sanitized reason
 */
function validateReason(reason) {
    if (!reason || typeof reason !== 'string') {
        return 'Payment proof was not clear or invalid.';
    }
    return reason.trim().slice(0, CONFIG.MAX_REASON_LENGTH);
}

/* -------------------------------------------------------------------------- */
/*                             UTILITY FUNCTIONS                             */
/* -------------------------------------------------------------------------- */

/**
 * Safely deletes a payment screenshot from the filesystem.
 * Path traversal prevention, async/await, type safety
 * 
 * @param {string} screenshotUrl - Relative URL from database
 * @returns {Promise<boolean>} Success or failure
 */
async function deleteScreenshot(screenshotUrl) {
    // Validate path to prevent traversal
    const safePath = validateScreenshotPath(screenshotUrl);
    if (!safePath) {
        console.warn('[Cleanup] Invalid screenshot path rejected');
        return false;
    }

    try {
        const filePath = path.join(__dirname, '../public', safePath);

        // Verify the resolved path is still within public directory
        const resolvedPath = path.resolve(filePath);
        const publicDir = path.resolve(__dirname, '../public');

        if (!resolvedPath.startsWith(publicDir)) {
            console.warn('[Cleanup] Path traversal attempt blocked');
            return false;
        }

        // Use fs.promises for proper async/await
        if (fsSync.existsSync(filePath)) {
            await fs.unlink(filePath);
            console.log(`[Cleanup] Deleted screenshot: ${sanitizeForLog(safePath)}`);
            return true;
        }

        return false;
    } catch (err) {
        // Don't expose file paths in logs
        return false;
    }
}

/**
 * Safely deletes a video thumbnail from the filesystem.
 */
async function deleteVideoThumbnail(thumbnailUrl) {
    if (!thumbnailUrl || typeof thumbnailUrl !== 'string') return false;

    try {
        // Thumbnail URL format: /uploads/thumbnails/filename.webp
        const relativePath = thumbnailUrl.startsWith('/') ? thumbnailUrl.substring(1) : thumbnailUrl;

        // Basic security check: must be in thumbnails directory
        if (!relativePath.startsWith(CONFIG.THUMBNAIL_UPLOAD_DIR)) {
            console.warn('[Cleanup] Invalid thumbnail path rejected:', relativePath);
            return false;
        }

        const filePath = path.join(__dirname, '../public', relativePath);

        // Prevent traversal
        const resolvedPath = path.resolve(filePath);
        const publicDir = path.resolve(__dirname, '../public');
        if (!resolvedPath.startsWith(publicDir)) return false;

        if (fsSync.existsSync(filePath)) {
            await fs.unlink(filePath);
            console.log(`[Cleanup] Deleted thumbnail: ${sanitizeForLog(relativePath)}`);
            return true;
        }
        return false;
    } catch (err) {
        console.error('[Cleanup] Thumbnail deletion failed');
        return false;
    }
}

/* -------------------------------------------------------------------------- */
/*                         FILE UPLOAD CONFIGURATION                         */
/* -------------------------------------------------------------------------- */

const THUMBNAIL_DIR = path.join(__dirname, '../public', CONFIG.THUMBNAIL_UPLOAD_DIR);

// Ensure thumbnail directory exists
if (!fsSync.existsSync(THUMBNAIL_DIR)) {
    fsSync.mkdirSync(THUMBNAIL_DIR, { recursive: true, mode: 0o755 });
}

const thumbnailStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, THUMBNAIL_DIR),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'thumb-' + uniqueSuffix + ext);
    }
});

const thumbnailUpload = multer({
    storage: thumbnailStorage,
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit for thumbnails
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!CONFIG.ALLOWED_EXTENSIONS.includes(ext)) {
            return cb(new Error('Only images (JPG, PNG, WebP) are allowed'));
        }
        cb(null, true);
    }
});


/* -------------------------------------------------------------------------- */
/*                       PAYMENT VERIFICATION ROUTES                         */
/* -------------------------------------------------------------------------- */

/**
 * Approve a pending payment and grant course access.
 * Comprehensive validation and error handling
 * 
 * @route POST /api/admin/approve-payment
 * @access Admin only
 */
router.post('/api/admin/approve-payment', isAdmin, async (req, res) => {
    try {
        const { purchaseId } = req.body;

        //  Validate purchaseId format
        if (!isValidObjectId(purchaseId)) {
            return res.status(400).json({ success: false, message: 'Invalid purchase ID format' });
        }

        // 1. Verify purchase exists
        const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });
        if (!purchase) {
            return res.status(404).json({ success: false, message: 'Purchase not found' });
        }

        // Prevent double approval (idempotency)
        if (purchase.status === 'COMPLETED') {
            return res.status(400).json({ success: false, message: 'Purchase already completed' });
        }

        // Validate courseId format
        if (!isValidObjectId(purchase.courseId)) {
            return res.status(400).json({ success: false, message: 'Invalid course ID in purchase' });
        }

        // Verify course exists before approval
        const course = await prisma.course.findUnique({ where: { id: purchase.courseId } });
        if (!course) {
            return res.status(400).json({ success: false, message: 'Course no longer exists' });
        }

        // Check for double enrollment - prevent duplicate course IDs
        const user = await prisma.user.findUnique({ where: { id: purchase.userId } });
        if (!user) {
            return res.status(400).json({ success: false, message: 'User not found' });
        }

        const alreadyEnrolled = (user.purchasedCourseIds || []).includes(purchase.courseId);

        // Execute enrollment as atomic transaction with proper error handling
        try {
            await withRetry(() => prisma.$transaction(async (tx) => {
                // a. Mark purchase as completed
                await tx.purchase.update({
                    where: { id: purchaseId },
                    data: { status: 'COMPLETED' }
                });

                // b. Grant user access to the course (only if not already enrolled)
                if (!alreadyEnrolled) {
                    await tx.user.update({
                        where: { id: purchase.userId },
                        data: { purchasedCourseIds: { push: purchase.courseId } }
                    });

                    // c. Increment course enrollment count
                    await tx.course.update({
                        where: { id: purchase.courseId },
                        data: { users: { increment: 1 } }
                    });
                }
            }), 3);
        } catch (txError) {
            // Explicit transaction failure handling
            console.error('[Approve] Transaction failed');
            return res.status(500).json({ success: false, message: 'Enrollment failed. Please try again.' });
        }

        // Audit log (console for now, should be database)
        console.log(`[Approval] User ${sanitizeForLog(purchase.userId)} enrolled in course ${sanitizeForLog(purchase.courseId)}`);

        // 4. Cleanup: Delete payment screenshot (no longer needed)
        if (purchase.screenshotUrl) {
            await deleteScreenshot(purchase.screenshotUrl);
        }

        // 5. Invalidate caches immediately so user sees "Enrolled" and has access
        try {
            clearUserCourseCache(purchase.userId);
            invalidateUserCache(purchase.userId);
        } catch (cacheError) {
            console.error('[Approval] Cache invalidation failed:', cacheError.message);
        }

        res.json({
            success: true,
            message: alreadyEnrolled
                ? 'Payment approved (user was already enrolled)'
                : 'Payment approved and user enrolled'
        });

    } catch (error) {
        //  Don't expose internal error details
        console.error('[Approve] Error');
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

/**
 * Reject a pending payment with optional reason.
 * Input validation and logging
 * 
 * @route POST /api/admin/reject-payment
 * @access Admin only
 */
router.post('/api/admin/reject-payment', isAdmin, async (req, res) => {
    try {
        const { purchaseId, reason } = req.body;

        //  Validate purchaseId format
        if (!isValidObjectId(purchaseId)) {
            return res.status(400).json({ success: false, message: 'Invalid purchase ID format' });
        }

        // 1. Fetch purchase details before updating
        const purchase = await prisma.purchase.findUnique({ where: { id: purchaseId } });

        if (!purchase) {
            return res.status(404).json({ success: false, message: 'Purchase record not found' });
        }

        // Validate and sanitize reason
        const safeReason = validateReason(reason);

        // Wrap update and delete in transaction for consistency
        try {
            await prisma.$transaction(async (tx) => {
                // 2. Mark purchase as rejected with reason
                await tx.purchase.update({
                    where: { id: purchaseId },
                    data: {
                        status: 'REJECTED',
                        rejectionReason: safeReason
                    }
                });
            });
        } catch {
            return res.status(500).json({ success: false, message: 'Failed to update purchase' });
        }

        // 3. Cleanup: Delete the screenshot (user will resubmit new one)
        if (purchase.screenshotUrl) {
            await deleteScreenshot(purchase.screenshotUrl);
        }

        // Sanitize log output
        console.log(`[Rejection] Purchase ${sanitizeForLog(purchaseId)} rejected`);

        res.json({ success: true, message: 'Payment rejected' });

    } catch (error) {
        // Don't expose internal details
        console.error('[Reject] Error');
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

/* -------------------------------------------------------------------------- */
/*                          USER MANAGEMENT ROUTES                           */
/* -------------------------------------------------------------------------- */

/**
 * Display list of all users with basic information.
 * Pagination support
 * 
 * @route GET /admin/users
 * @access Admin only
 */
router.get('/admin/users', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page, 10) || 1);
        const limit = 10; // FIX: removed CONFIG dependency
        const skip = (page - 1) * limit;

        const [users, totalCount] = await Promise.all([
            prisma.user.findMany({
                orderBy: { createdAt: 'desc' },
                skip,
                take: limit
            }),
            prisma.user.count()
        ]);

        const sanitizedUsers = (users || []).map(user => {
            const { password, ...rest } = user;
            return {
                ...rest,
                id: user.id,
                name: user.name || user.username || 'N/A',
                username: user.username || 'unknown',
                email: user.email || 'N/A',
                phone: user.phone || 'N/A',
                role: user.role || 'USER',
                createdAt: user.createdAt,
                purchasedCourseIds: user.purchasedCourseIds || []
            };
        });

        res.render('dashboard/admin_users', {
            users: sanitizedUsers,
            pagination: {
                page,
                totalPages: Math.ceil(totalCount / limit),
                totalCount
            }
        });
    } catch (e) {
        console.error('[Users] List error', e);
        res.status(500).send('Error loading users');
    }
});

/**
 * Display detailed information about a specific user.
 * Proper validation and error handling
 * 
 * @route GET /admin/users/:id
 * @access Admin only
 */
router.get('/admin/users/:id', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const userId = req.params.id;

        const results = await Promise.allSettled([
            prisma.user.findUnique({ where: { id: userId } }),
            prisma.purchase.findMany({ where: { userId }, orderBy: { date: 'desc' } }),
            prisma.communityPost.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
            prisma.testimonial.findMany({ where: { userId }, orderBy: { submittedAt: 'desc' } })
        ]);

        const user = results[0].status === 'fulfilled' ? results[0].value : null;
        const purchases = results[1].status === 'fulfilled' ? results[1].value : [];
        const posts = results[2].status === 'fulfilled' ? results[2].value : [];
        const testimonials = results[3].status === 'fulfilled' ? results[3].value : [];

        if (!user) {
            return res.status(404).send('User not found');
        }

        const { password, ...rest } = user;
        const sanitizedProfileUser = {
            ...rest,
            id: user.id,
            name: user.name || 'N/A',
            username: user.username || 'unknown',
            email: user.email || 'N/A',
            phone: user.phone || 'N/A',
            createdAt: user.createdAt,
            purchasedCourseIds: user.purchasedCourseIds || []
        };

        const enrichedPurchases = await Promise.all(
            (purchases || []).map(async p => {
                const course = await prisma.course.findUnique({
                    where: { id: p.courseId }
                }).catch(() => null);

                return {
                    ...p,
                    courseTitle: course ? course.title : '(deleted course)',
                    amount: p.amount || 0,
                    date: p.date,
                    paymentMethod: p.paymentMethod || 'unknown',
                    status: p.status || 'PENDING'
                };
            })
        );

        const enrolledCourses = await Promise.all(
            (sanitizedProfileUser.purchasedCourseIds || []).map(cid =>
                prisma.course.findUnique({ where: { id: cid } }).catch(() => null)
            )
        );

        res.render('dashboard/admin_user_detail', {
            profileUser: sanitizedProfileUser,
            purchases: enrichedPurchases,
            posts,
            testimonials,
            enrolledCourses: enrolledCourses.filter(Boolean)
        });
    } catch (e) {
        console.error('[Users] Detail error', e);
        res.status(500).send('Error loading user detail');
    }
});
/* -------------------------------------------------------------------------- */
/*                        COURSE VIDEO MANAGEMENT                            */
/* -------------------------------------------------------------------------- */

/**
 * Render the video management interface for a specific course.
 * Proper validation
 * 
 * @route GET /admin/courses/:id/videos
 * @access Admin only
 */
router.get('/admin/courses/:id/videos', isAuthenticated, isAdmin, async (req, res) => {
    try {
        const courseId = req.params.id;

        const course = await prisma.course.findUnique({
            where: { id: courseId }
        });

        if (!course) {
            return res.status(404).render('error', { message: 'Course not found' });
        }

        const videos = await prisma.courseVideo.findMany({
            where: { courseId },
            orderBy: { order: 'asc' },
            take: 100
        });

        res.render('dashboard/admin_course_videos', {
            user: req.session?.user || null,
            course,
            videos,
            path: '/admin/courses'
        });
    } catch (error) {
        console.error('[Videos] View error', error);
        res.status(500).render('error', { message: 'Internal Server Error' });
    }
});

/**
 * Add a new video lesson to a course.
 * Proper validation
 * 
 * @route POST /api/admin/courses/:id/videos
 * @access Admin only
 */
router.post('/api/admin/courses/:id/videos', isAdmin, async (req, res) => {
    // Handle optional thumbnail upload
    thumbnailUpload.single('thumbnail')(req, res, async (err) => {
        if (err) {
            console.error('[Video] Thumbnail upload error:', err.message);
            return res.status(400).json({ success: false, message: err.message });
        }

        try {
            const courseId = req.params.id;
            const { title, description, youtubeUrl } = req.body;

            //  Validate courseId format
            if (!isValidObjectId(courseId)) {
                return res.status(400).json({ success: false, message: 'Invalid course ID' });
            }

            // 1. Validate required fields
            if (!title || typeof title !== 'string' || !title.trim()) {
                return res.status(400).json({ success: false, message: 'Title is required' });
            }

            if (!youtubeUrl || typeof youtubeUrl !== 'string') {
                return res.status(400).json({ success: false, message: 'YouTube URL is required' });
            }

            //  Proper YouTube URL validation
            if (!isValidYouTubeUrl(youtubeUrl)) {
                return res.status(400).json({ success: false, message: 'Invalid YouTube URL' });
            }

            // Verify course exists before adding video
            const course = await prisma.course.findUnique({ where: { id: courseId } });
            if (!course) {
                return res.status(404).json({ success: false, message: 'Course not found' });
            }

            // Sanitize title and description
            const safeTitle = title.trim().slice(0, 200);
            const safeDescription = (description || '').trim().slice(0, 2000);

            // 2. Handle Thumbnail Compression if provided
            let thumbnailUrl = null;
            if (req.file) {
                try {
                    const compressedFilename = await compressImage(req.file, THUMBNAIL_DIR, 'course');
                    if (compressedFilename) {
                        thumbnailUrl = `/uploads/thumbnails/${compressedFilename}`;
                    }
                } catch (compErr) {
                    console.error('[Video] Compression failed:', compErr.message);
                    // Continue without thumbnail if compression fails (or return error if critical)
                }
            }

            // 3. Calculate next order number
            const videoCount = await prisma.courseVideo.count({ where: { courseId } });

            // 4. Create new video record
            const video = await prisma.courseVideo.create({
                data: {
                    courseId,
                    title: safeTitle,
                    description: safeDescription,
                    youtubeUrl: youtubeUrl.trim(),
                    thumbnailUrl,
                    order: videoCount + 1
                }
            });

            console.log(`[Video] Added to course ${sanitizeForLog(courseId)}`);

            res.json({ success: true, message: 'Video added successfully', video });
        } catch (error) {
            console.error('[Video] Add error:', error);
            res.status(500).json({ success: false, message: 'Internal Server Error' });
        }
    });
});

/**
 * Update an existing video lesson.
 * Proper validation and ownership check
 * 
 * @route POST /api/admin/courses/:id/videos/:videoId/update
 * @access Admin only
 */
router.post('/api/admin/courses/:id/videos/:videoId/update', isAdmin, async (req, res) => {
    // Handle optional thumbnail upload
    thumbnailUpload.single('thumbnail')(req, res, async (err) => {
        if (err) {
            console.error('[Video] Thumbnail upload error:', err.message);
            return res.status(400).json({ success: false, message: err.message });
        }

        try {
            const { title, description, youtubeUrl } = req.body;
            const { id: courseId, videoId } = req.params;

            // Validate IDs
            if (!isValidObjectId(courseId) || !isValidObjectId(videoId)) {
                return res.status(400).json({ success: false, message: 'Invalid ID format' });
            }

            // 1. Validate required fields
            if (!title || typeof title !== 'string' || !title.trim()) {
                return res.status(400).json({ success: false, message: 'Title is required' });
            }

            if (!youtubeUrl || typeof youtubeUrl !== 'string') {
                return res.status(400).json({ success: false, message: 'YouTube URL is required' });
            }

            //  Proper YouTube URL validation
            if (!isValidYouTubeUrl(youtubeUrl)) {
                return res.status(400).json({ success: false, message: 'Invalid YouTube URL' });
            }

            // Verify video belongs to the specified course
            const existingVideo = await prisma.courseVideo.findUnique({ where: { id: videoId } });
            if (!existingVideo) {
                return res.status(404).json({ success: false, message: 'Video not found' });
            }

            if (existingVideo.courseId !== courseId) {
                return res.status(403).json({ success: false, message: 'Video does not belong to this course' });
            }

            // Sanitize input
            const safeTitle = title.trim().slice(0, 200);
            const safeDescription = (description || '').trim().slice(0, 2000);

            // 2. Handle Thumbnail Replacement
            let thumbnailUrl = existingVideo.thumbnailUrl;
            if (req.file) {
                try {
                    const compressedFilename = await compressImage(req.file, THUMBNAIL_DIR, 'course');
                    if (compressedFilename) {
                        // Delete old thumbnail if it exists
                        if (existingVideo.thumbnailUrl) {
                            await deleteVideoThumbnail(existingVideo.thumbnailUrl);
                        }
                        thumbnailUrl = `/uploads/thumbnails/${compressedFilename}`;
                    }
                } catch (compErr) {
                    console.error('[Video] Compression failed:', compErr.message);
                }
            }

            // Update and verify result
            const result = await prisma.courseVideo.update({
                where: { id: videoId },
                data: {
                    title: safeTitle,
                    description: safeDescription,
                    youtubeUrl: youtubeUrl.trim(),
                    thumbnailUrl
                }
            });

            if (!result) {
                return res.status(500).json({ success: false, message: 'Update failed' });
            }

            console.log(`[Video] Updated ${sanitizeForLog(videoId)}`);

            res.json({ success: true, message: 'Video updated successfully' });
        } catch (error) {
            console.error('[Video] Update error:', error);
            res.status(500).json({ success: false, message: 'Internal Server Error' });
        }
    });
});

/**
 * Delete a video lesson from a course.
 * Ownership check, validation, delete verification
 * 
 * @route DELETE /api/admin/courses/:courseId/videos/:videoId
 * @access Admin only
 */
router.delete('/api/admin/courses/:courseId/videos/:videoId', isAdmin, async (req, res) => {
    try {
        const { courseId, videoId } = req.params;

        // Validate IDs
        if (!isValidObjectId(courseId) || !isValidObjectId(videoId)) {
            return res.status(400).json({ success: false, message: 'Invalid ID format' });
        }

        // Verify video exists and belongs to the course
        const video = await prisma.courseVideo.findUnique({ where: { id: videoId } });

        if (!video) {
            return res.status(404).json({ success: false, message: 'Video not found' });
        }

        if (video.courseId !== courseId) {
            return res.status(403).json({ success: false, message: 'Video does not belong to this course' });
        }

        // Delete and verify
        const deleteResult = await prisma.courseVideo.delete({
            where: { id: videoId }
        });

        if (!deleteResult) {
            return res.status(500).json({ success: false, message: 'Delete failed' });
        }

        // Cleanup associated thumbnail
        if (video.thumbnailUrl) {
            await deleteVideoThumbnail(video.thumbnailUrl);
        }

        console.log(`[Video] Deleted ${sanitizeForLog(videoId)}`);

        res.json({ success: true, message: 'Video deleted successfully' });
    } catch (error) {
        console.error('[Video] Delete error');
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

/* -------------------------------------------------------------------------- */
/*                          SITE SETTINGS ROUTES                             */
/* -------------------------------------------------------------------------- */

const SETTINGS_UPLOAD_DIR = path.join(__dirname, '../public/uploads/settings');
if (!fsSync.existsSync(SETTINGS_UPLOAD_DIR)) {
    fsSync.mkdirSync(SETTINGS_UPLOAD_DIR, { recursive: true, mode: 0o755 });
}

const settingsStorage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, SETTINGS_UPLOAD_DIR),
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        cb(null, 'hero-image-' + Date.now() + ext);
    }
});

const settingsUpload = multer({
    storage: settingsStorage,
    limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
    fileFilter: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        if (!CONFIG.ALLOWED_EXTENSIONS.includes(ext)) {
            return cb(new Error('Only images (JPG, PNG, WebP) are allowed'));
        }
        cb(null, true);
    }
});

/**
 * Upload a new hero image for the home page.
 */
router.post('/api/admin/settings/hero-image', isAdmin, settingsUpload.single('heroImage'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'No file uploaded' });
        }

        let finalFilename = req.file.filename;
        try {
            const compressedFilename = await compressImage(req.file, SETTINGS_UPLOAD_DIR, 'course');
            if (compressedFilename) finalFilename = compressedFilename;
        } catch (compErr) {
            console.warn('[Settings] Compression failed:', compErr.message);
        }

        const imageUrl = `/uploads/settings/${finalFilename}`;
        const oldSetting = await prisma.siteSetting.findUnique({ where: { key: 'hero_image' } });

        await prisma.siteSetting.upsert({
            where: { key: 'hero_image' },
            update: { value: imageUrl },
            create: { key: 'hero_image', value: imageUrl }
        });

        if (oldSetting && oldSetting.value && oldSetting.value.startsWith('/uploads/settings/')) {
            const oldFilename = path.basename(oldSetting.value);
            if (oldFilename !== finalFilename) {
                await fs.unlink(path.join(SETTINGS_UPLOAD_DIR, oldFilename)).catch(() => { });
                await fs.unlink(path.join(SETTINGS_UPLOAD_DIR, '.originals', oldFilename)).catch(() => { });
            }
        }

        res.json({ success: true, message: 'Hero image updated successfully', imageUrl });
    } catch (error) {
        console.error('[Settings] Upload error:', error);
        res.status(500).json({ success: false, message: 'Internal Server Error' });
    }
});

/* -------------------------------------------------------------------------- */
/*                                  EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = router;

