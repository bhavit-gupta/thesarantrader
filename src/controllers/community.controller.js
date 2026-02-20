/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require('../utils/prisma');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { compressImage } = require('../utils/upload.utils');

/* -------------------------------------------------------------------------- */
/*                            COMMUNITY CONTROLLERS                           */
/* -------------------------------------------------------------------------- */

/**
 * Creates a new post in the community forum.
 */
exports.createPost = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Please log in to post' });

    const { title, content } = req.body;
    try {
        let finalImageUrl = null;
        if (req.file) {
            const communityUploadDir = path.join(__dirname, '../public/uploads/community');
            const compressedFilename = await compressImage(req.file, communityUploadDir);
            finalImageUrl = `/uploads/community/${compressedFilename}`;
        }

        const newPost = await prisma.communityPost.create({
            data: {
                userId: req.session.user.id,
                userName: req.session.user.name,
                title: title ? title.trim() : '',
                content: content ? content.trim() : '',
                imageUrl: finalImageUrl,
                likes: 0,
                likedBy: []
            }
        });

        console.log(`💬 [COMMUNITY] New post by ${newPost.userName} ${imageUrl ? '(with image)' : ''}`);
        res.json({ success: true, message: 'Post created successfully!', post: newPost });
    } catch (error) {
        console.error("❌ Post Creation Error:", error);
        // Clean up uploaded file if DB creation fails
        if (req.file) {
            fs.unlink(req.file.path, (err) => {
                if (err) console.error("Error deleting file after DB failure:", err);
            });
        }
        res.status(500).json({ success: false, message: "Error creating post" });
    }
};

/**
 * Fetches community posts. 
 * Supports both smart polling (via 'after' timestamp) and standard pagination.
 */
exports.getPosts = async (req, res) => {
    try {
        // --- SCENARIO A: SMART POLLING UPDATE ---
        // Client requests only posts created AFTER a specific timestamp
        if (req.query.after) {
            const afterDate = new Date(req.query.after);
            if (isNaN(afterDate.getTime())) return res.status(400).json({ success: false, message: 'Invalid timestamp' });

            const newPosts = await prisma.communityPost.findMany({
                where: { createdAt: { gt: afterDate } },
                orderBy: { createdAt: 'asc' }
            });

            // Map like status for the current user
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
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const [posts, totalPosts] = await prisma.$transaction([
            prisma.communityPost.findMany({ orderBy: { createdAt: 'desc' }, skip, take: limit }),
            prisma.communityPost.count()
        ]);

        const totalPages = Math.ceil(totalPosts / limit);
        let postsWithLikeStatus = posts;

        // Enrich with personal 'isLiked' status if logged in
        if (req.session.user) {
            const userId = req.session.user.id;
            const userLikes = await prisma.communityLike.findMany({
                where: { userId, postId: { in: posts.map(p => p.id) } },
                select: { postId: true }
            });

            const likedPostIds = new Set(userLikes.map(l => l.postId));
            postsWithLikeStatus = posts.map(post => ({ ...post, isLiked: likedPostIds.has(post.id) }));
        } else {
            postsWithLikeStatus = posts.map(post => ({ ...post, isLiked: false }));
        }

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

/**
 * Toggles a 'like' on a post.
 */
exports.likePost = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Please log in' });

    const postId = req.params.id;
    const userId = req.session.user.id;

    try {
        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

        const existingLike = await prisma.communityLike.findUnique({
            where: { postId_userId: { postId, userId } }
        });

        let likesCount = post.likes;
        let isLiked = false;

        if (existingLike) {
            // UNLIKE logic
            await prisma.$transaction([
                prisma.communityLike.delete({ where: { id: existingLike.id } }),
                prisma.communityPost.update({ where: { id: postId }, data: { likes: { decrement: 1 } } })
            ]);
            likesCount = Math.max(0, likesCount - 1);
            isLiked = false;
        } else {
            // LIKE logic
            await prisma.$transaction([
                prisma.communityLike.create({ data: { postId, userId } }),
                prisma.communityPost.update({ where: { id: postId }, data: { likes: { increment: 1 } } })
            ]);
            likesCount++;
            isLiked = true;
        }

        res.json({ success: true, likes: likesCount, isLiked });
    } catch (error) {
        console.error("❌ Like Toggle Error:", error);
        res.status(500).json({ success: false, message: "Error toggling like" });
    }
};

/**
 * Appends a new comment to a post.
 * Comments are stored as an array of objects within the post document.
 */
exports.addComment = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Please log in' });

    const postId = req.params.id;
    const { content } = req.body;

    if (!content || content.trim().length === 0) return res.status(400).json({ success: false, message: 'Empty comment' });
    if (content.length > 500) return res.status(400).json({ success: false, message: 'Comment too long' });

    try {
        const newComment = {
            id: crypto.randomUUID(),
            userId: req.session.user.id,
            userName: req.session.user.name,
            content: content.trim(),
            createdAt: new Date()
        };

        await prisma.communityPost.update({
            where: { id: postId },
            data: { comments: { push: newComment } }
        });

        res.json({ success: true, message: 'Comment added!', comment: newComment });
    } catch (error) {
        res.status(500).json({ success: false, message: "Error adding comment" });
    }
};

/**
 * Deletes a community post. Authorized for owner or admin.
 */
exports.deletePost = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const postId = req.params.id;
    const currentUserId = req.session.user.id;
    const currentUserIsAdmin = req.session.user.role === 'admin';

    try {
        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

        if (String(post.userId) !== String(currentUserId) && !currentUserIsAdmin) {
            return res.status(403).json({ success: false, message: 'Authorization Failed' });
        }

        // Delete associated image file if it exists
        if (post.imageUrl) {
            const filePath = path.join(__dirname, '../public', post.imageUrl);
            fs.unlink(filePath, (err) => {
                if (err && err.code !== 'ENOENT') {
                    console.error("Error deleting post image:", err);
                }
            });
        }

        await prisma.communityPost.delete({ where: { id: postId } });
        console.log(`🗑️ [DELETE] Post #${postId} removed by ${currentUserId}`);
        res.json({ success: true, message: 'Post deleted successfully' });
    } catch (error) {
        console.error("❌ Post Deletion Error:", error);
        res.status(500).json({ success: false, message: "Error deleting post" });
    }
};

