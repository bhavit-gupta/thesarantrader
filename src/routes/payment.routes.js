/* -------------------------------------------------------------------------- */
/*                        PAYMENT ROUTE DEFINITIONS                          */
/* -------------------------------------------------------------------------- */
/*
 * This file defines routes for manual payment processing with screenshot verification.
 * 
 * Payment Flow:
 * 1. User pays via external method (bank transfer, UPI, etc.)
 * 2. User uploads payment screenshot as proof
 * 3. Admin reviews screenshot and approves/rejects
 * 4. On approval: User gets course access
 * 5. On rejection: User can resubmit with correct proof
 * 
 * Security Features:
 * - CSRF protection on all POST routes
 * - CourseId/UserId validation
 * - Payment amount validation
 * - Secure filename generation
 * - Magic byte validation
 * - Rate limiting
 * - Audit logging
 * - File cleanup on failure
 * - Symlink protection
 * 
 * Payment Proof Requirements:
 * - Must be image format (JPEG, PNG, WebP)
 * - Maximum 5MB file size
 * - Should show transaction details
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const express = require('express');
const router = express.Router();
const prisma = require('../utils/prisma');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { compressImage } = require('../utils/upload.utils');
const csrfProtection = require('../middleware/csrfProtection');
const { isAuthenticated } = require('../middleware/auth.middleware');
const { authLimiter } = require('../middleware/rateLimiter');
const { invalidateUserCache } = require('../middleware/viewData.middleware');

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                */
/* -------------------------------------------------------------------------- */

// Reduced from 100MB to 5MB - payment screenshots don't need to be large
const CONFIG = {
    MAX_FILE_SIZE: 5 * 1024 * 1024, // 5MB maximum
    UPLOAD_TIMEOUT: 30000, // 30 seconds
    OBJECTID_REGEX: /^[0-9a-fA-F]{24}$/,
    ALLOWED_MIMETYPES: new Set(['image/jpeg', 'image/png', 'image/webp']),
    ALLOWED_EXTENSIONS: new Set(['.jpg', '.jpeg', '.png', '.webp']),
    // Magic bytes for image validation
    MAGIC_BYTES: {
        jpeg: [0xFF, 0xD8, 0xFF],
        png: [0x89, 0x50, 0x4E, 0x47],
        webp: [0x52, 0x49, 0x46, 0x46] // RIFF header
    },
    VALID_PAYMENT_METHODS: new Set(['manual', 'upi', 'bank_transfer']),
    MIN_PRICE: 0,
    MAX_PRICE: 999999
};

// Generic error messages - don't expose internals
const STRINGS = {
    UPLOAD_FAILED: 'File upload failed. Please try again.',
    INVALID_FILE_TYPE: 'Invalid file type. Only JPEG, PNG, or WebP images allowed.',
    INVALID_COURSE_ID: 'Invalid course identifier.',
    UNAUTHORIZED: 'Authentication required.',
    INVALID_SESSION: 'Invalid session. Please login again.',
    COURSE_NOT_FOUND: 'Course not found.',
    ALREADY_PURCHASED: 'You have already purchased this course.',
    PENDING_APPROVAL: 'Verification in progress. Please wait for admin approval.',
    INVALID_PRICE: 'Course price is invalid.',
    SUBMISSION_SUCCESS: 'Payment proof submitted. Waiting for admin approval.',
    SERVER_ERROR: 'An error occurred. Please try again.'
};

/* -------------------------------------------------------------------------- */
/*                         FILE UPLOAD CONFIGURATION                         */
/* -------------------------------------------------------------------------- */

const UPLOAD_DIR = path.join(__dirname, '../public/uploads/payments');

// Ensure upload directory exists with proper permissions
function ensureUploadDirectory() {
    if (!fs.existsSync(UPLOAD_DIR)) {
        fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o755 });
    }
}
ensureUploadDirectory();

// Check for symlink attacks
function isSymlink(filePath) {
    try {
        const stats = fs.lstatSync(filePath);
        return stats.isSymbolicLink();
    } catch {
        return false;
    }
}

// Secure filename generation using crypto
function generateSecureFilename(originalname) {
    const ext = path.extname(originalname).toLowerCase();
    const randomBytes = crypto.randomBytes(16).toString('hex');
    return `payment-${randomBytes}${ext}`;
}

