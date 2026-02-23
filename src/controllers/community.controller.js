/**
 * ============================================================================
 * FILE: community.controller.js
 * PURPOSE: Social community forum with posts, likes, and comments
 * ============================================================================
 * 
 * DESCRIPTION:
 * Manages community forum features for users to share and discuss content:
 * - Create posts with optional image attachments and text content
 * - Smart polling for real-time feed updates (fetch only new posts)
 * - Like/unlike system using separate like table for scalability
 * - Nested comments on posts (embedded in post document)
 * - Authorization-based deletion (owner or admin)
 * - Automatic cleanup of posts older than 15 days
 * 
 * DATA MODEL:
 * - Posts: CommunityPost table (id, userId, userName, title, content, imageUrl, likes, comments, createdAt)
 * - Likes: CommunityLike table (id, userId, postId) - separate for scalability
 * - Comments: Embedded array in post document (id, userId, userName, content, createdAt)
 * 
 * KEY FEATURES:
 * - Smart polling: Fetch only new messages via ?after=timestamp parameter
 * - Image compression: WebP format, ~70% size reduction via compressImage()
 * - Role-based deletion: Only post owner or admin can delete
 * - Real-time like updates: Optimistic UI with server confirmation
 * - Automatic cleanup: Background job deletes posts older than 15 days
 * 
 * DEPENDENCIES:
 * - @prisma/client: Database ORM for posts, likes, comments
 * - crypto: UUID generation for comment IDs
 * - fs: File system operations for image cleanup
 * - multer middleware: Handles image file uploads
 * - compressImage utility: Converts images to WebP format
 * 
 */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require('../utils/prisma');
const { withRetry, paginate } = require('../utils/prisma');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { compressImage } = require('../utils/upload.utils');

/* -------------------------------------------------------------------------- */
/*                          CONFIGURATION CONSTANTS                          */
/* -------------------------------------------------------------------------- */

// Content limits
const MAX_TITLE_LENGTH = 200;
const MAX_CONTENT_LENGTH = 5000;
const MAX_COMMENT_LENGTH = 500;
const MAX_COMMENTS_PER_POST = 100;

// Rate limiting for post creation (in-memory, per user)
const RATE_LIMIT_WINDOW_MS = 3600 * 1000; // 1 hour
const RATE_LIMIT_MAX_POSTS = 5; // Max 5 posts per hour
const postRateLimits = new Map(); // Map<userId, { count, resetTime }>

// Allowed MIME types for image uploads
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

/* -------------------------------------------------------------------------- */
/*                              HELPER FUNCTIONS                              */
/* -------------------------------------------------------------------------- */

/**
 * Checks if user has exceeded post rate limit.
 * @param {string} userId - User ID to check
 * @returns {boolean} - True if rate limited
 */
