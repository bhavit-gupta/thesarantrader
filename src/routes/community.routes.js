/* -------------------------------------------------------------------------- */
/*                       COMMUNITY ROUTE DEFINITIONS                         */
/* -------------------------------------------------------------------------- */
/**
 * ============================================================================
 * FILE: community.routes.js
 * PURPOSE: Community forum functionality - posts, likes, comments, images
 * ============================================================================
 * 
 * 
 * Features:
 * - Social feed with posts, likes, and comments
 * - Image attachments for posts (compressed to WebP)
 * - Like/unlike functionality with real-time counts
 * - Commenting system on posts
 * - Post deletion (owner or admin only)
 * 
 * Security:
 * - CSRF protection on all POST/DELETE routes
 * - PostId validation (MongoDB ObjectId format)
 * - User ownership validation on upload
 * - Reduced file size limit (5MB)
 * - Cryptographically secure filenames
 * - Extension whitelist + MIME validation
 * - Rate limiting on posts/likes/comments
 * - Symlink protection + explicit permissions
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

const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');
const csrfProtection = require('../middleware/csrfProtection');
const { authLimiter } = require('../middleware/rateLimiter');

// Validate middleware exists at startup
if (typeof isAuthenticated !== 'function') {
    throw new Error('[COMMUNITY ROUTES] isAuthenticated middleware not found');
}

/* -------------------------------------------------------------------------- */
/*                              CONTROLLER IMPORT                             */
/* -------------------------------------------------------------------------- */

let communityController;
try {
    communityController = require('../controllers/community.controller');
} catch (error) {
    console.error('[COMMUNITY ROUTES] Failed to load community.controller:', error.message);
    communityController = {
        getPosts: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        createPost: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        likePost: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        addComment: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        deletePost: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        deleteComment: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' })
    };
}

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

const CONFIG = {
    // Reduced file size limit (5MB for forum images)
    MAX_FILE_SIZE: 5 * 1024 * 1024,

    // Request size limits (enforced at app level)
    MAX_BODY_SIZE: '50kb',

    // Upload timeout in milliseconds
    UPLOAD_TIMEOUT_MS: 60000,

    // Allowed image extensions
    ALLOWED_EXTENSIONS: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],

    // Allowed MIME types
    ALLOWED_MIMETYPES: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],

    // Upload directory permissions
    DIR_MODE: 0o755,

    // PostId validation pattern (MongoDB ObjectId)
    OBJECTID_REGEX: /^[0-9a-fA-F]{24}$/,
    // CommentId validation pattern (UUID v4)
    UUID_REGEX: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,

    // Content limits
    MAX_TITLE_LENGTH: 500,
    MAX_CONTENT_LENGTH: 5000,
    MAX_COMMENT_LENGTH: 1000,

    // Pagination limits
    MAX_POSTS_PER_REQUEST: 50,
    MAX_PAGE_NUMBER: 1000,
    MAX_TIMESTAMP: 2147483647000
};

// Generic error messages (no internal details)
const STRINGS = {
    UPLOAD_ERROR: 'File upload failed. Please try again.',
    INVALID_FILE_TYPE: 'Only images (JPEG, PNG, GIF, WebP) are allowed.',
    FILE_TOO_LARGE: 'File size exceeds the 5MB limit.',
    INVALID_POST_ID: 'Invalid post identifier.',
    INVALID_COMMENT_ID: 'Invalid comment identifier.',
    INVALID_PAGINATION: 'Invalid pagination parameters.',
    INVALID_TITLE: 'Title is required and must be under 500 characters.',
    INVALID_CONTENT: 'Content is required and must be under 5000 characters.',
    INVALID_COMMENT: 'Comment must be between 1 and 1000 characters.',
    INVALID_PATH: 'Invalid file path.',
    DIR_SETUP_ERROR: 'Upload service unavailable.',
    SERVICE_ERROR: 'Service temporarily unavailable.',
    UNAUTHORIZED: 'Please log in to perform this action.'
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
 * Validate pagination parameters
 */
function isValidPaginationParams(page, limit, after) {
    if (page !== undefined) {
        const pageNum = parseInt(page, 10);
        if (isNaN(pageNum) || pageNum < 1 || pageNum > CONFIG.MAX_PAGE_NUMBER) {
            return false;
        }
    }
    if (limit !== undefined) {
        const limitNum = parseInt(limit, 10);
        if (isNaN(limitNum) || limitNum < 1 || limitNum > CONFIG.MAX_POSTS_PER_REQUEST) {
            return false;
        }
    }
    if (after !== undefined) {
        const afterNum = parseInt(after, 10);
        if (isNaN(afterNum) || afterNum < 0 || afterNum > CONFIG.MAX_TIMESTAMP) {
            return false;
        }
    }
    return true;
}

/**
 * Log file upload for audit
 */
function logFileUpload(req, filename, success) {
    const logData = {
        action: success ? 'COMMUNITY_UPLOAD' : 'COMMUNITY_UPLOAD_FAILED',
        userId: req.user?.id || 'unknown',
        filename: filename ? filename.substring(0, 50) : 'none',
        ip: req.ip,
        timestamp: new Date().toISOString()
    };
    console.log(`[COMMUNITY] ${logData.action}:`, JSON.stringify(logData));
}

/* -------------------------------------------------------------------------- */
/*                         FILE UPLOAD CONFIGURATION                          */
/* -------------------------------------------------------------------------- */

// Secure upload directory setup
const uploadDir = path.join(__dirname, '../public/uploads/community');

try {
    if (fs.existsSync(uploadDir)) {
        const stats = fs.lstatSync(uploadDir);
        if (stats.isSymbolicLink()) {
            throw new Error('Upload directory is a symbolic link - security risk');
        }
    } else {
        fs.mkdirSync(uploadDir, { recursive: true, mode: CONFIG.DIR_MODE });
    }
} catch (error) {
    console.error('[COMMUNITY ROUTES] Upload directory setup failed:', error.message);
}

// Generate cryptographically secure filename
function generateSecureFilename(originalname) {
    const sanitized = sanitizeFilename(originalname);
    const ext = sanitized ? path.extname(sanitized).toLowerCase() : '.jpg';
    const randomBytes = crypto.randomBytes(16).toString('hex');
    return `post-${Date.now()}-${randomBytes}${ext}`;
}

// Define storage strategy
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
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
        files: 1
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
 * PostId validation middleware
 */
function validatePostId(req, res, next) {
    const { id, postId } = req.params;
    const targetId = id || postId;

    if (!isValidObjectId(targetId)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_POST_ID
        });
    }

    next();
}

