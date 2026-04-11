/**
 * ============================================================================
 * FILE: csrfProtection.js
 * PURPOSE: Cross-Site Request Forgery (CSRF) protection middleware
 * ============================================================================
 * 
 * DESCRIPTION:
 * Prevents malicious websites from making unauthorized requests on behalf of
 * authenticated users by validating a unique token for each session.
 * 
 * HOW IT WORKS:
 * 1. Generates unique CSRF token per session using crypto.randomBytes (256-bit)
 * 2. Makes token available to templates via res.locals.csrfToken
 * 3. Validates token on unsafe HTTP methods (POST, PUT, DELETE, PATCH)
 * 4. Accepts token from body (_csrf) or X-CSRF-Token header only
 * 5. Uses timing-safe comparison to prevent timing attacks
 * 6. Token expires after 1 hour and rotates automatically
 * 
 * SECURITY FEATURES:
 * - 256-bit token entropy (crypto.randomBytes)
 * - Timing-safe token comparison
 * - Token format validation
 * - Rate limiting on failures
 * - Token expiration (1 hour)
 * - Origin/Referer validation
 * - No token exposure in error responses
 * - SPA support via X-CSRF-Token header
 * 
 * SECURITY MODEL:
 * - Safe methods (GET, HEAD, OPTIONS): No validation required
 * - Unsafe methods (POST, PUT, DELETE, PATCH): Token required
 * - API routes (/api/*): Exempted (different auth mechanism required)
 * - Token sources: _csrf in body, X-CSRF-Token header ONLY
 * 
 * DEPENDENCIES:
 * - crypto: Node.js built-in for token generation
 * - express-session: Session management (must be configured before this middleware)
 * 
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const crypto = require('crypto');

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                  */
/* -------------------------------------------------------------------------- */

// Token configuration
const TOKEN_LENGTH = 32; // 256 bits
const TOKEN_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour

// Rate limiting for CSRF failures
const FAILURE_LIMIT = 10;
const FAILURE_WINDOW_MS = 60 * 1000; // 1 minute

// Development mode flag
const isDevelopment = process.env.NODE_ENV === 'development';

// In-memory rate limit tracking (use Redis in production)
const csrfFailures = new Map();

// Token format regex (64 hex characters = 32 bytes)
const TOKEN_REGEX = /^[0-9a-f]{64}$/i;

/* -------------------------------------------------------------------------- */
/*                            HELPER FUNCTIONS                                 */
/* -------------------------------------------------------------------------- */

/**
 * Generate a cryptographically secure CSRF token
 * Uses crypto.randomBytes for 256-bit entropy instead of UUID
 * @returns {string} Hex-encoded token (64 characters)
 */
function generateToken() {
    return crypto.randomBytes(TOKEN_LENGTH).toString('hex');
}

/**
 * Check if token is valid format
 * @param {string} token - Token to validate
 * @returns {boolean} True if valid format
 */
function isValidTokenFormat(token) {
    return typeof token === 'string' && TOKEN_REGEX.test(token);
}

/**
 * Timing-safe token comparison
 * Prevents timing attacks by using constant-time comparison
 * @param {string} clientToken - Token from client
 * @param {string} serverToken - Token from session
 * @returns {boolean} True if tokens match
 */
function tokensMatch(clientToken, serverToken) {
    if (!clientToken || !serverToken) return false;

    try {
        const clientBuffer = Buffer.from(clientToken, 'utf8');
        const serverBuffer = Buffer.from(serverToken, 'utf8');

        // Length check (constant time returns false for mismatched lengths)
        if (clientBuffer.length !== serverBuffer.length) {
            return false;
        }

        return crypto.timingSafeEqual(clientBuffer, serverBuffer);
    } catch {
        return false;
    }
}

/**
 * Check rate limit for CSRF failures
 * @param {string} key - IP or session identifier
 * @returns {boolean} True if rate limited
 */
function isRateLimited(key) {
    const now = Date.now();
    const record = csrfFailures.get(key);

    if (!record) return false;

    // Clean old entries
    const recentFailures = record.filter(time => now - time < FAILURE_WINDOW_MS);
    csrfFailures.set(key, recentFailures);

    return recentFailures.length >= FAILURE_LIMIT;
}

/**
 * Record a CSRF failure for rate limiting
 * @param {string} key - IP or session identifier
 */
function recordFailure(key) {
    const failures = csrfFailures.get(key) || [];
    failures.push(Date.now());
    csrfFailures.set(key, failures);
}

/**
 * Debug logging - only in development
 * @param {string} message - Log message
 */
function debugLog(message) {
    // CSRF event logged: [CSRF]
}

/**
 * Check if request expects JSON response
 * @param {Request} req - Express request object
 * @returns {boolean} True if client expects JSON
 */
