/**
 * ============================================================================
 * FILE: course.controller.js
 * PURPOSE: Course management (CRUD), live streaming, and enrollment
 * ============================================================================
 * 
 * DESCRIPTION:
 * Handles all course-related operations including:
 * - Public course listing with filtering (active courses only)
 * - Admin course management (create, update, delete)
 * - Live streaming status tracking and toggling
 * - User enrollment and course access control
 * - Video viewing for enrolled users with access verification
 * 
 * FEATURES:
 * - Course creation with price validation and date management
 * - Course deletion with cascade cleanup (chat messages, user enrollments)
 * - Purchase preservation for financial audit trail
 * - Real-time live streaming indicators with timestamps
 * - Enrollment transaction with atomic updates (user list, purchase record, user count)
 * - Video player with sequential ordering and enrollment verification
 * 
 * DATA MODEL:
 * - Course: title, description, price, originalPrice, dates, icon, colors, live status
 * - Purchase: user, course, amount, status, date (financial history)
 * - CourseVideo: course, title, URL, order (sequential playback)
 * - User.purchasedCourseIds: Array of course IDs user has enrolled in
 * 
 * KEY CONCEPTS:
 * - Active courses: No endDate OR endDate in future
 * - Live status: Tracked with isLive boolean and lastLiveStartedAt timestamp
 * - Enrollment: User must purchase to access course content and videos
 * - Transactions: Used in deleteCourse() and enrollCourse() for atomic operations
 * - Purchase records: Preserved even after course deletion for financial tracking
 * 
 * DEPENDENCIES:
 * - @prisma/client: Database ORM for course, user, purchase, video operations
 * 
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require('../utils/prisma');
const { withRetry, withTimeout } = require('../utils/prisma');
const { getUserPurchasedCourses, clearUserCourseCache } = require('../utils/helpers');
const { invalidateCourseCache, invalidateUserCache } = require('../middleware/viewData.middleware');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');

/* -------------------------------------------------------------------------- */
/*                          CONFIGURATION CONSTANTS                          */
/* -------------------------------------------------------------------------- */

// Content limits
const MAX_TITLE_LENGTH = 200;
const MAX_DESCRIPTION_LENGTH = 3000;

// Allowed Tailwind color themes
const ALLOWED_COLOR_THEMES = ['red', 'blue', 'green', 'yellow', 'purple', 'pink', 'indigo', 'orange', 'teal', 'cyan', 'gray'];

// Rate limiting for enrollment (in-memory, per user)
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_ENROLLMENTS = 5; // Max 5 enrollment attempts per minute
const enrollRateLimits = new Map(); // Map<userId, { count, resetTime }>

/* -------------------------------------------------------------------------- */
/*                              HELPER FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

/**
 * Checks if user has exceeded enrollment rate limit.
 * @param {string} userId - User ID to check
 * @returns {boolean} - True if rate limited
 */
function isEnrollRateLimited(userId) {
    const now = Date.now();
    const userLimit = enrollRateLimits.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
        enrollRateLimits.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }

    if (userLimit.count >= RATE_LIMIT_MAX_ENROLLMENTS) {
        return true;
    }

    userLimit.count++;
    return false;
}

/**
 * Validates URL format.
 * @param {string} url - URL string to validate
 * @returns {boolean} - True if valid URL
 */
function isValidUrl(url) {
    if (!url || !url.trim()) return true; // Empty is allowed
    try {
        new URL(url);
        return true;
    } catch {
        return false;
    }
}

/**
 * Validates date logic for course creation/editing.
 * @param {Date|null} startDate - Course start date
 * @param {Date|null} endDate - Course end date
 * @param {Date|null} enrollmentDeadline - Enrollment deadline
 * @returns {string|null} - Error message or null if valid
 */
function validateCourseDates(startDate, endDate, enrollmentDeadline) {
    if (startDate && endDate && startDate >= endDate) {
        return 'Start date must be before end date';
    }
    return null;
}

/**
 * Validates course input data.
 * @param {Object} data - Course data to validate
 * @returns {string|null} - Error message or null if valid
 */
