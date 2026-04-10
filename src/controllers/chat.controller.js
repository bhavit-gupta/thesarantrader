/**
 * ============================================================================
 * FILE: chat.controller.js
 * PURPOSE: Real-time chat messaging for courses
 * ============================================================================
 * 
 * DESCRIPTION:
 * Handles course chat functionality including:
 * - Chat room page rendering (list of purchasable courses)
 * - Individual chat room display (messages + interface)
 * - Message fetching with smart pagination & real-time polling
 * - Message sending with optional image attachments
 * - Automatic cleanup of old messages from database
 * 
 * KEY FEATURES:
 * - Smart polling: Fetch only new messages (real-time without full reload)
 * - Image compression: WebP format, ~70% size reduction
 * - Cleanup scheduler: Auto-delete messages older than 7 days
 * - Role-based access: Users see purchased courses, admins see all
 * - Image attachment support: Optional chat images with compression
 * 
 * DEPENDENCIES:
 * - @prisma/client: Database ORM
 * - multer middleware: Handles file uploads
 * - compressImage utility: Converts images to WebP
 * 
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require('../utils/prisma');
const { withRetry } = require('../utils/prisma');
const { getUserPurchasedCourses } = require('../utils/helpers');
const fs = require('fs');
const path = require('path');
const { compressImage } = require('../utils/upload.utils');
const { GLOBAL_CHAT_ID, GLOBAL_CHAT_DEFAULTS } = require('../utils/constants');

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

// Message validation constants
const MAX_MESSAGE_LENGTH = 5000;

// Rate limiting configuration (in-memory for simplicity)
// Production: Use Redis for distributed rate limiting
const messageRateLimits = new Map();
const RATE_LIMIT_WINDOW_MS = 10000; // 10 seconds
const RATE_LIMIT_MAX_MESSAGES = 5; // Max 5 messages per window

// Allowed file types for image uploads
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/* -------------------------------------------------------------------------- */
/*                            HELPER FUNCTIONS                                */
/* -------------------------------------------------------------------------- */

/**
 * Check rate limit for message sending
 * @param {string} userId - User ID
 * @param {string} courseId - Course ID
 * @returns {boolean} true if rate limited (should block), false if allowed
 */
function isRateLimited(userId, courseId) {
    const key = `${userId}_${courseId}`;
    const now = Date.now();

    if (!messageRateLimits.has(key)) {
        messageRateLimits.set(key, { count: 1, windowStart: now });
        return false;
    }

    const limit = messageRateLimits.get(key);

    // Reset window if expired
    if (now - limit.windowStart > RATE_LIMIT_WINDOW_MS) {
        messageRateLimits.set(key, { count: 1, windowStart: now });
        return false;
    }

    // Increment count
    limit.count++;

    // Check if over limit
    if (limit.count > RATE_LIMIT_MAX_MESSAGES) {
        return true;
    }

    return false;
}

/**
 * Sanitize message text to prevent XSS
 * Removes HTML tags and dangerous characters
 * @param {string} text - Input text
 * @returns {string} Sanitized text
 */
function sanitizeMessage(text) {
    if (!text) return '';

    return text
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;')
        .trim();
}

/**
 * Validate filename doesn't contain path traversal characters
 * @param {string} filename - Filename to validate
 * @returns {boolean} true if safe, false if suspicious
 */
function isValidFilename(filename) {
    if (!filename) return false;

    // Check for path traversal attempts
    if (filename.includes('..') ||
        filename.includes('/') ||
        filename.includes('\\') ||
        filename.includes('\0')) {
        return false;
    }

    return true;
}

/* -------------------------------------------------------------------------- */
/*                            CHAT ROOM CONTROLLERS                           */
/* -------------------------------------------------------------------------- */

/**
 * Attaches lastActivityAt (timestamp of most recent message) to each course object.
 * Courses with no messages will have lastActivityAt = null.
 * @param {Array} courses - Array of course objects to mutate in-place
 */
async function attachLastActivity(courses) {
    const courseIds = courses.map(c => c.id).filter(Boolean);
    if (courseIds.length === 0) return;

    // Fetch the latest message timestamp for each course in one query
    const latestMessages = await prisma.chatMessage.findMany({
        where: { courseId: { in: courseIds } },
        orderBy: { timestamp: 'desc' },
        distinct: ['courseId'],
        select: { courseId: true, timestamp: true }
    });

    // Build a lookup map: courseId → latest timestamp
    const activityMap = new Map(latestMessages.map(m => [m.courseId, m.timestamp]));

    // Attach lastActivityAt to each course
    courses.forEach(course => {
        course.lastActivityAt = activityMap.get(course.id) || null;
    });
}

