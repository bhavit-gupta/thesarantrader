/* ---------------- DEPENDENCIES ---------------- */
const crypto = require('crypto');

/* ---------------- CSRF MIDDLEWARE ---------------- */
const csrfProtection = (req, res, next) => {
    // Always define csrfToken for views
    res.locals.csrfToken = null;

    // ✅ ISSUE 5 FIX: Do NOT apply CSRF to API routes
    if (req.path.startsWith('/api')) {
        return next();
    }

    // Ensure session exists
    if (!req.session) {
        return next();
    }

    // Generate token if not exists
    if (!req.session.csrfToken) {
        req.session.csrfToken = crypto.randomUUID();
    }

    const token = req.session.csrfToken;
    res.locals.csrfToken = token;

    // Skip validation for safe HTTP methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }

    // Validate token for unsafe methods
    const clientToken =
        (req.body && req.body._csrf) ||
        (req.query && req.query._csrf) ||
        req.headers['csrf-token'] ||
        req.headers['xsrf-token'] ||
        req.headers['x-csrf-token'];

    if (!clientToken || clientToken !== token) {
        console.warn(`[CSRF] Blocked ${req.method} to ${req.path}`);
        if (req.accepts('html')) {
            return res.redirect('/login?error=Session+expired.+Please+refresh+and+try+again.');
        }
        return res.status(403).json({
            error: 'CSRF token mismatch',
            received: clientToken,
            expected: token
        });
    }

    next();
};

module.exports = csrfProtection;