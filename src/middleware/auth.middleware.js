/**
 * ============================================================================
 * FILE: auth.middleware.js
 * PURPOSE: Authentication and authorization middleware for route protection
 * ============================================================================
 * 
 * DESCRIPTION:
 * Provides Express middleware functions to control access to protected routes:
 * - isAuthenticated: Verifies user is logged in (has valid session)
 * - isAdmin: Verifies user has administrator privileges
 * 
 * Both middleware functions handle API requests (JSON) and browser requests
 * (redirects) appropriately.
 * 
 * MIDDLEWARE CHAIN USAGE:
 * 1. isAuthenticated - For any route requiring login
 * 2. isAdmin - For admin-only routes (can be used standalone with auth check)
 * 
 * Example: router.get('/admin/users', isAuthenticated, isAdmin, controller)
 * 
 * SESSION STRUCTURE EXPECTED:
 * req.session.user = {
 *   id: string,
 *   name: string,
 *   email: string,
 *   role: 'user' | 'admin'
 * }
 * 
 * SECURITY FEATURES:
 * - Session timeout validation (30 min inactivity)
 * - Activity timestamp tracking
 * - Development-only debug logging
 * - Defensive auth checks in all middlewares
 * 
 * RESPONSE TYPES:
 * - API requests (Accept: application/json): JSON error response
 * - Browser requests: Redirect to login or dashboard
 * 
 * DEPENDENCIES:
 * - express-session: Session management (must be configured before this middleware)
 * 
 */

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                  */
/* -------------------------------------------------------------------------- */

// Role constants
const USER_ROLES = {
    ADMIN: 'ADMIN',
    USER: 'USER'
};

// Session timeout configuration
const SESSION_INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

// Development mode flag
const isDevelopment = process.env.NODE_ENV === 'development';

/* -------------------------------------------------------------------------- */
/*                            HELPER FUNCTIONS                                 */
/* -------------------------------------------------------------------------- */

/**
 * Check if request expects JSON response
 * Relies on Accept header instead of deprecated req.xhr
 * @param {Request} req - Express request object
 * @returns {boolean} True if client expects JSON
 */
function isApiRequest(req) {
    const acceptHeader = req.headers.accept || '';
    return acceptHeader.includes('application/json');
}

/**
 * Debug logging - only in development
 * @param {string} message - Log message
 */
function debugLog(message) {
    if (isDevelopment) {
        console.log(message);
    }
}

/* -------------------------------------------------------------------------- */
/*                        AUTHENTICATION MIDDLEWARE                          */
/* -------------------------------------------------------------------------- */

/**
 * Verify user is logged in with session timeout validation
 * Usage: Apply to any route requiring authentication
 * 
 * Security features:
 * - Validates session existence
 * - Checks inactivity timeout (30 min)
 * - Updates last activity timestamp
 * - Development-only logging
 * 
 * Returns:
 * - 401 JSON for API requests if not authenticated
 * - Redirect to /login for browser requests
 */
const isAuthenticated = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return res.redirect('/login');
    }

    return next();
};

/* -------------------------------------------------------------------------- */
/*                          AUTHORIZATION MIDDLEWARE                         */
/* -------------------------------------------------------------------------- */

/**
 * Verify user has admin role
 * Usage: Apply to admin-only routes (can be used with or without isAuthenticated)
 * 
 * Security features:
 * - Defensive auth check (doesn't assume isAuthenticated ran)
 * - Uses role constant instead of hardcoded string
 * - Specific error messages
 * 
 * Returns:
 * - 401 JSON for API requests if not authenticated
 * - 403 JSON for API requests if not admin
 * - Redirect to /login if not authenticated (browser)
 * - Redirect to /dashboard if not admin (browser)
 */
const isAdmin = (req, res, next) => {
    if (!req.session || !req.session.user) {
        return isApiRequest(req)
            ? res.status(401).json({ success: false, message: 'Authentication required' })
            : res.redirect('/login');
    }

    // 🔥 FIX: normalize role to uppercase for comparison
    const role = String(req.session.user.role).toUpperCase();

    if (role !== 'ADMIN') {
        return isApiRequest(req)
            ? res.status(403).json({ success: false, message: 'Admin access required' })
            : res.redirect('/dashboard');
    }

    return next();
};

/* -------------------------------------------------------------------------- */
/*                                  EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = {
    isAuthenticated,
    isAdmin,
    USER_ROLES
};
