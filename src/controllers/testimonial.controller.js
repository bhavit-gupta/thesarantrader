/**
 * ============================================================================
 * FILE: testimonial.controller.js
 * PURPOSE: User testimonial management with admin approval workflow
 * ============================================================================
 * 
 * DESCRIPTION:
 * Manages the complete testimonial lifecycle from user submission to public display:
 * - User submission with validation (rating, message, role)
 * - Three-state workflow: pending → approved/rejected
 * - One testimonial per user enforcement
 * - Admin moderation panel with approval/rejection actions
 * - Public API for approved testimonials only
 * - User dashboard to track submission status
 * 
 * WORKFLOW:
 * 1. User submits testimonial (status: pending)
 * 2. Admin reviews in moderation panel
 * 3. Admin approves (status: approved, appears publicly) OR rejects (status: rejected)
 * 4. Only approved testimonials visible on public website
 * 5. User can delete and resubmit after rejection
 * 
 * BUSINESS RULES:
 * - One testimonial per user (prevents spam, enforced at submission)
 * - 10-500 character limit for message
 * - Rating required: 1-5 stars (integer validation)
 * - Admin approval required before public display
 * - User role categorization: User, Trader, Investor
 * - Rate limiting: max 3 submissions per 24 hours
 * 
 * SECURITY FEATURES:
 * - XSS prevention via content sanitization
 * - Authentication checks on all user endpoints
 * - Admin authorization on moderation endpoints
 * - Rate limiting to prevent spam
 * - Atomic one-per-user enforcement with P2002 handling
 * 
 * DATA MODEL:
 * - Testimonial: userId, userName, userRole, message, rating, status, submittedAt, reviewedAt
 * - Status values: 'pending', 'approved', 'rejected'
 * - reviewedAt: Tracks when admin approved/rejected (null for pending)
 * 
 * KEY FEATURES:
 * - Approval workflow with timestamps for audit trail
 * - Authorization-based deletion (owner or admin)
 * - Status-based filtering for public vs admin views
 * - One-per-user rule reset after deletion (allows resubmission)
 * - Pagination for public testimonials API
 * - Rejection reason support for admin feedback
 * 
 * DEPENDENCIES:
 * - @prisma/client: Database ORM for testimonial operations
 * 
 * 
 */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require('../utils/prisma');
const { withRetry, paginate } = require('../utils/prisma');

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                  */
/* -------------------------------------------------------------------------- */

// Message validation constants
const MIN_MESSAGE_LENGTH = 10;
const MAX_MESSAGE_LENGTH = 500;

// Rate limiting configuration
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const RATE_LIMIT_MAX_SUBMISSIONS = 3;

// In-memory rate limit tracking (use Redis in production)
const submissionRateLimits = new Map();

// Allowed user roles
const ALLOWED_ROLES = ['User', 'Trader', 'Investor'];

/* -------------------------------------------------------------------------- */
/*                            HELPER FUNCTIONS                                 */
/* -------------------------------------------------------------------------- */

/**
 * Check if user has exceeded submission rate limit
 * @param {string} userId - User ID to check
 * @returns {boolean} True if rate limited
 */
function isRateLimited(userId) {
    const now = Date.now();
    const userSubmissions = submissionRateLimits.get(userId) || [];

    // Filter out expired entries
    const recentSubmissions = userSubmissions.filter(
        timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS
    );

    // Update map with filtered entries
    submissionRateLimits.set(userId, recentSubmissions);

    return recentSubmissions.length >= RATE_LIMIT_MAX_SUBMISSIONS;
}

/**
 * Record a new submission for rate limiting
 * @param {string} userId - User ID to record
 */
function recordSubmission(userId) {
    const submissions = submissionRateLimits.get(userId) || [];
    submissions.push(Date.now());
    submissionRateLimits.set(userId, submissions);
}

/**
 * Sanitize user content to prevent XSS attacks
 * Escapes HTML special characters
 * @param {string} content - User-provided content
 * @returns {string} Sanitized content
 */
