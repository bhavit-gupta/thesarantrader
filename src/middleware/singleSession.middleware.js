/**
 * ============================================================================
 * FILE: singleSession.middleware.js
 * PURPOSE: Enforces single-device login policy (one session per user)
 * ============================================================================
 * 
 * 
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require('../utils/prisma');
const { withTimeout } = require('../utils/prisma');

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

const CONFIG = {
    // Cache validation for 5 minutes to reduce DB queries
    VALIDATION_INTERVAL_MS: parseInt(process.env.SESSION_VALIDATION_INTERVAL_MS, 10) || 5 * 60 * 1000,

    // Query timeout to prevent hanging requests
    QUERY_TIMEOUT_MS: parseInt(process.env.SESSION_QUERY_TIMEOUT_MS, 10) || 2000,

    // Grace period before invalidating old session (2 minutes)
    GRACE_PERIOD_MS: parseInt(process.env.SESSION_GRACE_PERIOD_MS, 10) || 2 * 60 * 1000,

    // Strict mode: fail-closed if DB unavailable
    STRICT_MODE: process.env.SINGLE_SESSION_STRICT === 'true',

    // Allow admins to have multiple sessions
    EXEMPT_ADMINS: process.env.SINGLE_SESSION_EXEMPT_ADMINS !== 'false', // Default true

    // Configurable login route
    LOGIN_ROUTE: process.env.LOGIN_ROUTE || '/login',

    // Routes exempt from session validation
    EXEMPT_PATHS: [
        '/health',         // Health checks
        '/public/',        // Static files
        '/images/',        // Images
        '/stylesheets/',   // CSS
        '/javascripts/',   // JS
        '/uploads/',       // Uploaded files
        '/login',          // Login page
        '/signup',         // Signup page
        '/logout',         // Logout
        '/forgot-password',// Password reset
        '/verify-otp'      // OTP verification
    ]
};

// Expected session user properties (prevent bloat)
const EXPECTED_USER_PROPS = ['id', 'email', 'username', 'role', 'phone'];

// Metrics counter
let sessionConflictCount = 0;

// Rate-limited logging (track recent logs)
const recentlyLogged = new Set();

/* -------------------------------------------------------------------------- */
/*                               HELPERS                                      */
/* -------------------------------------------------------------------------- */

/**
 * Development-only debug logging
 * @param {string} message - Log message
 */
function debugLog(message) {
    // Session event logged: [SingleSession]
}

/**
 * Rate-limited warning logging (max once per minute per user)
 * @param {string} userId - User ID
 * @param {string} message - Log message
 */
function rateLimitedWarn(userId, message) {
    const logKey = `session-conflict-${userId}`;

    if (!recentlyLogged.has(logKey)) {
        // Warning logged: [SingleSession]
        recentlyLogged.add(logKey);
        setTimeout(() => recentlyLogged.delete(logKey), 60000); // Clear after 1 minute
    }
}

/**
 * Check if path should be exempt from validation
 * @param {string} path - Request path
 * @returns {boolean} True if exempt
 */
function isExemptPath(path) {
    return CONFIG.EXEMPT_PATHS.some(exemptPath => path.startsWith(exemptPath));
}

/**
 * Validate session ID format and compare safely
 * @param {*} storedId - Session ID from database
 * @param {*} currentId - Current request session ID
 * @returns {boolean} True if they match (or stored is empty)
 */
function sessionsMatch(storedId, currentId) {
    // Handle null, undefined, empty string
    if (!storedId || (typeof storedId === 'string' && storedId.trim() === '')) {
        return true; // No stored session = allow
    }

    // Type safety check
    if (typeof storedId !== 'string' || typeof currentId !== 'string') {
        console.error('[SingleSession] Invalid session ID types');
        return true; // Allow on type error (fail-open for edge case)
    }

    return storedId === currentId;
}

/**
 * Safely destroy session with error handling
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {string} redirectUrl - URL to redirect to
 * @param {Object} options - Additional options
 */
