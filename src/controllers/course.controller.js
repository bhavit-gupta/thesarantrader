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
const { compressImage } = require('../utils/upload.utils');

const THUMBNAIL_DIR = path.join(__dirname, '../public/uploads/thumbnails');

/* -------------------------------------------------------------------------- */
/*                          CONFIGURATION CONSTANTS                          */
/* -------------------------------------------------------------------------- */

// Content limits
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 10000;

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
    const { title, description, price, originalPrice, colorTheme, zoomMeetingId, zoomPassword, demoVideoUrl, startDate, endDate, enrollmentDeadline, icon, badge, badgeColor, level } = data;


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

    // Zoom Meeting ID validation (numeric string)
    if (zoomMeetingId && !/^\d+$/.test(zoomMeetingId.replace(/\s/g, ''))) {
        return 'Invalid Zoom Meeting ID (should be numbers only)';
    }

    if (!isValidUrl(demoVideoUrl)) {
        return 'Invalid demo video URL';
    }


    // Date logic validation (Conditional based on "No Deadline" flags)
    const { noEndDate, noEnrollmentDeadline } = data;

    // Start date is always required for sorting/timeline
    if (!startDate) return 'Start date is required';
    const start = new Date(startDate);
    if (isNaN(start.getTime())) return 'Invalid start date format';

    // End date validation (only if not "Unlimited")
    let end = null;
    if (noEndDate !== 'true' && noEndDate !== true && endDate) {
        end = new Date(endDate);
        if (isNaN(end.getTime())) return 'Invalid end date format';
    }

    // Enrollment deadline validation (only if not "Unlimited")
    let deadline = null;
    if (noEnrollmentDeadline !== 'true' && noEnrollmentDeadline !== true && enrollmentDeadline) {
        deadline = new Date(enrollmentDeadline);
        if (isNaN(deadline.getTime())) return 'Invalid enrollment deadline format';
    }

    // Logical cross-date validation
    if (start && end && start >= end) {
        return 'Start date must be before end date';
    }

    // Level validation
    const ALLOWED_LEVELS = ['Learn Step 1', 'Nifty Zoom Live Session', 'Nifty+Zoom+Commodity'];
    if (level && !ALLOWED_LEVELS.includes(level)) {
        return 'Invalid course level selected';
    }

    // Publish Validation: Cannot publish if expired
    if (data.isPublished === 'on' || data.isPublished === true) {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        if (end && end < now) {
            return 'Cannot publish a course that has already ended. Please extend the End Date first.';
        }
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
        const startOfToday = new Date(now);
        startOfToday.setHours(0, 0, 0, 0);

        // --- Just-In-Time Unpublishing Hook ---
        // Automatically unpublish courses where the end date has passed.
        // This ensures the database accurately reflects the course state.
        try {
            await prisma.course.updateMany({
                where: {
                    isPublished: true,
                    endDate: { lt: startOfToday },
                    NOT: { endDate: null }
                },
                data: { isPublished: false }
            });
        } catch (unpublishErr) {
            console.warn("⚠️ [JIT Unpublish] Failed to auto-unpublish expired courses:", unpublishErr.message);
        }

        // Fetch only active, published courses for students
        const courses = await withRetry(
            () => prisma.course.findMany({
                where: {
                    AND: [
                        { isPublished: true },                    // Must be published
                        {
                            OR: [
                                { endDate: { gte: startOfToday } }, // End date in future
                                { endDate: null }                   // No end date
                            ]
                        },
                        {
                            OR: [
                                { enrollmentDeadline: { gte: startOfToday } }, // Enrollment open
                                { enrollmentDeadline: null }                   // No deadline
                            ]
                        },
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

/**
 * API: Fetches a single course by ID.
 * Used by the admin dashboard for pre-filling edit forms.
 */
exports.getCourseById = async (req, res) => {
    try {
        const { id } = req.params;
        const course = await prisma.course.findUnique({
            where: { id }
        });

        if (!course) {
            return res.status(404).json({ success: false, message: "Course not found" });
        }

        res.json(course);
    } catch (error) {
        console.error("❌ API Fetch Error:", error);
        res.status(500).json({ success: false, message: "Error fetching course" });
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
        // 2. Fetch only non-deleted courses for admin visibility
        const courses = await withRetry(
            () => prisma.course.findMany({}),
            2
        );

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

    const { title, description, price, originalPrice, icon, colorTheme, zoomMeetingId, zoomPassword, demoVideoUrl, startDate, endDate, enrollmentDeadline, level, dailyLiveTime } = req.body;

    // 2. Comprehensive validation
    const validationError = validateCourseInput(req.body);
    if (validationError) {
        return res.status(400).json({ success: false, message: validationError });
    }


    const { badge, badgeColor } = req.body;
    const parsedPrice = parseInt(price);
    const parsedOriginalPrice = parseInt(originalPrice);

    try {
        // 2.5 Handle Thumbnail Upload & Compression
        let thumbnailUrl = req.body.thumbnailUrl || null;
        if (req.file) {
            try {
                const compressedFilename = await compressImage(req.file, THUMBNAIL_DIR, 'course');
                if (compressedFilename) {
                    thumbnailUrl = `/uploads/thumbnails/${compressedFilename}`;
                }
            } catch (compErr) {
                console.error('⚠️ [Thumbnail] Compression failed:', compErr.message);
            }
        }

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
                    thumbnailUrl,
                    isPublished: req.body.isPublished === 'on',
                    zoomMeetingId: zoomMeetingId || "",
                    zoomPassword: zoomPassword || "",
                    startDate: startDate ? new Date(startDate) : null,
                    endDate: req.body.noEndDate === 'true' ? null : (endDate ? new Date(endDate) : null),
                    enrollmentDeadline: req.body.noEnrollmentDeadline === 'true' ? null : (enrollmentDeadline ? new Date(enrollmentDeadline) : null),
                    level: level || null,
                    dailyLiveTime: dailyLiveTime || null
                }
            }),
            2
        );


        // 4. Log creation for monitoring
        console.log(`✅ [NEW COURSE] Added: ${title} (#${newCourse.id})`);

        // 5. Invalidate cache and respond
        invalidateCourseCache();

        // AJAX response check (Safe header check)
        if (req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('json'))) {
            return res.status(201).json({ 
                success: true, 
                message: 'Course created successfully!', 
                courseId: newCourse.id 
            });
        }

        const referer = req.get('Referer');
        res.redirect(referer ? referer : '/admin/courses');
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
        await withRetry(
            () => prisma.$transaction(async (tx) => {
                // 3a. Find and delete physical files for resources
                const resources = await tx.courseResource.findMany({
                    where: { courseId },
                    select: { path: true }
                });

                for (const resource of resources) {
                    if (resource.path) {
                        const filePath = path.join(__dirname, '../public', resource.path);
                        await fs.unlink(filePath).catch(() => { }); // Ignore errors if file already gone
                    }
                }

                // 3b. Delete database records in logical order (child to parent)
                
                // Delete Chat Messages
                await tx.chatMessage.deleteMany({ where: { courseId } });

                // Delete Resources
                await tx.courseResource.deleteMany({ where: { courseId } });

                // Delete Folders
                await tx.courseFolder.deleteMany({ where: { courseId } });

                // Delete Legacy Videos (if collection exists)
                // Note: wrapped in try-catch in case model is already removed from prisma client but remains in DB
                try {
                    await tx.courseVideo.deleteMany({ where: { courseId } });
                } catch (vErr) { /* ignore */ }

                // 3c. Revoke access: Remove course from all users' enrollment lists
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

                // 3d. Delete the course record permanently
                await tx.course.delete({ where: { id: courseId } });
            }),
            3 // Critical operation: 3 retries
        );

        // 4. Delete Thumbnail from disk
        if (course.thumbnailUrl && course.thumbnailUrl.startsWith('/uploads/thumbnails/')) {
            const thumbPath = path.join(__dirname, '../public', course.thumbnailUrl);
            await fs.unlink(thumbPath).catch(() => { });
        }

        // 5. Invalidate cache and respond
        invalidateCourseCache();

        // AJAX response check (Safe header check)
        if (req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('json'))) {
            return res.json({ 
                success: true, 
                message: 'Course deleted successfully!' 
            });
        }

        const referer = req.get('Referer');
        res.redirect(referer ? referer : '/admin/courses');
    } catch (e) {
        console.error("❌ Course Deletion Error:", e);
        
        // Return JSON error for AJAX, redirect for forms
        if (req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('json'))) {
            return res.status(500).json({ success: false, message: 'Error deleting course: ' + e.message });
        }
        
        const referer = req.get('Referer');
        res.redirect(referer ? referer + '?error=' + encodeURIComponent(e.message) : '/admin/courses?error=deletion_failed');
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
    const { title, description, price, originalPrice, icon, colorTheme, zoomMeetingId, zoomPassword, demoVideoUrl, startDate, endDate, enrollmentDeadline, badge, badgeColor, level, dailyLiveTime } = req.body;


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
        zoomMeetingId: zoomMeetingId || "",
        zoomPassword: zoomPassword || "",
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
        enrollmentDeadline: enrollmentDeadline ? new Date(enrollmentDeadline) : null,
        badge: badge || null, // Update badge
        badgeColor: badgeColor || "blue", // Update badge color
        level: level || null,
        dailyLiveTime: dailyLiveTime || null,
        isPublished: req.body.isPublished === 'on',
    };

    // Correctly handle nulls for dates if Unlimited is selected
    updateData.endDate = req.body.noEndDate === 'true' ? null : (endDate ? new Date(endDate) : null);
    updateData.enrollmentDeadline = req.body.noEnrollmentDeadline === 'true' ? null : (enrollmentDeadline ? new Date(enrollmentDeadline) : null);

    // 3.5 Handle Thumbnail replacement
    if (req.file) {
        try {
            const compressedFilename = await compressImage(req.file, THUMBNAIL_DIR, 'course');
            if (compressedFilename) {
                // Delete old file if it was a local upload
                const oldCourse = await prisma.course.findUnique({ where: { id: courseId }, select: { thumbnailUrl: true } });
                if (oldCourse?.thumbnailUrl && oldCourse.thumbnailUrl.startsWith('/uploads/thumbnails/')) {
                    const oldPath = path.join(__dirname, '../public', oldCourse.thumbnailUrl);
                    await fs.unlink(oldPath).catch(() => { });
                }
                updateData.thumbnailUrl = `/uploads/thumbnails/${compressedFilename}`;
            }
        } catch (compErr) {
            console.error('⚠️ [Thumbnail] Edit compression failed:', compErr.message);
        }
    } else if (req.body.thumbnailUrl !== undefined) {
        // Fallback for manual URL entry if file wasn't provided
        updateData.thumbnailUrl = req.body.thumbnailUrl || null;
    }


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

        // AJAX response check (Safe header check)
        if (req.xhr || (req.headers && req.headers.accept && req.headers.accept.includes('json'))) {
            return res.json({ 
                success: true, 
                message: 'Course updated successfully!', 
                courseId 
            });
        }

        const referer = req.get('Referer');
        res.redirect(referer ? referer : '/admin/courses');
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
        
        // Helper to check enrollment that works for both Array and Set
        const checkEnrollment = (courseId) => {
            if (!purchasedCourseIds) return false;
            if (Array.isArray(purchasedCourseIds)) return purchasedCourseIds.includes(courseId);
            if (purchasedCourseIds instanceof Set) return purchasedCourseIds.has(courseId);
            return false;
        };

        liveCourses.forEach(c => {
            if (isAdmin || checkEnrollment(c.id)) {
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
        return res.redirect('/login');
    }

    const courseId = req.params.id;
    const userId = req.session.user.id;
    const isAdmin = String(req.session.user.role).toUpperCase() === 'ADMIN';

    try {
        // 2. Access verification (Admins bypass enrollment check)
        if (!isAdmin) {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { purchasedCourseIds: true }
            });

            if (!user || !user.purchasedCourseIds.includes(courseId)) {
                return res.redirect('/dashboard?error=not_enrolled');
            }
        }

        // 3. Fetch course details
        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) {
            return res.redirect('/dashboard');
        }

        // 4. Fetch all videos for this course in proper order
        const videos = await prisma.courseVideo.findMany({
            where: { courseId: courseId },
            orderBy: { order: 'asc' }
        });

        // 5. Render video player interface with role context
        res.render("dashboard/user_course_videos", {
            course,
            videos,
            user: req.session.user,
            isAdmin,
            csrfToken: res.locals.csrfToken || req.csrfToken?.() || ''
        });
    } catch (e) {
        console.error("❌ Course View Error:", e);
        res.status(500).send('Error loading course content');
    }
};

