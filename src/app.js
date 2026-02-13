const express = require('express');
const path = require('path');
const session = require('express-session');

const app = express();

// Set EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Body parser
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session middleware
app.use(session({
    secret: 'thesarantrader-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// ===== Courses Data (Mock DB) =====
const courses = [
    { id: 1, title: "March Batch: Options Trading", description: "Master the skills of risk management and profitable trading strategies.", rating: 4.6, students: 800, price: 4000, originalPrice: 8000, badge: "Bestseller", badgeColor: "orange", icon: "💹", iconBg: "blue-50", iconColor: "blue-500" },
    { id: 2, title: "Technical Analysis Masterclass", description: "Learn to read charts, patterns, and indicators like a pro.", rating: 4.9, students: 500, price: 3500, originalPrice: 7000, icon: "📊", iconBg: "indigo-50", iconColor: "indigo-500" },
    { id: 3, title: "Long-term Wealth Creation", description: "Understand company fundamentals and build a long-term portfolio.", rating: 4.7, students: 300, price: 2999, originalPrice: 6000, icon: "🏢", iconBg: "green-50", iconColor: "green-500" },
    { id: 4, title: "Options Trading: Zero to Hero", description: "A complete guide from basics to advanced strategies.", rating: 5.0, students: 100, price: 4999, originalPrice: 10000, badgeColor: "purple", icon: "🚀", iconBg: "purple-50", iconColor: "purple-500" }
];

// ===== Admin Live Status (in-memory) =====
// Map courseId -> { isLive: boolean, startTime: number }
let liveSessions = {};

// Initialize liveSessions
courses.forEach(c => {
    liveSessions[c.id] = { isLive: false, startTime: null };
});

// Make user available to all views
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.liveSessions = liveSessions; // Make live status global
    res.locals.courses = courses; // Make courses global (useful for some views)
    next();
});

// Routes
app.get('/', (req, res) => res.render("layouts/index"));
app.get('/courses', (req, res) => res.render("layouts/courses"));
app.get('/login', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render("auth/login");
});
app.get('/signup', (req, res) => {
    if (req.session.user) return res.redirect('/dashboard');
    res.render("auth/signup");
});
app.get('/forgetPassword', (req, res) => res.render("auth/forgetPassword"));
app.get('/verifyOTP', (req, res) => res.render("auth/verifyOTP"));
app.get('/enroll', (req, res) => res.render("courses/enroll"));

// Dashboard (protected)
app.get('/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    if (req.session.user.role === 'admin') return res.redirect('/admin/dashboard');
    res.render("dashboard/user", { liveSessions, courses });
});

// Admin Dashboard (protected, admin only)
app.get('/admin/dashboard', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    if (req.session.user.role !== 'admin') return res.redirect('/dashboard');
    res.render("dashboard/admin", { liveSessions, courses });
});

// ⚠️ TEMPORARY: Test dashboard without login (remove in production)
app.get('/test-dashboard', (req, res) => {
    req.session.user = { name: 'Test User', username: 'testuser', email: 'test@example.com', role: 'user' };
    res.redirect('/dashboard');
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// Live status API
app.get('/api/live-status', (req, res) => {
    res.json({ liveSessions });
});

// Courses API (For public frontend)
app.get('/api/courses', (req, res) => {
    res.json(courses);
});

// Admin toggle live
app.post('/admin/toggle-live', (req, res) => {
    const { courseId } = req.body;
    if (!courseId || !liveSessions[courseId]) {
        // Safe creation if missing
        if (courseId) {
            liveSessions[courseId] = { isLive: false, startTime: null };
        } else {
            return res.status(400).json({ success: false, message: "Invalid Course ID" });
        }
    }

    const session = liveSessions[courseId];
    session.isLive = !session.isLive;

    if (session.isLive) {
        session.startTime = Date.now();
    } else {
        session.startTime = null;
    }

    console.log(`🔴 Live status toggled for Course ${courseId}: ${session.isLive ? 'ON' : 'OFF'}`);
    res.json({ success: true, courseId, isLive: session.isLive, startTime: session.startTime });
});

// Admin Course Management Routes
app.get('/admin/courses', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/dashboard');
    }
    res.render("dashboard/admin_courses", { courses });
});

app.post('/admin/courses/add', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Unauthorized");
    }

    const { title, description, price, originalPrice, icon, colorTheme } = req.body;

    // Create new course object
    const newCourse = {
        id: courses.length > 0 ? Math.max(...courses.map(c => c.id)) + 1 : 1,
        title,
        description,
        price: parseInt(price),
        originalPrice: parseInt(originalPrice),
        rating: 5.0, // Default rating for new course
        students: 0, // Default students
        icon: icon || "📚",
        iconBg: `${colorTheme || 'blue'}-50`,
        iconColor: `${colorTheme || 'blue'}-500`,
        badge: "New",
        badgeColor: "green"
    };

    // Add to in-memory DB
    courses.push(newCourse);

    // Initialize live session state for new course
    liveSessions[newCourse.id] = { isLive: false, startTime: null };

    console.log(`✅ New Course Added: ${title}`);
    res.redirect('/admin/courses');
});

// Delete Course Route
app.post('/admin/courses/delete/:id', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Unauthorized");
    }

    const courseId = parseInt(req.params.id);

    const courseIndex = courses.findIndex(c => c.id === courseId);

    if (courseIndex !== -1) {
        const deletedCourse = courses.splice(courseIndex, 1)[0];
        delete liveSessions[courseId]; // Cleanup live session state
        console.log(`🗑️ Course Deleted: ${deletedCourse.title}`);
    }

    res.redirect('/admin/courses');
});

// Edit Course Route
app.post('/admin/courses/edit/:id', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Unauthorized");
    }

    const courseId = parseInt(req.params.id);
    const { title, description, price, originalPrice, icon, colorTheme } = req.body;

    const course = courses.find(c => c.id === courseId);

    if (course) {
        course.title = title;
        course.description = description;
        course.price = parseInt(price);
        course.originalPrice = parseInt(originalPrice);
        if (icon) course.icon = icon;
        if (colorTheme) {
            course.iconBg = `${colorTheme}-50`;
            course.iconColor = `${colorTheme}-500`;
        }
        console.log(`✏️ Course Updated: ${course.title}`);
    }

    res.redirect('/admin/courses');
});

// Auth API routes
const authRoutes = require("./routes/auth.route");
app.use("/auth", authRoutes);

module.exports = app;
