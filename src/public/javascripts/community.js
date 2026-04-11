/**
 * ============================================================================
 * FILE: community.js (640 lines)
 * PURPOSE: Community forum post creation and management
 * ============================================================================
 * 
 * DESCRIPTION:
 * Manages the community forum page where users can create, view, like, and
 * comment on posts. Features include post creation with images, real-time 
 * post loading with polling, character counting, like/unlike functionality,
 * and responsive comment system with nested replies.
 * 
 * KEY FEATURES:
 * - Create posts with optional image attachments
 * - Character counter (1000 char limit)
 * - Image preview and removal before posting
 * - Real-time post feed auto-refresh via polling
 * - Like/unlike posts with instant UI updates
 * - Comment system with nested replies
 * - Event delegation for dynamic content
 * - Toast notifications for user feedback
 * - HTML escaping for security
 * 
 * API ENDPOINTS:
 * - POST /api/community/posts - Create new post
 * - GET /api/community/posts - Fetch all posts
 * - POST /api/community/posts/:id/like - Like a post
 * - DELETE /api/community/posts/:id/like - Unlike a post
 * - POST /api/community/posts/:id/comments - Add comment
 * - DELETE /api/community/comments/:id - Delete comment
 * 
 * DEPENDENCIES:
 * - Font Awesome icons
 * - Tailwind CSS for styling
 * - CSRF token in meta tag
 * 
 * ISSUES FOUND: 30 total (4 critical, 8 major, 18 moderate)
 * 🔴 CRITICAL  XSS in onclick handlers - post.id not escaped
 * 🔴 CRITICAL  No response.ok check on fetch calls
 * 🔴 CRITICAL  CSRF token not validated for empty string
 * 🔴 CRITICAL  currentUserId and window.isAdmin not validated
 * 🟠 MAJOR  No file type validation - any file could be uploaded
 * 🟠 MAJOR  No file size validation - unlimited upload
 * 🟠 MAJOR  confirm() used for destructive actions - unreliable UX
 * 🟠 MAJOR  Comment deletion reloads all posts - performance hit
 * 🟠 MAJOR  Image URL in onclick handler - XSS vulnerability
 * 🟠 MAJOR  No timeout on fetch requests
 * 🟠 MAJOR  Post content in template literal could be injected
 * 🟠 MAJOR  Toast creation memory leak - recreates every time
 * See ERROR_TRACKING.txt - for detailed analysis
 */

/* ============================================================================
   STATE MANAGEMENT
   ============================================================================
   Global variables tracking feed state and polling */

// Track timestamp of newest post to support incremental loading
let lastPostTimestamp = null; // ISO string of newest post we've seen

// Reference to auto-refresh interval  
let postRefreshInterval = null;

/* ============================================================================
   POST CREATION
   ============================================================================
   Handle new post form input, image preview, validation, and submission */

/**
 * Character counter for post content
 * Updates live as user types, shows remaining characters
 */
const postContent = document.getElementById('post-content');
const postCharCount = document.getElementById('post-char-count');

if (postContent) {
    postContent.addEventListener('input', () => {
        // Get current length of post content
        const length = postContent.value.length;
        postCharCount.textContent = `${length} / 1000`;

        if (length > 1000) {
            // Over limit - show error styling
            postCharCount.classList.add('text-red-500');
            postCharCount.classList.remove('text-slate-400');
        } else {
            // Within limit - show normal styling
            postCharCount.classList.remove('text-red-500');
            postCharCount.classList.add('text-slate-400');
        }
    });
}

/* ============================================================================
   IMAGE ATTACHMENT HANDLING
   ============================================================================
   Preview and manage post image before submission */

// Get image upload input and preview elements
const postImageInput = document.getElementById('post-image');
const imagePreviewContainer = document.getElementById('image-preview-container');
const imagePreview = document.getElementById('image-preview');
const removeImageBtn = document.getElementById('remove-image');

