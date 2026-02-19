/* ---------------- DEPENDENCIES ---------------- */
const express = require('express');
const router = express.Router();
const testimonialController = require('../controllers/testimonial.controller');

/* ---------------- MIDDLEWARE ---------------- */
const { isAuthenticated, isAdmin } = require('../middleware/auth.middleware');

/* ---------------- PUBLIC ROUTES ---------------- */
// Public API
router.get('/api/testimonials/approved', testimonialController.getPublicTestimonials);
router.get('/api/testimonials/my-testimonials', isAuthenticated, testimonialController.getUserTestimonials);
router.post('/api/testimonials/submit', isAuthenticated, testimonialController.submitTestimonial);

/* ---------------- DELETE ROUTES ---------------- */
// Changed to POST for maximum compatibility
router.post('/api/testimonials/delete/:id', isAuthenticated, testimonialController.deleteTestimonial);

/* ---------------- ADMIN ROUTES ---------------- */
// Admin Routes
router.get('/admin/testimonials', isAdmin, testimonialController.getAdminTestimonials);
router.post('/admin/testimonials/:id/approve', isAdmin, testimonialController.approveTestimonial);
router.post('/admin/testimonials/:id/reject', isAdmin, testimonialController.rejectTestimonial);

module.exports = router;