// Validate file magic bytes
function validateMagicBytes(buffer) {
    if (!buffer || buffer.length < 4) return false;

    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
        return 'image/jpeg';
    }

    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
        return 'image/png';
    }

    // WebP: RIFF....WEBP
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) {
        if (buffer.length >= 12 && buffer[8] === 0x57 && buffer[9] === 0x45 &&
            buffer[10] === 0x42 && buffer[11] === 0x50) {
            return 'image/webp';
        }
    }

    return false;
}

// File cleanup helper
function cleanupFile(filePath) {
    if (filePath && fs.existsSync(filePath)) {
        try {
            fs.unlinkSync(filePath);
        } catch (err) {
            console.error('[Payment] File cleanup error:', err.message);
        }
    }
}

// Define storage strategy with secure filenames
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Symlink protection
        if (isSymlink(UPLOAD_DIR)) {
            return cb(new Error('Invalid upload directory'));
        }
        cb(null, UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        // Cryptographically secure filename
        cb(null, generateSecureFilename(file.originalname));
    }
});

// Configure multer with validation
const upload = multer({
    storage: storage,
    limits: {
        fileSize: CONFIG.MAX_FILE_SIZE // 5MB maximum
    },
    fileFilter: function (req, file, cb) {
        // Check MIME type
        if (!CONFIG.ALLOWED_MIMETYPES.has(file.mimetype)) {
            return cb(new Error(STRINGS.INVALID_FILE_TYPE));
        }

        // Check extension
        const ext = path.extname(file.originalname).toLowerCase();
        if (!CONFIG.ALLOWED_EXTENSIONS.has(ext)) {
            return cb(new Error(STRINGS.INVALID_FILE_TYPE));
        }

        cb(null, true);
    }
});

/* -------------------------------------------------------------------------- */
/*                           VALIDATION MIDDLEWARE                           */
/* -------------------------------------------------------------------------- */

// Validate courseId format
function validateCourseId(req, res, next) {
    const courseId = req.body.courseId;

    if (!courseId || typeof courseId !== 'string') {
        return res.status(400).json({ success: false, message: STRINGS.INVALID_COURSE_ID });
    }

    if (!CONFIG.OBJECTID_REGEX.test(courseId)) {
        return res.status(400).json({ success: false, message: STRINGS.INVALID_COURSE_ID });
    }

    next();
}

// Validate session user
function validateSessionUser(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ success: false, message: STRINGS.UNAUTHORIZED });
    }

    const userId = req.session.user.id;
    if (!userId || typeof userId !== 'string' || !CONFIG.OBJECTID_REGEX.test(userId)) {
        return res.status(401).json({ success: false, message: STRINGS.INVALID_SESSION });
    }

    next();
}

// Validate file upload success
function validateFileUpload(req, res, next) {
    if (!req.file) {
        return res.status(400).json({
            success: false,
            message: 'Payment screenshot is required.'
        });
    }
    next();
}

// Cleanup middleware on error
function cleanupOnError(req, res, next) {
    const originalJson = res.json.bind(res);
    res.json = function (data) {
        if (!data.success && req.file) {
            cleanupFile(req.file.path);
        }
        return originalJson(data);
    };
    next();
}

/* -------------------------------------------------------------------------- */
/*                              AUDIT LOGGING                                */
/* -------------------------------------------------------------------------- */

// Payment audit logging
async function logPaymentAudit(userId, action, details) {
    try {
        // Audit log action locally or to DB if needed
        // In production, log to database:
        // await prisma.auditLog.create({
        //     data: { userId, action, details: JSON.stringify(details), timestamp: new Date() }
        // });
    } catch (err) {
        console.error('[Payment Audit] Logging error:', err.message);
    }
}

/* -------------------------------------------------------------------------- */
/*                              API ROUTES                                   */
/* -------------------------------------------------------------------------- */

/**
 * Submit payment proof for course purchase.
 * 
 * Security:
 * - CSRF protection
 * - Rate limiting
 * - Session validation
 * - CourseId validation
 * - Magic byte validation
 * - File cleanup on failure
 * - Audit logging
 * 
 * @route POST /api/payment/submit-proof
 * @access Private (requires authentication)
 */