/**
 * renderMyCourses - Displays the course portal with enrolled courses.
 * 
 * Logic:
 * - Admin: Sees all non-deleted courses.
 * - User: Sees only courses in their purchasedCourseIds.
 */
exports.renderMyCourses = async (req, res) => {
    try {
        if (!req.session.user) return res.redirect('/login');

        const userId = req.session.user.id;
        const isAdmin = String(req.session.user.role).toUpperCase() === 'ADMIN';

        const now = new Date();
        
        // --- Just-In-Time Unpublishing Hook ---
        try {
            await exports.cleanupExpiredCourses();
        } catch (cleanupErr) {
            console.warn("⚠️ [JIT Unpublish] Cleanup failed during renderMyCourses:", cleanupErr.message);
        }

        if (isAdmin) {
            // Admin sees all non-deleted courses
            filter = {
                OR: [
                    { deletedAt: null },
                    { deletedAt: { isSet: false } }
                ]
            };
        } else {
            // Student sees only purchased, published, and non-expired courses
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { purchasedCourseIds: true }
            });
            const purchasedIds = user?.purchasedCourseIds || [];
            
            filter = {
                id: { in: purchasedIds },
                isPublished: true,
                AND: [
                    {
                        OR: [
                            { deletedAt: null },
                            { deletedAt: { isSet: false } }
                        ]
                    },
                    {
                        OR: [
                            { endDate: null },
                            { endDate: { isSet: false } },
                            { endDate: { gt: now } }
                        ]
                    }
                ]
            };
        }

        courses = await prisma.course.findMany({
            where: filter,
            orderBy: { startDate: 'desc' }
        });

        // 4. Fetch lesson counts for each course for the UI
        const coursesWithMetadata = await Promise.all(courses.map(async (course) => {
            const videoCount = await prisma.courseResource.count({
                where: { 
                    courseId: course.id,
                    type: 'VIDEO'
                }
            });
            return {
                ...course,
                videoCount
            };
        }));

        res.render('dashboard/my_courses', {
            user: req.session.user,
            courses: coursesWithMetadata,
            isAdmin,
            path: '/my-courses'
        });
    } catch (error) {
        console.error('[MyCourses] Render error:', error);
        res.status(500).send('Error loading your courses');
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
        const liveResult = await prisma.course.updateMany({
            where: {
                endDate: { lt: now },
                isLive: true
            },
            data: {
                isLive: false,
                lastLiveStartedAt: null
            }
        });

        // 2. Unpublish courses that have passed their end date
        const publishResult = await prisma.course.updateMany({
            where: {
                endDate: { lt: now },
                isPublished: true
            },
            data: {
                isPublished: false
            }
        });

        if (liveResult.count > 0 || publishResult.count > 0) {
            console.log(`🧹 [CLEANUP] Stopped ${liveResult.count} live streams and unpublished ${publishResult.count} expired courses.`);
            // Invalidate cache if courses were updated
            invalidateCourseCache();
        }

        return liveResult.count + publishResult.count;
    } catch (error) {
        console.error("❌ Error running course cleanup:", error);
        throw error;
    }
};