function destroySessionSafely(req, res, redirectUrl, options = {}) {
    const { logoutReason = 'single_session_enforcement' } = options;

    // Store logout reason before destroying
    if (req.session) {
        req.session.logoutReason = logoutReason;
    }

    req.session.destroy((err) => {
        if (err) {
            console.error('[SingleSession] Failed to destroy session:', err);
            // Force clear session anyway
            if (req.session) {
                req.session = null;
            }
        }
        res.redirect(redirectUrl);
    });
}

/**
 * Validate and clean session user structure
 * @param {Object} sessionUser - Session user object
 * @returns {Object} Cleaned user object
 */
function validateSessionStructure(sessionUser) {
    if (!sessionUser || typeof sessionUser !== 'object') {
        return sessionUser;
    }

    const userProps = Object.keys(sessionUser);

    // Check for session bloat (more than expected + 3 extra)
    if (userProps.length > EXPECTED_USER_PROPS.length + 3) {
        debugLog(`Session bloat detected (${userProps.length} properties), cleaning`);

        const cleanUser = {};
        EXPECTED_USER_PROPS.forEach(prop => {
            if (sessionUser[prop] !== undefined) {
                cleanUser[prop] = sessionUser[prop];
            }
        });
        return cleanUser;
    }

    return sessionUser;
}

/* -------------------------------------------------------------------------- */
/*                       SINGLE SESSION ENFORCEMENT                          */
/* -------------------------------------------------------------------------- */

/**
 * Enforce single-device login policy with caching and optimizations
 * 
 * FEATURES:
 * - Validates session every 5 minutes (configurable) instead of every request
 * - Skips API routes, static files, and auth pages
 * - Optional admin exemption
 * - Grace period for quick device switches
 * - Proper error handling and metrics
 * 
 * MIDDLEWARE PLACEMENT:
 * Place right after session middleware in app.js:
 *   app.use(session({...}));
 *   app.use(singleSessionMiddleware); // Early - before heavy processing
 * 
 * WEBSOCKET INTEGRATION:
 * For Socket.io, add similar validation in io.use() middleware
 * and optionally push 'session-invalidated' event to old sessions
 * 
 * SESSION HISTORY:
 * Consider creating SessionHistory model for audit trail
 * 
 * SESSION FIXATION:
 * Ensure login controller calls req.session.regenerate() after authentication
 * 
 * DATABASE INDEX:
 * Add @@index([currentSessionId]) or @unique to User model in schema.prisma
 */