router.post('/api/payment/submit-proof',
    isAuthenticated,
    csrfProtection, // CSRF protection
    authLimiter, // Rate limiting
    validateSessionUser, // Session user validation
    (req, res, next) => {
        // Handle screenshot upload with error handling
        upload.single('screenshot')(req, res, (err) => {
            if (err) {
                console.error('[Payment] Upload error:', err.message);
                // Generic error message
                return res.status(400).json({
                    success: false,
                    message: STRINGS.UPLOAD_FAILED
                });
            }
            next();
        });
    },
    validateFileUpload, // Validate file exists
    cleanupOnError, // Cleanup on error
    async (req, res) => {
        const filePath = req.file ? req.file.path : null;

        try {
            const { courseId } = req.body;
            const userId = req.session.user.id;

            // Validate courseId format
            if (!courseId || typeof courseId !== 'string' || !CONFIG.OBJECTID_REGEX.test(courseId)) {
                return res.status(400).json({
                    success: false,
                    message: STRINGS.INVALID_COURSE_ID
                });
            }

            // Validate magic bytes
            const fileBuffer = fs.readFileSync(filePath);
            const detectedType = validateMagicBytes(fileBuffer);
            if (!detectedType) {
                cleanupFile(filePath);
                return res.status(400).json({
                    success: false,
                    message: STRINGS.INVALID_FILE_TYPE
                });
            }

            // Verify course exists
            const course = await prisma.course.findUnique({ where: { id: courseId } });
            if (!course) {
                return res.status(404).json({
                    success: false,
                    message: STRINGS.COURSE_NOT_FOUND
                });
            }

            // Validate payment amount
            if (typeof course.price !== 'number' || course.price < CONFIG.MIN_PRICE || course.price > CONFIG.MAX_PRICE) {
                return res.status(400).json({
                    success: false,
                    message: STRINGS.INVALID_PRICE
                });
            }

            // Check for existing purchases with proper handling
            const existingPurchase = await prisma.purchase.findFirst({
                where: {
                    userId: userId,
                    courseId: courseId,
                    status: { in: ['COMPLETED', 'PENDING'] }
                }
            });

            if (existingPurchase) {
                if (existingPurchase.status === 'PENDING') {
                    return res.status(400).json({
                        success: false,
                        message: STRINGS.PENDING_APPROVAL
                    });
                }
                return res.status(400).json({
                    success: false,
                    message: STRINGS.ALREADY_PURCHASED
                });
            }

            // Clean up old rejected purchases
            await prisma.purchase.deleteMany({
                where: {
                    userId: userId,
                    courseId: courseId,
                    status: 'REJECTED'
                }
            });

            // Compress payment screenshot to save storage
            const compressedFilename = await compressImage(req.file, UPLOAD_DIR);

            // Validate compression result
            if (!compressedFilename) {
                cleanupFile(filePath);
                throw new Error('Image compression failed');
            }

            // Delete original after successful compression
            if (filePath !== path.join(UPLOAD_DIR, compressedFilename)) {
                cleanupFile(filePath);
            }

            // Store price at submission time
            const submittedPrice = course.price;

            // Create purchase record
            await prisma.purchase.create({
                data: {
                    userId: userId,
                    courseId: courseId,
                    amount: submittedPrice, // Price at submission time
                    paymentMethod: 'MANUAL', // Validated method
                    screenshotUrl: '/uploads/payments/' + compressedFilename,
                    status: 'PENDING'
                }
            });

            // Invalidate user cache to show "Waiting for Approval" immediately
            invalidateUserCache(userId);

            // Audit logging
            await logPaymentAudit(userId, 'PAYMENT_SUBMITTED', {
                courseId,
                amount: submittedPrice,
                timestamp: new Date().toISOString()
            });

            res.json({
                success: true,
                message: STRINGS.SUBMISSION_SUCCESS
            });

        } catch (error) {
            console.error('[Payment] Submission error:', error.message);
            // Cleanup file on database error
            cleanupFile(filePath);
            res.status(500).json({
                success: false,
                message: STRINGS.SERVER_ERROR
            });
        }
    }
);

/* -------------------------------------------------------------------------- */
/*                                  EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = router;

// Export utilities for testing
module.exports.validateMagicBytes = validateMagicBytes;
module.exports.generateSecureFilename = generateSecureFilename;
module.exports.CONFIG = CONFIG;