/**
 * Attaches unreadCount to each course object for a specific user.
 * @param {string} userId - ID of the user to check unread messages for
 * @param {Array} courses - Array of course objects to mutate (must have .id and .lastActivityAt)
 */
async function attachUnreadCounts(userId, courses) {
    if (!userId || courses.length === 0) return;

    // 1. Fetch all read status records for this user in one query
    const courseIds = courses.map(c => c.id).filter(Boolean);
    const readStatuses = await prisma.chatReadStatus.findMany({
        where: {
            userId,
            courseId: { in: courseIds }
        }
    });

    // Lookup map: courseId → lastReadAt
    const readMap = new Map(readStatuses.map(rs => [rs.courseId, rs.lastReadAt]));

    // 2. Count unread messages for each course
    await Promise.all(courses.map(async (course) => {
        const lastReadAt = readMap.get(course.id);
        
        // If course has no activity, unread is 0
        if (!course.lastActivityAt) {
            course.unreadCount = 0;
            return;
        }

        // If user never read this chat, all messages are unread (capped at 50 for performance)
        // Or if last message is after last read
        const lastActivityDate = new Date(course.lastActivityAt);
        if (!lastReadAt || lastActivityDate > lastReadAt) {
            const count = await prisma.chatMessage.count({
                where: {
                    courseId: course.id,
                    timestamp: { gt: lastReadAt || new Date(0) }
                }
            });
            course.unreadCount = count;
        } else {
            course.unreadCount = 0;
        }
    }));
}

/**
 * Renders the chat rooms page for authenticated users.
 * 
 * Behavior:
 * - Admin users: See all available courses
 * - Users: See only purchased courses with live (ongoing) status
 * - Redirects to courses page if user has no purchases
 * 
 * @route GET /chat/rooms
 * @access Private (requires authentication)
 */
exports.getChatRooms = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.redirect('/login');
    }

    try {
        // 2. Admin users get access to ALL courses
        if (String(req.session.user.role || '').toUpperCase() === 'ADMIN') {
            const courses = await withRetry(() => prisma.course.findMany(), 2);
            
            // Ensure Global Chat is at the top if it exists in DB, otherwise add it from defaults
            const hasGlobal = courses.some(c => c.id === GLOBAL_CHAT_ID);
            const displayCourses = hasGlobal ? courses : [GLOBAL_CHAT_DEFAULTS, ...courses];

            // Attach metadata
            await attachLastActivity(displayCourses);
            await attachUnreadCounts(req.session.user.id, displayCourses);

            res.render('layouts/chat-rooms', {
                user: req.session.user,
                purchasedCourses: displayCourses,
                isAdmin: true
            });
            return;
        }

        // 3. Additional validation for regular users
        if (!req.session.user.id) {
            return res.redirect('/login');
        }

        // 4. Fetch courses purchased by this user
        const purchasedIds = await getUserPurchasedCourses(req.session.user.id);

        // 6. Retrieve full course details for purchased courses with retry
        const purchasedCourses = await withRetry(
            () => prisma.course.findMany({
                where: {
                    id: { in: Array.from(purchasedIds) }
                }
            }),
            2
        );

        // Always add Global Chat to the list for regular users
        // Check if it's already in purchased (unlikely but possible if they 'bought' a free course with that ID)
        if (!purchasedIds.has(GLOBAL_CHAT_ID)) {
            purchasedCourses.unshift(GLOBAL_CHAT_DEFAULTS);
        }

        // Attach metadata
        await attachLastActivity(purchasedCourses);
        await attachUnreadCounts(req.session.user.id, purchasedCourses);

        // 7. Render chat rooms page with user's purchased courses + Global Chat
        res.render('layouts/chat-rooms', {
            user: req.session.user,
            purchasedCourses,
            isAdmin: false
        });
    } catch (error) {
        console.error("Error fetching chat rooms:", error);
        res.status(500).send("Error loading chat rooms");
    }
};

/**
 * Renders the individual chat room page for a specific course.
 * 
 * PURPOSE:
 * Displays the chat interface for a specific course. Users can only
 * access chats for courses they've purchased (enforced here).
 * Admins have unrestricted access to all course chats.
 * 
 
 * 
 * @route GET /chat/:courseId
 * @access Private (requires authentication + course purchase for users)
 */
