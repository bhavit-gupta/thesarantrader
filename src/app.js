/* -------------------------------------------------------------------------- */
/*                          EXPRESS APPLICATION SETUP                         */
/* -------------------------------------------------------------------------- */
/*
 * Purpose: Configures the Express application with security, sessions, and routing
 * 
 * Architecture:
 * - MVC pattern (Models via Prisma, Views via EJS, Controllers in controllers/)
 * - Session-based authentication (stored in MongoDB via Prisma)
 * - CSRF protection on all state-changing requests
 * - Single-session enforcement (one device at a time)
 * - Rate limiting on authentication and API endpoints
 * 
 * Security Features:
 * - Helmet (security headers including HSTS, frameguard, noSniff)
 * - CSRF tokens (prevent cross-site request forgery)
 * - Rate limiting (prevent brute force and API abuse)
 * - Secure cookies (httpOnly, sameSite, secure)
 * - Single session enforcement (boot old sessions on new login)
 * - Request size limits (prevent DOS via large payloads)
 * - Content-Security-Policy (XSS mitigation)
 * 
 * Tech Stack:
 * - Express 5.2.1
 * - Prisma (MongoDB ORM)
 * - EJS (template engine)
 * - express-session (session management)
 */
/* -------------------------------------------------------------------------- */

require('dotenv').config();
const crypto = require('crypto');

const express = require('express');
const path = require('path');
const session = require('express-session');
const compression = require('compression'); // Gzip compression
const { PrismaSessionStore } = require('@quixo3/prisma-session-store');
const prisma = require('./utils/prisma');
const helmet = require('helmet');
const links = require('./config/links'); // Centralized links config
const app = express();

// Expose links globally to all EJS templates
app.locals.links = links;

/* -------------------------------------------------------------------------- */
/*                      ENVIRONMENT VARIABLES VALIDATION                      */
/* -------------------------------------------------------------------------- */

/**
 * Validate required environment variables at startup
 * Log configuration status for debugging
 */
const requiredEnvVars = ['SESSION_SECRET', 'DATABASE_URL'];
const missingVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingVars.length > 0) {
    throw new Error(`CRITICAL: Missing environment variables: ${missingVars.join(', ')}`);
}

// Log configuration validation
console.log('✓ Environment variables validated');

/* -------------------------------------------------------------------------- */
/*                          TRUST PROXY                                       */
/* -------------------------------------------------------------------------- */

/**
 * Trust proxy configuration for reverse proxy deployments
 * Required for proper IP detection behind nginx/load balancer
 */
if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1); // Trust first proxy
    console.log('✓ Trust proxy enabled for production');
}

/* -------------------------------------------------------------------------- */
/*                            GLOBAL REQUEST LOGGER                           */
/* -------------------------------------------------------------------------- */

/**
 * Logs all incoming requests for debugging and monitoring.
 * Skip noisy polling endpoints to prevent log bloat
 * 
 * Behavior:
 * - Excludes polling endpoints
 * - Logs HTTP method and URL path
 * - Emoji prefix (📡) for easy visual scanning
 */
const noLogUrls = [
    '/api/live-status',
    '/api/chat/',
    '/health',
    '/.well-known/healthz'
];

app.use((req, res, next) => {
    // Skip noisy polling requests
    const shouldSkipLog = noLogUrls.some(url => req.url.startsWith(url));
    if (!shouldSkipLog) {
        console.log(`📡 [${req.method}] ${req.url}`);
    }
    next();
});

/* -------------------------------------------------------------------------- */
/*                         PERFORMANCE MONITORING                             */
/* -------------------------------------------------------------------------- */

/**
 * Track request duration for performance monitoring
 * Log slow requests for optimization
 */
app.use((req, res, next) => {
    const startTime = Date.now();

    res.on('finish', () => {
        const duration = Date.now() - startTime;
        if (duration > 1000) { // Log requests taking > 1 second
            console.warn(`⚠️ SLOW REQUEST [${duration}ms]: ${req.method} ${req.path}`);
        }
    });

    next();
});

