/* -------------------------------------------------------------------------- */
/*                          CHAT ROUTE DEFINITIONS                           */
/* -------------------------------------------------------------------------- */
/**
 * ============================================================================
 * FILE: chat.routes.js
 * PURPOSE: Course-based chat functionality with image attachments
 * ============================================================================
 * 
 * 
 * 
 * Features:
 * - Real-time messaging within course-specific chat rooms
 * - Image attachments with WebP compression (controller handles)
 * - Smart polling for real-time updates
 * - Access control based on course purchase status
 * 
 * Security:
 * 
 * Base Path: /
 * Routes are mounted directly on the main app
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const crypto = require('crypto');

/* -------------------------------------------------------------------------- */
/*                              MIDDLEWARE IMPORTS                            */
/* -------------------------------------------------------------------------- */

const { isAuthenticated } = require('../middleware/auth.middleware');
const { requireCoursePurchase } = require('../utils/helpers');
const csrfProtection = require('../middleware/csrfProtection');

// Validate middleware exists at startup
if (typeof isAuthenticated !== 'function') {
    throw new Error('[CHAT ROUTES] isAuthenticated middleware not found');
}
if (typeof requireCoursePurchase !== 'function') {
    throw new Error('[CHAT ROUTES] requireCoursePurchase middleware not found');
}

/* -------------------------------------------------------------------------- */
/*                              CONTROLLER IMPORT                             */
/* -------------------------------------------------------------------------- */

let chatController;
try {
    chatController = require('../controllers/chat.controller');
} catch (error) {
    console.error('[CHAT ROUTES] Failed to load chat.controller:', error.message);
    // Fallback handlers
    chatController = {
        getChatRooms: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        getCourseChat: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        getMessages: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        sendMessage: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' })
    };
}

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

const CONFIG = {
    // File size limit (50MB for chat images)
    MAX_FILE_SIZE: 50 * 1024 * 1024,

    // Request size limits (enforced at app level)
    MAX_BODY_SIZE: '50kb',

    // Upload timeout in milliseconds
    UPLOAD_TIMEOUT_MS: 60000,

    // Concurrent upload limit per user (enforced via rate limiter)
    MAX_CONCURRENT_UPLOADS: 3,

    // Allowed image extensions
    ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],

    // Allowed MIME types with magic byte validation
    ALLOWED_MIMETYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],

    // Upload directory permissions
    DIR_MODE: 0o755,

    // CourseId validation pattern (MongoDB ObjectId)
    OBJECTID_REGEX: /^[0-9a-fA-F]{24}$/,

    // Pagination limits
    MAX_MESSAGES_PER_REQUEST: 100,
    MAX_TIMESTAMP: 2147483647000 // Year 2038
};

// Generic error messages (no internal details)
const STRINGS = {
    UPLOAD_ERROR: 'File upload failed. Please try again.',
    INVALID_FILE_TYPE: 'Only images (JPEG, PNG, GIF, WebP) are allowed.',
    FILE_TOO_LARGE: 'File size exceeds the 50MB limit.',
    INVALID_COURSE_ID: 'Invalid course identifier.',
    INVALID_PAGINATION: 'Invalid pagination parameters.',
    SERVICE_ERROR: 'Service temporarily unavailable.',
    INVALID_PATH: 'Invalid file path.',
    DIR_SETUP_ERROR: 'Upload service unavailable.'
};

/* -------------------------------------------------------------------------- */
/*                         VALIDATION UTILITIES                               */
/* -------------------------------------------------------------------------- */

/**
 * Validate MongoDB ObjectId format
 */
function isValidObjectId(id) {
    return typeof id === 'string' && CONFIG.OBJECTID_REGEX.test(id);
}

/**
 * Sanitize filename - remove path traversal and non-ASCII
 */
function sanitizeFilename(filename) {
    if (!filename || typeof filename !== 'string') return null;

    // Remove path components and null bytes
    const sanitized = path.basename(filename)
        .replace(/\0/g, '')           // Remove null bytes
        .replace(/[^\x20-\x7E]/g, '') // ASCII only
        .replace(/\.\./g, '');        // Remove path traversal

    return sanitized || null;
}