/**
 * CommentId validation middleware
 */
function validateCommentId(req, res, next) {
    const { commentId } = req.params;

    if (!commentId || typeof commentId !== 'string' || !CONFIG.UUID_REGEX.test(commentId)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_COMMENT_ID
        });
    }

    next();
}

/**
 * Pagination validation middleware
 */
function validatePagination(req, res, next) {
    const { page, limit, after } = req.query;

    if (!isValidPaginationParams(page, limit, after)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_PAGINATION
        });
    }

    next();
}

/**
 * Post content validation middleware
 */
function validatePostContent(req, res, next) {
    const { title, content } = req.body || {};

    if (title && (typeof title !== 'string' || title.length > CONFIG.MAX_TITLE_LENGTH)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_TITLE
        });
    }

    if (content && (typeof content !== 'string' || content.length > CONFIG.MAX_CONTENT_LENGTH)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_CONTENT
        });
    }

    // Sanitize inputs
    req.body.title = title ? title.trim() : '';
    req.body.content = content ? content.trim() : '';

    next();
}

/**
 * Comment content validation middleware
 */
function validateCommentContent(req, res, next) {
    const { content } = req.body || {};

    if (!content || typeof content !== 'string' || content.trim().length === 0 || content.length > CONFIG.MAX_COMMENT_LENGTH) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_COMMENT
        });
    }

    req.body.content = content.trim();
    next();
}

function validateUserExists(req, res, next) {
    const user = req.session?.user || req.user;
    if (!user || !user.id) {
        return res.status(401).json({
            success: false,
            message: STRINGS.UNAUTHORIZED
        });
    }
    req.user = user; // Ensure req.user is set for downstream (like logFileUpload)
    next();
}

/**
 * Error cleanup middleware - removes temp files on failure
 */
function cleanupOnError(req, res, next) {
    const originalSend = res.send;

    res.send = function (body) {
        if (res.statusCode >= 400 && req.file && req.file.path) {
            fs.unlink(req.file.path, (err) => {
                if (err) {
                    console.error('[COMMUNITY] Cleanup failed:', err.message);
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
            console.error(`[COMMUNITY ERROR] ${req.method} ${req.path}:`, error.message);

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
/*                              API ROUTES                                    */
/* -------------------------------------------------------------------------- */

// Get Posts with validated pagination
router.get('/api/community/posts',
    validatePagination,
    asyncHandler(communityController.getPosts)
);

// Create Post with validation and CSRF (Admin Only)
router.post('/api/community/posts',
    isAdmin,
    validateUserExists,
    csrfProtection,
    authLimiter,
    cleanupOnError,
    (req, res, next) => {
        upload.single('image')(req, res, (err) => {
            if (err instanceof multer.MulterError) {
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

            if (req.file) {
                logFileUpload(req, req.file.filename, true);
            }

            next();
        });
    },
    validatePostContent,
    asyncHandler(communityController.createPost)
);

// Like/Unlike Post
router.post('/api/community/posts/:id/like',
    isAuthenticated,
    csrfProtection,
    authLimiter,
    validatePostId,
    asyncHandler(communityController.likePost)
);

// Add Comment to Post
router.post('/api/community/posts/:id/comment',
    isAuthenticated,
    csrfProtection,
    authLimiter,
    validatePostId,
    validateCommentContent,
    asyncHandler(communityController.addComment)
);

/* -------------------------------------------------------------------------- */
/*                          MODERATION ROUTES                                 */
/* -------------------------------------------------------------------------- */

// Delete Post (Owner or Admin)
router.delete('/api/community/posts/:id',
    isAuthenticated,
    csrfProtection,
    validatePostId,
    asyncHandler(communityController.deletePost)
);

// Delete Comment
router.delete('/api/community/posts/:postId/comments/:commentId',
    isAuthenticated,
    csrfProtection,
    validatePostId,
    validateCommentId,
    asyncHandler(communityController.deleteComment)
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