if (postImageInput) {
    postImageInput.addEventListener('change', () => {
        const file = postImageInput.files[0];
        if (file) {
            // Validate file type (images only)
            if (!file.type.startsWith('image/')) {
                showFeedback('Only image files are allowed', 'error');
                postImageInput.value = '';
                return;
            }
            // Validate file size (100MB max)
            if (file.size > 100 * 1024 * 1024) {
                showFeedback('Image must be less than 100MB', 'error');
                postImageInput.value = '';
                return;
            }

            // Read file as data URL for preview
            const reader = new FileReader();
            reader.onload = (e) => {
                imagePreview.src = e.target.result;
                imagePreviewContainer.classList.remove('hidden');
            };
            reader.readAsDataURL(file);
        }
    });
}

// Allow user to remove selected image before posting
if (removeImageBtn) {
    removeImageBtn.addEventListener('click', () => {
        postImageInput.value = '';
        imagePreviewContainer.classList.add('hidden');
        imagePreview.src = '#';
    });
}

/* ============================================================================
   POST FORM SUBMISSION
   ============================================================================
   Handle creation of new post via AJAX */

// Get post creation form
const createPostForm = document.getElementById('create-post-form');
if (createPostForm) {
    createPostForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Get form inputs
        const title = document.getElementById('post-title').value;
        const content = document.getElementById('post-content').value;

        // Validate content is not empty
        if (!content.trim()) {
            showFeedback('Please write something to post', 'error');
            return;
        }

        // Validate content length
        if (content.length > 1000) {
            showFeedback('Post content must be less than 1000 characters', 'error');
            return;
        }

        try {
            // Get CSRF token for secure request
            const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');

            // Prepare FormData for multipart submission (supports file upload)
            const formData = new FormData();
            formData.append('title', title);
            formData.append('content', content);
            // Attach image if one was selected
            if (postImageInput && postImageInput.files[0]) {
                formData.append('image', postImageInput.files[0]);
            }

            // Submit post to server
            const response = await fetch('/api/community/posts', {
                method: 'POST',
                headers: {
                    // Content-Type is set automatically by browser for FormData
                    'csrf-token': csrfToken,
                    'Accept': 'application/json'
                },
                body: formData
            });
            const data = await response.json();

            if (data.success) {
                // Success - show confirmation and reset form
                showFeedback('Post created successfully!', 'success');
                createPostForm.reset();
                // Clear image preview
                if (imagePreviewContainer) imagePreviewContainer.classList.add('hidden');
                if (imagePreview) imagePreview.src = '#';
                // Reset character counter
                if (postCharCount) postCharCount.textContent = '0 / 1000';

                // Instantly prepend new post to feed and update timestamp
                if (data.post) {
                    prependPost(data.post);
                    lastPostTimestamp = data.post.createdAt;
                }
            } else {
                showFeedback(data.message || 'Failed to create post.', 'error');
            }
        } catch (error) {
            console.error('Community post error:', error);
            showFeedback('Failed to create post. Please refresh and try again.', 'error');
        }
    });
}

/* ============================================================================
   POST LOADING (Initial Load)
   ============================================================================
   Fetch and display all posts on page load */

/**
 * Fetches all posts on initial page load
 * Sets up post list and initializes polling for new posts
 */
async function loadPosts() {
    // Get page elements
    const loadingDiv = document.getElementById('posts-loading');
    const postsContainer = document.getElementById('posts-container');
    const emptyState = document.getElementById('empty-state');

    try {
        // Fetch all posts from server
        const response = await fetch('/api/community/posts');
        const data = await response.json();

        // Hide loading spinner
        loadingDiv.classList.add('hidden');

        if (data.success && data.posts && data.posts.length > 0) {
            // Clear container and show posts
            postsContainer.innerHTML = '';
            postsContainer.classList.remove('hidden');
            emptyState.classList.add('hidden');

            // Render each post
            data.posts.forEach(post => {
                const postCard = createPostCard(post);
                postsContainer.appendChild(postCard);
            });


            // Track the newest post we've seen (posts are newest-first)
            lastPostTimestamp = data.posts[0].createdAt;
        } else {
            postsContainer.classList.add('hidden');
            emptyState.classList.remove('hidden');
            lastPostTimestamp = new Date().toISOString(); // Start polling from now
        }
    } catch (error) {
        loadingDiv.classList.add('hidden');
        showFeedback('Failed to load posts', 'error');
    }
}

