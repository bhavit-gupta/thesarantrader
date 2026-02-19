/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require('../utils/prisma');

/* -------------------------------------------------------------------------- */
/*                           TESTIMONIAL CONTROLLERS                          */
/* -------------------------------------------------------------------------- */

/**
 * Handles user submission of a new testimonial.
 * Includes validation for length, rating, and role.
 * Prevents multiple submissions from the same user.
 */
exports.submitTestimonial = async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in to submit a testimonial' });
    }

    const { message, rating, userRole } = req.body;

    // 1. Validation
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

    // Default role to 'Student' if not provided or invalid
    const allowedRoles = ['Student', 'Trader', 'Investor'];
    const role = (userRole && allowedRoles.includes(userRole)) ? userRole : 'Student';

    try {
        // 2. Check for existing testimonial (One per user)
        const existingTestimonial = await prisma.testimonial.findFirst({
            where: { userId: req.session.user.id }
        });

        if (existingTestimonial) {
            return res.status(400).json({ success: false, message: 'You have already submitted a testimonial.' });
        }

        // 3. Create testimonial in 'pending' status
        const newTestimonial = await prisma.testimonial.create({
            data: {
                userId: req.session.user.id,
                userName: req.session.user.name,
                userRole: role,
                message: message.trim(),
                rating: ratingNum,
                status: 'pending'
            }
        });

        console.log(`📝 [NEW TESTIMONIAL] Submitted by ${newTestimonial.userName}`);
        res.json({
            success: true,
            message: 'Testimonial submitted successfully! Waiting for admin approval.',
            testimonial: newTestimonial
        });

    } catch (error) {
        console.error("❌ Submission Error:", error);
        res.status(500).json({ success: false, message: "Error submitting testimonial" });
    }
};

/**
 * Public API: Returns all approved testimonials for the website frontend.
 */
exports.getPublicTestimonials = async (req, res) => {
    try {
        const approvedTestimonials = await prisma.testimonial.findMany({
            where: { status: 'approved' },
            orderBy: { reviewedAt: 'desc' }
        });
        res.json({ success: true, testimonials: approvedTestimonials });
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        res.status(500).json({ success: false, message: "Error fetching testimonials" });
    }
};

/**
 * User API: Returns testimonials submitted by the currently logged-in user.
 */
exports.getUserTestimonials = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    try {
        const userTestimonials = await prisma.testimonial.findMany({
            where: { userId: req.session.user.id },
            orderBy: { submittedAt: 'desc' }
        });
        res.json({ success: true, testimonials: userTestimonials });
    } catch (error) {
        console.error("❌ User Fetch Error:", error);
        res.status(500).json({ success: false, message: "Error fetching user testimonials" });
    }
};

/* -------------------------------------------------------------------------- */
/*                                 ADMIN ONLY                                 */
/* -------------------------------------------------------------------------- */

/**
 * Admin API: Renders the testimonial management page with all submissions categorized.
 */
exports.getAdminTestimonials = async (req, res) => {
    if (!req.session.user || req.session.user.role !== 'admin') return res.redirect('/dashboard');

    try {
        const allTestimonials = await prisma.testimonial.findMany({
            orderBy: { submittedAt: 'desc' }
        });

        res.render('dashboard/admin_testimonials', {
            pendingTestimonials: allTestimonials.filter(t => t.status === 'pending'),
            approvedTestimonials: allTestimonials.filter(t => t.status === 'approved'),
            rejectedTestimonials: allTestimonials.filter(t => t.status === 'rejected')
        });
    } catch (error) {
        console.error("❌ Admin Fetch Error:", error);
        res.redirect('/admin/dashboard');
    }
};

/**
 * Admin API: Approves a testimonial and sets the reviewed timestamp.
 */
exports.approveTestimonial = async (req, res) => {
    const testimonialId = req.params.id;

    try {
        const testimonial = await prisma.testimonial.update({
            where: { id: testimonialId },
            data: { status: 'approved', reviewedAt: new Date() }
        });

        console.log(`✅ [TESTIMONIAL APPROVED] #${testimonialId}`);
        res.json({ success: true, message: 'Testimonial approved successfully', testimonial });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Approval failed' });
    }
};

/**
 * Admin API: Rejects a testimonial.
 */
exports.rejectTestimonial = async (req, res) => {
    const testimonialId = req.params.id;

    try {
        const testimonial = await prisma.testimonial.update({
            where: { id: testimonialId },
            data: { status: 'rejected', reviewedAt: new Date() }
        });

        console.log(`❌ [TESTIMONIAL REJECTED] #${testimonialId}`);
        res.json({ success: true, message: 'Testimonial rejected', testimonial });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Rejection failed' });
    }
};

/**
 * Deletes a testimonial. Accessible by the owner or an administrator.
 */
exports.deleteTestimonial = async (req, res) => {
    const testimonialId = req.params.id;

    try {
        const testimonial = await prisma.testimonial.findUnique({
            where: { id: testimonialId }
        });

        if (!testimonial) return res.status(404).json({ success: false, message: 'Not found' });

        const isOwner = req.session.user && testimonial.userId === req.session.user.id;
        const isAdmin = req.session.user && req.session.user.role === 'admin';

        if (!isOwner && !isAdmin) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        await prisma.testimonial.delete({ where: { id: testimonialId } });
        console.log(`⚙️ [SYSTEM] Testimonial #${testimonialId} deleted by ${req.session.user.name}`);

        res.json({ success: true, message: 'Testimonial deleted successfully' });
    } catch (error) {
        console.error("❌ Delete Error:", error);
        res.status(500).json({ success: false, message: 'Error deleting testimonial' });
    }
};
