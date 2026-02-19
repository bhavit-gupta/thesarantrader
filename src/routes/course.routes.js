/* ---------------- DEPENDENCIES ---------------- */
const express = require('express');
const router = express.Router();
const courseController = require('../controllers/course.controller');

/* ---------------- MIDDLEWARE ---------------- */
const { isAdmin } = require('../middleware/auth.middleware');

/* ---------------- PUBLIC ROUTES ---------------- */
// Public Routes
router.get('/api/courses', courseController.getAllCourses);
router.get('/api/live-status', courseController.getLiveStatus);
router.post('/api/courses/enroll', courseController.enrollCourse);

/* ---------------- ADMIN ROUTES ---------------- */
// Admin Routes
router.get('/admin/courses', isAdmin, courseController.getAdminCourses);
router.post('/admin/courses/add', isAdmin, courseController.addCourse);
router.post('/admin/courses/delete/:id', isAdmin, courseController.deleteCourse);
router.post('/admin/courses/edit/:id', isAdmin, courseController.editCourse);
router.post('/admin/toggle-live', isAdmin, courseController.toggleLiveStatus);

module.exports = router;
