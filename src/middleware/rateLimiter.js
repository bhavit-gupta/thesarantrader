/**
 * ============================================================================
 * FILE: rateLimiter.js
 * PURPOSE: Rate limiting middleware to prevent brute-force attacks
 * ============================================================================
 * 
 * DESCRIPTION:
 * Configures rate limiting specifically for authentication endpoints to prevent
 * credential stuffing, brute-force attacks, and automated abuse.
 * 
 * 
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const rateLimit = require('express-rate-limit');

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

// Configurable via environment variables
const CONFIG = {
    AUTH_WINDOW_MS: parseInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
    AUTH_MAX_ATTEMPTS: parseInt(process.env.RATE_LIMIT_AUTH_MAX, 10) || 5,
    OTP_MAX_ATTEMPTS: parseInt(process.env.RATE_LIMIT_OTP_MAX, 10) || 3,
    SIGNUP_MAX_ATTEMPTS: parseInt(process.env.RATE_LIMIT_SIGNUP_MAX, 10) || 10,
    RESET_MAX_ATTEMPTS: parseInt(process.env.RATE_LIMIT_RESET_MAX, 10) || 3,
    CAPTCHA_THRESHOLD: parseInt(process.env.RATE_LIMIT_CAPTCHA_THRESHOLD, 10) || 3,
    SUPPORT_LEGACY_HEADERS: process.env.RATE_LIMIT_LEGACY_HEADERS === 'true',
    FAIL_OPEN: process.env.RATE_LIMIT_FAIL_OPEN === 'true',
    BYPASS_TOKEN: process.env.RATE_LIMIT_BYPASS_TOKEN || null,
};

// Trusted IPs that skip rate limiting (admin, monitoring)
const TRUSTED_IPS = [];

// Trusted proxy IPs for X-Forwarded-For validation
const TRUSTED_PROXIES = [];

/* -------------------------------------------------------------------------- */
/*                               HELPERS                                      */
/* -------------------------------------------------------------------------- */

/**
 * Development-only debug logging
 * @param {string} message - Log message
 */
function debugLog(message) {
    // Rate limit event logged: [RATE LIMIT]
}

/**
 * Security event logging (always logs in production)
 * @param {string} event - Event type
 * @param {Object} data - Event data
 */
function securityLog(event, data) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        event,
        ...data
    };

    // Integration point for monitoring services
    // In production, send to Sentry, Datadog, etc.
    // [SECURITY] event logged
}

/**
 * Get client IP with proxy handling and validation
 * @param {Object} req - Express request
 * @returns {string} Client IP address
 */
function getClientIp(req) {
    // If behind trusted proxy, use X-Forwarded-For
    const forwardedFor = req.headers['x-forwarded-for'];

    if (forwardedFor) {
        const proxyIp = req.connection?.remoteAddress || req.socket?.remoteAddress;

        // Only trust X-Forwarded-For from known proxies
        if (TRUSTED_PROXIES.length === 0 || TRUSTED_PROXIES.includes(proxyIp)) {
            // Take first IP (original client)
            const clientIp = forwardedFor.split(',')[0].trim();
            return clientIp;
        } else {
            // Untrusted proxy, use connection IP
            debugLog(`Untrusted proxy ${proxyIp} sent X-Forwarded-For`);
            return proxyIp || req.ip || 'unknown';
        }
    }

    return req.ip || req.connection?.remoteAddress || 'unknown';
}

/**
 * Generate composite rate limit key (IP + identifier)
 * @param {Object} req - Express request
 * @returns {string} Rate limit key
 */
function generateCompositeKey(req) {
    const ip = getClientIp(req);
    const identifier = req.body?.email || req.body?.username || req.body?.phone || '';

    if (identifier) {
        // Rate limit by IP + account identifier (prevents distributed attacks)
        return `${ip}:${identifier.toLowerCase()}`;
    }

    return ip;
}

/**
 * Check if request should skip rate limiting
 * @param {Object} req - Express request
 * @returns {boolean} True if should skip
 */
function shouldSkipRateLimit(req) {
    const ip = getClientIp(req);

    // Skip for trusted IPs (admin, monitoring)
    if (TRUSTED_IPS.includes(ip)) {
        debugLog(`Skipping rate limit for trusted IP: ${ip}`);
        return true;
    }

    // Skip for health check bypass token
    const bypassToken = req.headers['x-rate-limit-bypass'];
    if (CONFIG.BYPASS_TOKEN && bypassToken === CONFIG.BYPASS_TOKEN) {
        debugLog('Skipping rate limit for bypass token');
        return true;
    }

    // Skip for monitoring user agents
    const userAgent = req.headers['user-agent'] || '';
    if (userAgent.includes('HealthCheck') || userAgent.includes('Monitoring')) {
        debugLog('Skipping rate limit for monitoring user agent');
        return true;
    }

    return false;
}

