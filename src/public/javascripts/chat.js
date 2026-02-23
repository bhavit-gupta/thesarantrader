/**
 * ============================================================================
 * FILE: chat.js (391 lines)
 * PURPOSE: Course-specific chat room functionality
 * ============================================================================
 * 
 * DESCRIPTION:
 * Manages real-time chat for each course. Features include message loading
 * with smart polling (only fetch new messages since last update), message
 * rendering with avatars, image uploads, and auto-scrolling. Provides live
 * conversation experience for enrolled users and instructors.
 * 
 * KEY FEATURES:
 * - Smart message polling (fetch only new messages since last timestamp)
 * - 3-second auto-refresh interval
 * - Image upload with preview and size validation
 * - Message rendering with user avatars (gradient backgrounds)
 * - Time-ago formatting for message timestamps
 * - Auto-scroll to latest message
 * - Duplicate message prevention
 * - Separate styling for user's own messages
 * - HTML escaping for security
 * 
 * GLOBAL VARIABLES (from EJS):
 * - window.courseId - Current course ID
 * - window.currentUserId - Current logged-in user ID
 * 
 * API ENDPOINTS:
 * - GET /api/chat/:courseId/messages - Fetch messages (with optional ?after= timestamp)
 * - POST /api/chat/:courseId/send - Send new message with optional image
 * 
 * DEPENDENCIES:
 * - Font Awesome icons
 * - Tailwind CSS
 * - CSRF token in meta tag
 * 
 * ISSUES FOUND: 30 total (3 critical, 7 major, 20 moderate)
 * 🔴 CRITICAL [16.1] XSS in onclick handler - imageUrl not escaped
 * 🔴 CRITICAL [16.2] No response.ok check on all fetch calls
 * 🔴 CRITICAL [16.3] CSRF token not validated for empty string
 * 🟠 MAJOR [16.4] escapeHtml incomplete - allows some XSS patterns
 * 🟠 MAJOR [16.5] Fixed 3s polling wastes resources when no new messages
 * 🟠 MAJOR [16.6] No timestamp validation - could be negative/very large
 * 🟠 MAJOR [16.7] scrollToBottom() called on every message - performance hit
 * 🟠 MAJOR [16.8] Console.log with emojis unprofessional - data leak
 * 🟠 MAJOR [16.9] window.courseId and window.currentUserId not validated
 * 🟠 MAJOR [16.10] Image upload validation only checks mimetype string
 * See ERROR_TRACKING.txt [16.1]-[16.30] for detailed analysis
 */

/* ============================================================================
   STATE MANAGEMENT
   ============================================================================
   Track polling state and message timestamps */

// Track timestamp of most recent message received (for smart polling)
let lastMessageTimestamp = 0;

// Reference to message auto-refresh interval
let messageRefreshInterval;

/* ============================================================================
   INITIALIZATION
   ============================================================================
   Set up all chat functionality when page loads */

// Initialize chat data
const rawCourseId = window.courseId || '';
const trimmedCourseId = String(rawCourseId).trim();

// Global validation once
function validateCourseId(id) {
    if (!id) return false;
    return /^[a-fA-F0-9]{24}$/.test(id);
}

if (!validateCourseId(trimmedCourseId)) {
    console.error(`❌ [CHAT] Invalid courseId detected!
      Original: "${rawCourseId}"
      Trimmed: "${trimmedCourseId}"
      Type: ${typeof rawCourseId}`);

    showFeedback('Invalid course identifier. Please reload the page or contact support.', 'error');

    const chatContainer = document.getElementById('messages-container');
    if (chatContainer) chatContainer.classList.add('hidden');

    // Stop execution
    throw new Error('Chat aborted due to invalid courseId');
}

// Update global courseId to its trimmed version for all future API calls
window.courseId = trimmedCourseId;

// Load initial messages when page loads
loadMessages();

// Set up auto-refresh every 3 seconds (3000ms)
messageRefreshInterval = setInterval(loadMessages, 3000);

// Set up message form submission handler
const messageForm = document.getElementById('message-form');
if (messageForm) {
    messageForm.addEventListener('submit', sendMessage);
}

// Set up image preview for chat images
setupChatImagePreview();

/* ============================================================================
   IMAGE UPLOAD HANDLING
   ============================================================================
   Preview and validate images before sending */

/**
 * Sets up image preview for message attachments
 * Handles file validation, preview display, and removal
 */