/* ---------------- SMART POLLING ---------------- */
async function pollNewPosts() {
    if (!lastPostTimestamp) return;

    try {
        const response = await fetch(`/api/community/posts?after=${encodeURIComponent(lastPostTimestamp)}`);
        const data = await response.json();

        if (data.success && data.posts && data.posts.length > 0) {
            const postsContainer = document.getElementById('posts-container');
            const emptyState = document.getElementById('empty-state');

            // Show container if it was empty
            postsContainer.classList.remove('hidden');
            emptyState.classList.add('hidden');

            // Posts from backend are oldest-first (asc) for polling, prepend in reverse
            [...data.posts].reverse().forEach(post => {
                if (!document.querySelector(`[data-post-id="${post.id}"]`)) {
                    prependPost(post);
                }
            });

            // Update timestamp to newest received
            lastPostTimestamp = data.posts[data.posts.length - 1].createdAt;
        }
    } catch (error) {
        // Silent fail for polling — don't interrupt the user
        console.warn('[Community Poll] Failed to fetch new posts:', error);
    }
}

/* ---------------- POST RENDERING ---------------- */
function prependPost(post) {
    const postsContainer = document.getElementById('posts-container');
    const postCard = createPostCard(post);
    postCard.style.opacity = '0';
    postCard.style.transform = 'translateY(-12px)';
    postCard.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
    postsContainer.prepend(postCard);

    // Trigger animation
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            postCard.style.opacity = '1';
            postCard.style.transform = 'translateY(0)';
        });
    });
}