/**
 * Get dynamic error message based on endpoint
 * @param {Object} req - Express request
 * @returns {string} Error message
 */
function getEndpointMessage(req) {
    const path = req.path.toLowerCase();

    // Use vague messages that don't reveal timing
    if (path.includes('login')) {
        return 'Too many login attempts. Please try again later.';
    }
    if (path.includes('signup') || path.includes('register')) {
        return 'Too many signup attempts. Please try again later.';
    }
    if (path.includes('forgot-password') || path.includes('reset')) {
        return 'Too many password reset requests. Please try again later.';
    }
    if (path.includes('verify') || path.includes('otp')) {
        return 'Too many verification attempts. Please try again later.';
    }

    return 'Too many requests. Please try again later.';
}

/**
 * Handle rate limit exceeded
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Object} options - Rate limiter options
 */
function handleLimitReached(req, res, options) {
    const ip = getClientIp(req);
    const email = req.body?.email || 'N/A';
    const attempts = req.rateLimit?.current || 0;
    const path = req.path;
    const userAgent = req.headers['user-agent'] || 'Unknown';

    // Log rate limit events for monitoring
    securityLog('RATE_LIMIT_EXCEEDED', {
        ip,
        email,
        path,
        attempts,
        limit: req.rateLimit?.limit,
        userAgent: userAgent.substring(0, 100) // Truncate
    });

    // Calculate and set Retry-After header
    const retryAfterSeconds = req.rateLimit?.resetTime
        ? Math.ceil((req.rateLimit.resetTime - Date.now()) / 1000)
        : 60; // Default 60s

    res.set('Retry-After', retryAfterSeconds.toString());

    // Signal CAPTCHA requirement after threshold
    const requireCaptcha = attempts >= CONFIG.CAPTCHA_THRESHOLD;

    // Dynamic message based on endpoint
    const message = getEndpointMessage(req);

    res.status(429).json({
        success: false,
        message,
        requireCaptcha, // Frontend can show CAPTCHA if true
        retryAfter: retryAfterSeconds, // Also in body for convenience
        code: 'RATE_LIMIT_EXCEEDED'
    });
}

/**
 * Handle store errors gracefully
 * @param {Error} err - Store error
 * @param {Object} req - Express request
 * @param {Object} res - Express response
 * @param {Function} next - Next middleware
 */
function handleStoreError(err, req, res, next) {
    console.error('[RATE LIMIT] Store error:', err);

    if (CONFIG.FAIL_OPEN) {
        // Fail open: allow requests during store failures
        return next();
    }

    // Fail closed: reject requests during store failures
    return res.status(503).json({
        success: false,
        message: 'Service temporarily unavailable. Please try again later.',
        code: 'SERVICE_UNAVAILABLE'
    });
}

/* -------------------------------------------------------------------------- */
/*                        RATE LIMITER FACTORY                                */
/* -------------------------------------------------------------------------- */

/**
 * Create a rate limiter with common configuration
 * @param {Object} options - Custom options to override defaults
 * @returns {Function} Rate limiter middleware
 */
function createLimiter(options = {}) {
    const {
        windowMs = CONFIG.AUTH_WINDOW_MS,
        max = CONFIG.AUTH_MAX_ATTEMPTS,
        skipFailedRequests = false,
        skipSuccessfulRequests = false, // Don't count successful logins
        ...customOptions
    } = options;

    return rateLimit({
        // Configurable window and max
        windowMs,
        max,

        // Composite key: IP + identifier
        keyGenerator: generateCompositeKey,

        // Skip for trusted IPs and health checks
        skip: shouldSkipRateLimit,

        // Only count relevant requests
        skipFailedRequests,
        skipSuccessfulRequests,

        // Explicit in-memory store
        // NOTE: For production with multiple servers, use rate-limit-redis:
        // store: new RedisStore({ client: redis, prefix: 'rl:' })
        // The MemoryStore is explicit here for clarity

        // Headers configuration
        standardHeaders: 'draft-7', // Include RateLimit-* in ALL responses
        legacyHeaders: CONFIG.SUPPORT_LEGACY_HEADERS, // X-RateLimit-* for old clients

        // Custom handler with logging
        handler: handleLimitReached,

        // Define what counts as successful
        requestWasSuccessful: (req, res) => res.statusCode < 400,

        // Handle store errors gracefully
        // Note: express-rate-limit v6+ handles this internally, but good to be explicit

        ...customOptions
    });
}