exports.getCourseChat = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const courseId = String(req.params.courseId || '').trim();
    const isAdmin = String(req.session.user.role || '').toUpperCase() === 'ADMIN';

    // Validate courseId format (MongoDB ObjectId: 24 hex chars)
    if (!courseId || !/^[a-fA-F0-9]{24}$/.test(courseId)) {
        return res.render('layouts/chat-room', {
            user: req.session.user,
            course: { id: '', title: 'Invalid Course', icon: '❌' },
            isAdmin,
            errorMessage: 'Invalid course identifier. Please reload the page or contact support.'
        });
    }

    try {
        // 2. Verify course exists (Bypass DB lookup for Global Chat)
        let course;
        if (courseId === GLOBAL_CHAT_ID) {
            course = GLOBAL_CHAT_DEFAULTS;
        } else {
            course = await prisma.course.findUnique({ where: { id: courseId } });
        }

        if (!course) {
            return res.render('layouts/chat-room', {
                user: req.session.user,
                course: { id: '', title: 'Course Not Found', icon: '❓' },
                isAdmin,
                errorMessage: 'Course not found. Please check the link or contact support.'
            });
        }

        // 3. Access control check (Global Chat is always accessible)
        if (!isAdmin && courseId !== GLOBAL_CHAT_ID) {
            const purchasedCourses = await getUserPurchasedCourses(req.session.user.id);
            if (!purchasedCourses.has(courseId)) {
                return res.render('layouts/chat-room', {
                    user: req.session.user,
                    course,
                    isAdmin,
                    errorMessage: 'Access denied - Please purchase this course.'
                });
            }
        }

        // 3. Mark all messages as read for this user
        if (req.session.user.id) {
            try {
                // Upsert read status: Create if not exists, update if it does
                await prisma.chatReadStatus.upsert({
                    where: {
                        userId_courseId: {
                            userId: req.session.user.id,
                            courseId: course.id
                        }
                    },
                    update: { lastReadAt: new Date() },
                    create: {
                        userId: req.session.user.id,
                        courseId: course.id,
                        lastReadAt: new Date()
                    }
                });
            } catch (readErr) {
                console.warn(`⚠️ [ChatReadStatus] Failed to update for ${req.session.user.id}/${course.id}:`, readErr.message);
            }
        }

        // 4. Render chat room interface
        res.render('layouts/chat-room', {
            user: req.session.user,
            course,
            isAdmin,
            errorMessage: null
        });
    } catch (error) {
        console.error("Error loading chat room:", error);
        res.render('layouts/chat-room', {
            user: req.session.user,
            course: { id: '', title: 'Error', icon: '⚠️' },
            isAdmin,
            errorMessage: 'Error loading chat room. Please try again later.'
        });
    }
};

/* -------------------------------------------------------------------------- */
/*                           MESSAGE API CONTROLLERS                          */
/* -------------------------------------------------------------------------- */

/**
 * Fetches messages for a specific course with pagination and smart polling support.
 * 
 * PURPOSE:
 * Retrieves chat messages using smart pagination and real-time polling.
 * Enables both:
 * 1. Historical loading (scroll up to see older messages)
 * 2. Real-time updates (fetch only new messages periodically)
 * 
 * Features:
 * - Standard pagination: Load messages before a specific timestamp (infinite scroll)
 * - Smart polling: Fetch only new messages after a timestamp (real-time updates)
 * - Returns messages in chronological order (oldest → newest)
 * 
 * @route GET /api/chat/:courseId/messages
 * @access Private (requires authentication)
 * 
 * Query Parameters:
 * @param {string} before - Fetch messages before this timestamp (for pagination/scrolling)
 * @param {string} after - Fetch messages after this timestamp (for polling/new messages)
 * @param {number} limit - Maximum number of messages to return (default: 50, max recommended: 100)
 * 
 */
