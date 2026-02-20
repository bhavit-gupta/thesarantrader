/* ---------------- DEPENDENCIES ---------------- */
const express = require('express');
const router = express.Router();
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const communityController = require('../controllers/community.controller');

/* ---------------- MULTER CONFIGURATION ---------------- */
// Ensure community upload directory exists
const uploadDir = path.join(__dirname, '../public/uploads/community');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, 'post-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit (effectively unrestricted)
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|webp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);
        if (mimetype && extname) return cb(null, true);
        cb(new Error('Only images (jpeg, jpg, png, gif, webp) are allowed'));
    }
});

/* ---------------- MIDDLEWARE ---------------- */
const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');

/* ---------------- PUBLIC ROUTES ---------------- */
router.get('/api/community/posts', communityController.getPosts);

// Create post with optional image upload
router.post('/api/community/posts', isAuthenticated, (req, res, next) => {
    upload.single('image')(req, res, (err) => {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ success: false, message: `Upload error: ${err.message}` });
        } else if (err) {
            return res.status(400).json({ success: false, message: err.message });
        }
        next();
    });
}, communityController.createPost);
router.post('/api/community/posts/:id/like', isAuthenticated, communityController.likePost);
router.post('/api/community/posts/:id/comment', isAuthenticated, communityController.addComment);

/* ---------------- ADMIN ROUTES ---------------- */
// Admin Routes (isAuthenticated — ownership/role check is in controller)
router.delete('/api/community/posts/:id', isAuthenticated, communityController.deletePost);
router.delete('/api/community/posts/:postId/comments/:commentId', isAuthenticated, communityController.deleteComment);

module.exports = router;
