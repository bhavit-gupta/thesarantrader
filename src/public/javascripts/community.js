// Community functionality

/* ---------------- STATE ---------------- */
let lastPostTimestamp = null; // ISO string of newest post we've seen
let postRefreshInterval = null;

/* ---------------- POST CREATION ---------------- */
// Character counter for post content
const postContent = document.getElementById('post-content');
const postCharCount = document.getElementById('post-char-count');

if (postContent) {
    postContent.addEventListener('input', () => {
        const length = postContent.value.length;
        postCharCount.textContent = `${length} / 1000`;

        if (length > 1000) {
            postCharCount.classList.add('text-red-500');
            postCharCount.classList.remove('text-slate-400');
        } else {
            postCharCount.classList.remove('text-red-500');
            postCharCount.classList.add('text-slate-400');
        }
    });
}

// Create post form submission
const createPostForm = document.getElementById('create-post-form');
if (createPostForm) {
    createPostForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const title = document.getElementById('post-title').value;
        const content = document.getElementById('post-content').value;

        if (!content.trim()) {
            showFeedback('Please write something to post', 'error');
            return;
        }

        if (content.length > 1000) {
            showFeedback('Post content must be less than 1000 characters', 'error');
            return;
        }

        try {
            const csrfToken = document.querySelector('meta[name="csrf-token"]').getAttribute('content');
            const response = await fetch('/api/community/posts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'csrf-token': csrfToken,
                    'Accept': 'application/json'
                },
                body: JSON.stringify({ title, content })
            });
            const data = await response.json();

            if (data.success) {
                showFeedback('Post created successfully!', 'success');
                createPostForm.reset();
                if (postCharCount) postCharCount.textContent = '0 / 1000';

                // Instantly prepend the new post and update timestamp
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

/* ---------------- POST LOADING (Initial) ---------------- */
async function loadPosts() {
    const loadingDiv = document.getElementById('posts-loading');
    const postsContainer = document.getElementById('posts-container');
    const emptyState = document.getElementById('empty-state');

    try {
        const response = await fetch('/api/community/posts');
        const data = await response.json();

        loadingDiv.classList.add('hidden');

        if (data.success && data.posts && data.posts.length > 0) {
            postsContainer.innerHTML = '';
            postsContainer.classList.remove('hidden');
            emptyState.classList.add('hidden');

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
    card.className = 'bg-white rounded-2xl border border-slate-200 shadow-sm p-6 hover:shadow-md transition-all';
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
    const isLiked = post.isLiked;

    // Check if current user is admin
    const isAdmin = window.isAdmin || false;

    // Check if user is logged in
    const isLoggedIn = currentUserId && currentUserId !== '';

    // Can the current user delete this post? (admin or owner)
    const canDeletePost = isAdmin || (isLoggedIn && post.userId === currentUserId);

    card.innerHTML = `
        <div class="flex items-start gap-4 mb-4">
            <div class="w-12 h-12 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-lg flex-shrink-0">
                ${post.userName.charAt(0).toUpperCase()}
            </div>
            <div class="flex-1">
                <p class="font-bold text-slate-800">${post.userName}</p>
                <p class="text-xs text-slate-400">${formatTimeAgo(post.createdAt)}</p>
            </div>
            ${canDeletePost ? `
                <button onclick="deletePost('${post.id}')" class="text-red-400 hover:text-red-600 transition-colors" title="Delete post">
                    <i class="fa-solid fa-trash text-sm"></i>
                </button>
            ` : ''}
        </div>

        ${post.title ? `<h3 class="text-lg font-bold text-slate-800 mb-2">${escapeHtml(post.title)}</h3>` : ''}
        <p class="text-slate-600 leading-relaxed mb-4 whitespace-pre-wrap">${escapeHtml(post.content)}</p>

        <div class="flex items-center gap-4 mb-4 pt-4 border-t border-slate-100">
            ${isLoggedIn ? `
                <button onclick="toggleLike('${post.id}')" class="like-btn flex items-center gap-2 px-4 py-2 rounded-lg ${isLiked ? 'bg-blue-50 text-blue-600' : 'bg-slate-50 text-slate-600'} hover:bg-blue-100 transition-colors">
                    <i class="fa-${isLiked ? 'solid' : 'regular'} fa-heart"></i>
                    <span class="like-count font-semibold">${post.likes}</span>
                </button>
                <button onclick="toggleComments('${post.id}')" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
                    <i class="fa-regular fa-comment"></i>
                    <span class="font-semibold">${post.comments.length}</span>
                </button>
            ` : `
                <div class="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-50 text-slate-400">
                    <i class="fa-regular fa-heart"></i>
                    <span class="font-semibold">${post.likes}</span>
                </div>
                <button onclick="toggleComments('${post.id}')" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-50 text-slate-600 hover:bg-slate-100 transition-colors">
                    <i class="fa-regular fa-comment"></i>
                    <span class="font-semibold">${post.comments.length}</span>
                </button>
            `}
        </div>

        <!-- Comments Section -->
        <div id="comments-${post.id}" class="hidden">
            <div class="space-y-3 mb-4">
                ${post.comments.map(comment => {
        const canDeleteComment = isAdmin || (isLoggedIn && comment.userId === currentUserId);
        return `
                    <div class="flex gap-3 p-3 rounded-lg bg-slate-50">
                        <div class="w-8 h-8 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                            ${comment.userName.charAt(0).toUpperCase()}
                        </div>
                        <div class="flex-1">
                            <p class="text-sm font-bold text-slate-800">${comment.userName}</p>
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
            // Reload posts to show new comment
            loadPosts();
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
        // Start smart polling every 5 seconds after initial load completes
        postRefreshInterval = setInterval(pollNewPosts, 10000);
    });
});

// Clean up interval when leaving page
window.addEventListener('beforeunload', () => {
    if (postRefreshInterval) {
        clearInterval(postRefreshInterval);
    }
});