exports.getMessages = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const courseId = String(req.params.courseId || '').trim();
    const { before, limit } = req.query;
    const messageLimit = parseInt(limit) || 50;

    try {
        // 2. Build query based on pagination/polling parameters
        const query = {
            where: { courseId: courseId },
            orderBy: { timestamp: 'asc' },  // ⚠️ CHANGED: Was 'desc' + reverse (inefficient)
            take: messageLimit
        };

        // 3. Pagination: Load older messages (scroll up to see history)
        if (before) {
            const beforeDate = new Date(before);
            if (isNaN(beforeDate.getTime())) {
                return res.status(400).json({ success: false, message: "Invalid before date" });
            }
            query.where.timestamp = { lt: beforeDate };
        }

        // 4. Smart Polling: Fetch only new messages created after a specific timestamp
        // This enables real-time message updates without reloading entire history
        if (req.query.after) {
            const afterDate = new Date(parseInt(req.query.after));
            if (isNaN(afterDate.getTime())) {
                return res.status(400).json({ success: false, message: "Invalid after date" });
            }
            query.where.timestamp = { gt: afterDate };
        }

        // 5. Execute database query with retry for resilience
        const messages = await withRetry(
            () => prisma.chatMessage.findMany(query),
            2
        );

        // 6. Messages already in chronological order (no reverse needed now)
        // ⚠️ REMOVED: messages.reverse() - unnecessary with 'asc' ordering

        res.json({ success: true, messages });
    } catch (error) {
        console.error("Error fetching messages:", error);
        res.status(500).json({ success: false, message: "Error fetching messages" });
    }
};

/**
 * Creates a new chat message with optional image attachment.
 * 
 * PURPOSE:
 * Converts user input (text + optional image) into a database record.
 * Handles image compression to WebP format for efficiency.
 * 
 * Features:
 * - Text messages with emoji support
 * - Optional image upload with automatic compression to WebP format
 * - Images stored in /uploads/chat/ directory
 * - Automatic cleanup if database operation fails
 * 
 * @route POST /api/chat/:courseId/send
 * @access Private (requires authentication)
 * 
 * Body Parameters:
 * @param {string} message - The text content of the message (optional if image provided)
 * @param {File} image - Image file attachment (optional, handled by multer middleware)
 * 
 */
exports.sendMessage = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const courseId = String(req.params.courseId || '').trim();
    const { message } = req.body;

    // Rate limiting check
    if (isRateLimited(req.session.user.id, courseId)) {
        // Clean up uploaded file if rate limited
        if (req.file) {
            fs.unlink(req.file.path, () => { });
        }
        return res.status(429).json({
            success: false,
            message: 'Too many messages. Please wait before sending again.'
        });
    }

    // Validate message content
    const trimmedMessage = message ? message.trim() : '';

    if (!trimmedMessage && !req.file) {
        return res.status(400).json({
            success: false,
            message: 'Message must have text or image'
        });
    }

    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
        // Clean up uploaded file if validation fails
        if (req.file) {
            fs.unlink(req.file.path, () => { });
        }
        return res.status(400).json({
            success: false,
            message: `Message too long (max ${MAX_MESSAGE_LENGTH} characters)`
        });
    }

    // Sanitize message to prevent XSS
    const sanitizedMessage = sanitizeMessage(trimmedMessage);

    try {
        let finalImageUrl = null;

        // 2. Process image upload if present
        if (req.file) {
            // Validate file type before processing
            if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
                // Delete invalid file
                await fs.promises.unlink(req.file.path).catch(() => { });
                return res.status(400).json({
                    success: false,
                    message: 'Only image files allowed (JPEG, PNG, GIF, WebP)'
                });
            }

            const chatUploadDir = path.join(__dirname, '../public/uploads/chat');
            // Compress and convert to WebP format (reduces size by ~70%)
            const compressedFilename = await compressImage(req.file, chatUploadDir);

            // Validate filename doesn't contain path traversal
            if (!isValidFilename(compressedFilename)) {
                console.error('⚠️ Invalid filename from compression:', compressedFilename);
                throw new Error('Invalid filename from compression utility');
            }

            finalImageUrl = `/uploads/chat/${compressedFilename}`;
        }

        // 3. Create message record in database with retry
        const newMessage = await withRetry(
            () => prisma.chatMessage.create({
                data: {
                    courseId,
                    userId: req.session.user.id,
                    userName: req.session.user.name,
                    message: sanitizedMessage,
                    imageUrl: finalImageUrl
                }
            }),
            2
        );

        // 4. Log message creation for monitoring
        console.log(`💬 New message in course ${courseId} by ${newMessage.userName} ${finalImageUrl ? '(with image)' : ''}`);

        res.json({ success: true, message: 'Message sent!', chatMessage: newMessage });
    } catch (error) {
        console.error("Error sending message:", error);

        // Cleanup: Delete uploaded file if database operation failed (async/await)
        if (req.file) {
            try {
                await fs.promises.unlink(req.file.path);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    console.error("Error deleting file after DB failure:", err);
                }
            }
        }

        res.status(500).json({ success: false, message: "Error sending message" });
    }
};