/**
 * renderLiveControlPage - Renders the unified broadcast control dashboard.
 * Groups courses into "Ongoing" and "Upcoming" for centralized management.
 * 
 * @route GET /admin/live
 * @access Admin only
 */
exports.renderLiveControlPage = async (req, res) => {
    try {
        const now = new Date();

        // 1. Fetch all courses with basic metadata
        const allCourses = await withRetry(() => prisma.course.findMany({
            where: {
                OR: [
                    { deletedAt: null },
                    { deletedAt: { isSet: false } }
                ]
            },
            orderBy: { startDate: 'desc' }
        }), 2);

        // 2. Categorize courses based on dates and status
        const ongoing = [];
        const upcoming = [];

        allCourses.forEach(course => {
            const start = course.startDate ? new Date(course.startDate) : null;
            const end = course.endDate ? new Date(course.endDate) : null;
            
            // Logically Ongoing: Started or No End Date, and not clearly in the future
            const isFuture = start && start > now;
            
            if (isFuture) {
                upcoming.push(course);
            } else {
                ongoing.push(course);
            }
        });

        // 3. Render the control panel
        if (!res.locals.csrfToken) {
            console.warn('⚠️ [Live Control] No CSRF token in res.locals! AJAX controls may fail.');
        }

        res.render('dashboard/admin_live_control', {
            user: req.session.user,
            ongoing,
            upcoming,
            now: now.toISOString(), // Pass for server-client time sync
            csrfToken: res.locals.csrfToken || ''
        });

    } catch (error) {
        console.error('❌ Live Control Error:', error.message);
        res.status(500).render('error', { 
            message: 'Failed to load live session controls. Please try again.',
            errorId: req.errorId 
        });
    }
};