function validateCourseInput(data) {
    const { title, description, price, originalPrice, colorTheme, liveLink, demoVideoUrl, startDate, endDate, enrollmentDeadline, icon, badge, badgeColor } = data;


    // Title validation
    if (!title || !title.trim() || title.trim().length > MAX_TITLE_LENGTH) {
        return `Title must be 1-${MAX_TITLE_LENGTH} characters`;
    }

    // Description validation
    if (!description || !description.trim() || description.trim().length > MAX_DESCRIPTION_LENGTH) {
        return `Description must be 1-${MAX_DESCRIPTION_LENGTH} characters`;
    }

    // Price validation
    const parsedPrice = parseInt(price);
    const parsedOriginalPrice = parseInt(originalPrice);

    if (isNaN(parsedPrice) || parsedPrice < 0 || isNaN(parsedOriginalPrice) || parsedOriginalPrice < 0) {
        return 'Prices must be valid positive numbers';
    }

    if (parsedPrice > parsedOriginalPrice) {
        return 'Sale price cannot exceed original price';
    }

    // Color theme validation
    if (colorTheme && !ALLOWED_COLOR_THEMES.includes(colorTheme)) {
        return `Invalid color theme. Allowed: ${ALLOWED_COLOR_THEMES.join(', ')}`;
    }

    // Icon validation (single emoji)
    if (icon && icon.length > 4) { // Emojis can be up to 4 bytes
        return 'Icon must be a single emoji';
    }

    // URL validations
    if (!isValidUrl(liveLink)) {
        return 'Invalid live link URL';
    }
    if (!isValidUrl(demoVideoUrl)) {
        return 'Invalid demo video URL';
    }

    // Date logic validation
    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    const deadline = enrollmentDeadline ? new Date(enrollmentDeadline) : null;

    const dateError = validateCourseDates(start, end, deadline);
    if (dateError) {
        return dateError;
    }

    return null;
}

/* -------------------------------------------------------------------------- */
/*                              PUBLIC ROUTES                                */
/* -------------------------------------------------------------------------- */

/**
 * Fetches all courses that are currently active (not ended).
 * 
 * Returns courses that:
 * - Have no end date (ongoing indefinitely)
 * - OR have an end date in the future
 * 
 * Used by the public courses page and enrolled users dashboard.
 * 
 * NOTE: Uses proper date filtering for active courses only.
 * 
 * @route GET /api/courses
 * @access Public
 * @returns {Array} Array of course objects sorted by start date (ascending)
 */
exports.getAllCourses = async (req, res) => {
    try {
        const now = new Date();

        // Fetch only active courses (not ended) with retry
        const courses = await withRetry(
            () => prisma.course.findMany({
                where: {
                    OR: [
                        { endDate: { gte: now } },       // End date is in the future
                        { endDate: null }                 // No end date (ongoing)
                    ],
                    // [Fix] Handle both literal null and non-existent field in MongoDB
                    OR: [
                        { deletedAt: null },
                        { deletedAt: { isSet: false } }
                    ]
                },
                orderBy: { startDate: 'asc' }
            }),
            2
        );

        res.json(courses);
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        res.status(500).json({ success: false, message: "Error fetching courses" });
    }
};

/* -------------------------------------------------------------------------- */
/*                         ADMIN COURSE MANAGEMENT                            */
/* -------------------------------------------------------------------------- */

/**
 * Renders the course management dashboard for administrators.
 * 
 * Displays all courses (active and ended) with options to:
 * - Add new courses
 * - Edit existing courses
 * - Delete courses
 * - Toggle live streaming status
 * 
 * @route GET /admin/courses
 * @access Admin only (verified by middleware)
 */
exports.getAdminCourses = async (req, res) => {
    // 1. Verify admin access
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Admin access only' });
    }

    try {
        // 2. Fetch all courses (including ended ones for admin visibility) with retry
        const courses = await withRetry(() => prisma.course.findMany(), 2);

        // 3. Render admin dashboard
        res.render("dashboard/admin_courses", {
            courses,
            user: req.session.user
        });
    } catch (e) {
        console.error("❌ Admin Fetch Error:", e);
        res.status(500).json({ success: false, message: 'Error loading admin dashboard' });
    }
};

