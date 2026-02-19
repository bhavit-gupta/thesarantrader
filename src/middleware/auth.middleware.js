/* ---------------- AUTHENTICATION MIDDLEWARE ---------------- */
const isAuthenticated = (req, res, next) => {
    console.log(`🔐 [AUTH] Checking authentication for: ${req.method} ${req.url}`);
    if (req.session.user) {
        console.log(`✅ [AUTH] Userauthenticated: ${req.session.user.name}`);
        return next();
    }

    console.log(`❌ [AUTH] Not authenticated`);
    const acceptHeader = req.headers.accept || '';

    if (req.xhr || acceptHeader.includes('json')) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    res.redirect('/login');
};

/* ---------------- ADMIN MIDDLEWARE ---------------- */
const isAdmin = (req, res, next) => {
    if (req.session.user && req.session.user.role === 'admin') {
        return next();
    }

    const acceptHeader = req.headers.accept || '';

    if (req.xhr || acceptHeader.includes('json')) {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    res.redirect('/dashboard');
};

/* ---------------- EXPORTS ---------------- */
module.exports = {
    isAuthenticated,
    isAdmin
};
