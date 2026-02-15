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

// ===== Testimonials Data (in-memory) =====
let testimonials = [];
let testimonialIdCounter = 1;

// ===== Community Posts Data (in-memory) =====
let communityPosts = [];
let postIdCounter = 1;
let commentIdCounter = 1;

// ===== Chat Messages Data (in-memory) =====
// Format: { courseId: [messages] }
let chatMessages = {};
let chatMessageIdCounter = 1;

// ===== User Purchases Data (mock for testing) =====
let userPurchases = [
    { userId: 'user1', courseId: 1, purchaseDate: Date.now() - 86400000 },
    { userId: 'user1', courseId: 2, purchaseDate: Date.now() - 172800000 },
    { userId: 'user2', courseId: 1, purchaseDate: Date.now() - 259200000 }
];

// Helper function to get user's purchased courses
function getUserPurchasedCourses(userId) {
    return userPurchases
        .filter(p => p.userId === userId)
        .map(p => p.courseId);
}

// Helper function to check if user purchased a course
function hasUserPurchasedCourse(userId, courseId) {
    return userPurchases.some(p => p.userId === userId && p.courseId === parseInt(courseId));
}

// Make user available to all views
app.use((req, res, next) => {
    res.locals.user = req.session.user || null;
    res.locals.liveSessions = liveSessions; // Make live status global
    res.locals.courses = courses; // Make courses global (useful for some views)

    // Check if user has purchased any courses (for chat access)
    // Admin always has chat access
    if (req.session.user) {
        if (req.session.user.username === 'admin') {
            res.locals.hasPurchasedCourses = true;
        } else {
            const purchasedCourses = getUserPurchasedCourses(req.session.user.username);
            res.locals.hasPurchasedCourses = purchasedCourses.length > 0;
        }
    } else {
        res.locals.hasPurchasedCourses = false;
    }

    next();
});

// Routes
app.get('/', (req, res) => res.render("layouts/index"));
app.get('/courses', (req, res) => res.render("layouts/courses", { courses }));
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
app.get('/testimonials', (req, res) => res.render("layouts/testimonials"));
app.get('/features', (req, res) => res.render("layouts/features"));

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
    res.render("dashboard/admin_courses", {
        courses,
        user: req.session.user,
        liveSessions
    });
});

app.post('/admin/courses/add', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).send("Unauthorized");
    }

    const { title, description, price, originalPrice, icon, colorTheme, liveLink } = req.body;

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
        badgeColor: "green",
        liveLink: liveLink || "" // Store the live link
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
    const { title, description, price, originalPrice, icon, colorTheme, liveLink } = req.body;

    const course = courses.find(c => c.id === courseId);

    if (course) {
        course.title = title;
        course.description = description;
        course.price = parseInt(price);
        course.originalPrice = parseInt(originalPrice);
        course.liveLink = liveLink || ""; // Update live link
        if (icon) course.icon = icon;
        if (colorTheme) {
            course.iconBg = `${colorTheme}-50`;
            course.iconColor = `${colorTheme}-500`;
        }
        console.log(`✏️ Course Updated: ${course.title}`);
    }

    res.redirect('/admin/courses');
});

// ===== Testimonial API Routes =====

// User submits a testimonial
app.post('/api/testimonials/submit', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in to submit a testimonial' });
    }

    const { message, rating, userRole } = req.body;

    // Validation
    if (!message || !rating) {
        return res.status(400).json({ success: false, message: 'Message and rating are required' });
    }

    if (message.length > 500) {
        return res.status(400).json({ success: false, message: 'Message must be 500 characters or less' });
    }

    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }

    // Create new testimonial
    const newTestimonial = {
        id: testimonialIdCounter++,
        userId: req.session.user.username,
        userName: req.session.user.name,
        userRole: userRole || 'Student',
        message: message.trim(),
        rating: ratingNum,
        status: 'pending',
        submittedAt: Date.now(),
        reviewedAt: null
    };

    testimonials.push(newTestimonial);
    console.log(`📝 New testimonial submitted by ${newTestimonial.userName}`);

    res.json({ success: true, message: 'Testimonial submitted successfully! Waiting for admin approval.', testimonial: newTestimonial });
});

// Get approved testimonials (public)
app.get('/api/testimonials/approved', (req, res) => {
    const approvedTestimonials = testimonials
        .filter(t => t.status === 'approved')
        .sort((a, b) => b.reviewedAt - a.reviewedAt); // Most recently approved first

    res.json({ success: true, testimonials: approvedTestimonials });
});