/**
 * Creates a new course in the system.
 * 
 * Features:
 * - Validates price and original price values
 * - Sets default icon and color theme if not provided
 * - Configures enrollment and duration dates
 * - Initializes with 0 users and 5.0 rating
 * 
 * @route POST /admin/courses/add
 * @access Admin only
 * 
 * Body Parameters:
 * @param {string} title - Course name
 * @param {string} description - Course description
 * @param {number} price - Discounted price
 * @param {number} originalPrice - Original price (before discount)
 * @param {string} icon - Emoji icon (default: 📚)
 * @param {string} colorTheme - Tailwind color name (default: blue)
 * @param {string} liveLink - Live streaming URL
 * @param {string} demoVideoUrl - Demo/preview video URL
 * @param {Date} startDate - Course start date
 * @param {Date} endDate - Course end date
 * @param {Date} enrollmentDeadline - Last date to enroll
 * 
 */
exports.addCourse = async (req, res) => {
    // 1. Authorization check
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Admin access only' });
    }

    const { title, description, price, originalPrice, icon, colorTheme, liveLink, demoVideoUrl, startDate, endDate, enrollmentDeadline } = req.body;

    // 2. Comprehensive validation
    const validationError = validateCourseInput(req.body);
    if (validationError) {
        return res.status(400).json({ success: false, message: validationError });
    }

    const { badge, badgeColor } = req.body;
    const parsedPrice = parseInt(price);
    const parsedOriginalPrice = parseInt(originalPrice);

    try {
        // 3. Create new course with validated data using retry
        const newCourse = await withRetry(
            () => prisma.course.create({
                data: {
                    title: title.trim(),
                    description: description.trim(),
                    price: parsedPrice,
                    originalPrice: parsedOriginalPrice,
                    users: 0,                                             // No enrollments yet
                    icon: icon || "📚",                                   // Default book emoji
                    iconBg: `${colorTheme || 'blue'}-50`,                // Light background
                    iconColor: `${colorTheme || 'blue'}-500`,            // Darker icon color
                    badge: badge || "New",                                // Custom badge selection
                    badgeColor: badgeColor || "green",                    // Custom badge color
                    demoVideoUrl: demoVideoUrl || "",
                    liveLink: liveLink || "",
                    startDate: startDate ? new Date(startDate) : null,
                    endDate: endDate ? new Date(endDate) : null,
                    enrollmentDeadline: enrollmentDeadline ? new Date(enrollmentDeadline) : null
                }
            }),
            2
        );


        // 4. Log creation for monitoring
        console.log(`✅ [NEW COURSE] Added: ${title} (#${newCourse.id})`);

        // 5. Invalidate cache and redirect
        invalidateCourseCache();
        res.redirect('/admin/courses');
    } catch (e) {
        console.error("❌ Course Addition Error:", e);
        res.status(500).json({ success: false, message: 'Error adding course: ' + e.message });
    }
};

/**
 * Deletes a course and performs cleanup of associated data.
 * 
 * Cleanup Process (executed as a transaction):
 * 1. Deletes all chat messages for the course
 * 2. Removes course from users' purchased course lists (revokes access)
 * 3. Deletes the course record
 * 
 * Note: Purchase records are preserved for financial history and auditing.
 * 
 * 
 * @route DELETE /admin/courses/:id
 * @access Admin only
 * 
 * @param {string} id - Course ID to delete (from URL params)
 */
exports.deleteCourse = async (req, res) => {
    // 1. Authorization check
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Admin access only' });
    }

    const courseId = req.params.id;

    try {
        // 2. Check if course exists and is not live
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }

        if (course.isLive) {
            return res.status(400).json({
                success: false,
                message: 'Cannot delete course while it is live. Stop the stream first.'
            });
        }

        // 3. Execute all cleanup operations as a single atomic transaction with retry
        // If any step fails, all changes are rolled back
        await withRetry(
            () => prisma.$transaction(async (tx) => {
                // 3a. Delete all chat messages for this course
                await tx.chatMessage.deleteMany({ where: { courseId } });

                // 3b. Revoke access: Remove course from all users' enrollment lists
                const usersWithCourse = await tx.user.findMany({
                    where: { purchasedCourseIds: { has: courseId } },
                    select: { id: true, purchasedCourseIds: true }
                });

                // Update each enrolled user's course list
                for (const user of usersWithCourse) {
                    const newIds = user.purchasedCourseIds.filter(id => id !== courseId);
                    await tx.user.update({
                        where: { id: user.id },
                        data: { purchasedCourseIds: newIds }
                    });
                }

                // 3c. Delete the course record itself
                await tx.course.delete({ where: { id: courseId } });
            }),
            3 // Critical operation: 3 retries
        );

        // Note: Purchase records in the Purchase table are NOT deleted
        // This preserves financial history for accounting and refund tracking
        // 4. Invalidate cache and redirect
        invalidateCourseCache();
        res.redirect('/admin/courses');
    } catch (e) {
        console.error("❌ Course Deletion Error:", e);
        res.status(500).json({ success: false, message: 'Error deleting course: ' + e.message });
    }
};

