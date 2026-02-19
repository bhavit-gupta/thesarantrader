/* ---------------- DEPENDENCIES ---------------- */
const express = require('express');
const router = express.Router();
const communityController = require('../controllers/community.controller');

/* ---------------- MIDDLEWARE ---------------- */
const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');

/* ---------------- PUBLIC ROUTES ---------------- */
router.get('/api/community/posts', communityController.getPosts);
router.post('/api/community/posts', isAuthenticated, communityController.createPost);
router.post('/api/community/posts/:id/like', isAuthenticated, communityController.likePost);
router.post('/api/community/posts/:id/comment', isAuthenticated, communityController.addComment);

/* ---------------- ADMIN ROUTES ---------------- */
// Admin Routes (isAuthenticated — ownership/role check is in controller)
router.delete('/api/community/posts/:id', isAuthenticated, communityController.deletePost);
router.delete('/api/community/posts/:postId/comments/:commentId', isAuthenticated, communityController.deleteComment);

module.exports = router;
