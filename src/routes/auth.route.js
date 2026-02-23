/* -------------------------------------------------------------------------- */
/*                       AUTHENTICATION ROUTE DEFINITIONS                    */
/* -------------------------------------------------------------------------- */
/**
 * ============================================================================
 * FILE: auth.route.js
 * PURPOSE: Authentication route definitions - registration, login, password reset
 * ============================================================================
 * 
 * 
 * 
 * This file defines all routes related to user authentication and account management.
 * 
 * Features:
 * - User registration with OTP verification
 * - Login with session management  
 * - Password reset flow (forgot password → OTP → reset)
 * - Account existence checks (prevent duplicate registrations)
 * - Secure logout with session cleanup
 * 
 * Security:
 * 
 * Base Path: /auth
 * All routes in this file are prefixed with /auth in the main app
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const express = require("express");
const router = express.Router();

/* -------------------------------------------------------------------------- */
/*                              MIDDLEWARE IMPORTS                            */
/* -------------------------------------------------------------------------- */

// CSRF protection middleware
const csrfProtection = require("../middleware/csrfProtection");

// Authentication middleware for logout
const { isAuthenticated } = require("../middleware/auth.middleware");

// Specific rate limiters for each endpoint type
const {
    loginLimiter,
    signupLimiter,
    otpLimiter,
    resetLimiter,
    authLimiter
} = require("../middleware/rateLimiter");

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

const CONFIG = {
    // Request size limits (enforced at app level in app.js)
    MAX_REQUEST_SIZE: '10kb',

    // Request timeout in milliseconds
    REQUEST_TIMEOUT_MS: 30000,

    // OTP/reset throttling (enforced via rate limiters)
    MAX_OTP_PER_HOUR: 3,
    MAX_RESETS_PER_DAY: 5,

    // Input validation patterns
    EMAIL_REGEX: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
    PHONE_REGEX: /^\+?[\d\s-]{10,15}$/,
    PASSWORD_MIN_LENGTH: 8,
    PASSWORD_MAX_LENGTH: 128,
    NAME_MAX_LENGTH: 100,
    OTP_LENGTH: 6,
    OTP_REGEX: /^\d{6}$/
};

// Generic responses for existence checks (prevent enumeration)
const STRINGS = {
    VALIDATION_FAILED: 'Validation failed',
    INVALID_EMAIL: 'Invalid email format',
    INVALID_PHONE: 'Invalid phone number format',
    INVALID_PASSWORD: 'Password must be 8-128 characters',
    INVALID_NAME: 'Name is required and must be under 100 characters',
    INVALID_OTP: 'Invalid OTP format',
    INVALID_CONTENT_TYPE: 'Content-Type must be application/json',
    INTERNAL_ERROR: 'An error occurred. Please try again.',
    LOGOUT_SUCCESS: 'Logged out successfully'
};

/* -------------------------------------------------------------------------- */
/*                              CONTROLLERS                                   */
/* -------------------------------------------------------------------------- */

// Safe controller import with validation
let controllers;
try {
    controllers = require("../controllers/auth.controller");
} catch (error) {
    console.error('[AUTH ROUTES] Failed to load auth.controller:', error.message);
    // Provide fallback error handlers
    controllers = {
        registerUser: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        loginUser: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        logoutUser: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        forgotPassword: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        resetPassword: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        verifyResetOTP: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        sendOtp: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' }),
        checkExistence: (req, res) => res.status(500).json({ success: false, message: 'Service unavailable' })
    };
}

const {
    registerUser,
    loginUser,
    logoutUser,
    forgotPassword,
    resetPassword,
    verifyResetOTP,
    sendOtp,
    checkExistence
} = controllers;

/* -------------------------------------------------------------------------- */
/*                          VALIDATION UTILITIES                              */
/* -------------------------------------------------------------------------- */

/**
 * Validate email format
 */
function isValidEmail(email) {
    return typeof email === 'string' &&
        email.length <= 254 &&
        CONFIG.EMAIL_REGEX.test(email.trim());
}

/**
 * Validate phone number format
 */
function isValidPhone(phone) {
    return typeof phone === 'string' &&
        CONFIG.PHONE_REGEX.test(phone.trim());
}

/**
 * Validate password strength
 */
function isValidPassword(password) {
    return typeof password === 'string' &&
        password.length >= CONFIG.PASSWORD_MIN_LENGTH &&
        password.length <= CONFIG.PASSWORD_MAX_LENGTH;
}

/**
 * Validate name field
 */
function isValidName(name) {
    return typeof name === 'string' &&
        name.trim().length > 0 &&
        name.length <= CONFIG.NAME_MAX_LENGTH;
}

/**
 * Validate OTP format (6 digits)
 */
function isValidOTP(otp) {
    return typeof otp === 'string' && CONFIG.OTP_REGEX.test(otp);
}

/* -------------------------------------------------------------------------- */
/*                         VALIDATION MIDDLEWARE                              */
/* -------------------------------------------------------------------------- */