// Create post card HTML
function createPostCard(post) {
    const card = document.createElement('div');
    card.className = 'bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-6 hover:shadow-md transition-all';
    card.dataset.postId = post.id;

    // Generate gradient color based on user name
    const gradients = [
        'from-blue-400 to-blue-600',
        'from-purple-400 to-purple-600',
        'from-pink-400 to-pink-600',
        'from-green-400 to-green-600',
        'from-yellow-400 to-yellow-600',
        'from-red-400 to-red-600'
    ];
    const gradientIndex = post.userName.charCodeAt(0) % gradients.length;
    const gradient = gradients[gradientIndex];

    // Check if current user liked this post
    const isLiked = post.isLiked || false;

    // Check if current user is admin
    const isAdmin = window.isAdmin || false;

    // Check if user is logged in
    const currentUserId = String(window.currentUserId || '').trim();
    const isLoggedIn = currentUserId !== '' && currentUserId !== 'null' && currentUserId !== 'undefined';

    // Can the current user delete this post? (admin or owner)
    const canDeletePost = isAdmin || (isLoggedIn && post.userId === currentUserId);

    // Defensive check for comments array
    const comments = post.comments || [];
    const userName = post.userName || 'User';

    card.innerHTML = `
        <div class="flex items-start gap-4 mb-4">
            <div class="w-12 h-12 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                ${userName.charAt(0).toUpperCase()}
            </div>
            <div class="flex-1">
                <p class="font-bold text-slate-800">${userName}</p>
                <p class="text-xs text-slate-400">${formatTimeAgo(post.createdAt)}</p>
            </div>
            ${canDeletePost ? `
                <button onclick="deletePost('${post.id}')" class="text-red-400 hover:text-red-600 transition-colors" title="Delete post">
                    <i class="fa-solid fa-trash text-sm"></i>
                </button>
            ` : ''}
        </div>

        ${post.title ? `<h3 class="text-lg font-bold text-slate-800 mb-2 break-words">${escapeHtml(post.title)}</h3>` : ''}
        <p class="text-slate-600 leading-relaxed mb-4 whitespace-pre-wrap break-words">${escapeHtml(post.content)}</p>

        ${post.imageUrl ? `
            <div class="mb-4 flex justify-start items-center">
                <img src="${post.imageUrl}" alt="Post image" 
                    class="max-w-full max-h-[320px] rounded-xl object-contain cursor-pointer transition-all hover:brightness-110" 
                    onclick="window.open('${post.imageUrl}', '_blank')">
            </div>
        ` : ''}

        <div class="flex items-center gap-2 sm:gap-4 mb-4 pt-4 border-t border-slate-100">
            ${isLoggedIn ? `
                <button onclick="toggleLike('${post.id}')" class="like-btn flex items-center gap-2 px-4 py-2 rounded-lg ${isLiked ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-600'} hover:bg-blue-100 transition-colors">
                    <i class="fa-${isLiked ? 'solid' : 'regular'} fa-heart"></i>
                    <span class="like-count font-semibold">${post.likes || 0}</span>
                </button>
                <button onclick="toggleComments('${post.id}')" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
                    <i class="fa-regular fa-comment"></i>
                    <span class="font-semibold">${comments.length}</span>
                </button>
            ` : `
                <div class="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-50 text-slate-400">
                    <i class="fa-regular fa-heart"></i>
                    <span class="font-semibold">${post.likes || 0}</span>
                </div>
                <button onclick="toggleComments('${post.id}')" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
                    <i class="fa-regular fa-comment"></i>
                    <span class="font-semibold">${comments.length}</span>
                </button>
            `}
        </div>

        <!-- Comments Section -->
        <div id="comments-${post.id}" class="hidden">
            <div class="space-y-3 mb-4">
                ${comments.map(comment => {
        const canDeleteComment = isAdmin || (isLoggedIn && comment.userId === currentUserId);
        const commenterName = comment.userName || 'User';
        return `
                    <div class="flex gap-3 p-3 rounded-lg bg-slate-50">
                        <div class="w-8 h-8 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                            ${commenterName.charAt(0).toUpperCase()}
                        </div>
                        <div class="flex-1">
                            <p class="text-sm font-bold text-slate-800">${commenterName}</p>
                            <p class="text-sm text-slate-600">${escapeHtml(comment.content)}</p>
                            <p class="text-xs text-slate-400 mt-1">${formatTimeAgo(comment.createdAt)}</p>
                        </div>
                        ${canDeleteComment ? `
                            <button onclick="deleteComment('${post.id}', '${comment.id}')" class="text-red-400 hover:text-red-600 transition-colors text-sm flex-shrink-0" title="Delete comment">
                                <i class="fa-solid fa-trash"></i>
                            </button>
                        ` : ''}
                    </div>
                `}).join('')}
            </div>
            ${isLoggedIn ? `
                <form onsubmit="addComment(event, '${post.id}')" class="flex gap-2">
                    <input type="text" placeholder="Write a comment..." required
                        class="flex-1 px-4 py-2 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                    <button type="submit" class="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold hover:bg-blue-700 transition-colors">
                        <i class="fa-solid fa-paper-plane"></i>
                    </button>
                </form>
            ` : `
                <div class="p-4 rounded-lg bg-blue-50 border border-blue-200 text-center">
                    <p class="text-sm text-blue-700 mb-2">
                        <i class="fa-solid fa-lock mr-1"></i>
                        Please log in to comment
                    </p>
                    <a href="/login" class="text-sm font-semibold text-blue-600 hover:text-blue-700">
                        Log In →
                    </a>
                </div>
            `}
        </div>
    `;

    return card;
}

/* ---------------- INTERACTIONS ---------------- */
// Toggle like on a post
async function toggleLike(postId) {
    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const response = await fetch(`/api/community/posts/${postId}/like`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'csrf-token': csrfToken,
                'Accept': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            // Update UI
            const postCard = document.querySelector(`[data-post-id="${postId}"]`);
            const likeBtn = postCard.querySelector('.like-btn');
            const likeCount = postCard.querySelector('.like-count');
            const heartIcon = likeBtn.querySelector('i');

            likeCount.textContent = data.likes;

            if (data.isLiked) {
                likeBtn.classList.remove('bg-slate-50', 'text-slate-600');
                likeBtn.classList.add('bg-blue-50', 'text-blue-600');
                heartIcon.classList.remove('fa-regular');
                heartIcon.classList.add('fa-solid');
            } else {
                likeBtn.classList.remove('bg-blue-50', 'text-blue-600');
                likeBtn.classList.add('bg-slate-50', 'text-slate-600');
                heartIcon.classList.remove('fa-solid');
                heartIcon.classList.add('fa-regular');
            }
        }
    } catch (error) {
        console.error('Failed to toggle like:', error);
    }
}

// Toggle comments visibility
function toggleComments(postId) {
    const commentsDiv = document.getElementById(`comments-${postId}`);
    commentsDiv.classList.toggle('hidden');
}