/* -------------------------------------------------------------------------- */
/*                              COMPRESSION                                   */
/* -------------------------------------------------------------------------- */

/**
 * Enable gzip compression for responses
 * Reduces bandwidth and improves load times
 */
app.use(compression());

/* -------------------------------------------------------------------------- */
/*                        SECURITY HEADERS (HELMET)                           */
/* -------------------------------------------------------------------------- */

/**
 * Helmet middleware for security-related HTTP headers.
 * 
 * Protects Against:
 * - XSS (Cross-Site Scripting) - via CSP
 * - Clickjacking - via frameguard
 * - MIME sniffing - via noSniff
 * - Protocol downgrade - via HSTS
 * - Information disclosure - via hidePoweredBy
 * - Privacy leakage - via referrerPolicy
 * 
 * Content Security Policy (CSP):
 * - Removed unsafe-inline from scriptSrcAttr for better XSS protection
 * - Allows scripts from CDN (CDNjs for libraries)
 * - Allows styles from Google Fonts and CDNjs
 * - Allows YouTube embeds for video lectures
 * - Restricted image sources to self, data, and specific domains
 * 
 * Note: crossOriginEmbedderPolicy disabled for YouTube iframe compatibility
 */
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            // Still need unsafe-inline for existing templates, but document for future refactoring
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "blob:", "cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "*.zoom.us", "zoom.us", "https://source.zoom.us", "https://*.cloudfront.net"],
            // Note: Keep unsafe-inline for now due to existing inline handlers
            // TODO: Refactor templates to remove inline handlers
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "https://cdn.jsdelivr.net", "fonts.googleapis.com", "*.zoom.us", "zoom.us", "https://source.zoom.us", "https://*.cloudfront.net"],
            fontSrc: ["'self'", "data:", "cdnjs.cloudflare.com", "fonts.gstatic.com", "https://source.zoom.us", "https://*.cloudfront.net"],
            // Restricted image sources - add specific CDNs as needed
            imgSrc: ["'self'", "data:", "https://cdn.jsdelivr.net", "https://i.imgur.com", "https://res.cloudinary.com", "*.zoom.us", "zoom.us", "https://source.zoom.us", "https://*.cloudfront.net"],
            connectSrc: ["'self'", "blob:", "https://cdn.jsdelivr.net", "*.zoom.us", "zoom.us", "https://source.zoom.us", "wss://*.zoom.us", "https://*.cloudfront.net"],
            frameSrc: ["'self'", "https://www.youtube.com", "https://youtube.com", "https://www.youtube-nocookie.com", "*.zoom.us", "zoom.us"],
            workerSrc: ["'self'", "blob:", "*.zoom.us", "zoom.us", "https://source.zoom.us", "https://*.cloudfront.net"],
            childSrc: ["'self'", "blob:", "*.zoom.us", "zoom.us", "https://source.zoom.us", "https://*.cloudfront.net"],
            mediaSrc: ["'self'", "blob:", "*.zoom.us", "zoom.us", "https://source.zoom.us"]



        },
    },
    crossOriginEmbedderPolicy: false, // Allow YouTube and Zoom embeds

    // HSTS - Force HTTPS
    hsts: {
        maxAge: 31536000,        // 1 year
        includeSubDomains: true,
        preload: true
    },
    // Prevent clickjacking
    // Prevent MIME sniffing
    noSniff: true,
    // Remove X-Powered-By header
    hidePoweredBy: true,
    // Privacy-conscious referrer policy
    referrerPolicy: {
        policy: 'strict-origin-when-cross-origin'
    }
}));

// Apply Cross-Origin Isolation AFTER Helmet for Zoom routes
// This prevents Helmet from overriding these specific headers.
app.use('/live-meeting', (req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp'); // Strict isolation for WASM/SAB
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin'); // Allow cross-origin resources in this context
    res.setHeader('Permissions-Policy', 'camera=*, microphone=*, display-capture=*, clipboard-write=*');
    next();
});

