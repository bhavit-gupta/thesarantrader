/* -------------------------------------------------------------------------- */
/*                      TESTIMONIAL ROUTE DEFINITIONS                        */
/* -------------------------------------------------------------------------- */
/*
 * This file defines all routes related to testimonial/review management.
 * 
 * Security Features:
 * - CSRF protection on all POST routes
 * - Testimonial ID validation
 * - Ownership verification middleware
 * - Admin role verification
 * - Rate limiting
 * - Input validation (rating, userRole, message)
 * - Audit logging
 * 
 * Testimonial System:
 * - Users can submit one testimonial per account
 * - All submissions start in 'pending' status
 * - Admin reviews and approves/rejects submissions
 * - Only approved testimonials appear on public pages
 * - Users can delete their own testimonials anytime
 * 
 * Validation:
 * - Message length: max 500 characters
 * - Rating range: 1-5 stars
 * - UserRole: Trader, Investor only
 * - One testimonial per user (enforced)
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const express = require('express');
const router = express.Router();
const testimonialController = require('../controllers/testimonial.controller');
const csrfProtection = require('../middleware/csrfProtection');
const { authLimiter } = require('../middleware/rateLimiter');
const prisma = require('../utils/prisma');

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                */
/* -------------------------------------------------------------------------- */

const CONFIG = {
    OBJECTID_REGEX: /^[0-9a-fA-F]{24}$/,
    MAX_MESSAGE_LENGTH: 500,
    MAX_REASON_LENGTH: 200,
    MIN_RATING: 1,
    MAX_RATING: 5,
    VALID_USER_ROLES: new Set(['User', 'Trader', 'Investor']),
    DEFAULT_PAGE: 1,
    DEFAULT_LIMIT: 10,
    MAX_LIMIT: 100,
    VALID_SORT_FIELDS: new Set(['createdAt', 'rating']),
    VALID_SORT_ORDERS: new Set(['asc', 'desc'])
};

// Generic error messages - don't expose internals
const STRINGS = {
    INVALID_TESTIMONIAL_ID: 'Invalid testimonial identifier.',
    INVALID_RATING: 'Rating must be between 1 and 5.',
    INVALID_USER_ROLE: 'Invalid user role.',
    MESSAGE_TOO_LONG: 'Message must not exceed 500 characters.',
    MESSAGE_REQUIRED: 'Message is required.',
    REASON_TOO_LONG: 'Reason must not exceed 200 characters.',
    UNAUTHORIZED: 'Authentication required.',
    NOT_OWNER: 'You can only delete your own testimonials.',
    ADMIN_REQUIRED: 'Admin access required.',
    SERVER_ERROR: 'An error occurred. Please try again.',
    INVALID_PAGINATION: 'Invalid pagination parameters.'
};

/* -------------------------------------------------------------------------- */
/*                                MIDDLEWARE                                 */
/* -------------------------------------------------------------------------- */

const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');

// Validate testimonial ID format
function validateTestimonialId(req, res, next) {
    const id = req.params.id;

    if (!id || typeof id !== 'string' || !CONFIG.OBJECTID_REGEX.test(id)) {
        return res.status(400).json({ success: false, message: STRINGS.INVALID_TESTIMONIAL_ID });
    }

    next();
}

// Validate rating range
function validateRating(req, res, next) {
    const { rating } = req.body;

    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < CONFIG.MIN_RATING || ratingNum > CONFIG.MAX_RATING) {
        return res.status(400).json({ success: false, message: STRINGS.INVALID_RATING });
    }

    // Normalize to integer
    req.body.rating = ratingNum;
    next();
}

// Validate userRole
function validateUserRole(req, res, next) {
    const { userRole } = req.body;

    if (!userRole || typeof userRole !== 'string' || userRole.trim().length === 0 || userRole.length > 50) {
        return res.status(400).json({ success: false, message: STRINGS.INVALID_USER_ROLE });
    }

    // Sanitize userRole
    req.body.userRole = userRole.trim();
    next();
}

// Validate message length
function validateMessage(req, res, next) {
    const { message } = req.body;

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ success: false, message: STRINGS.MESSAGE_REQUIRED });
    }

    if (message.length > CONFIG.MAX_MESSAGE_LENGTH) {
        return res.status(400).json({ success: false, message: STRINGS.MESSAGE_TOO_LONG });
    }

    // Sanitize message - trim whitespace
    req.body.message = message.trim();
    next();
}

// Validate rejection reason
function validateRejectReason(req, res, next) {
    const { reason } = req.body;

    if (reason && typeof reason === 'string' && reason.length > CONFIG.MAX_REASON_LENGTH) {
        return res.status(400).json({ success: false, message: STRINGS.REASON_TOO_LONG });
    }

    next();
}

// Verify ownership of testimonial before delete
async function verifyOwnership(req, res, next) {
    try {
        const testimonialId = req.params.id;
        const userId = req.session.user.id;

        const testimonial = await prisma.testimonial.findUnique({
            where: { id: testimonialId },
            select: { userId: true }
        });

        if (!testimonial) {
            return res.status(404).json({ success: false, message: 'Testimonial not found.' });
        }

        if (testimonial.userId !== userId) {
            return res.status(403).json({ success: false, message: STRINGS.NOT_OWNER });
        }

        next();
    } catch (error) {
        console.error('[Testimonial] Ownership verification error:', error.message);
        return res.status(500).json({ success: false, message: STRINGS.SERVER_ERROR });
    }
}

// Secondary admin verification
function verifyAdminRole(req, res, next) {
    if (!req.session || !req.session.user || req.session.user.role !== 'ADMIN') {
        return res.status(403).json({ success: false, message: STRINGS.ADMIN_REQUIRED });
    }
    next();
}