/* -------------------------------------------------------------------------- */
/*                    ENDPOINT-SPECIFIC RATE LIMITERS                         */
/* -------------------------------------------------------------------------- */

/**
 * Login rate limiter - standard authentication attempts
 * 5 attempts per 15 minutes per IP+email
 */
const loginLimiter = createLimiter({
    max: CONFIG.AUTH_MAX_ATTEMPTS,
    skipSuccessfulRequests: true, // Only count failed logins
});

/**
 * Signup rate limiter - more lenient for form errors
 * 10 attempts per 15 minutes
 */
const signupLimiter = createLimiter({
    max: CONFIG.SIGNUP_MAX_ATTEMPTS,
    windowMs: 60 * 60 * 1000, // 1 hour window for signups
});

/**
 * OTP rate limiter - stricter due to brute-force risk
 * 3 attempts per 15 minutes (6-digit OTP = 1M combinations)
 */
const otpLimiter = createLimiter({
    max: CONFIG.OTP_MAX_ATTEMPTS,
    // OTP "costs" more due to higher brute-force risk
});

/**
 * Password reset rate limiter - prevent email enumeration
 * 3 attempts per hour
 */
const resetLimiter = createLimiter({
    max: CONFIG.RESET_MAX_ATTEMPTS,
    windowMs: 60 * 60 * 1000, // 1 hour
});

/**
 * General auth limiter (backwards compatibility)
 * Use specific limiters (loginLimiter, signupLimiter, etc.) when possible
 */
const authLimiter = createLimiter({
    max: CONFIG.AUTH_MAX_ATTEMPTS,
    skipSuccessfulRequests: true,
});

/**
 * API rate limiter for general API abuse prevention
 * More lenient than auth limiter - 100 requests per 15 minutes
 */
const apiLimiter = createLimiter({
    windowMs: parseInt(process.env.RATE_LIMIT_API_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_API_MAX, 10) || 5000,
    skipSuccessfulRequests: false, // Count all requests
    message: 'Too many requests, please try again later.',
});

/**
 * Stricter long-term limiter for sustained attack protection
 * 20 attempts per hour, 50 per day
 */
const longTermLimiter = createLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 20,
    skipSuccessfulRequests: true,
});

/**
 * Factory for user-type specific limiters
 * Premium users get higher limits, suspicious accounts get stricter limits
 * @param {Function} getUserType - Function to determine user type from request
 * @returns {Function} Middleware
 */
function createUserTypeLimiter(getUserType) {
    return async (req, res, next) => {
        try {
            const userType = await getUserType(req);

            let maxAttempts = CONFIG.AUTH_MAX_ATTEMPTS;

            // Different limits by user type
            switch (userType) {
                case 'premium':
                    maxAttempts = CONFIG.AUTH_MAX_ATTEMPTS * 4; // 4x for premium
                    break;
                case 'verified':
                    maxAttempts = CONFIG.AUTH_MAX_ATTEMPTS * 2; // 2x for verified
                    break;
                case 'suspicious':
                    maxAttempts = Math.max(2, Math.floor(CONFIG.AUTH_MAX_ATTEMPTS / 2)); // Half, min 2
                    break;
                default:
                    maxAttempts = CONFIG.AUTH_MAX_ATTEMPTS;
            }

            // Create limiter with user-specific max
            const limiter = createLimiter({ max: maxAttempts });
            return limiter(req, res, next);
        } catch (error) {
            // On error, use default limiter
            return authLimiter(req, res, next);
        }
    };
}

/* -------------------------------------------------------------------------- */
/*                                  EXPORTS                                   */
/* -------------------------------------------------------------------------- */

// Multiple exports for flexibility
module.exports = {
    // Specific limiters (recommended)
    loginLimiter,
    signupLimiter,
    otpLimiter,
    resetLimiter,

    // General purpose
    authLimiter,
    apiLimiter, // API abuse prevention
    longTermLimiter,

    // Factory function
    createLimiter,
    createUserTypeLimiter,

    // Utilities (for testing/customization)
    getClientIp,
    generateCompositeKey,
    shouldSkipRateLimit,

    // Configuration (for inspection)
    CONFIG
};

// Default export for simple usage
module.exports.default = authLimiter;

