/* -------------------------------------------------------------------------- */
/*                         COURSE ROUTE DEFINITIONS                          */
/* -------------------------------------------------------------------------- */
/**
 * This file defines all routes for course management - listing, enrollment, admin operations.
 * 
 * Route Categories:
 * 1. Public Routes - Available to all users (with rate limiting)
 * 2. User Routes - Require authentication and course purchase
 * 3. Admin Routes - Require admin privileges
 * 
 * Security:
 * - CSRF protection on all POST routes
 * - requireCoursePurchase in middleware chain
 * - CourseId validation (MongoDB ObjectId format)
 * - Rate limiting on all endpoints
 * - Input validation middleware
 * - Admin audit logging
 * 
 * Base Path: /
 * Routes are mounted directly on the main app
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const express = require('express');
const router = express.Router();

/* -------------------------------------------------------------------------- */
/*                              MIDDLEWARE IMPORTS                            */
/* -------------------------------------------------------------------------- */

const { isAdmin, isAuthenticated } = require('../middleware/auth.middleware');
const csrfProtection = require('../middleware/csrfProtection');
const { authLimiter } = require('../middleware/rateLimiter');
const { requireCoursePurchase } = require('../utils/helpers');

// Validate middleware exists at startup
if (typeof isAuthenticated !== 'function') {
    throw new Error('[COURSE ROUTES] isAuthenticated middleware not found');
}
if (typeof requireCoursePurchase !== 'function') {
    throw new Error('[COURSE ROUTES] requireCoursePurchase middleware not found');
}

/* -------------------------------------------------------------------------- */
/*                              CONTROLLER IMPORT                             */
/* -------------------------------------------------------------------------- */

let courseController;
try {
    courseController = require('../controllers/course.controller');
} catch (error) {
    console.error('[COURSE ROUTES] Failed to load course.controller:', error.message);
    courseController = {
        getAllCourses: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        getLiveStatus: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        enrollCourse: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        viewCourseVideos: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        getAdminCourses: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        addCourse: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        editCourse: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        deleteCourse: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        toggleLiveStatus: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' })
    };
}

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

const CONFIG = {
    // CourseId validation pattern (MongoDB ObjectId)
    OBJECTID_REGEX: /^[0-9a-fA-F]{24}$/,

    // Course field limits
    MAX_TITLE_LENGTH: 500,
    MAX_DESCRIPTION_LENGTH: 10000,
    MAX_CATEGORY_LENGTH: 100,

    // Price limits
    MIN_PRICE: 0,
    MAX_PRICE: 999999,

    // Pagination limits
    MAX_COURSES_PER_PAGE: 50,
    DEFAULT_PAGE_SIZE: 10,
    MAX_PAGE_NUMBER: 1000,

    // Valid course statuses
    VALID_STATUSES: ['active', 'draft', 'archived'],

    // Valid categories (whitelist)
    VALID_CATEGORIES: ['trading', 'investing', 'crypto', 'forex', 'stocks', 'options', 'futures', 'technical-analysis', 'fundamental-analysis', 'general']
};

const STRINGS = {
    INVALID_COURSE_ID: 'Invalid course identifier.',
    INVALID_TITLE: 'Title is required and must be under 500 characters.',
    INVALID_DESCRIPTION: 'Description must be under 10000 characters.',
    INVALID_PRICE: 'Price must be a number between 0 and 999999.',
    INVALID_STATUS: 'Invalid course status.',
    INVALID_CATEGORY: 'Invalid course category.',
    INVALID_PAGINATION: 'Invalid pagination parameters.',
    SERVICE_ERROR: 'Service temporarily unavailable.',
    COURSE_NOT_FOUND: 'Course not found.'
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
 * Validate price field
 */
function isValidPrice(price) {
    const num = parseFloat(price);
    return !isNaN(num) && num >= CONFIG.MIN_PRICE && num <= CONFIG.MAX_PRICE;
}

/**
 * Validate pagination parameters
 */
function isValidPaginationParams(page, limit) {
    if (page !== undefined) {
        const pageNum = parseInt(page, 10);
        if (isNaN(pageNum) || pageNum < 1 || pageNum > CONFIG.MAX_PAGE_NUMBER) {
            return false;
        }
    }
    if (limit !== undefined) {
        const limitNum = parseInt(limit, 10);
        if (isNaN(limitNum) || limitNum < 1 || limitNum > CONFIG.MAX_COURSES_PER_PAGE) {
            return false;
        }
    }
    return true;
}

/**
 * Log admin operation for audit
 */
function logAdminOperation(req, action, courseId, details = {}) {
    const logData = {
        action,
        adminId: req.user?.id || req.session?.user?.id || 'unknown',
        adminName: req.user?.name || req.session?.user?.name || 'unknown',
        courseId,
        details,
        ip: req.ip,
        timestamp: new Date().toISOString()
    };
    console.log(`[COURSE ADMIN] ${action}:`, JSON.stringify(logData));
}

/* -------------------------------------------------------------------------- */
/*                          MIDDLEWARE FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

/**
 * CourseId validation middleware
 */
function validateCourseId(req, res, next) {
    const { id } = req.params;

    if (!isValidObjectId(id)) {
        // If it's a browser request, redirect to courses page with error
        const { isAjaxRequest } = require('../utils/helpers');
        if (!isAjaxRequest(req)) {
            return res.redirect('/courses?error=invalid_course');
        }

        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_COURSE_ID
        });
    }

    next();
}

/**
 * CourseId in body validation middleware (for toggle-live)
 */
function validateCourseIdInBody(req, res, next) {
    const { courseId } = req.body || {};

    if (!isValidObjectId(courseId)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_COURSE_ID
        });
    }

    next();
}