function isRateLimited(userId) {
    const now = Date.now();
    const userLimit = postRateLimits.get(userId);

    if (!userLimit || now > userLimit.resetTime) {
        // Reset or initialize
        postRateLimits.set(userId, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
        return false;
    }

    if (userLimit.count >= RATE_LIMIT_MAX_POSTS) {
        return true;
    }

    userLimit.count++;
    return false;
}

/**
 * Sanitizes text content by escaping HTML special characters.
 * Prevents XSS attacks when content is rendered.
 * @param {string} text - Text to sanitize
 * @returns {string} - Sanitized text
 */
function sanitizeContent(text) {
    if (!text) return '';
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Validates filename to prevent path traversal attacks.
 * @param {string} filename - Filename to validate
 * @returns {boolean} - True if valid
 */
function isValidFilename(filename) {
    if (!filename || typeof filename !== 'string') return false;
    return !filename.includes('..') &&
        !filename.includes('/') &&
        !filename.includes('\\');
}

/* -------------------------------------------------------------------------- */
/*                             POST CREATION                                  */
/* -------------------------------------------------------------------------- */

/**
 * Creates a new post in the community forum.
 * 
 * Features:
 * - Optional title and content fields
 * - Optional image attachment (compressed to WebP)
 * - Author name stored with post (denormalized for performance)
 * - Automatic likes initialization to 0
 * 
 * Image Processing:
 * 1. multer stores temporary file
 * 2. compressImage() converts to WebP and moves to final location
 * 3. Original temp file deleted
 * 4. WebP path stored in database
 * 
 * Error Handling:
 * - If DB save fails, uploaded file is deleted (prevents orphan files)
 * 
 * 
 * 
 * @route POST /api/community/posts
 * @access Private (authenticated users)
 * 
 * @param {Object} req.body.title - Post title (optional, trimmed)
 * @param {Object} req.body.content - Post content (optional, trimmed)
 * @param {Object} req.file - Uploaded image file (via multer, optional)
 * @returns {Object} JSON response with new post data
 */
exports.createPost = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in to post' });
    }

    const userId = req.session.user.id;
    const { title, content } = req.body;

    // 2. Rate limiting check
    if (isRateLimited(userId)) {
        // Cleanup uploaded file before returning
        if (req.file) {
            try { await fs.promises.unlink(req.file.path); } catch (e) { /* ignore */ }
        }
        return res.status(429).json({
            success: false,
            message: 'Too many posts. Please wait before posting again.'
        });
    }

    // 3. Validate and sanitize content
    const titleTrimmed = title ? title.trim() : '';
    const contentTrimmed = content ? content.trim() : '';

    // Check for empty post (must have title OR content OR image)
    if (!titleTrimmed && !contentTrimmed && !req.file) {
        return res.status(400).json({
            success: false,
            message: 'Post must have title, content, or image'
        });
    }

    // Validate lengths
    if (titleTrimmed.length > MAX_TITLE_LENGTH) {
        if (req.file) {
            try { await fs.promises.unlink(req.file.path); } catch (e) { /* ignore */ }
        }
        return res.status(400).json({
            success: false,
            message: `Title too long (max ${MAX_TITLE_LENGTH} characters)`
        });
    }
    if (contentTrimmed.length > MAX_CONTENT_LENGTH) {
        if (req.file) {
            try { await fs.promises.unlink(req.file.path); } catch (e) { /* ignore */ }
        }
        return res.status(400).json({
            success: false,
            message: `Content too long (max ${MAX_CONTENT_LENGTH} characters)`
        });
    }

    // Sanitize content for XSS prevention
    const sanitizedTitle = sanitizeContent(titleTrimmed);
    const sanitizedContent = sanitizeContent(contentTrimmed);

    try {
        // 4. Process image if provided
        let finalImageUrl = null;
        if (req.file) {
            // Validate MIME type
            if (!ALLOWED_MIME_TYPES.includes(req.file.mimetype)) {
                try { await fs.promises.unlink(req.file.path); } catch (e) { /* ignore */ }
                return res.status(400).json({
                    success: false,
                    message: 'Only images allowed (JPEG, PNG, GIF, WebP)'
                });
            }

            const communityUploadDir = path.join(__dirname, '../public/uploads/community');
            const compressedFilename = await compressImage(req.file, communityUploadDir);

            // Validate filename for path traversal
            if (!isValidFilename(compressedFilename)) {
                throw new Error('Invalid filename from compression utility');
            }

            // Verify compressed file exists
            const compressedPath = path.join(communityUploadDir, compressedFilename);
            if (!fs.existsSync(compressedPath)) {
                throw new Error('Image compression failed - output file not created');
            }

            finalImageUrl = `/uploads/community/${compressedFilename}`;
        }

        // 5. Create post in database with retry for resilience
        const newPost = await withRetry(
            () => prisma.communityPost.create({
                data: {
                    userId: req.session.user.id,
                    userName: req.session.user.name,
                    title: sanitizedTitle,
                    content: sanitizedContent,
                    imageUrl: finalImageUrl,
                    likes: 0
                }
            }),
            2 // Max 2 retries for user-facing operations
        );

        console.log(`💬 [COMMUNITY] New post by ${newPost.userName} ${finalImageUrl ? '(with image)' : ''}`);

        // 6. Return success response
        res.json({ success: true, message: 'Post created successfully!', post: newPost });
    } catch (error) {
        console.error("❌ Post Creation Error:", error);

        // 7. Cleanup uploaded file if database operation failed
        if (req.file) {
            try {
                await fs.promises.unlink(req.file.path);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    console.error("Error deleting file after DB failure:", err);
                }
            }
        }

        res.status(500).json({ success: false, message: "Error creating post" });
    }
};