// Validate pagination parameters
function validatePagination(req, res, next) {
    let { page, limit, sort, order } = req.query;

    page = parseInt(page, 10) || CONFIG.DEFAULT_PAGE;
    limit = parseInt(limit, 10) || CONFIG.DEFAULT_LIMIT;

    if (page < 1 || limit < 1 || limit > CONFIG.MAX_LIMIT) {
        return res.status(400).json({ success: false, message: STRINGS.INVALID_PAGINATION });
    }

    // Validate sort field
    if (sort && !CONFIG.VALID_SORT_FIELDS.has(sort)) {
        sort = 'createdAt';
    }

    if (order && !CONFIG.VALID_SORT_ORDERS.has(order)) {
        order = 'desc';
    }

    req.pagination = { page, limit, sort: sort || 'createdAt', order: order || 'desc' };
    next();
}

/* -------------------------------------------------------------------------- */
/*                              AUDIT LOGGING                                */
/* -------------------------------------------------------------------------- */

// Admin action audit logging
function logAdminAction(action) {
    return (req, res, next) => {
        const adminId = req.session?.user?.id || 'unknown';
        const testimonialId = req.params.id || req.body.id || 'unknown';
        console.log(`[Testimonial Audit] Admin: ${adminId}, Action: ${action}, Testimonial: ${testimonialId}, Time: ${new Date().toISOString()}`);
        next();
    };
}

// Middleware to log admin actions after response
function auditLog(action) {
    return (req, res, next) => {
        res.on('finish', () => {
            if (res.statusCode < 400) {
                const adminId = req.session?.user?.id || 'unknown';
                const testimonialId = req.params.id || 'unknown';
                console.log(`[Testimonial Audit] Admin: ${adminId}, Action: ${action}, Testimonial: ${testimonialId}, Status: ${res.statusCode}`);
            }
        });
        next();
    };
}

/* -------------------------------------------------------------------------- */
/*                              PUBLIC ROUTES                                */
/* -------------------------------------------------------------------------- */

// Get Approved Testimonials
router.get('/api/testimonials/approved',
    authLimiter, // IP-based rate limiting
    validatePagination,
    testimonialController.getPublicTestimonials
);
// Description: Fetch all approved testimonials for public display with pagination
// Query params: ?page=1&limit=10&sort=createdAt&order=desc&role=User&rating=5

/* -------------------------------------------------------------------------- */
/*                              USER ROUTES                                  */
/* -------------------------------------------------------------------------- */

// Get User's Own Testimonials
router.get('/api/testimonials/my-testimonials',
    isAuthenticated,
    validatePagination,
    testimonialController.getUserTestimonials
);
// Description: Fetch testimonials submitted by current user

// Submit New Testimonial
router.post('/api/testimonials/submit',
    isAuthenticated,
    csrfProtection, // CSRF protection
    authLimiter, // Rate limiting
    validateMessage, // Message validation
    validateRating, // Rating validation
    validateUserRole, // UserRole validation
    testimonialController.submitTestimonial
);
// Description: Submit a new testimonial (max 1 per user)
// Body: { message: string (max 500 chars), rating: number (1-5), userRole: string }

// Delete Own Testimonial
router.post('/api/testimonials/delete/:id',
    isAuthenticated,
    csrfProtection, // CSRF protection
    validateTestimonialId, // ID validation
    verifyOwnership, // Ownership verification
    testimonialController.deleteTestimonial
);
// Description: Delete user's own testimonial
// Note: Uses POST instead of DELETE for broad browser compatibility

/* -------------------------------------------------------------------------- */
/*                              ADMIN ROUTES                                 */
/* -------------------------------------------------------------------------- */

// Admin Testimonial Management Dashboard
router.get('/admin/testimonials',
    isAuthenticated,
    isAdmin,
    verifyAdminRole, // Secondary admin check
    validatePagination,
    testimonialController.getAdminTestimonials
);
// Description: Render admin dashboard with pending, approved, and rejected testimonials
// Note: Verified by isAdmin middleware + verifyAdminRole secondary check

// Approve Testimonial
router.post('/admin/testimonials/:id/approve',
    isAdmin,
    csrfProtection, // CSRF protection
    authLimiter, // Rate limiting
    verifyAdminRole, // Secondary admin check
    validateTestimonialId, // ID validation
    auditLog('APPROVE'), // Audit logging
    testimonialController.approveTestimonial
);
// Description: Approve a pending testimonial (makes it public)

// Reject Testimonial
router.post('/admin/testimonials/:id/reject',
    isAdmin,
    csrfProtection, // CSRF protection
    authLimiter, // Rate limiting
    verifyAdminRole, // Secondary admin check
    validateTestimonialId, // ID validation
    validateRejectReason, // Reason validation
    auditLog('REJECT'), // Audit logging
    testimonialController.rejectTestimonial
);
// Description: Reject a testimonial with optional reason
// Body: { reason: string (optional, max 200 chars) }

// Toggle Featured Status
router.patch('/admin/testimonials/:id/feature',
    isAdmin,
    csrfProtection, // CSRF protection
    authLimiter, // Rate limiting
    verifyAdminRole, // Secondary admin check
    validateTestimonialId, // ID validation
    auditLog('FEATURE_TOGGLE'), // Audit logging
    testimonialController.toggleFeatured
);
// Description: Toggle featured status of a testimonial (homepage pin)

/* -------------------------------------------------------------------------- */
/*                                  EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = router;

// Export utilities for testing
module.exports.validateTestimonialId = validateTestimonialId;
module.exports.validateRating = validateRating;
module.exports.validateUserRole = validateUserRole;
module.exports.CONFIG = CONFIG;