/**
 * Updates an existing course with new information.
 * 
 * Features:
 * - Validates price inputs
 * - Updates all course metadata (title, description, dates, etc.)
 * - Conditionally updates icon and color theme if provided
 * - Preserves existing values for fields not included in the request
 * 
 * @route POST /admin/courses/:id/edit
 * @access Admin only
 * 
 * @param {string} id - Course ID to update (from URL params)
 * Body parameters are the same as addCourse (all optional except prices)
 * 
 */
exports.editCourse = async (req, res) => {
    // 1. Authorization check
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Admin access only' });
    }

    const courseId = req.params.id;
    const { title, description, price, originalPrice, icon, colorTheme, liveLink, demoVideoUrl, startDate, endDate, enrollmentDeadline, badge, badgeColor } = req.body;

    // 2. Comprehensive validation [, 4.2, 4.5, 4.6, 4.7, 4.16]
    const validationError = validateCourseInput(req.body);
    if (validationError) {
        return res.status(400).json({ success: false, message: validationError });
    }

    const parsedPrice = parseInt(price);
    const parsedOriginalPrice = parseInt(originalPrice);

    // 3. Build update object with core fields
    const updateData = {
        title: title.trim(),
        description: description.trim(),
        price: parsedPrice,
        originalPrice: parsedOriginalPrice,
        demoVideoUrl: demoVideoUrl || "",
        liveLink: liveLink || "",
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        enrollmentDeadline: enrollmentDeadline ? new Date(enrollmentDeadline) : null,
        badge: badge || null, // Update badge
        badgeColor: badgeColor || "blue" // Update badge color
    };


    // 4. Conditionally update icon and color theme
    if (icon) updateData.icon = icon;
    if (colorTheme) {
        updateData.iconBg = `${colorTheme}-50`;
        updateData.iconColor = `${colorTheme}-500`;
    }

    try {
        // 5. Apply updates to database with retry
        await withRetry(
            () => prisma.course.update({ where: { id: courseId }, data: updateData }),
            2
        );
        console.log(`✏️ [COURSE UPDATED] ${courseId}`);
        invalidateCourseCache();
        res.redirect('/admin/courses');
    } catch (e) {
        console.error("❌ Update Error:", e);
        res.status(500).json({ success: false, message: 'Error updating course' });
    }
};

/* -------------------------------------------------------------------------- */
/*                        LIVE STREAMING MANAGEMENT                          */
/* -------------------------------------------------------------------------- */

/**
 * Fetches the current live streaming status for all active courses.
 * 
 * Used by the frontend to:
 * - Display "LIVE" badges on course cards
 * - Show live stream duration
 * - Enable real-time status updates via polling
 * 
 * @route GET /api/courses/live-status
 * @access Public
 * 
 * @returns {Object} liveSessions - Map of courseId to { isLive, startTime }
 */
exports.getLiveStatus = async (req, res) => {
    try {
        // 1. Authentication check for user purchases
        const purchasedCourseIds = req.session?.user?.purchasedCourseIds || [];
        const isAdmin = req.session?.user?.role === 'ADMIN';

        // 2. Fetch all courses currently streaming live
        const liveCourses = await prisma.course.findMany({
            where: { isLive: true }
        });

        // 3. Build response object mapping courseId to status
        const liveSessions = {};
        liveCourses.forEach(c => {
            if (isAdmin || purchasedCourseIds.includes(c.id)) {
                liveSessions[c.id] = {
                    isLive: true,
                    startTime: c.lastLiveStartedAt ? c.lastLiveStartedAt.getTime() : null
                };
            }
        });

        res.json({ liveSessions });
    } catch (error) {
        console.error("❌ Live Status Fetch Error:", error);
        res.status(500).json({ success: false, message: "Error fetching status" });
    }
};