/**
 * Deletes a specific comment from a post. Authorized for owner or admin.
 */
exports.deleteComment = async (req, res) => {
    if (!req.session.user) return res.status(401).json({ success: false, message: 'Unauthorized' });

    const { postId, commentId } = req.params;
    const currentUserId = req.session.user.id;
    const isAdminUser = req.session.user.role === 'admin';

    try {
        const post = await prisma.communityPost.findUnique({ where: { id: postId } });
        if (!post) return res.status(404).json({ success: false, message: 'Post not found' });

        const comment = post.comments.find(c => c.id === commentId);
        if (!comment) return res.status(404).json({ success: false, message: 'Comment not found' });

        if (String(comment.userId) !== String(currentUserId) && !isAdminUser) {
            return res.status(403).json({ success: false, message: 'Access denied' });
        }

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

/**
 * Cleanup Logic: Delete community posts older than 15 days, 
 * including their associated image files.
 */
exports.cleanupOldPosts = async () => {
    try {
        const fifteenDaysAgo = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000);

        // Find posts with images that are older than 15 days
        const oldPostsWithImages = await prisma.communityPost.findMany({
            where: {
                createdAt: { lt: fifteenDaysAgo },
                imageUrl: { not: null }
            },
            select: { imageUrl: true }
        });

        // Delete image files from disk
        oldPostsWithImages.forEach(post => {
            if (post.imageUrl) {
                const filePath = path.join(__dirname, '../public', post.imageUrl);
                fs.unlink(filePath, (err) => {
                    if (err && err.code !== 'ENOENT') {
                        console.error("Error deleting old post image during cleanup:", err);
                    }
                });
            }
        });

        // Delete posts from DB
        const deleted = await prisma.communityPost.deleteMany({
            where: {
                createdAt: { lt: fifteenDaysAgo }
            }
        });

        console.log(`🧹 Community Cleanup: Removed ${deleted.count} posts older than 15 days.`);
    } catch (error) {
        console.error("❌ Community Cleanup Error:", error);
    }
};