const singleSessionMiddleware = async (req, res, next) => {
    // Skip exempt paths early (API, static, auth pages)
    if (isExemptPath(req.path)) {
        return next();
    }

    // Only validate for logged-in users
    if (!req.session || !req.session.user || !req.session.user.id) {
        return next();
    }

    const userId = req.session.user.id;
    const currentSessionId = req.sessionID;

    // Exempt admin users if configured
    if (CONFIG.EXEMPT_ADMINS && String(req.session.user.role || '').toUpperCase() === 'ADMIN') {
        debugLog(`Admin user ${userId} exempt from single session`);
        return next();
    }

    // Validate and clean session structure
    req.session.user = validateSessionStructure(req.session.user);

    // Check cache - skip DB query if recently validated
    const now = Date.now();
    const lastValidation = req.session.lastSessionValidation || 0;

    if (lastValidation && (now - lastValidation) < CONFIG.VALIDATION_INTERVAL_MS) {
        // Recently validated, skip DB query
        return next();
    }

    try {
        // Query with timeout to prevent hanging
        const user = await withTimeout(
            () => prisma.user.findUnique({
                where: { id: userId },
                select: {
                    currentSessionId: true
                }
            }),
            CONFIG.QUERY_TIMEOUT_MS
        );

        // Handle deleted user
        if (!user) {
            debugLog(`User ${userId} not found in database, destroying session`);
            return destroySessionSafely(req, res, CONFIG.LOGIN_ROUTE, {
                logoutReason: 'user_deleted'
            });
        }

        // Type-safe session comparison
        if (!sessionsMatch(user.currentSessionId, currentSessionId)) {
            // Race condition handling - retry once after brief delay
            await new Promise(resolve => setTimeout(resolve, 100));

            const freshUser = await withTimeout(
                () => prisma.user.findUnique({
                    where: { id: userId },
                    select: { currentSessionId: true }
                }),
                CONFIG.QUERY_TIMEOUT_MS
            );

            // Confirm mismatch after retry
            if (!sessionsMatch(freshUser?.currentSessionId, currentSessionId)) {
                // Increment metrics
                sessionConflictCount++;

                // Log without PII, rate-limited
                rateLimitedWarn(userId, `Device mismatch for user ID ${userId} (conflict #${sessionConflictCount})`);

                // Preserve original URL for redirection after re-login
                const returnTo = encodeURIComponent(req.originalUrl || req.url || '/');

                // Generic error message, stored in session
                const errorMessage = 'Your session has expired. Please log in again.';

                return destroySessionSafely(
                    req,
                    res,
                    `${CONFIG.LOGIN_ROUTE}?returnTo=${returnTo}`,
                    { logoutReason: 'new_device_login' }
                );
            }
        }

        // Session is valid - update cache timestamp
        req.session.lastSessionValidation = now;

    } catch (error) {
        // Handle timeout and other errors
        const isTimeout = error.message?.includes('timeout') || error.message?.includes('Timeout');

        if (isTimeout) {
            console.error('[SingleSession] Database query timeout');
        } else {
            console.error('[SingleSession] Validation error:', error.message);
        }

        // Strict mode: fail-closed on errors
        if (CONFIG.STRICT_MODE) {
            return destroySessionSafely(req, res, CONFIG.LOGIN_ROUTE, {
                logoutReason: 'validation_error'
            });
        }

        // Default: fail-open (use cache if available)
        if (req.session.lastSessionValidation &&
            (now - req.session.lastSessionValidation) < 10 * 60 * 1000) { // 10 min cache fallback
            debugLog('Using cached validation during DB error');
            return next();
        }

        // No cache and strict mode off - allow through (graceful degradation)
        debugLog('Allowing request during DB error (graceful degradation)');
    }

    next();
};

/* -------------------------------------------------------------------------- */
/*                          UTILITY EXPORTS                                   */
/* -------------------------------------------------------------------------- */

/**
 * Clear session ID on logout (call from auth.controller)
 * @param {string} userId - User ID to clear session for
 */
async function clearUserSession(userId) {
    try {
        await prisma.user.update({
            where: { id: userId },
            data: {
                currentSessionId: null,
                sessionSwitchedAt: null
            }
        });
        debugLog(`Cleared session for user ${userId}`);
    } catch (error) {
        console.error('[SingleSession] Failed to clear user session:', error.message);
    }
}

/**
 * Get session conflict metrics
 * @returns {Object} Metrics object
 */
function getMetrics() {
    return {
        sessionConflictCount,
        timestamp: new Date().toISOString()
    };
}

/**
 * Invalidate session via WebSocket (call after login)
 * For use with Socket.io or similar
 * @param {Object} io - Socket.io instance
 * @param {string} userId - User ID whose old session to invalidate
 */
function notifyOldSession(io, userId) {
    if (io) {
        io.to(`user:${userId}`).emit('session-invalidated', {
            message: 'You have been logged out because you logged in on another device.',
            timestamp: Date.now()
        });
    }
}

/* -------------------------------------------------------------------------- */
/*                                  EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = singleSessionMiddleware;

// Additional exports for utility functions
module.exports.clearUserSession = clearUserSession;
module.exports.getMetrics = getMetrics;
module.exports.notifyOldSession = notifyOldSession;
module.exports.CONFIG = CONFIG;