/* -------------------------------------------------------------------------- */
/*                          STATIC FILES & PARSING                            */
/* -------------------------------------------------------------------------- */

/**
 * Static file serving from public/ directory.
 * Added caching for performance
 * Note: uploads directory should have access control
 * 
 * Accessible files:
 * - /stylesheets/output.css (Tailwind CSS)
 * - /javascripts/*.js (client-side scripts)
 * - /images/* (logos, icons)
 * - /uploads/* (user-uploaded content - consider access control)
 */
app.use(express.static(path.join(__dirname, 'public'), {
    maxAge: process.env.NODE_ENV === 'production' ? '1d' : 0, // Cache in production
    etag: true
}));

// Serve Zoom Meeting SDK from node_modules
app.use('/zoom-sdk', express.static(path.join(__dirname, '../node_modules/@zoom/meetingsdk/dist')));

/**
 * Body parsing middleware.
 * Added size limits to prevent DOS attacks
 * 
 * - urlencoded: Parses HTML form submissions (application/x-www-form-urlencoded)
 * - json: Parses JSON payloads from AJAX requests
 */
app.use(express.urlencoded({ extended: false, limit: '10kb' })); // Size limit
app.use(express.json({ limit: '10kb' })); // Size limit

/* -------------------------------------------------------------------------- */
/*                          VIEW ENGINE (EJS)                                 */
/* -------------------------------------------------------------------------- */

/**
 * EJS template engine configuration.
 * Views path validated to prevent symlink attacks
 * 
 * Template Location: src/views/
 * 
 * Directory Structure:
 * - layouts/: Full-page templates (index, courses, community)
 * - dashboard/: User and admin dashboard pages
 * - auth/: Login, signup, password reset pages
 * - courses/: Checkout and enrollment pages
 * - partials/: Reusable components (navbar, footer)
 * 
 * Data Injection:
 * - req.session.user: Current logged-in user (via viewData middleware)
 * - res.locals: Global data injected by viewData middleware
 */
app.set('view engine', 'ejs');

// Validate views path
const viewsPath = path.resolve(__dirname, 'views');
if (!viewsPath.startsWith(path.resolve(__dirname))) {
    throw new Error('SECURITY: Views path is outside application directory');
}
app.set('views', viewsPath);

/**
 * Global EJS helper functions (available in all templates).
 * 
 * app.locals.formatDate(dateInput):
 * Uses explicit timezone (Asia/Kolkata for Indian users)
 * Handles multiple date input formats
 * - Converts Date objects, ISO strings, or timestamps to DD/MM/YYYY format
 * - Returns empty string for invalid dates
 * - Used for displaying course start/end dates
 * 
 * @example
 * // In EJS template
 * <%= formatDate(course.startDate) %>
 * // Output: 25/12/2024
 */
app.locals.formatDate = function (dateInput) {
    if (!dateInput) return '';

    // Handle multiple input formats
    let date;
    if (typeof dateInput === 'string') {
        date = new Date(dateInput);
    } else if (typeof dateInput === 'number') {
        date = new Date(dateInput); // Assume milliseconds
    } else if (dateInput instanceof Date) {
        date = dateInput;
    } else {
        return String(dateInput);
    }

    if (isNaN(date.getTime())) return String(dateInput); // Invalid date

    // Use explicit timezone (IST for Indian users)
    try {
        const formatter = new Intl.DateTimeFormat('en-IN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            timeZone: 'Asia/Kolkata'
        });
        return formatter.format(date);
    } catch (e) {
        // Fallback to simple format
        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const year = date.getFullYear();
        return `${day}/${month}/${year}`;
    }
};

/* -------------------------------------------------------------------------- */
/*                              HEALTH CHECK                                  */
/* -------------------------------------------------------------------------- */

