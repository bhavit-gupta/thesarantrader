require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const helmet = require('helmet');
const app = express();

/* -------------------------------------------------------------------------- */
/*                                 MIDDLEWARE                                 */
/* -------------------------------------------------------------------------- */

// Global Request Logger (Excludes noise from status polling)
app.use((req, res, next) => {
    if (req.url === '/api/live-status') return next();
    console.log(`📡 [${req.method}] ${req.url}`);
    next();
});

// Security Headers (Helmet) - Protects against well-known web vulnerabilities
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "cdnjs.cloudflare.com", "fonts.googleapis.com"],
            fontSrc: ["'self'", "cdnjs.cloudflare.com", "fonts.gstatic.com"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));

// Static Files Deployment
app.use(express.static(path.join(__dirname, 'public')));

// Body Parsers for Form and JSON data
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

/* -------------------------------------------------------------------------- */
/*                                VIEW ENGINE                                 */
/* -------------------------------------------------------------------------- */

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Global EJS Helpers (Available in all templates)
app.locals.formatDate = function (dateString) {
    if (!dateString) return '';
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return dateString;
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

/* -------------------------------------------------------------------------- */
/*                                   SESSION                                  */
/* -------------------------------------------------------------------------- */

if (!process.env.SESSION_SECRET) {
    throw new Error("CRITICAL: SESSION_SECRET is missing from .env");
}

app.use(session({
    name: 'thesarantrader.sid',
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 Hours
    }
}));

/* -------------------------------------------------------------------------- */
/*                            CUSTOM MIDDLEWARES                              */
/* -------------------------------------------------------------------------- */

// CSRF Protection (Must follow session)
const csrfProtection = require('./middleware/csrfProtection');
app.use(csrfProtection);

// Single Session Enforcement (Boot old logins on device mismatch)
const singleSessionMiddleware = require('./middleware/singleSession.middleware');
app.use(singleSessionMiddleware);

// Global View Data (Injects common data like user, courses, CSRF into every render)
const viewDataMiddleware = require('./middleware/viewData.middleware');
app.use(viewDataMiddleware);

/* -------------------------------------------------------------------------- */
/*                                   ROUTES                                   */
/* -------------------------------------------------------------------------- */

const { authLimiter } = require('./middleware/rateLimiter');
app.use('/auth', authLimiter); // Protect login/signup from brute force

app.use("/auth", require("./routes/auth.route"));
app.use(require("./routes/course.routes"));
app.use(require("./routes/testimonial.routes"));
app.use(require("./routes/community.routes"));
app.use(require("./routes/chat.routes"));
app.use(require("./routes/payment.routes"));
app.use(require("./routes/admin.routes"));
app.use(require("./routes/views.routes"));

/* -------------------------------------------------------------------------- */
/*                                ERROR HANDLER                               */
/* -------------------------------------------------------------------------- */

app.use((err, req, res, next) => {
    console.error('❌ FATAL ERROR:', err);
    res.status(500).send('Something went wrong on our end. Please try again later.');
});

module.exports = app;