// Get user's testimonials
app.get('/api/testimonials/my-testimonials', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const userTestimonials = testimonials
        .filter(t => t.userId === req.session.user.username && (t.status === 'pending' || t.status === 'approved'))
        .sort((a, b) => b.submittedAt - a.submittedAt); // Most recent first

    res.json({ success: true, testimonials: userTestimonials });
});

// Admin: Get all testimonials
app.get('/admin/testimonials', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.redirect('/dashboard');
    }

    const pendingTestimonials = testimonials.filter(t => t.status === 'pending');
    const approvedTestimonials = testimonials.filter(t => t.status === 'approved');
    const rejectedTestimonials = testimonials.filter(t => t.status === 'rejected');

    res.render('dashboard/admin_testimonials', {
        pendingTestimonials,
        approvedTestimonials,
        rejectedTestimonials
    });
});

// Admin: Approve testimonial
app.post('/admin/testimonials/approve/:id', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const testimonialId = parseInt(req.params.id);
    const testimonial = testimonials.find(t => t.id === testimonialId);

    if (!testimonial) {
        return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    testimonial.status = 'approved';
    testimonial.reviewedAt = Date.now();

    console.log(`✅ Testimonial #${testimonialId} approved by admin`);
    res.json({ success: true, message: 'Testimonial approved successfully', testimonial });
});

// Admin: Reject testimonial
app.post('/admin/testimonials/reject/:id', (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') {
        return res.status(403).json({ success: false, message: 'Unauthorized' });
    }

    const testimonialId = parseInt(req.params.id);
    const testimonial = testimonials.find(t => t.id === testimonialId);

    if (!testimonial) {
        return res.status(404).json({ success: false, message: 'Testimonial not found' });
    }

    testimonial.status = 'rejected';
    testimonial.reviewedAt = Date.now();

    console.log(`❌ Testimonial #${testimonialId} rejected by admin`);
    res.json({ success: true, message: 'Testimonial rejected', testimonial });
});

// ==================== COMMUNITY ROUTES ====================

// Community page
app.get('/community', (req, res) => {
    res.render('layouts/community', {
        user: req.session.user || null,
        liveSessions: liveSessions
    });
});

// Create a new post
app.post('/api/community/posts', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in to post' });
    }

    const { title, content } = req.body;

    if (!content || content.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Post content is required' });
    }

    if (content.length > 1000) {
        return res.status(400).json({ success: false, message: 'Post content must be less than 1000 characters' });
    }

    const newPost = {
        id: postIdCounter++,
        userId: req.session.user.username,
        userName: req.session.user.name,
        title: title ? title.trim() : '',
        content: content.trim(),
        likes: 0,
        likedBy: [],
        comments: [],
        createdAt: Date.now()
    };

    communityPosts.unshift(newPost);
    console.log(`📝 New community post by ${newPost.userName}`);

    res.json({ success: true, message: 'Post created successfully!', post: newPost });
});

// Get all posts
app.get('/api/community/posts', (req, res) => {
    res.json({ success: true, posts: communityPosts });
});

// Toggle like on a post
app.post('/api/community/posts/:id/like', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const postId = parseInt(req.params.id);
    const post = communityPosts.find(p => p.id === postId);

    if (!post) {
        return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const userId = req.session.user.username;
    const likedIndex = post.likedBy.indexOf(userId);

    if (likedIndex > -1) {
        post.likedBy.splice(likedIndex, 1);
        post.likes--;
    } else {
        post.likedBy.push(userId);
        post.likes++;
    }

    res.json({ success: true, likes: post.likes, isLiked: likedIndex === -1 });
});

// Add comment to a post
app.post('/api/community/posts/:id/comment', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const postId = parseInt(req.params.id);
    const post = communityPosts.find(p => p.id === postId);

    if (!post) {
        return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const { content } = req.body;

    if (!content || content.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Comment cannot be empty' });
    }

    if (content.length > 500) {
        return res.status(400).json({ success: false, message: 'Comment must be less than 500 characters' });
    }

    const newComment = {
        id: commentIdCounter++,
        userId: req.session.user.username,
        userName: req.session.user.name,
        content: content.trim(),
        createdAt: Date.now()
    };

    post.comments.push(newComment);

    res.json({ success: true, message: 'Comment added!', comment: newComment });
});