/**
 * Health check endpoint for load balancers and monitoring
 * Returns server status for operational monitoring
 */
app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

/* -------------------------------------------------------------------------- */
/*                        SESSION MANAGEMENT (MONGODB)                        */
/* -------------------------------------------------------------------------- */

/**
 * Express session configuration with Prisma session store.
 * 
 * Storage: MongoDB (via Prisma Session model)
 * 
 * Security Features:
 * - httpOnly cookie: JavaScript can't access (prevents XSS theft)
 * secure cookie: HTTPS-only (always true in production)
 * - sameSite: 'lax': Prevents CSRF from external sites
 * - rolling: true: Extends session on every request (keeps users logged in)
 * 
 * Session Lifecycle:
 * 1. User logs in → Session created with random ID
 * 2. Session stored in MongoDB Session table
 * 3. Cookie sent to browser with session ID
 * 4. Every request includes cookie → Session restored
 * 5. Inactive for 30 days → Session expires
 * 
 * Custom Session ID Generation:
 * - MongoDB requires 24-character hex ObjectIds
 * - We hash the Express session ID (MD5) to create valid ObjectId
 * - This allows Prisma to store sessions in MongoDB
 * 
 * Cleanup:
 * - checkPeriod: 2 minutes (prunes expired sessions)
 * - Prevents stale session buildup in database
 */
app.use(session({
    name: 'thesarantrader.sid',           // Custom cookie name
    secret: process.env.SESSION_SECRET,    // Used to sign session cookie
    resave: false,                         // Don't save unchanged sessions
    saveUninitialized: false,              // Don't create session for unauthenticated users
    rolling: true,                         // Reset expiration on every request
    store: new PrismaSessionStore(
        prisma,
        {
            checkPeriod: 2 * 60 * 1000,    // Cleanup expired sessions every 2 minutes
            dbRecordIdIsSessionId: false,  // Use custom ID function
            // Generate MongoDB-compatible 24-char hex ID from Express session ID
            dbRecordIdFunction: (sessionId) =>
                crypto.createHash('md5').update(sessionId).digest('hex').substring(0, 24),
        }
    ),
    cookie: {
        httpOnly: true,
        secure: 'auto',
        sameSite: 'lax',                               // CSRF protection
        maxAge: 30 * 24 * 60 * 60 * 1000              // 30 days expiration
    }
}));

/* -------------------------------------------------------------------------- */
/*                          CUSTOM MIDDLEWARE CHAIN                           */
/* -------------------------------------------------------------------------- */

/**
 * Middleware execution order is critical for security and functionality.
 * 
 * Execution Order:
 * 1. CSRF Protection - Validates tokens on POST/PUT/DELETE
 * 2. Single Session Enforcement - Boots old sessions on new device login
 * 3. View Data Injection - Adds user, courses, CSRF token to res.locals
 * 
 * Optimizations:
 * - viewData only runs on non-API routes
 * - singleSession only runs for authenticated users
 * - CSRF skipped for static files
 * 
 * Why This Order:
 * - CSRF must run after session (needs req.session.user)
 * - Single session must run after session (checks currentSessionId)
 * - View data must run last (needs user to be authenticated)
 */

// Step 1: CSRF Protection (prevents cross-site request forgery)
// Only apply to dynamic routes that need it
const csrfProtection = require('./middleware/csrfProtection');
app.use((req, res, next) => {
    // Skip CSRF for health check
    if (req.path === '/health') {
        return next();
    }
    csrfProtection(req, res, next);
});

// Step 2: Single Session Enforcement (boot old logins on new device)
// Only run for authenticated users
const singleSessionMiddleware = require('./middleware/singleSession.middleware');
app.use((req, res, next) => {
    if (req.session?.user) {
        singleSessionMiddleware(req, res, next);
    } else {
        next();
    }
});