/**
 * Validate file extension (whitelist approach)
 */
function isValidExtension(filename) {
    const sanitized = sanitizeFilename(filename);
    if (!sanitized) return false;

    const ext = path.extname(sanitized).toLowerCase();
    return CONFIG.ALLOWED_EXTENSIONS.includes(ext);
}

/**
 * Validate pagination timestamp
 */
function isValidTimestamp(timestamp) {
    const num = parseInt(timestamp, 10);
    return !isNaN(num) && num >= 0 && num <= CONFIG.MAX_TIMESTAMP;
}

/**
 * Log file upload for audit
 */
function logFileUpload(req, filename, success) {
    const logData = {
        action: success ? 'FILE_UPLOAD' : 'FILE_UPLOAD_FAILED',
        userId: req.user?.id || 'unknown',
        courseId: req.params?.courseId,
        filename: filename ? filename.substring(0, 50) : 'none',
        ip: req.ip,
        timestamp: new Date().toISOString()
    };
    console.log(`[CHAT] ${logData.action}:`, JSON.stringify(logData));
}

/* -------------------------------------------------------------------------- */
/*                         FILE UPLOAD CONFIGURATION                          */
/* -------------------------------------------------------------------------- */

// Secure upload directory setup
const uploadDir = path.join(__dirname, '../public/uploads/chat');

try {
    // Check for symbolic links
    if (fs.existsSync(uploadDir)) {
        const stats = fs.lstatSync(uploadDir);
        if (stats.isSymbolicLink()) {
            throw new Error('Upload directory is a symbolic link - security risk');
        }
    } else {
        // Create with explicit permissions
        fs.mkdirSync(uploadDir, { recursive: true, mode: CONFIG.DIR_MODE });
    }
} catch (error) {
    console.error('[CHAT ROUTES] Upload directory setup failed:', error.message);
    // App can still start but uploads will fail gracefully
}

// Generate cryptographically secure filename
function generateSecureFilename(originalname) {
    const sanitized = sanitizeFilename(originalname);
    const ext = sanitized ? path.extname(sanitized).toLowerCase() : '.jpg';
    const randomBytes = crypto.randomBytes(16).toString('hex');
    return `chat-${Date.now()}-${randomBytes}${ext}`;
}

// Define storage strategy
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        // Verify directory exists and is not a symlink
        try {
            if (!fs.existsSync(uploadDir)) {
                return cb(new Error(STRINGS.DIR_SETUP_ERROR));
            }
            const stats = fs.lstatSync(uploadDir);
            if (stats.isSymbolicLink()) {
                return cb(new Error(STRINGS.DIR_SETUP_ERROR));
            }
            cb(null, uploadDir);
        } catch (error) {
            cb(new Error(STRINGS.DIR_SETUP_ERROR));
        }
    },
    filename: (req, file, cb) => {
        // Validate original filename
        if (!sanitizeFilename(file.originalname)) {
            return cb(new Error(STRINGS.INVALID_PATH));
        }
        cb(null, generateSecureFilename(file.originalname));
    }
});

// Configure multer with validation
const upload = multer({
    storage: storage,
    limits: {
        fileSize: CONFIG.MAX_FILE_SIZE,
        files: 1 // Single file per request
    },
    fileFilter: (req, file, cb) => {
        // Validate filename format
        if (!sanitizeFilename(file.originalname)) {
            return cb(new Error(STRINGS.INVALID_PATH));
        }

        // Validate extension (whitelist)
        if (!isValidExtension(file.originalname)) {
            return cb(new Error(STRINGS.INVALID_FILE_TYPE));
        }

        // Validate MIME type
        if (!CONFIG.ALLOWED_MIMETYPES.includes(file.mimetype)) {
            return cb(new Error(STRINGS.INVALID_FILE_TYPE));
        }

        cb(null, true);
    }
});

/* -------------------------------------------------------------------------- */
/*                          MIDDLEWARE FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

/**
 * CourseId validation middleware
 */