function setupChatImagePreview() {
    // Get image upload input
    const chatImageInput = document.getElementById('chat-image');
    const previewContainer = document.getElementById('chat-image-preview-container');
    const previewImg = document.getElementById('chat-image-preview');
    const removeBtn = document.getElementById('remove-chat-image');

    if (chatImageInput) {
        chatImageInput.addEventListener('change', () => {
            // Get selected file
            const file = chatImageInput.files[0];
            if (file) {
                // Validate file is an image
                if (!file.type.startsWith('image/')) {
                    showFeedback('Only image files are allowed', 'error');
                    chatImageInput.value = '';
                    return;
                }
                // Validate file size (100MB max)
                if (file.size > 100 * 1024 * 1024) {
                    showFeedback('Image must be less than 100MB', 'error');
                    chatImageInput.value = '';
                    return;
                }

                // Read file and show preview
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewImg.src = e.target.result;
                    previewContainer.classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Allow removing selected image
    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            chatImageInput.value = '';
            previewContainer.classList.add('hidden');
            previewImg.src = '#';
        });
    }
}

/* ============================================================================
   MESSAGE LOADING
   ============================================================================
   Fetch messages from server with smart polling (only new messages) */

/**
 * Loads messages from server
 * Uses smart polling: only fetches messages after the last received timestamp
 * This minimizes server load and bandwidth usage
 */
async function loadMessages() {
    try {
        // Build URL for message fetch
        let url = `/api/chat/${window.courseId}/messages`;

        // Smart Polling: Only fetch messages after the last received one
        // If we have a timestamp, append it to the query to get only newer messages
        if (lastMessageTimestamp > 0) {
            url += `?after=${lastMessageTimestamp}`;
        }

        // Fetch messages from server
        const response = await fetch(url, {
            headers: {
                'Accept': 'application/json'
            }
        });
        const data = await response.json();

        if (data.success) {
            if (data.messages.length > 0) {
                // Update timestamp from the latest message (last in the array)
                // This ensures next poll only gets messages after this one
                const latestMsg = data.messages[data.messages.length - 1];
                lastMessageTimestamp = new Date(latestMsg.timestamp).getTime();

                // Render new messages (append to existing list)
                displayMessages(data.messages, true); // true = append mode
            } else if (lastMessageTimestamp === 0) {
                // First load, but no messages exist in the channel yet
                displayMessages([], false);
            }
            // If  messages.length === 0 and lastMessageTimestamp > 0:
            // No new messages since last poll - do nothing
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

/* ============================================================================
   MESSAGE RENDERING & DISPLAY
   ============================================================================
   Render messages in chat window with proper formatting */

/**
 * Displays messages in the chat message list
 * Handles loading state, empty state, and message rendering
 * 
 * @param {Array} messages - Array of message objects to display
 * @param {boolean} append - If true, append to existing messages; if false, replace
 */
function displayMessages(messages, append = false) {
    // Get chat UI elements
    const loadingEl = document.getElementById('messages-loading');
    const listEl = document.getElementById('messages-list');
    const emptyEl = document.getElementById('empty-messages');

    // Hide loading spinner
    loadingEl.classList.add('hidden');

    // Handle "No Messages" state (only on initial load)
    if (messages.length === 0 && !append) {
        listEl.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        return;
    }

    // If we have messages, ensure list is visible
    emptyEl.classList.add('hidden');
    listEl.classList.remove('hidden');

    // Only clear existing messages if doing a full refresh (append=false)
    // For polling (append=true), just add new messages to the end
    if (!append) {
        listEl.innerHTML = '';
    }

    // Render each message
    messages.forEach(msg => {
        // Prevent duplicate messages (in case of timestamp overlap)
        if (document.getElementById(`msg-${msg.id}`)) return;

        // Create and append message element
        const messageEl = createMessageElement(msg);
        listEl.appendChild(messageEl);
    });

    // Scroll to bottom to show latest message
    scrollToBottom();
}

/**
 * Creates a single message element with proper formatting and styling
 * 
 * @param {Object} msg - Message object containing: id, userId, userName, message, imageUrl, timestamp
 * @returns {HTMLElement} Formatted message div element
 */
function createMessageElement(msg) {
    if (!msg) return document.createElement('div');

    // Check if this is the current user's message
    const isOwnMessage = msg.userId === window.currentUserId;
    const userName = msg.userName || 'Unknown User';

    // Create message container
    const messageDiv = document.createElement('div');
    messageDiv.id = `msg-${msg.id || Math.random()}`; // Unique ID for duplicate checking
    messageDiv.className = `flex ${isOwnMessage ? 'justify-end' : 'justify-start'} animate-fade-in-up`; // Add animation

    // Generate gradient background for avatar (based on user name)
    const gradients = [
        'from-blue-400 to-blue-600',
        'from-purple-400 to-purple-600',
        'from-pink-400 to-pink-600',
        'from-green-400 to-green-600',
        'from-yellow-400 to-yellow-600',
        'from-red-400 to-red-600'
    ];
    const gradientIndex = userName.charCodeAt(0) % gradients.length;
    const gradient = gradients[gradientIndex];

    // Build message HTML
    messageDiv.innerHTML = `
        <div class="max-w-md ${isOwnMessage ? 'ml-auto' : 'mr-auto'}">
            <div class="flex items-start gap-3 ${isOwnMessage ? 'flex-row-reverse' : ''}">
                <!-- Avatar with User Initial -->
                <div class="w-10 h-10 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold flex-shrink-0">
                    ${userName.charAt(0).toUpperCase()}
                </div>
                
                <!-- Message Content -->
                <div class="flex-1">
                    <!-- User Name and Time -->
                    <div class="flex items-center gap-2 mb-1 ${isOwnMessage ? 'justify-end' : ''}">
                        <span class="text-sm font-bold text-slate-800">${escapeHtml(userName)}</span>
                        <span class="text-xs text-slate-400">${formatTimeAgo(msg.timestamp)}</span>
                    </div>
                    
                    <!-- Message Bubble -->
                    <div class="px-4 py-2 rounded-lg ${isOwnMessage ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}">
                        ${msg.imageUrl ? `
                            <div class="mb-2 rounded-lg overflow-hidden border border-slate-200 bg-white">
                                <a href="${escapeHtml(msg.imageUrl)}" target="_blank" rel="noopener noreferrer">
                                    <img src="${escapeHtml(msg.imageUrl)}" alt="Uploaded image" class="max-w-full h-auto cursor-pointer">
                                </a>
                            </div>
                        ` : ''}
                        <p class="text-sm whitespace-pre-wrap">${escapeHtml(msg.message || '')}</p>
                    </div>
                </div>
            </div>
        </div>
    `;

    return messageDiv;
}

/* ============================================================================
   MESSAGE SENDING
   ============================================================================
   Handle message submission via form */

/**
 * Sends a message to the chat
 * Called when user submits the message form
 */
async function sendMessage(e) {
    e.preventDefault();
    console.log("📤 Sending message...");

    const input = document.getElementById('message-input');
    const imageInput = document.getElementById('chat-image');

    if (!input) {
        console.error("❌ Error: message-input not found");
        return;
    }

    const message = input.value.trim();
    const hasImage = imageInput && imageInput.files && imageInput.files[0];

    if (!message && !hasImage) {
        console.log("⚠️ Ignoring empty message/image");
        return;
    }

    try {
        const csrfMeta = document.querySelector('meta[name="csrf-token"]');
        if (!csrfMeta) {
            console.error("❌ Error: CSRF meta tag missing");
            showFeedback('Security error: CSRF token missing', 'error');
            return;
        }
        const csrfToken = csrfMeta.getAttribute('content');

        const formData = new FormData();
        formData.append('message', message);
        if (hasImage) {
            formData.append('image', imageInput.files[0]);
        }

        console.log("📡 Fetching to:", `/api/chat/${window.courseId}/messages`);
        const response = await fetch(`/api/chat/${window.courseId}/messages`, {
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'csrf-token': csrfToken
            },
            body: formData
        });

        const data = await response.json();
        console.log("📥 Server response:", data);

        if (data.success) {
            input.value = '';
            if (imageInput) imageInput.value = '';
            const previewContainer = document.getElementById('chat-image-preview-container');
            const previewImg = document.getElementById('chat-image-preview');
            if (previewContainer) previewContainer.classList.add('hidden');
            if (previewImg) previewImg.src = '#';

            if (data.chatMessage) {
                lastMessageTimestamp = Math.max(lastMessageTimestamp, new Date(data.chatMessage.timestamp).getTime());
                displayMessages([data.chatMessage], true);
            } else {
                loadMessages();
            }
            showFeedback('Message sent!', 'success');
        } else {
            showFeedback(data.message || 'Failed to send message', 'error');
        }
    } catch (error) {
        console.error('❌ Failed to send message:', error);
        showFeedback('Failed to send message', 'error');
    }
}

/* ---------------- HELPER FUNCTIONS ---------------- */
// Show feedback message
function showFeedback(message, type) {
    const feedbackEl = document.getElementById('message-feedback');
    feedbackEl.textContent = message;
    feedbackEl.className = `mt-2 text-sm ${type === 'success' ? 'text-green-600' : 'text-red-600'}`;
    feedbackEl.classList.remove('hidden');

    setTimeout(() => {
        feedbackEl.classList.add('hidden');
    }, 3000);
}

// Scroll to bottom of messages
function scrollToBottom() {
    const container = document.getElementById('messages-container');
    container.scrollTop = container.scrollHeight;
}

// Format timestamp to relative time
function formatTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (seconds < 60) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days < 7) return `${days}d ago`;

    return formatDate(timestamp);
}

// Escape HTML to prevent XSS
function escapeHtml(unsafe) {
    if (!unsafe) return '';
    return String(unsafe)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

// Clean up interval when leaving page
window.addEventListener('beforeunload', () => {
    if (messageRefreshInterval) {
        clearInterval(messageRefreshInterval);
    }
});

// End of chat.js