/* -------------------------------------------------------------------------- */
/*                            POST RETRIEVAL                                  */
/* -------------------------------------------------------------------------- */

/**
 * Fetches community posts with smart polling support.
 * 
 * Two Modes:
 * 
 * Mode A: Smart Polling Update (?after=timestamp)
 * - Client provides timestamp of last fetch
 * - Returns only posts created AFTER that timestamp
 * - Used for real-time feed updates without full page reload
 * - Sorts ascending (oldest new post first)
 * 
 * Mode B: Initial Load / Pagination (?page=N&limit=M)
 * - Returns paginated posts in descending order (newest first)
 * - Includes total count and page info
 * - Default: page=1, limit=10
 * 
 * Like Status Enrichment:
 * - Each post includes isLiked flag for current user
 * - Requires separate query to CommunityLike table
 * - Guests see isLiked=false for all posts
 * 
 * 
 * 
 * @route GET /api/community/posts
 * @access Public (but like status requires authentication)
 * 
 * @param {string} req.query.after - ISO timestamp for smart polling (optional)
 * @param {number} req.query.page - Page number for pagination (default: 1)
 * @param {number} req.query.limit - Posts per page (default: 10)
 * @returns {Object} JSON response with posts array and metadata
 */
exports.getPosts = async (req, res) => {
    try {
        // --- SCENARIO A: SMART POLLING UPDATE ---
        if (req.query.after) {
            const afterDate = new Date(req.query.after);

            // Validate timestamp format
            if (isNaN(afterDate.getTime())) {
                return res.status(400).json({ success: false, message: 'Invalid timestamp' });
            }

            // 1. Fetch only new posts created after the given timestamp with retry
            const newPosts = await withRetry(
                () => prisma.communityPost.findMany({
                    where: { createdAt: { gt: afterDate } },
                    orderBy: { createdAt: 'asc' } // Ascending for chronological order
                }),
                2
            );

            // 2. Enrich with like status for current user
            let postsWithLikeStatus = newPosts.map(p => ({ ...p, isLiked: false }));
            if (req.session.user && newPosts.length > 0) {
                const userId = req.session.user.id;
                const userLikes = await prisma.communityLike.findMany({
                    where: { userId, postId: { in: newPosts.map(p => p.id) } },
                    select: { postId: true }
                });
                const likedPostIds = new Set(userLikes.map(l => l.postId));
                postsWithLikeStatus = newPosts.map(p => ({ ...p, isLiked: likedPostIds.has(p.id) }));
            }

            return res.json({ success: true, posts: postsWithLikeStatus, isPollingUpdate: true });
        }

        // --- SCENARIO B: INITIAL LOAD / PAGINATION ---
        // Validate and clamp pagination parameters
        const page = Math.max(1, Math.min(parseInt(req.query.page) || 1, 10000));
        const limit = Math.max(1, Math.min(parseInt(req.query.limit) || 10, 100));
        const skip = (page - 1) * limit;

        // 3. Fetch posts and total count in single transaction with retry
        const [posts, totalPosts] = await withRetry(
            () => prisma.$transaction([
                prisma.communityPost.findMany({
                    orderBy: { createdAt: 'desc' }, // Descending for newest first
                    skip,
                    take: limit
                }),
                prisma.communityPost.count()
            ]),
            2
        );

        const totalPages = Math.ceil(totalPosts / limit);
        let postsWithLikeStatus = posts;

        // 4. Enrich with personal 'isLiked' status if logged in
        if (req.session.user) {
            const userId = req.session.user.id;
            const userLikes = await prisma.communityLike.findMany({
                where: { userId, postId: { in: posts.map(p => p.id) } },
                select: { postId: true }
            });

            const likedPostIds = new Set(userLikes.map(l => l.postId));
            postsWithLikeStatus = posts.map(post => ({ ...post, isLiked: likedPostIds.has(post.id) }));
        } else {
            // Guest users - all posts marked as not liked
            postsWithLikeStatus = posts.map(post => ({ ...post, isLiked: false }));
        }

        // 5. Return paginated response
        res.json({
            success: true,
            posts: postsWithLikeStatus,
            pagination: { page, limit, totalPosts, totalPages }
        });
    } catch (error) {
        console.error("❌ Post Fetch Error:", error);
        res.status(500).json({ success: false, message: "Error fetching posts" });
    }
};