// Step 3: Global View Data (inject common data into res.locals for EJS)
// Only apply to non-API routes
const viewDataMiddleware = require('./middleware/viewData.middleware');
app.use((req, res, next) => {
    if (!req.path.startsWith('/api')) {
        viewDataMiddleware(req, res, next);
    } else {
        next();
    }
});

/* -------------------------------------------------------------------------- */
/*                              ROUTE MOUNTING                                */
/* -------------------------------------------------------------------------- */

/**
 * Application routes organized by feature domain.
 * 
 * Route Organization:
 * - /auth/*: Authentication (login, signup, password reset, OTP)
 * - /api/courses/*: Course CRUD operations
 * - /api/testimonials/*: Testimonial submission and approval
 * - /api/community/*: Social feed (posts, likes, comments)
 * - /api/chat/*: Course chat rooms with image attachments
 * - /api/payment/*: Manual payment verification workflow
 * - /admin/*: Admin panel (users, courses, payments, statistics)
 * - /*: View routes (renders EJS templates)
 * 
 * Rate Limiting:
 * - /auth/* routes are rate-limited (5 requests per minute)
 * - /api/* routes are rate-limited (100 requests per 15 minutes)
 * - Prevents brute force attacks and API abuse
 * 
 * Added API rate limiting for abuse prevention
 */
const { authLimiter, apiLimiter } = require('./middleware/rateLimiter');
app.use('/auth', authLimiter); // Rate limiting for auth routes
app.use('/api', apiLimiter);   // Rate limiting for API routes

app.use("/auth", require("./routes/auth.route"));          // Authentication endpoints
app.use(require("./routes/course.routes"));                // Course management
app.use(require("./routes/testimonial.routes"));           // Testimonial system
app.use(require("./routes/community.routes"));             // Social feed
app.use(require("./routes/chat.routes"));                  // Course chat rooms
app.use(require("./routes/payment.routes"));               // Payment verification
app.use(require("./routes/admin.routes"));                 // Admin dashboard
app.use(require("./routes/views.routes"));                 // View rendering

// 404 Handler - MUST be after all routes
app.use((req, res) => {
    res.status(404).render('errors/404');
});

/* -------------------------------------------------------------------------- */
/*                           GLOBAL ERROR HANDLER                             */
/* -------------------------------------------------------------------------- */

/**
 * Express error handling middleware.
 * Improved error logging with unique error ID
 * Content negotiation for JSON/HTML responses
 * 
 * Catches:
 * - Unhandled errors from async route handlers
 * - Middleware errors (e.g., multer file size exceeded)
 * - Database connection failures
 * 
 * Behavior:
 * - Logs full error with unique ID for tracking
 * - Returns JSON for API requests, text for browser
 * - Sets 500 status code (Internal Server Error)
 * 
 * @param {Error} err - The error object
 * @param {Request} req - Express request object
 * @param {Response} res - Express response object
 * @param {NextFunction} next - Express next middleware function
 */
app.use((err, req, res, next) => {
    // Generate unique error ID for tracking
    const errorId = crypto.randomUUID();

    // ALWAYS log details to console for admin/dev tracking
    console.error(`❌ GLOBAL ERROR [${errorId}]: ${err.message}`);
    console.error('  Path:', req.path);
    console.error('  Method:', req.method);
    if (req.session?.user) console.error('  User:', req.session.user.id, `(${req.session.user.role})`);
    console.error('  IP:', req.ip);
    console.error('  Stack Trace:\n', err.stack);

    // Return appropriate format based on request type
    if (req.accepts('json') || req.path.startsWith('/api')) {
        if (process.env.NODE_ENV === 'production') {
            res.status(500).json({
                success: false,
                message: 'Something went wrong. Reference ID: ' + errorId,
                errorId
            });
        } else {
            res.status(500).json({
                success: false,
                message: err.message,
                errorId,
                stack: err.stack
            });
        }
    } else {
        res.status(500).send('Something went wrong on our end. Please try again later. Reference: ' + errorId);
    }
});

/* -------------------------------------------------------------------------- */
/*                                   EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = app;