/* -------------------------------------------------------------------------- */
/*                          AUTOMATED CLEANUP TASK                            */
/* -------------------------------------------------------------------------- */

/**
 * Background cleanup job that removes old chat messages to manage database size.
 * 
 * PURPOSE:
 * Runs periodically (daily at midnight) to delete old chat messages and
 * their associated image files from disk and database.
 * 
 * Cleanup Rules:
 * 1. Deletes messages older than 7 days
 * 2. Deletes all messages from courses that have ended (past endDate)
 * 3. Removes associated image files from disk
 * 
 * Execution:
 * - Runs automatically via scheduler (configured in scheduler.js)
 * - Can be called manually for maintenance
 * - Non-blocking: Errors don't crash application
 * 
 * Database Benefits:
 * - Reduces storage: Database size keeps manageable
 * - Improves performance: Fewer rows = faster queries
 * - Privacy: Deletes old conversation history
 * 
 
 * 
 * @access Internal (not exposed as route, called by scheduler)
 */
exports.cleanupOldMessages = async () => {
    const startTime = Date.now();
    let totalDeleted = 0;
    let imagesDeleted = 0;
    let estimatedSpaceFreed = 0;

    try {
        const now = new Date();

        // Calculate 7-day cutoff with 1 hour buffer for safety (prevents race conditions)
        const sevenDaysAgo = new Date(
            now.getTime() - (7 * 24 * 60 * 60 * 1000) - (1 * 60 * 60 * 1000)
        );

        // 1. Find all courses that have ended
        const endedCourses = await prisma.course.findMany({
            where: {
                endDate: { lt: now }
            },
            select: { id: true }
        });
        const endedCourseIds = endedCourses.map(c => c.id);

        // 2. Find all messages to be deleted that have image attachments
        // We need to delete these images from disk to free up storage
        const messagesWithImages = await prisma.chatMessage.findMany({
            where: {
                OR: [
                    { timestamp: { lt: sevenDaysAgo } },           // Old messages
                    { courseId: { in: endedCourseIds } }            // Messages from ended courses
                ],
                imageUrl: { not: null }
            },
            select: { imageUrl: true }
        });

        // Delete image files from disk using async/await properly
        for (const msg of messagesWithImages) {
            if (msg.imageUrl) {
                const filePath = path.join(__dirname, '../public', msg.imageUrl);
                try {
                    await fs.promises.unlink(filePath);
                    imagesDeleted++;
                    estimatedSpaceFreed += 50000; // ~50KB per image estimate
                } catch (err) {
                    // Ignore "file not found" errors (image may have been manually deleted)
                    if (err.code !== 'ENOENT') {
                        console.error("Error deleting old chat image during cleanup:", err);
                    }
                }
            }
        }

        // 4. Delete old messages from database (7+ days old)
        const deletedOld = await prisma.chatMessage.deleteMany({
            where: {
                timestamp: { lt: sevenDaysAgo }
            }
        });

        // 5. Delete messages from ended courses
        let deletedEndedCount = 0;
        if (endedCourseIds.length > 0) {
            const deletedEnded = await prisma.chatMessage.deleteMany({
                where: {
                    courseId: { in: endedCourseIds }
                }
            });
            deletedEndedCount = deletedEnded.count;
        }

        totalDeleted = deletedOld.count + deletedEndedCount;
        const durationMs = Date.now() - startTime;

        // Consistent logging with metrics
        console.log(`🧹 Chat Cleanup: ${totalDeleted} messages (${deletedOld.count} old, ${deletedEndedCount} from ${endedCourseIds.length} ended courses), ${imagesDeleted} images, ~${(estimatedSpaceFreed / 1024 / 1024).toFixed(2)}MB freed, ${durationMs}ms`);

        // Return metrics for scheduler tracking
        return {
            success: true,
            messagesDeleted: totalDeleted,
            imagesDeleted,
            endedCoursesCount: endedCourseIds.length,
            estimatedSpaceFreedBytes: estimatedSpaceFreed,
            durationMs
        };

    } catch (error) {
        console.error("❌ Error running chat cleanup:", error);
        return {
            success: false,
            error: error.message,
            messagesDeleted: totalDeleted
        };
    }
};