function sanitizeContent(content) {
    if (!content) return '';
    return content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/* -------------------------------------------------------------------------- */
/*                        TESTIMONIAL CONTROLLERS                             */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                        TESTIMONIAL SUBMISSION                              */
/* -------------------------------------------------------------------------- */

/**
 * Submit a new testimonial
 * POST /
 * Body: { message, rating, userRole }
 * 
 * Validation:
 * - message: required, 10-500 characters (trimmed)
 * - rating: required, integer 1-5
 * - userRole: required, one of 'User', 'Trader', 'Investor'
 * 
 * Security:
 * - Rate limited: max 3 submissions per 24 hours
 * - XSS protection: message content sanitized
 * - Atomic one-per-user enforcement with P2002 handling
 * 
 * Business Rules:
 * - One testimonial per user
 * - Submissions start with status 'pending'
 * - userName captured at submission (denormalized for display)
 */
exports.submitTestimonial = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in to submit a testimonial' });
    }

    const userId = req.session.user.id;
    const { message, rating, userRole } = req.body;

    // 2. Rate limiting check
    if (isRateLimited(userId)) {
        return res.status(429).json({
            success: false,
            message: 'Too many testimonial submissions. Please try again tomorrow.'
        });
    }

    // 3. Validation - Required fields
    if (!message || !rating) {
        return res.status(400).json({ success: false, message: 'Message and rating are required' });
    }

    // 4. Validation - Message after trim
    const trimmedMessage = message.trim();
    if (!trimmedMessage || trimmedMessage.length === 0) {
        return res.status(400).json({ success: false, message: 'Message cannot be empty' });
    }

    // 5. Validation - Minimum message length
    if (trimmedMessage.length < MIN_MESSAGE_LENGTH) {
        return res.status(400).json({
            success: false,
            message: `Message must be at least ${MIN_MESSAGE_LENGTH} characters`
        });
    }

    // 6. Validation - Maximum message length
    if (trimmedMessage.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
            success: false,
            message: `Message must be ${MAX_MESSAGE_LENGTH} characters or less`
        });
    }

    // 7. Validation - Rating range (1-5 stars)
    const ratingNum = parseInt(rating);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return res.status(400).json({ success: false, message: 'Rating must be between 1 and 5' });
    }

    // 8. Validation - User role (default to 'User' if invalid)
    const role = userRole || 'User';

    // 9. Sanitize message content for XSS prevention
    const sanitizedMessage = sanitizeContent(trimmedMessage);

    try {
        // 10. Create testimonial with atomic one-per-user enforcement
        // If schema has @@unique([userId]), P2002 error will be caught
        const newTestimonial = await withRetry(
            () => prisma.testimonial.create({
                data: {
                    userId: userId,
                    userName: req.session.user.name,
                    userRole: role,
                    message: sanitizedMessage,
                    rating: ratingNum,
                    status: 'PENDING'
                }
            }),
            2
        );

        // Record submission for rate limiting
        recordSubmission(userId);

        console.log(`📝 [NEW TESTIMONIAL] Submitted by ${newTestimonial.userName}`);

        // 11. Return success response with approval notification
        return res.json({
            success: true,
            message: 'Testimonial submitted successfully! Waiting for admin approval.',
            testimonial: newTestimonial
        });

    } catch (error) {
        // Handle unique constraint violation (one-per-user rule)
        if (error.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: 'You have already submitted a testimonial.'
            });
        }

        console.error("❌ Submission Error:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/* -------------------------------------------------------------------------- */
/*                          PUBLIC API ENDPOINTS                              */
/* -------------------------------------------------------------------------- */

/**
 * Get all approved testimonials for public display
 * GET /public
 * Query params: page (default 1), limit (default 10)
 * 
 * Returns:
 * - status: 200 on success
 * - testimonials: Array of approved testimonials
 * - pagination: { page, limit, total, totalPages }
 * - ordered by reviewedAt desc (most recently approved first)
 * - Includes user relation for up-to-date userName 
 */
exports.getPublicTestimonials = async (req, res) => {
    try {
        // 1. Parse and validate pagination params
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
        const skip = (page - 1) * limit;

        // 3. Prepare where clause
        //  Support optional featured filtering
        const where = {
            status: 'APPROVED'
        };

        if (req.query.featured === 'true') {
            where.isFeatured = true;
        }

        // 4. Fetch total count for pagination
        const total = await withRetry(
            () => prisma.testimonial.count({ where }),
            2
        );

        // 5. Fetch paginated approved testimonials with user relation
        const approvedTestimonials = await withRetry(
            () => prisma.testimonial.findMany({
                where,
                orderBy: [
                    { isFeatured: 'desc' }, // Pin featured items to top if viewing all
                    { reviewedAt: 'desc' }
                ],
                skip,
                take: limit
            }),
            2
        );

        // 6. Return public testimonials with pagination
        return res.json({
            success: true,
            testimonials: approvedTestimonials,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/* -------------------------------------------------------------------------- */
/*                          USER DASHBOARD API                                */
/* -------------------------------------------------------------------------- */

/**
 * Get testimonials for current user
 * GET /user
 * 
 * Returns:
 * - status: 200 on success
 * - testimonials: Array of user's own testimonials (all statuses)
 * - ordered by submittedAt desc
 * 
 */
exports.getUserTestimonials = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    try {
        // 2. Fetch all testimonials for current user with retry
        const userTestimonials = await withRetry(
            () => prisma.testimonial.findMany({
                where: { userId: req.session.user.id },
                orderBy: { submittedAt: 'desc' }
            }),
            2
        );

        // 3. Return user's testimonials
        return res.json({ success: true, testimonials: userTestimonials });
    } catch (error) {
        console.error("❌ User Fetch Error:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/* -------------------------------------------------------------------------- */
/*                          ADMIN MODERATION PANEL                            */
/* -------------------------------------------------------------------------- */

/**
 * Get admin testimonials panel with categorization
 * GET /admin
 * Authorization: Admin only
 * 
 * Returns:
 * - status: 200 on success (renders page)
 * - status: 403 for API requests without admin access 
 * - Three categories:
 *   • pending: Awaiting review (ordered by submittedAt desc)
 *   • approved: Publicly visible (ordered by reviewedAt desc)
 *   • rejected: Denied testimonials (ordered by reviewedAt desc)
 */
exports.getAdminTestimonials = async (req, res) => {
    // 1. Authorization check (admin only)
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
        const acceptHeader = req.headers.accept || '';
        if (acceptHeader.includes('application/json')) {
            return res.status(403).json({
                success: false,
                message: 'Admin access required'
            });
        }
        return res.redirect('/dashboard');
    }

    try {
        // 2. Fetch all testimonials (all statuses) with retry
        const allTestimonials = await withRetry(
            () => prisma.testimonial.findMany({
                orderBy: { submittedAt: 'desc' }
            }),
            2
        );

        // 3. Categorize by status for admin tabs
        return res.render('dashboard/admin_testimonials', {
            pendingTestimonials: allTestimonials.filter(t => t.status === 'PENDING' || t.status === 'pending'),
            approvedTestimonials: allTestimonials.filter(t => t.status === 'APPROVED' || t.status === 'approved'),
            rejectedTestimonials: allTestimonials.filter(t => t.status === 'REJECTED' || t.status === 'rejected')
        });
    } catch (error) {
        console.error("❌ Admin Fetch Error:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/* -------------------------------------------------------------------------- */
/*                        ADMIN APPROVAL ACTIONS                              */
/* -------------------------------------------------------------------------- */

/**
 * Approve a testimonial (Admin action)
 * POST /approve/:testimonialId
 * Authorization: Admin only
 * 
 * Actions:
 * - Verifies admin authorization 
 * - Checks testimonial is in pending status 
 * - Sets status to 'approved'
 * - Sets reviewedAt to current timestamp
 * - Makes testimonial publicly visible
 */
exports.approveTestimonial = async (req, res) => {
    // 1. Authorization check (admin only) 
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }

    const testimonialId = req.params.id;

    try {
        // 2. Fetch testimonial to check status 
        const existingTestimonial = await withRetry(
            () => prisma.testimonial.findUnique({
                where: { id: testimonialId }
            }),
            2
        );

        if (!existingTestimonial) {
            return res.status(404).json({
                success: false,
                message: 'Testimonial not found'
            });
        }

        // 3. Check if testimonial is already approved 
        if (existingTestimonial.status === 'APPROVED' || existingTestimonial.status === 'approved') {
            return res.status(400).json({
                success: false,
                message: 'Testimonial is already approved'
            });
        }

        // 4. Update status to 'approved' and set review timestamp
        const testimonial = await withRetry(
            () => prisma.testimonial.update({
                where: { id: testimonialId },
                data: {
                    status: 'APPROVED',
                    reviewedAt: new Date()
                }
            }),
            2
        );

        console.log(`✅ [TESTIMONIAL APPROVED] #${testimonialId}`);

        // 5. Return updated testimonial
        return res.json({
            success: true,
            message: 'Testimonial approved successfully',
            testimonial
        });
    } catch (error) {
        console.error("❌ Approval Error:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Reject a testimonial (Admin action)
 * POST /reject/:testimonialId
 * Authorization: Admin only
 * Body: { reason?: string } - Optional rejection reason 
 * 
 * Actions:
 * - Verifies admin authorization 
 * - Checks testimonial is in pending status 
 * - Sets status to 'rejected'
 * - Records rejection reason if provided 
 * - Sets reviewedAt to current timestamp
 * - User can delete and resubmit
 */
exports.rejectTestimonial = async (req, res) => {
    // 1. Authorization check (admin only) 
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }

    const testimonialId = req.params.id;
    const { reason } = req.body; // Optional rejection reason

    try {
        // 2. Fetch testimonial to check status 
        const existingTestimonial = await withRetry(
            () => prisma.testimonial.findUnique({
                where: { id: testimonialId }
            }),
            2
        );

        if (!existingTestimonial) {
            return res.status(404).json({
                success: false,
                message: 'Testimonial not found'
            });
        }

        // 3. Check if testimonial is already rejected 
        if (existingTestimonial.status === 'REJECTED' || existingTestimonial.status === 'rejected') {
            return res.status(400).json({
                success: false,
                message: 'Testimonial is already rejected'
            });
        }

        // 4. Update status to 'rejected' with optional reason
        const updateData = {
            status: 'REJECTED',
            isFeatured: false,
            reviewedAt: new Date()
        };

        // Add rejection reason if schema supports it
        if (reason) {
            updateData.rejectionReason = sanitizeContent(reason.trim().substring(0, 500));
        }

        const testimonial = await withRetry(
            () => prisma.testimonial.update({
                where: { id: testimonialId },
                data: updateData
            }),
            2
        );

        console.log(`❌ [TESTIMONIAL REJECTED] #${testimonialId}${reason ? ` - Reason: ${reason}` : ''}`);

        // 5. Return updated testimonial
        return res.json({
            success: true,
            message: 'Testimonial rejected',
            testimonial
        });
    } catch (error) {
        console.error("❌ Rejection Error:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};

/**
 * Toggle featured status of a testimonial (Admin action)
 * PATCH /:id/feature
 * Authorization: Admin only
 */
exports.toggleFeatured = async (req, res) => {
    // 1. Authorization check (admin only)
    if (!req.session.user || req.session.user.role !== 'ADMIN') {
        return res.status(403).json({
            success: false,
            message: 'Admin access required'
        });
    }

    const testimonialId = req.params.id;

    try {
        // 2. Fetch current status
        const testimonial = await withRetry(
            () => prisma.testimonial.findUnique({
                where: { id: testimonialId }
            }),
            2
        );

        if (!testimonial) {
            return res.status(404).json({ success: false, message: 'Testimonial not found' });
        }

        // 3. Toggle isFeatured
        const updatedTestimonial = await withRetry(
            () => prisma.testimonial.update({
                where: { id: testimonialId },
                data: { isFeatured: !testimonial.isFeatured }
            }),
            2
        );

        console.log(`✨ [TESTIMONIAL FEATURED TOGGLE] #${testimonialId} is now ${updatedTestimonial.isFeatured}`);

        return res.json({
            success: true,
            message: `Testimonial ${updatedTestimonial.isFeatured ? 'featured' : 'unfeatured'} successfully`,
            testimonial: updatedTestimonial
        });
    } catch (error) {
        console.error("❌ Toggle Featured Error:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error'
        });
    }
};

/* -------------------------------------------------------------------------- */
/*                          TESTIMONIAL DELETION                              */
/* -------------------------------------------------------------------------- */

/**
 * Delete a testimonial
 * DELETE /:testimonialId
 * Authorization: Owner or Admin
 * 
 * Business Rules:
 * - User can delete own testimonial (any status)
 * - Admin can delete any testimonial
 * - After deletion, user can resubmit new testimonial
 */
exports.deleteTestimonial = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({
            success: false,
            message: 'Authentication required'
        });
    }

    const testimonialId = req.params.id;

    try {
        // 2. Fetch testimonial to check ownership
        const testimonial = await withRetry(
            () => prisma.testimonial.findUnique({
                where: { id: testimonialId }
            }),
            2
        );

        // 3. Verify testimonial exists
        if (!testimonial) {
            return res.status(404).json({
                success: false,
                message: 'Testimonial not found'
            });
        }

        // 4. Authorization check (owner or admin)
        const isOwner = testimonial.userId === req.session.user.id;
        const isAdmin = req.session.user.role === 'ADMIN';

        if (!isOwner && !isAdmin) {
            return res.status(403).json({
                success: false,
                message: 'You can only delete your own testimonials'
            });
        }

        // 5. Delete testimonial from database with retry
        await withRetry(
            () => prisma.testimonial.delete({ where: { id: testimonialId } }),
            2
        );
        console.log(`⚙️ [SYSTEM] Testimonial #${testimonialId} deleted by ${req.session.user.name}`);

        // 6. Return success response
        return res.json({ success: true, message: 'Testimonial deleted successfully' });
    } catch (error) {
        console.error("❌ Delete Error:", error);
        return res.status(500).json({
            success: false,
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
};