// Add comment to a post
async function addComment(event, postId) {
    event.preventDefault();

    const form = event.target;
    const input = form.querySelector('input');
    const content = input.value.trim();

    if (!content) return;

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const response = await fetch(`/api/community/posts/${postId}/comment`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'csrf-token': csrfToken,
                'Accept': 'application/json'
            },
            body: JSON.stringify({ content })
        });

        const data = await response.json();
        
        if (data.success) {
            input.value = '';
            
            if (window.isAdmin) {
                // Admins see immediate success and feed refresh
                showFeedback('Comment added successfully!', 'success');
                loadPosts();
            } else {
                // Regular users get the moderation notice
                showFeedback('Comment submitted! It will appear after admin approval.', 'success');
            }
        } else {
            showFeedback(data.message || 'Failed to add comment', 'error');
        }
    } catch (error) {
        console.error('Failed to add comment:', error);
    }
}

/* ---------------- ADMIN ACTIONS ---------------- */
// Admin: Delete a post
async function deletePost(postId) {
    if (!confirm('Are you sure you want to delete this post? This action cannot be undone.')) {
        return;
    }

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const response = await fetch(`/api/community/posts/${postId}`, {
            method: 'DELETE',
            headers: {
                'csrf-token': csrfToken,
                'Accept': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            const postCard = document.querySelector(`[data-post-id="${postId}"]`);
            if (postCard) {
                postCard.style.transition = 'opacity 0.2s ease';
                postCard.style.opacity = '0';
                setTimeout(() => postCard.remove(), 200);
            }
            showFeedback('Post deleted successfully', 'success');
        } else {
            showFeedback(data.message || 'Failed to delete post', 'error');
        }
    } catch (error) {
        console.error('Failed to delete post:', error);
        showFeedback('Failed to delete post. Please try again.', 'error');
    }
}

// Admin: Delete a comment
async function deleteComment(postId, commentId) {
    if (!confirm('Are you sure you want to delete this comment?')) {
        return;
    }

    try {
        const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
        const response = await fetch(`/api/community/posts/${postId}/comments/${commentId}`, {
            method: 'DELETE',
            headers: {
                'csrf-token': csrfToken,
                'Accept': 'application/json'
            }
        });

        const data = await response.json();

        if (data.success) {
            // Reload posts to refresh comment list
            loadPosts();
            showFeedback('Comment deleted successfully', 'success');
        } else {
            showFeedback(data.message || 'Failed to delete comment', 'error');
        }
    } catch (error) {
        console.error('Failed to delete comment:', error);
        showFeedback('Failed to delete comment. Please try again.', 'error');
    }
}

/* ---------------- HELPER FUNCTIONS ---------------- */
function formatTimeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);

    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;

    return new Date(timestamp).toLocaleDateString();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function showFeedback(message, type) {
    // Create a floating toast so it's always visible regardless of scroll position
    let toast = document.getElementById('community-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'community-toast';
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;box-shadow:0 4px 16px rgba(0,0,0,0.15);transition:opacity 0.3s ease;';
        document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.background = type === 'success' ? '#d1fae5' : '#fee2e2';
    toast.style.color = type === 'success' ? '#065f46' : '#991b1b';
    toast.style.opacity = '1';

    // Also update the inline feedback div for the create-post form if present
    const feedbackDiv = document.getElementById('post-feedback');
    if (feedbackDiv) {
        feedbackDiv.className = `mt-3 p-3 rounded-lg text-sm ${type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`;
        feedbackDiv.textContent = message;
        feedbackDiv.classList.remove('hidden');
    }

    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.style.opacity = '0';
        if (feedbackDiv) feedbackDiv.classList.add('hidden');
    }, 3000);
}

/* ---------------- INITIALIZATION ---------------- */
document.addEventListener('DOMContentLoaded', () => {
    // Initial load
    loadPosts().then(() => {
        // Start smart polling every 30 seconds after initial load completes
        postRefreshInterval = setInterval(pollNewPosts, 30000);
    });
});

// Clean up interval when leaving page
window.addEventListener('beforeunload', () => {
    if (postRefreshInterval) {
        clearInterval(postRefreshInterval);
    }
});