/**
 * Toggles a course's live streaming status on/off.
 * 
 * Behavior:
 * - Starting stream: Sets isLive=true and records current timestamp
 * - Stopping stream: Sets isLive=false and clears timestamp
 * 
 * Used by admins to indicate when they're actively streaming a course.
 * Users see "LIVE" indicators and can join the stream.
 * 
 * @route POST /api/courses/toggle-live
 * @access Admin only
 * 
 * Body Parameters:
 * @param {string} courseId - ID of the course to toggle
 */
exports.toggleLiveStatus = async (req, res) => {
    // 1. Authorization check
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: 'Admin access only' });
    }

    const { courseId } = req.body;

    // 2. Validate input
    if (!courseId) {
        return res.status(400).json({ success: false, message: "Invalid ID" });
    }

    try {
        // 3. Verify course exists
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) {
            return res.status(404).json({ success: false, message: "Course not found" });
        }

        // 4. Calculate new status
        // Use provided target state if available, otherwise toggle
        const { isLive: requestedState } = req.body;
        const newIsLive = typeof requestedState === 'boolean' ? requestedState : !course.isLive;
        const newStartTime = newIsLive ? new Date() : null;  // Record start time or clear it

        // 5. Update database
        await prisma.course.update({
            where: { id: courseId },
            data: {
                isLive: newIsLive,
                lastLiveStartedAt: newStartTime
            }
        });

        // 5.1 Invalidate global view cache so other users/pages see the update
        invalidateCourseCache();

        // 6. Log status change for monitoring
        console.log(`🔴 [LIVE TOGGLE] Course ${courseId} is now ${newIsLive ? 'LIVE' : 'OFFLINE'}`);

        res.json({
            success: true,
            courseId,
            isLive: newIsLive,
            startTime: newStartTime ? newStartTime.getTime() : null
        });

    } catch (error) {
        console.error("❌ Live Toggle Error:", error);
        res.status(500).json({ success: false, message: "Toggle failed" });
    }
};

/* -------------------------------------------------------------------------- */
/*                          ENROLLMENT MANAGEMENT                            */
/* -------------------------------------------------------------------------- */

/**
 * Manually enrolls a user in a course (typically used for testing or admin grants).
 * 
 * This is NOT the normal enrollment flow (which goes through payment verification).
 * Use this for:
 * - Testing course access
 * - Admin granting free access
 * - Manual enrollment corrections
 * 
 * Transaction includes:
 * 1. Adding course to user's purchasedCourseIds array
 * 2. Creating a purchase record for financial tracking
 * 3. Incrementing course user count
 * 
 * @route POST /api/courses/enroll
 * @access Private (requires authentication)
 * 
 * Body Parameters:
 * @param {string} courseId - ID of the course to enroll in
 * 
 */
exports.enrollCourse = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: "Login required" });
    }

    const { courseId } = req.body;
    const userId = req.session.user.id;

    // 2. Rate limiting check
    if (isEnrollRateLimited(userId)) {
        return res.status(429).json({
            success: false,
            message: 'Too many enrollment attempts. Please wait a minute.'
        });
    }

    try {
        // 3. Verify course exists
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) {
            return res.status(404).json({ success: false, message: "Course not found" });
        }

        // 4. Check enrollment deadline
        const now = new Date();
        if (course.enrollmentDeadline && now > course.enrollmentDeadline) {
            return res.status(400).json({
                success: false,
                message: 'Enrollment deadline has passed'
            });
        }
        if (course.endDate && now > course.endDate) {
            return res.status(400).json({
                success: false,
                message: 'Course has ended'
            });
        }

        // 5. Check if already enrolled
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { purchasedCourseIds: true }
        });

        const safePurchasedIds = user?.purchasedCourseIds || [];
        if (safePurchasedIds.includes(courseId)) {
            return res.status(400).json({ success: false, message: "Already enrolled" });
        }

        // 6. Execute enrollment as atomic transaction
        await prisma.$transaction(async (tx) => {
            // 6a. Check for duplicate purchase record
            const existingPurchase = await tx.purchase.findFirst({
                where: { userId, courseId }
            });
            if (existingPurchase) {
                throw new Error('DUPLICATE_PURCHASE');
            }

            // 6b. Add course to user's enrollment list
            await tx.user.update({
                where: { id: userId },
                data: { purchasedCourseIds: { push: courseId } }
            });

            // 6c. Create purchase record for tracking
            await tx.purchase.create({
                data: {
                    userId,
                    courseId,
                    amount: course.price,
                    status: 'completed',
                    date: new Date()
                }
            });

            // 6d. Increment user count
            await tx.course.update({
                where: { id: courseId },
                data: { users: { increment: 1 } }
            });
        });

        // 7. Log enrollment for monitoring
        console.log(`🎓 [ENROLLMENT] ${req.session.user.name} joined ${course.title}`);
        // Invalidate caches immediately so user sees "Enrolled" and has access
        try {
            clearUserCourseCache(userId);
            invalidateUserCache(userId);
        } catch (cacheError) {
            console.error('[Enroll] Cache invalidation failed:', cacheError.message);
        }

        res.json({ success: true, message: 'User enrolled successfully' });

    } catch (error) {
        if (error.message === 'DUPLICATE_PURCHASE') {
            return res.status(400).json({ success: false, message: 'Already enrolled' });
        }
        console.error("❌ Enrollment Error:", error);
        res.status(500).json({ success: false, message: "Failed to enroll" });
    }
};

