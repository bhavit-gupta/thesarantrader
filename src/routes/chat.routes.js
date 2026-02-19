/* ---------------- DEPENDENCIES ---------------- */
const express = require('express');
const router = express.Router();
const { isAuthenticated } = require('../middleware/auth.middleware');
const { requireCoursePurchase } = require('../utils/helpers');
const chatController = require('../controllers/chat.controller');

// Apply middleware to all chat routes (or individually)
/* ---------------- PAGE ROUTES ---------------- */
// Page Routes (Rendered Views)
router.get('/chat', isAuthenticated, chatController.getChatRooms);
router.get('/chat/:courseId', isAuthenticated, requireCoursePurchase(), chatController.getCourseChat);

/* ---------------- API ROUTES ---------------- */
// API Routes
router.get('/api/chat/:courseId/messages', isAuthenticated, requireCoursePurchase(), chatController.getMessages);
router.post('/api/chat/:courseId/messages', isAuthenticated, requireCoursePurchase(), chatController.sendMessage);

module.exports = router;