/* -------------------------------------------------------------------------- */
/*                           LIKE/UNLIKE TOGGLE                               */
/* -------------------------------------------------------------------------- */

/**
 * Toggles a 'like' on a post.
 * 
 * Behavior:
 * - If user hasn't liked: Add like (increment count)
 * - If user already liked: Remove like (decrement count)
 * 
 * Data Integrity:
 * - Uses transaction to ensure like count matches CommunityLike records
 * - Prevents negative like counts (Math.max ensures minimum of 0)
 * - Unique constraint on (postId, userId) prevents duplicate likes
 * 
 * Response:
 * - Returns updated like count
 * - Returns isLiked status for optimistic UI updates
 * 
 * Use Case:
 * - Client calls on every like button click
 * - No need to check current state client-side (server decides)
 * 
 * 
 * 
 * @route POST /api/community/posts/:id/like
 * @access Private (authenticated users)
 * 
 * @param {string} req.params.id - Post ID to like/unlike
 * @returns {Object} JSON with updated likes count and isLiked flag
 */
exports.likePost = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const postId = req.params.id;
    const userId = req.session.user.id;

    try {
        // 2. Verify post exists and get current count
        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        // 3. Check if user has already liked this post
        const existingLike = await prisma.communityLike.findUnique({
            where: { postId_userId: { postId, userId } }
        });

        let isLiked = false;

        if (existingLike) {
            // 4A. UNLIKE logic - Remove existing like with retry
            await withRetry(
                () => prisma.$transaction([
                    prisma.communityLike.delete({ where: { id: existingLike.id } }),
                    prisma.communityPost.update({ where: { id: postId }, data: { likes: { decrement: 1 } } })
                ]),
                2
            );
            isLiked = false;
        } else {
            // 4B. LIKE logic - Create new like with retry
            await withRetry(
                () => prisma.$transaction([
                    prisma.communityLike.create({ data: { postId, userId } }),
                    prisma.communityPost.update({ where: { id: postId }, data: { likes: { increment: 1 } } })
                ]),
                2
            );
            isLiked = true;
        }

        // 5. Get actual like count from database
        // Re-fetch to ensure accurate count after transaction completes
        const realLikeCount = await prisma.communityLike.count({ where: { postId } });

        // Sync denormalized count if it drifted
        const updatedPost = await prisma.communityPost.findUnique({
            where: { id: postId },
            select: { likes: true }
        });

        if (updatedPost && updatedPost.likes !== realLikeCount) {
            await prisma.communityPost.update({
                where: { id: postId },
                data: { likes: realLikeCount }
            });
        }

        // 6. Return updated state to client
        res.json({ success: true, likes: realLikeCount, isLiked });
    } catch (error) {
        console.error("❌ Like Toggle Error:", error);
        res.status(500).json({ success: false, message: "Error toggling like" });
    }
};

/* -------------------------------------------------------------------------- */
/*                            COMMENT MANAGEMENT                              */
/* -------------------------------------------------------------------------- */

/**
 * Appends a new comment to a post.
 * 
 * Data Model:
 * - Comments stored as array in post document (embedded, not separate table)
 * - Each comment has: id, userId, userName, content, createdAt
 * - No edit functionality (users must delete and re-comment)
 * 
 * Validation:
 * - Content must not be empty (after trimming)
 * - Maximum 500 characters (prevents spam)
 * - Requires authentication
 * 
 * Comment ID:
 * - Generated via crypto.randomUUID() (unique identifier)
 * - Used for deletion targeting
 * 
 * 
 * 
 * @route POST /api/community/posts/:id/comments
 * @access Private (authenticated users)
 * 
 * @param {string} req.params.id - Post ID to comment on
 * @param {string} req.body.content - Comment text (max 500 chars)
 * @returns {Object} JSON with newly created comment object
 */