/**
 * Content-Type validation middleware
 * Ensures POST requests have application/json content type
 */
function validateContentType(req, res, next) {
    const contentType = req.headers['content-type'];
    // Allow both JSON and standard form submissions
    const allowedTypes = ['application/json', 'application/x-www-form-urlencoded', 'multipart/form-data'];

    const isAllowed = allowedTypes.some(type => contentType && contentType.includes(type));

    if (req.method !== 'GET' && !isAllowed) {
        return res.status(415).json({
            success: false,
            message: STRINGS.INVALID_CONTENT_TYPE
        });
    }
    next();
}

/**
 * Registration input validation middleware
 */
function validateRegisterInput(req, res, next) {
    const { name, username, email, phone, state, city, password, otp } = req.body || {};
    const errors = [];

    if (!isValidName(name)) errors.push(STRINGS.INVALID_NAME);
    if (!username || username.trim().length < 3) errors.push('Username must be at least 3 characters');
    if (!isValidEmail(email)) errors.push(STRINGS.INVALID_EMAIL);
    if (!isValidPhone(phone)) errors.push(STRINGS.INVALID_PHONE);
    if (!isValidPassword(password)) errors.push(STRINGS.INVALID_PASSWORD);
    if (!state || state.trim().length === 0) errors.push('State is required');
    if (!city || city.trim().length === 0) errors.push('City is required');
    if (!otp) errors.push('Email OTP is required');
    if (!req.body['mobile-otp']) errors.push('Mobile OTP is required');

    if (errors.length > 0) {
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.status(400).json({
                success: false,
                message: STRINGS.VALIDATION_FAILED,
                errors
            });
        }
        return res.render("auth/signup", {
            error: errors[0],
            formData: req.body
        });
    }

    // Sanitize inputs
    req.body.email = email.trim().toLowerCase();
    req.body.username = username.trim().toLowerCase();
    req.body.name = name.trim();
    if (phone) req.body.phone = phone.trim();

    next();
}

/**
 * Login input validation middleware
 */
function validateLoginInput(req, res, next) {
    const { loginIdentifier, password, loginType } = req.body || {};
    const errors = [];

    if (!loginIdentifier || typeof loginIdentifier !== 'string') {
        errors.push('Login identifier (username, email, or phone) is required');
    }

    if (!password || typeof password !== 'string') {
        errors.push('Password is required');
    }

    if (errors.length > 0) {
        // Return 400 for API but render for form
        if (req.headers.accept && req.headers.accept.includes('application/json')) {
            return res.status(400).json({
                success: false,
                message: STRINGS.VALIDATION_FAILED,
                errors
            });
        }
        return res.render("auth/login", { error: errors[0] });
    }

    if (loginIdentifier) req.body.loginIdentifier = loginIdentifier.trim();
    next();
}

/**
 * Send OTP input validation middleware
 */
function validateSendOtpInput(req, res, next) {
    const { email, phone } = req.body || {};

    if (!email && !phone) {
        return res.status(400).json({
            success: false,
            message: 'Email or phone is required'
        });
    }

    if (email && !isValidEmail(email)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_EMAIL
        });
    }

    if (phone && !isValidPhone(phone)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_PHONE
        });
    }

    if (email) req.body.email = email.trim().toLowerCase();
    if (phone) req.body.phone = phone.trim();
    next();
}

/**
 * Forgot password input validation middleware
 */
function validateForgotPasswordInput(req, res, next) {
    const { identifier, type } = req.body || {};

    if (!identifier) {
        return res.status(400).json({
            success: false,
            message: 'Identifier (email or phone) is required'
        });
    }

    if (type === 'email' && !isValidEmail(identifier)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_EMAIL
        });
    }

    if (type === 'phone' && !isValidPhone(identifier)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_PHONE
        });
    }

    if (identifier) req.body.identifier = identifier.trim();
    next();
}

/**
 * Verify OTP input validation middleware
 */
function validateVerifyOtpInput(req, res, next) {
    const { identifier, otp } = req.body || {};

    if (!identifier) {
        return res.status(400).json({
            success: false,
            message: 'Identifier is required'
        });
    }

    if (!isValidOTP(otp)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_OTP
        });
    }

    if (identifier) req.body.identifier = identifier.trim();
    next();
}

/**
 * Reset password input validation middleware
 */
function validateResetPasswordInput(req, res, next) {
    const { identifier, otp, password } = req.body || {};
    const errors = [];

    if (!identifier) {
        errors.push('Identifier is required');
    }
    if (!isValidOTP(otp)) {
        errors.push(STRINGS.INVALID_OTP);
    }
    if (!isValidPassword(password)) {
        errors.push(STRINGS.INVALID_PASSWORD);
    }

    if (errors.length > 0) {
        return res.status(400).json({
            success: false,
            message: STRINGS.VALIDATION_FAILED,
            errors
        });
    }

    if (identifier) req.body.identifier = identifier.trim();
    next();
}