/* -------------------------------------------------------------------------- */
/*                            USER VIDEO ACCESS                              */
/* -------------------------------------------------------------------------- */

/**
 * Renders the video player page for enrolled users.
 * 
 * Features:
 * - Verifies user has purchased the course
 * - Displays course videos in sequential order
 * - Shows video titles, descriptions, and playback controls
 * - Only accessible to users who have completed payment
 * 
 * @route GET /courses/:id/videos
 * @access Private (requires authentication and course purchase)
 * 
 * @param {string} id - Course ID (from URL params)
 * 
 */
exports.viewCourseVideos = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.redirect('/login?returnUrl=' + encodeURIComponent(req.path));
    }

    const courseId = req.params.id;
    const userId = req.session.user.id;

    try {
        // 2. Verify user has purchased this course
        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { purchasedCourseIds: true }
        });

        if (!user || !user.purchasedCourseIds.includes(courseId)) {
            return res.redirect('/dashboard?error=not_enrolled');
        }

        // 3. Fetch course details
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) {
            return res.redirect('/dashboard');
        }

        // 4. Fetch all videos for this course in proper order
        const videos = await prisma.courseVideo.findMany({
            where: { courseId: courseId },
            orderBy: { order: 'asc' }  // Sequential order (Lesson 1, 2, 3...)
        });

        // 5. Handle empty video list gracefully
        if (!videos || videos.length === 0) {
            return res.render("dashboard/user_course_videos", {
                course,
                videos: [],
                user: req.session.user,
                message: 'No videos available for this course yet'
            });
        }

        // 6. Render video player interface
        res.render("dashboard/user_course_videos", {
            course,
            videos,
            user: req.session.user
        });
    } catch (e) {
        console.error("❌ User Video Fetch Error:", e);
        res.status(500).json({ success: false, message: 'Error loading course content' });
    }
};

/* -------------------------------------------------------------------------- */
/*                          AUTOMATED CLEANUP TASK                            */
/* -------------------------------------------------------------------------- */

/**
 * Background task: Clean up expired courses.
 * 
 * Purpose:
 * - Automatically stops live streams for courses that have ended
 * - Performs any other maintenance for expired courses
 * 
 * Logic: 
 * 1. Find all courses where endDate < now AND isLive is true
 * 2. Update them to set isLive = false
 * 
 * @returns {Promise<number>} Number of courses updated
 */
exports.cleanupExpiredCourses = async () => {
    try {
        const now = new Date();
        
        // 1. Find and stop live streams for courses that have ended
        const result = await prisma.course.updateMany({
            where: {
                endDate: { lt: now },
                isLive: true
            },
            data: {
                isLive: false,
                lastLiveStartedAt: null
            }
        });

        if (result.count > 0) {
            console.log(`🧹 [CLEANUP] Stopped live streams for ${result.count} expired courses.`);
            // Invalidate cache if courses were updated
            invalidateCourseCache();
        }

        return result.count;
    } catch (error) {
        console.error("❌ Error running course cleanup:", error);
        throw error;
    }
};