/**
 * Admin Landing Page Management - Control site-wide branding and hero imagery.
 * Supports multiple hero images (gallery).
 * 
 * @route GET /admin/landing-page
 * @access Admin only
 */
exports.renderLandingPageManagement = async (req, res) => {
    try {
        const settings = await prisma.siteSetting.findMany({
            where: {
                key: { in: ['hero_image', 'dashboard_images', 'dashboard_broadcast_message'] }
            }
        });

        const heroSetting = settings.find(s => s.key === 'hero_image');
        let heroImages = [];
        if (heroSetting && heroSetting.value) {
            try {
                const parsed = JSON.parse(heroSetting.value);
                heroImages = Array.isArray(parsed) ? parsed : [heroSetting.value];
            } catch (e) {
                heroImages = [heroSetting.value];
            }
        } else {
            heroImages = ['/images/hero-image.png'];
        }

        const dashSetting = settings.find(s => s.key === 'dashboard_images');
        let dashboardImages = [];
        if (dashSetting && dashSetting.value) {
            try {
                dashboardImages = JSON.parse(dashSetting.value);
                if (!Array.isArray(dashboardImages)) dashboardImages = [];
            } catch (e) {
                dashboardImages = [];
            }
        }

        const broadcastSetting = settings.find(s => s.key === 'dashboard_broadcast_message');
        const dashboardBroadcastMessage = broadcastSetting ? broadcastSetting.value : '';

        res.render('dashboard/admin_landing_page', {
            user: req.session.user,
            heroImages: heroImages,
            dashboardImages: dashboardImages,
            dashboardBroadcastMessage: dashboardBroadcastMessage,
            csrfToken: res.locals.csrfToken
        });
    } catch (error) {
        console.error('❌ Landing Page Management Error:', error.message);
        res.status(500).render('error', { 
            message: 'Failed to load landing page controls.',
            errorId: req.errorId 
        });
    }
};