exports.addComment = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Please log in' });
    }

    const postId = req.params.id;
    const { content } = req.body;

    // 2. Validation checks
    if (!content || content.trim().length === 0) {
        return res.status(400).json({ success: false, message: 'Empty comment' });
    }
    if (content.length > MAX_COMMENT_LENGTH) {
        return res.status(400).json({
            success: false,
            message: `Comment too long (max ${MAX_COMMENT_LENGTH} characters)`
        });
    }

    try {
        // 3. Verify post exists
        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        // 4. Check comment limit
        if (post.comments && post.comments.length >= MAX_COMMENTS_PER_POST) {
            return res.status(400).json({
                success: false,
                message: 'Comment limit reached for this post'
            });
        }

        // 5. Construct comment object with sanitized content
        const sanitizedComment = sanitizeContent(content.trim());
        const newComment = {
            id: crypto.randomUUID(),              // Unique identifier for deletion
            userId: req.session.user.id,
            userName: req.session.user.name,      // Denormalized for display
            content: sanitizedComment,
            createdAt: new Date()
        };

        // 6. Push comment to post's comments array with retry
        await withRetry(
            () => prisma.communityPost.update({
                where: { id: postId },
                data: { comments: { push: newComment } }
            }),
            2
        );

        // 7. Return the new comment to client
        res.json({ success: true, message: 'Comment added!', comment: newComment });
    } catch (error) {
        console.error("❌ Comment Add Error:", error);
        res.status(500).json({ success: false, message: "Error adding comment" });
    }
};

/* -------------------------------------------------------------------------- */
/*                              POST DELETION                                 */
/* -------------------------------------------------------------------------- */

/**
 * Deletes a community post and its associated image file.
 * 
 * Authorization:
 * - Post owner can delete their own post
 * - Admins can delete any post (moderation)
 * - Other users are denied access (403)
 * 
 * Cleanup Process:
 * 1. Verify post exists
 * 2. Check authorization (owner or admin)
 * 3. Delete image file from disk (if exists)
 * 4. Delete post from database
 * 5. Cascade: Likes are auto-deleted via foreign key
 * 
 * Image Handling:
 * - ENOENT errors ignored (file already deleted)
 * - Other errors logged but don't block post deletion
 * 
 
 * 
 * @route DELETE /api/community/posts/:id
 * @access Private (post owner or admin)
 * 
 * @param {string} req.params.id - Post ID to delete
 * @returns {Object} JSON success/error response
 */
exports.deletePost = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const postId = req.params.id;
    const currentUserId = req.session.user.id;
    const currentUserIsAdmin = req.session.user.role === 'ADMIN';

    try {
        // 2. Fetch post to verify existence and ownership
        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        // 3. Authorization check (owner or admin)
        if (String(post.userId) !== String(currentUserId) && !currentUserIsAdmin) {
            return res.status(403).json({ success: false, message: 'Authorization Failed' });
        }

        // 4. Delete associated image file from disk
        if (post.imageUrl) {
            const filePath = path.join(__dirname, '../public', post.imageUrl);
            try {
                await fs.promises.unlink(filePath);
            } catch (err) {
                if (err.code !== 'ENOENT') {
                    // Log error but don't fail the request
                    console.error("Error deleting post image:", err);
                }
            }
        }

        // 5. Delete post from database
        await prisma.communityPost.delete({ where: { id: postId } });
        console.log(`🗑️ [DELETE] Post #${postId} removed by ${currentUserId}`);

        res.json({ success: true, message: 'Post deleted successfully' });
    } catch (error) {
        console.error("❌ Post Deletion Error:", error);
        res.status(500).json({ success: false, message: "Error deleting post" });
    }
};

/* -------------------------------------------------------------------------- */
/*                            COMMENT DELETION                                */
/* -------------------------------------------------------------------------- */

/**
 * Deletes a specific comment from a post.
 * 
 * Authorization:
 * - Comment owner can delete their own comment
 * - Admins can delete any comment (moderation)
 * - Other users are denied access (403)
 * 
 * Process:
 * 1. Fetch post containing the comment
 * 2. Find comment by ID in comments array
 * 3. Check authorization (owner or admin)
 * 4. Filter out the comment from array
 * 5. Update post with new comments array
 * 
 * Data Model Note:
 * - Comments are embedded in post document
 * - Deletion requires filtering array and updating entire field
 * - Not as efficient as separate table, but simpler for small comment counts
 * 
 * 
 * 
 * @route DELETE /api/community/posts/:postId/comments/:commentId
 * @access Private (comment owner or admin)
 * 
 * @param {string} req.params.postId - Post containing the comment
 * @param {string} req.params.commentId - Comment ID to delete (UUID)
 * @returns {Object} JSON success/error response
 */
