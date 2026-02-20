// Chat functionality for course-specific chat rooms

// Chat functionality for course-specific chat rooms

let lastMessageTimestamp = 0;
let messageRefreshInterval;

/* ---------------- INITIALIZATION ---------------- */
// Load messages when page loads
loadMessages();

// Set up auto-refresh every 3 seconds
messageRefreshInterval = setInterval(loadMessages, 3000);

// Set up message form
const messageForm = document.getElementById('message-form');
if (messageForm) {
    messageForm.addEventListener('submit', sendMessage);
}

// Set up chat image preview
setupChatImagePreview();

/* ---------------- IMAGE PREVIEW ---------------- */
function setupChatImagePreview() {
    const chatImageInput = document.getElementById('chat-image');
    const previewContainer = document.getElementById('chat-image-preview-container');
    const previewImg = document.getElementById('chat-image-preview');
    const removeBtn = document.getElementById('remove-chat-image');

    if (chatImageInput) {
        chatImageInput.addEventListener('change', () => {
            const file = chatImageInput.files[0];
            if (file) {
                if (!file.type.startsWith('image/')) {
                    showFeedback('Only image files are allowed', 'error');
                    chatImageInput.value = '';
                    return;
                }
                if (file.size > 100 * 1024 * 1024) {
                    showFeedback('Image must be less than 100MB', 'error');
                    chatImageInput.value = '';
                    return;
                }

                const reader = new FileReader();
                reader.onload = (e) => {
                    previewImg.src = e.target.result;
                    previewContainer.classList.remove('hidden');
                };
                reader.readAsDataURL(file);
            }
        });
    }

    if (removeBtn) {
        removeBtn.addEventListener('click', () => {
            chatImageInput.value = '';
            previewContainer.classList.add('hidden');
            previewImg.src = '#';
        });
    }
}

/* ---------------- MESSAGE LOADING ---------------- */
// Load messages from server
// Load messages from server
async function loadMessages() {
    try {
        let url = `/api/chat/${window.courseId}/messages`;

        // Smart Polling: Only fetch messages after the last received one
        if (lastMessageTimestamp > 0) {
            url += `?after=${lastMessageTimestamp}`;
        }

        const response = await fetch(url);
        const data = await response.json();

        if (data.success) {
            if (data.messages.length > 0) {
                // Update timestamp from the latest message (last in the array)
                const latestMsg = data.messages[data.messages.length - 1];
                lastMessageTimestamp = new Date(latestMsg.timestamp).getTime();

                // Append new messages
                displayMessages(data.messages, true); // true = append
            } else if (lastMessageTimestamp === 0) {
                // First load, but no messages exist
                displayMessages([], false);
            }
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

/* ---------------- MESSAGE RENDERING ---------------- */
// Display messages in the chat
// Display messages in the chat
function displayMessages(messages, append = false) {
    const loadingEl = document.getElementById('messages-loading');
    const listEl = document.getElementById('messages-list');
    const emptyEl = document.getElementById('empty-messages');

    loadingEl.classList.add('hidden');

    // Handle "No Messages" State
    if (messages.length === 0 && !append) {
        listEl.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        return;
    }

    // If we have messages, ensure list is visible and empty state is hidden
    emptyEl.classList.add('hidden');
    listEl.classList.remove('hidden');

    // Clear existing messages ONLY if not appending (Initial Refresh)
    // Note: Since we use lastMessageTimestamp, we practically always append 
    // unless it's a hard refresh logic we haven't implemented yet.
    // But for the very first load (lastMessageTimestamp=0), we passed append=true 
    // effectively because we want to fill the list. 
    // Actually, in loadMessages:
    // If lastMessageTimestamp > 0 (polling) -> append=true
    // If lastMessageTimestamp == 0 (initial) -> append=true (it's empty accessing anyway)
    // Wait, let's keep it clean: 
    // We only clear if we specifically want to reset (e.g. manual refresh?).
    // For now, let's just NOT clear if append is true.

    // Safety check for duplicates could be added here if needed, 
    // but timestamp filtering should handle it.

    if (!append) {
        listEl.innerHTML = '';
    }

    // Add each message
    messages.forEach(msg => {
        // Prevent duplicates just in case (e.g. slight timestamp overlap)
        if (document.getElementById(`msg-${msg.id}`)) return;

        const messageEl = createMessageElement(msg);
        listEl.appendChild(messageEl);
    });

    // Scroll to bottom
    scrollToBottom();
}

// Create message element
function createMessageElement(msg) {
    if (!msg) return document.createElement('div');
    const isOwnMessage = msg.userId === window.currentUserId;
    const userName = msg.userName || 'Unknown User';

    const messageDiv = document.createElement('div');
    messageDiv.id = `msg-${msg.id || Math.random()}`; // Add ID for duplicate checking
    messageDiv.className = `flex ${isOwnMessage ? 'justify-end' : 'justify-start'} animate-fade-in-up`; // Add animation

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

    messageDiv.innerHTML = `
        <div class="max-w-md ${isOwnMessage ? 'ml-auto' : 'mr-auto'}">
            <div class="flex items-start gap-3 ${isOwnMessage ? 'flex-row-reverse' : ''}">
                <div class="w-10 h-10 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold flex-shrink-0">
                    ${userName.charAt(0).toUpperCase()}
                </div>
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1 ${isOwnMessage ? 'justify-end' : ''}">
                        <span class="text-sm font-bold text-slate-800">${escapeHtml(userName)}</span>
                        <span class="text-xs text-slate-400">${formatTimeAgo(msg.timestamp)}</span>
                    </div>
                    <div class="px-4 py-2 rounded-lg ${isOwnMessage ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}">
                        ${msg.imageUrl ? `
                            <div class="mb-2 rounded-lg overflow-hidden border border-slate-200 bg-white">
                                <img src="${msg.imageUrl}" alt="Uploaded image" class="max-w-full h-auto cursor-pointer" onclick="window.open('${msg.imageUrl}', '_blank')">
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

/* ---------------- MESSAGE SENDING ---------------- */
// Send message
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
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Clean up interval when leaving page
window.addEventListener('beforeunload', () => {
    if (messageRefreshInterval) {
        clearInterval(messageRefreshInterval);
    }
});