// Admin: Delete a post
app.delete('/api/community/posts/:id', (req, res) => {
    if (!req.session.user || req.session.user.username !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const postId = parseInt(req.params.id);
    const postIndex = communityPosts.findIndex(p => p.id === postId);

    if (postIndex === -1) {
        return res.status(404).json({ success: false, message: 'Post not found' });
    }

    communityPosts.splice(postIndex, 1);
    console.log(`🗑️ Admin deleted post #${postId}`);

    res.json({ success: true, message: 'Post deleted successfully' });
});

// Admin: Delete a comment
app.delete('/api/community/posts/:postId/comments/:commentId', (req, res) => {
    if (!req.session.user || req.session.user.username !== 'admin') {
        return res.status(403).json({ success: false, message: 'Admin access required' });
    }

    const postId = parseInt(req.params.postId);
    const commentId = parseInt(req.params.commentId);

    const post = communityPosts.find(p => p.id === postId);

    if (!post) {
        return res.status(404).json({ success: false, message: 'Post not found' });
    }

    const commentIndex = post.comments.findIndex(c => c.id === commentId);

    if (commentIndex === -1) {
        return res.status(404).json({ success: false, message: 'Comment not found' });
    }

    post.comments.splice(commentIndex, 1);
    console.log(`🗑️ Admin deleted comment #${commentId} from post #${postId}`);

    res.json({ success: true, message: 'Comment deleted successfully' });
});

// ==================== CHAT ROUTES ====================

// Chat rooms - show list of purchased courses
app.get('/chat', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    // Admin has access to all courses
    if (req.session.user.username === 'admin') {
        res.render('layouts/chat-rooms', {
            user: req.session.user,
            liveSessions: liveSessions,
            purchasedCourses: courses,
            isAdmin: true
        });
        return;
    }

    const purchasedCourseIds = getUserPurchasedCourses(req.session.user.username);

    if (purchasedCourseIds.length === 0) {
        return res.redirect('/courses?message=purchase_required');
    }

    const purchasedCourses = courses.filter(c => purchasedCourseIds.includes(c.id));

    res.render('layouts/chat-rooms', {
        user: req.session.user,
        liveSessions: liveSessions,
        purchasedCourses,
        isAdmin: false
    });
});

// Specific course chat room
app.get('/chat/:courseId', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }

    const courseId = parseInt(req.params.courseId);
    const isAdmin = req.session.user.username === 'admin';

    // Admin has access to all chats, others need to have purchased
    if (!isAdmin && !hasUserPurchasedCourse(req.session.user.username, courseId)) {
        return res.redirect('/courses?message=purchase_required');
    }

    const course = courses.find(c => c.id === courseId);

    if (!course) {
        return res.status(404).send('Course not found');
    }

    res.render('layouts/chat-room', {
        user: req.session.user,
        liveSessions: liveSessions,
        course,
        isAdmin
    });
});

// Get messages for a course
app.get('/api/chat/:courseId/messages', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const courseId = parseInt(req.params.courseId);
    const isAdmin = req.session.user.username === 'admin';

    // Admin has access to all chats
    if (!isAdmin && !hasUserPurchasedCourse(req.session.user.username, courseId)) {
        return res.status(403).json({ success: false, message: 'You must purchase this course to access the chat' });
    }

    const messages = chatMessages[courseId] || [];
    res.json({ success: true, messages });
});

// Send message to course chat
app.post('/api/chat/:courseId/messages', (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const courseId = parseInt(req.params.courseId);
    const isAdmin = req.session.user.username === 'admin';

    // Admin can send messages in all chats
    if (!isAdmin && !hasUserPurchasedCourse(req.session.user.username, courseId)) {
        return res.status(403).json({ success: false, message: 'You must purchase this course to access the chat' });
    }

    const { message } = req.body;

    if (!message || message.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    if (message.length > 500) {
        return res.status(400).json({ success: false, message: 'Message must be less than 500 characters' });
    }

    const newMessage = {
        id: chatMessageIdCounter++,
        courseId,
        userId: req.session.user.username,
        userName: req.session.user.name,
        message: message.trim(),
        timestamp: Date.now()
    };

    if (!chatMessages[courseId]) {
        chatMessages[courseId] = [];
    }

    chatMessages[courseId].push(newMessage);
    console.log(`💬 New message in course ${courseId} by ${newMessage.userName}`);

    res.json({ success: true, message: 'Message sent!', chatMessage: newMessage });
});

// Auth API routes
const authRoutes = require("./routes/auth.route");
app.use("/auth", authRoutes);

module.exports = app;