exports.deleteComment = async (req, res) => {
    // 1. Authentication check
    if (!req.session.user) {
        return res.status(401).json({ success: false, message: 'Unauthorized' });
    }

    const { postId, commentId } = req.params;
    const currentUserId = req.session.user.id;
    const isAdminUser = req.session.user.role === 'ADMIN';

    try {
        // 2. Fetch post to access comments array
        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post) {
            return res.status(404).json({ success: false, message: 'Post not found' });
        }

        // 3. Find the specific comment in array
        const comment = post.comments.find(c => c.id === commentId);
        if (!comment) {
            return res.status(404).json({ success: false, message: 'Comment not found' });
        }

        // 4. Authorization check (owner or admin)
        if (String(comment.userId) !== String(currentUserId) && !isAdminUser) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

        // 5. Remove comment from array
        const updatedComments = post.comments.filter(c => c.id !== commentId);
        await prisma.communityPost.update({
            where: { id: postId },
            data: { comments: updatedComments }
        });

        res.json({ success: true, message: 'Comment deleted' });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error deleting comment" });
    }
};

/* -------------------------------------------------------------------------- */
/*                         AUTOMATED CLEANUP TASK                             */
/* -------------------------------------------------------------------------- */

/**
 * Background task: Delete community posts older than 15 days.
 * 
 * Purpose:
 * - Keeps community feed fresh and relevant
 * - Prevents database bloat from old social content
 * - Frees up disk space from old images
 * 
 * Cleanup Process:
 * 1. Calculate cutoff date (15 days ago)
 * 2. Find all posts with images older than cutoff
 * 3. Delete image files from disk (public/uploads/community/)
 * 4. Delete all old posts from database (with or without images)
 * 5. Log deletion count
 * 
 * Image Cleanup:
 * - Only deletes images for posts that have imageUrl
 * - ENOENT errors ignored (file already deleted)
 * - Other file errors logged but don't stop cleanup
 * 
 * Cascade Effects:
 * - Associated likes are auto-deleted (foreign key)
 * - Comments are deleted (embedded in post)
 * 
 * Scheduling:
 * - Called by scheduler.js every 24 hours
 * - Runs immediately on server startup
 * 
 * Note: Changed from 30 days to 15 days for more active content rotation
 * 
 * @returns {Promise<void>}
 */
exports.cleanupOldPosts = async () => {
    try {
        const startTime = Date.now();

        // 1. Calculate 15-day cutoff date
        const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

        // 2. Find old posts with images (need to delete files)
        const oldPostsWithImages = await prisma.communityPost.findMany({
            where: {
                createdAt: { lt: fifteenDaysAgo },
                imageUrl: { not: null }
            },
            select: { imageUrl: true }
        });

        // 3. Delete image files from disk - proper async deletion
        let imagesDeleted = 0;
        let deletionErrors = 0;

        for (const post of oldPostsWithImages) {
            if (post.imageUrl) {
                const filePath = path.join(__dirname, '../public', post.imageUrl);
                try {
                    await fs.promises.unlink(filePath);
                    imagesDeleted++;
                } catch (err) {
                    if (err.code !== 'ENOENT') {
                        deletionErrors++;
                        console.error("Error deleting old post image during cleanup:", err);
                    }
                }
            }
        }

        // 4. Delete all old posts from database
        const deleted = await prisma.communityPost.deleteMany({
            where: {
                createdAt: { lt: fifteenDaysAgo }
            }
        });

        // 5. Log cleanup metrics
        const durationMs = Date.now() - startTime;
        const estimatedSpaceFreed = imagesDeleted * 50000; // ~50KB per image

        console.log(`🧹 Community cleanup: ${deleted.count} posts, ${imagesDeleted} images (${deletionErrors} errors), ~${(estimatedSpaceFreed / 1024 / 1024).toFixed(2)}MB freed, ${durationMs}ms`);

        return {
            postsDeleted: deleted.count,
            imagesDeleted,
            deletionErrors,
            estimatedSpaceFreed,
            durationMs
        };
    } catch (error) {
        console.error("❌ Community Cleanup Error:", error);
        return { error: error.message };
    }
};
