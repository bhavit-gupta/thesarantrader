/* ---------------- DEPENDENCIES ---------------- */
const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth.middleware');
const { requireCoursePurchase } = require('../utils/helpers');
const chatController = require('../controllers/chat.controller');
const path = require('path');
const multer = require('multer');
const fs = require('fs');

/* ---------------- MULTER CONFIGURATION ---------------- */
// Ensure chat upload directory exists
const uploadDir = path.join(__dirname, '../public/uploads/chat');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'chat-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit (effectively unrestricted for photos)
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) return cb(null, true);
        cb(new Error('Only images (jpeg, jpg, png, gif, webp) are allowed'));
    }
});

// Apply middleware to all chat routes (or individually)
/* ---------------- PAGE ROUTES ---------------- */
// Page Routes (Rendered Views)
router.get('/chat', isAuthenticated, chatController.getChatRooms);
router.get('/chat/:courseId', isAuthenticated, requireCoursePurchase(), chatController.getCourseChat);

/* ---------------- API ROUTES ---------------- */
// API Routes
router.get('/api/chat/:courseId/messages', isAuthenticated, requireCoursePurchase(), chatController.getMessages);
router.post('/api/chat/:courseId/messages', isAuthenticated, requireCoursePurchase(), (req, res, next) => {
    upload.single('image')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
        } else if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, chatController.sendMessage);

module.exports = router;