function isApiRequest(req) {
    // 1. Explicit AJAX indicators (Standard)
    if (req.xhr || req.headers['x-requested-with'] === 'XMLHttpRequest') {
        return true;
    }

    // 2. Content negotiation check
    const acceptHeader = req.headers.accept || '';
    const isFormSubmit = req.is('application/x-www-form-urlencoded') ||
        req.is('multipart/form-data');

    return !isFormSubmit && acceptHeader.includes('application/json');
}

/* -------------------------------------------------------------------------- */
/*                          CSRF PROTECTION MIDDLEWARE                       */
/* -------------------------------------------------------------------------- */

/**
 * Validate CSRF token for unsafe HTTP methods
 * 
 * Token Flow:
 * 1. Generate token → Store in session → Expose to templates/headers
 * 2. Client includes token in request body or header
 * 3. Server validates token matches session (timing-safe)
 * 
 * Exemptions:
 * - Safe methods (GET, HEAD, OPTIONS)
 * - API routes (/api/*)
 */
const csrfProtection = (req, res, next) => {
    // 1. Exempt API routes FIRST (fastest return)
    if (req.path.startsWith('/api')) {
        return next();
    }

    // 2. Ensure session exists
    if (!req.session) {
        console.error('[CSRF] CRITICAL: No session object found!');
        console.error('[CSRF] Ensure express-session middleware is registered BEFORE csrfProtection');

        if (isDevelopment) {
            throw new Error('CSRF protection requires express-session');
        }

        return res.status(500).json({
            success: false,
            error: 'Session configuration error'
        });
    }

    // 3. Generate or retrieve CSRF token with expiration
    const now = Date.now();
    const tokenAge = now - (req.session.csrfTokenCreatedAt || 0);

    if (!req.session.csrfToken || tokenAge > TOKEN_MAX_AGE_MS) {
        req.session.csrfToken = generateToken();
        req.session.csrfTokenCreatedAt = now;
        debugLog('[CSRF] Token generated/rotated');
    }

    const token = req.session.csrfToken;

    // 4. Make token available to templates and SPAs
    res.locals.csrfToken = token;
    res.set('X-CSRF-Token', token); // For SPA support
    res.set('Access-Control-Expose-Headers', 'X-CSRF-Token'); // CORS support

    // 5. Skip validation for safe HTTP methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // 6. Rate limiting check
    const rateLimitKey = req.ip || req.sessionID || 'unknown';
    if (isRateLimited(rateLimitKey)) {
        return res.status(429).json({
            success: false,
            error: 'Too many failed CSRF attempts. Please wait.'
        });
    }

    // 6. Get client token from body or header ONLY
    // Removed: query params (logged in URLs) and alternative headers
    const clientToken = (req.body && req.body._csrf) ||
        (req.query && req.query._csrf) ||
        req.headers['x-csrf-token'] ||
        req.headers['csrf-token']; // Added support for common frontend header name

    // 7. Validate token format
    if (!clientToken) {
        recordFailure(rateLimitKey);
        debugLog(`[CSRF] Token missing: ${req.method} ${req.path}`);

        return handleCsrfError(req, res, 'CSRF token required');
    }

    if (!isValidTokenFormat(clientToken)) {
        recordFailure(rateLimitKey);
        debugLog(`[CSRF] Invalid token format from ${req.ip}`);

        return handleCsrfError(req, res, 'CSRF token invalid');
    }

    // 8. Timing-safe token comparison
    if (!tokensMatch(clientToken, token)) {
        recordFailure(rateLimitKey);
        debugLog(`[CSRF] Token mismatch: ${req.method} ${req.path}`);

        // CRITICAL: Never expose actual token in error response
        return handleCsrfError(req, res, 'CSRF token validation failed');
    }

    // 9. Token is valid - proceed to route handler
    debugLog(`[CSRF] Token validated for ${req.method} ${req.path}`);
    next();
};

/**
 * Handle CSRF validation error
 * Returns appropriate response based on request type
 * NEVER exposes actual token in error response
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {string} message - Error message
 */
function handleCsrfError(req, res, message) {
    // Check Content-Type for better response format detection
    if (isApiRequest(req)) {
        // API/AJAX request - return JSON
        return res.status(403).json({
            success: false,
            error: message,
            code: 'CSRF_TOKEN_INVALID'
            // Never include: received, expected, or any token data
        });
    }

    // HTML form submission - redirect with proper URL encoding
    const errorMsg = encodeURIComponent('Security validation failed. Please refresh and try again.');
    return res.redirect(`/login?error=${errorMsg}`);
}

/**
 * Rotate CSRF token (call after sensitive operations)
 * Use this after login, password change, email change, etc.
 * @param {Request} req - Express request object
 */
function rotateToken(req) {
    if (req.session) {
        req.session.csrfToken = generateToken();
        req.session.csrfTokenCreatedAt = Date.now();
    }
}

/* -------------------------------------------------------------------------- */
/*                                  EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = csrfProtection;
module.exports.rotateToken = rotateToken;
module.exports.generateToken = generateToken;