/**
 * Check existence input validation middleware
 */
function validateCheckExistenceInput(req, res, next) {
    const { email, phone } = req.body || {};

    if (!email && !phone) {
        return res.status(400).json({
            success: false,
            message: 'Email or phone is required'
        });
    }

    if (email && !isValidEmail(email)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_EMAIL
        });
    }

    if (phone && !isValidPhone(phone)) {
        return res.status(400).json({
            success: false,
            message: STRINGS.INVALID_PHONE
        });
    }

    if (email) req.body.email = email.trim().toLowerCase();
    if (phone) req.body.phone = phone.trim();
    next();
}

/* -------------------------------------------------------------------------- */
/*                           ERROR HANDLING                                   */
/* -------------------------------------------------------------------------- */

/**
 * Error handler wrapper for async controllers
 * Catches errors and returns consistent error response
 */
function asyncHandler(fn) {
    return (req, res, next) => {
        // Add timeout
        const timeoutId = setTimeout(() => {
            if (!res.headersSent) {
                res.status(503).json({
                    success: false,
                    message: 'Request timeout. Please try again.'
                });
            }
        }, CONFIG.REQUEST_TIMEOUT_MS);

        Promise.resolve(fn(req, res, next))
            .then(() => clearTimeout(timeoutId))
            .catch((error) => {
                clearTimeout(timeoutId);

                // Log auth attempts for forensics
                console.error(`[AUTH ERROR] ${req.method} ${req.path}:`, {
                    ip: req.ip,
                    userAgent: req.get('User-Agent'),
                    error: error.message,
                    timestamp: new Date().toISOString()
                });

                // Return generic error to client
                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        message: STRINGS.INTERNAL_ERROR
                    });
                }
            });
    };
}

/**
 * Auth attempt logging middleware
 */
function logAuthAttempt(action) {
    return (req, res, next) => {
        const logData = {
            action,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            email: req.body?.email ? `${req.body.email.substring(0, 3)}***` : undefined,
            timestamp: new Date().toISOString()
        };

        console.log(`[AUTH] ${action}:`, JSON.stringify(logData));
        next();
    };
}

/* -------------------------------------------------------------------------- */
/*                            ROUTE DEFINITIONS                               */
/* -------------------------------------------------------------------------- */

// Registration
// Middleware chain: Content-Type → Rate limit → CSRF → Validation → Log → Handler
router.post("/register",
    validateContentType,
    signupLimiter,
    csrfProtection,
    validateRegisterInput,
    logAuthAttempt('REGISTER'),
    asyncHandler(registerUser)
);

// Login
router.post("/login",
    validateContentType,
    loginLimiter,
    csrfProtection,
    validateLoginInput,
    logAuthAttempt('LOGIN'),
    asyncHandler(loginUser)
);

// Forgot password
router.post("/forgot-password",
    validateContentType,
    resetLimiter,
    csrfProtection,
    validateForgotPasswordInput,
    logAuthAttempt('FORGOT_PASSWORD'),
    asyncHandler(forgotPassword)
);

// Verify reset OTP
router.post("/verify-reset-otp",
    validateContentType,
    otpLimiter,
    csrfProtection,
    validateVerifyOtpInput,
    logAuthAttempt('VERIFY_OTP'),
    asyncHandler(verifyResetOTP)
);

// Reset password
router.post("/reset-password",
    validateContentType,
    resetLimiter,
    csrfProtection,
    validateResetPasswordInput,
    logAuthAttempt('RESET_PASSWORD'),
    asyncHandler(resetPassword)
);

// Send OTP
router.post("/send-otp",
    validateContentType,
    otpLimiter,
    csrfProtection,
    validateSendOtpInput,
    logAuthAttempt('SEND_OTP'),
    asyncHandler(sendOtp)
);

// Check existence
// Note: Returns generic response to prevent user enumeration
router.post("/check-existence",
    validateContentType,
    authLimiter,
    csrfProtection,
    validateCheckExistenceInput,
    asyncHandler(checkExistence)
);

// Logout
// Requires authentication to prevent DoS attacks
router.post("/logout",
    isAuthenticated,
    csrfProtection,
    logAuthAttempt('LOGOUT'),
    asyncHandler(logoutUser)
);

/* -------------------------------------------------------------------------- */
/*                              404 HANDLER                                   */
/* -------------------------------------------------------------------------- */

/**
 * Catch-all 404 handler for undefined auth routes
 */
router.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Auth endpoint not found'
    });
});

/* -------------------------------------------------------------------------- */
/*                                  EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = router;

// Export validation utilities for testing
module.exports.isValidEmail = isValidEmail;
module.exports.isValidPhone = isValidPhone;
module.exports.isValidPassword = isValidPassword;
module.exports.isValidOTP = isValidOTP;
module.exports.CONFIG = CONFIG;