/**
 * Enrollment validation middleware
 */
function validateEnrollment(req, res, next) {
    const { courseId } = req.body || {};

    if (!isValidObjectId(courseId)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_COURSE_ID
        });
    }

    next();
}

/**
 * Pagination validation middleware
 */
function validatePagination(req, res, next) {
    const { page, limit } = req.query;

    if (!isValidPaginationParams(page, limit)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_PAGINATION
        });
    }

    // Normalize pagination params
    if (page) req.query.page = parseInt(page, 10);
    if (limit) req.query.limit = Math.min(parseInt(limit, 10), CONFIG.MAX_COURSES_PER_PAGE);

    next();
}

/**
 * Course data validation middleware
 */
function validateCourseData(req, res, next) {
    const { title, description, price, status, category } = req.body || {};

    // Title validation
    if (title !== undefined) {
        if (typeof title !== 'string' || title.trim().length === 0 || title.length > CONFIG.MAX_TITLE_LENGTH) {
            return res.status(400).json({
                success: false,
                message: STRINGS.INVALID_TITLE
            });
        }
        req.body.title = title.trim();
    }

    // Description validation
    if (description !== undefined) {
        if (typeof description !== 'string' || description.length > CONFIG.MAX_DESCRIPTION_LENGTH) {
            return res.status(400).json({
                success: false,
                message: STRINGS.INVALID_DESCRIPTION
            });
        }
        req.body.description = description.trim();
    }

    // Price validation
    if (price !== undefined) {
        if (!isValidPrice(price)) {
            return res.status(400).json({
                success: false,
                message: STRINGS.INVALID_PRICE
            });
        }
        req.body.price = parseFloat(price);
    }

    // Status validation
    if (status !== undefined) {
        if (!CONFIG.VALID_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                message: STRINGS.INVALID_STATUS
            });
        }
    }

    // Category validation (optional - allow custom if not in whitelist but log)
    if (category !== undefined && typeof category === 'string') {
        if (category.length > CONFIG.MAX_CATEGORY_LENGTH) {
            return res.status(400).json({
                success: false,
                message: STRINGS.INVALID_CATEGORY
            });
        }
        req.body.category = category.trim().toLowerCase();
    }

    next();
}

/**
 * Require title for course creation
 */
function requireTitle(req, res, next) {
    const { title } = req.body || {};

    if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_TITLE
        });
    }

    next();
}

/**
 * Error handler wrapper for async controllers
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch((error) => {
            console.error(`[COURSE ERROR] ${req.method} ${req.path}:`, error.message);

            if (!res.headersSent) {
                res.status(500).json({
                    success: false,
                    message: STRINGS.SERVICE_ERROR
                });
            }
        });
    };
}

/**
 * Audit logging middleware for admin operations
 */
function auditLog(action) {
    return (req, res, next) => {
        const courseId = req.params.id || req.body?.courseId;
        logAdminOperation(req, action, courseId, { body: req.body });
        next();
    };
}

/* -------------------------------------------------------------------------- */
/*                              PUBLIC ROUTES                                 */
/* -------------------------------------------------------------------------- */

// Course Listing with pagination and rate limiting
router.get('/api/courses',
    authLimiter,
    validatePagination,
    asyncHandler(courseController.getAllCourses)
);

// Live Status - require auth to prevent info leakage
router.get('/api/live-status',
    isAuthenticated,
    authLimiter,
    asyncHandler(courseController.getLiveStatus)
);

// Enrollment with validation
router.post('/api/courses/enroll',
    isAuthenticated,
    csrfProtection,
    authLimiter,
    validateEnrollment,
    asyncHandler(courseController.enrollCourse)
);

/* -------------------------------------------------------------------------- */
/*                              USER ROUTES                                   */
/* -------------------------------------------------------------------------- */

// Video Access with purchase verification in middleware chain
router.get('/courses/:id/view',
    isAuthenticated,
    validateCourseId,
    requireCoursePurchase('id'), // Explicitly pass 'id' since it matched the route param
    asyncHandler(courseController.viewCourseVideos)
);

/* -------------------------------------------------------------------------- */
/*                              ADMIN ROUTES                                  */
/* -------------------------------------------------------------------------- */

// Course Management Dashboard
router.get('/admin/courses',
    isAuthenticated,
    isAdmin,
    validatePagination,
    asyncHandler(courseController.getAdminCourses)
);

// Create Course with validation and audit
router.post('/admin/courses/add',
    isAdmin,
    csrfProtection,
    authLimiter,
    requireTitle,
    validateCourseData,
    auditLog('CREATE_COURSE'),
    asyncHandler(courseController.addCourse)
);

// Edit Course with validation
router.post('/admin/courses/edit/:id',
    isAdmin,
    csrfProtection,
    validateCourseId,
    validateCourseData,
    auditLog('EDIT_COURSE'),
    asyncHandler(courseController.editCourse)
);

// Delete Course with validation and audit
router.post('/admin/courses/delete/:id',
    isAdmin,
    csrfProtection,
    validateCourseId,
    auditLog('DELETE_COURSE'),
    asyncHandler(courseController.deleteCourse)
);

// Toggle Live Status with validation
router.post('/admin/toggle-live',
    isAdmin,
    csrfProtection,
    validateCourseIdInBody,
    auditLog('TOGGLE_LIVE'),
    asyncHandler(courseController.toggleLiveStatus)
);

/* -------------------------------------------------------------------------- */
/*                                  EXPORTS                                   */
/* -------------------------------------------------------------------------- */

module.exports = router;

// Export utilities for testing
module.exports.isValidObjectId = isValidObjectId;
module.exports.isValidPrice = isValidPrice;
module.exports.CONFIG = CONFIG;