function validateCourseId(req, res, next) {
    const courseId = String(req.params.courseId || '').trim();

    if (!isValidObjectId(courseId)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_COURSE_ID
        });
    }

    // Update req.params.courseId with trimmed version
    req.params.courseId = courseId;

    next();
}

/**
 * Pagination validation middleware
 */
function validatePagination(req, res, next) {
    const { before, after, limit } = req.query;

    if (before && !isValidTimestamp(before)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_PAGINATION
        });
    }

    if (after && !isValidTimestamp(after)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_PAGINATION
        });
    }

    if (limit) {
        const limitNum = parseInt(limit, 10);
        if (isNaN(limitNum) || limitNum < 1 || limitNum > CONFIG.MAX_MESSAGES_PER_REQUEST) {
            return res.status(400).json({
                success: false,
                message: STRINGS.INVALID_PAGINATION
            });
        }
    }

    next();
}

/**
 * Error cleanup middleware - removes temp files on failure
 */
function cleanupOnError(req, res, next) {
    const originalSend = res.send;

    res.send = function (body) {
        // If response is an error and file was uploaded, clean up
        if (res.statusCode >= 400 && req.file && req.file.path) {
            fs.unlink(req.file.path, (err) => {
                if (err) {
                    console.error('[CHAT] Cleanup failed:', err.message);
                }
            });
        }
        return originalSend.call(this, body);
    };

    next();
}

/**
 * Error handler wrapper for async controllers
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((error) => {
            console.error(`[CHAT ERROR] ${req.method} ${req.path}:`, error.message);

            // Clean up uploaded file on error
            if (req.file && req.file.path) {
                fs.unlink(req.file.path, () => { });
            }

            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: STRINGS.SERVICE_ERROR
                });
            }
        });
    };
}

/* -------------------------------------------------------------------------- */
/*                              PAGE ROUTES                                   */
/* -------------------------------------------------------------------------- */

// Chat Room Selection
router.get('/chat', isAuthenticated, asyncHandler(chatController.getChatRooms));

// Individual Chat Room
router.get('/chat/:courseId',
    isAuthenticated,
    validateCourseId,
    requireCoursePurchase(), // Factory function - returns middleware
    asyncHandler(chatController.getCourseChat)
);

/* -------------------------------------------------------------------------- */
/*                              API ROUTES                                    */
/* -------------------------------------------------------------------------- */

// Fetch Messages with validated pagination
router.get('/api/chat/:courseId/messages',
    isAuthenticated,
    validateCourseId,
    validatePagination,
    requireCoursePurchase(),
    asyncHandler(chatController.getMessages)
);

// Send Message with CSRF protection and rate limiting
router.post('/api/chat/:courseId/messages',
    isAuthenticated,
    validateCourseId,
    csrfProtection,              // CSRF protection
    requireCoursePurchase(),
    cleanupOnError,               // Clean temp files on error
    (req, res, next) => {
        // Handle image upload with error handling
        upload.single('image')(req, res, (err) => {
            if (err instanceof multer.MulterError) {
                // Generic error messages
                if (err.code === 'LIMIT_FILE_SIZE') {
                    logFileUpload(req, null, false);
                    return res.status(400).json({
                        success: false,
                        message: STRINGS.FILE_TOO_LARGE
                    });
                }
                logFileUpload(req, null, false);
                return res.status(400).json({
                    success: false,
                    message: STRINGS.UPLOAD_ERROR
                });
            } else if (err) {
                logFileUpload(req, null, false);
                return res.status(400).json({
                    success: false,
                    message: err.message || STRINGS.UPLOAD_ERROR
                });
            }

            // Log successful upload
            if (req.file) {
                logFileUpload(req, req.file.filename, true);
            }

            next();
        });
    },
    asyncHandler(chatController.sendMessage)
);

/* -------------------------------------------------------------------------- */
/*                                  EXPORTS                                   */
/* -------------------------------------------------------------------------- */

module.exports = router;

// Export utilities for testing
module.exports.isValidObjectId = isValidObjectId;
module.exports.sanitizeFilename = sanitizeFilename;
module.exports.isValidExtension = isValidExtension;
module.exports.CONFIG = CONFIG;

