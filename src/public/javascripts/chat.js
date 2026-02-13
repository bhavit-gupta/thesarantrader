// Chat functionality for course-specific chat rooms

let messageRefreshInterval;

// Load messages when page loads
document.addEventListener('DOMContentLoaded', () => {
    loadMessages();

    // Set up auto-refresh every 3 seconds
    messageRefreshInterval = setInterval(loadMessages, 3000);

    // Set up message form
    const messageForm = document.getElementById('message-form');
    if (messageForm) {
        messageForm.addEventListener('submit', sendMessage);
    }
});

// Load messages from server
async function loadMessages() {
    try {
        const response = await fetch(`/api/chat/${window.courseId}/messages`);
        const data = await response.json();

        if (data.success) {
            displayMessages(data.messages);
        }
    } catch (error) {
        console.error('Failed to load messages:', error);
    }
}

// Display messages in the chat
function displayMessages(messages) {
    const loadingEl = document.getElementById('messages-loading');
    const listEl = document.getElementById('messages-list');
    const emptyEl = document.getElementById('empty-messages');

    loadingEl.classList.add('hidden');

    if (messages.length === 0) {
        listEl.classList.add('hidden');
        emptyEl.classList.remove('hidden');
        return;
    }

    emptyEl.classList.add('hidden');
    listEl.classList.remove('hidden');

    // Clear existing messages
    listEl.innerHTML = '';

    // Add each message
    messages.forEach(msg => {
        const messageEl = createMessageElement(msg);
        listEl.appendChild(messageEl);
    });

    // Scroll to bottom
    scrollToBottom();
}

// Create message element
function createMessageElement(msg) {
    const isOwnMessage = msg.userId === window.currentUserId;

    const messageDiv = document.createElement('div');
    messageDiv.className = `flex ${isOwnMessage ? 'justify-end' : 'justify-start'}`;

    const gradients = [
        'from-blue-400 to-blue-600',
        'from-purple-400 to-purple-600',
        'from-pink-400 to-pink-600',
        'from-green-400 to-green-600',
        'from-yellow-400 to-yellow-600',
        'from-red-400 to-red-600'
    ];
    const gradientIndex = msg.userName.charCodeAt(0) % gradients.length;
    const gradient = gradients[gradientIndex];

    messageDiv.innerHTML = `
        <div class="max-w-md ${isOwnMessage ? 'ml-auto' : 'mr-auto'}">
            <div class="flex items-start gap-3 ${isOwnMessage ? 'flex-row-reverse' : ''}">
                <div class="w-10 h-10 rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center text-white font-bold flex-shrink-0">
                    ${msg.userName.charAt(0).toUpperCase()}
                </div>
                <div class="flex-1">
                    <div class="flex items-center gap-2 mb-1 ${isOwnMessage ? 'justify-end' : ''}">
                        <span class="text-sm font-bold text-slate-800">${escapeHtml(msg.userName)}</span>
                        <span class="text-xs text-slate-400">${formatTimeAgo(msg.timestamp)}</span>
                    </div>
                    <div class="px-4 py-2 rounded-lg ${isOwnMessage ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-800'}">
                        <p class="text-sm whitespace-pre-wrap">${escapeHtml(msg.message)}</p>
                    </div>
                </div>
            </div>
        </div>
    `;

    return messageDiv;
}

// Send message
async function sendMessage(e) {
    e.preventDefault();

    const input = document.getElementById('message-input');
    const message = input.value.trim();

    if (!message) return;

    try {
        const response = await fetch(`/api/chat/${window.courseId}/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ message })
        });

        const data = await response.json();

        if (data.success) {
            input.value = '';
            loadMessages(); // Reload messages immediately
            showFeedback('Message sent!', 'success');
        } else {
            showFeedback(data.message || 'Failed to send message', 'error');
        }
    } catch (error) {
        console.error('Failed to send message:', error);
        showFeedback('Failed to send message', 'error');
    }
}

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

    return new Date(timestamp).toLocaleDateString();
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
