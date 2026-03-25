/**
 * ============================================================================
 * FILE: admin-testimonials.js
 * PURPOSE: Admin Testimonial Management Interface
 * ============================================================================
 * 
 * DESCRIPTION:
 * Client-side JavaScript for handling testimonial approval and rejection
 * actions on the admin testimonials management page. Uses event delegation
 * for dynamic button handling and provides visual feedback via notifications.
 * 
 * KEY FEATURES:
 * - Event delegation for approve/reject buttons
 * - CSRF-protected API calls with validation
 * - Custom confirmation modal (non-blocking)
 * - Accessible toast notification system with stacking
 * - Loading states and visual processing feedback
 * - Request timeout and retry mechanism
 * - Scroll position preservation
 * - Offline detection
 * - Rejection reason support
 * 
 * API ENDPOINTS:
 * - POST /admin/testimonials/:id/approve - Approves testimonial (makes public)
 * - POST /admin/testimonials/:id/reject - Rejects testimonial with optional reason
 * 
 * DEPENDENCIES:
 * - Font Awesome icons for notification icons
 * - CSRF token in meta tag
 * 
 * ALL ISSUES FIXED - See ERROR_TRACKING.txt Section 11
 */

/* ============================================================================
   CONFIGURATION
   ============================================================================ */

//  Configurable constants (no magic numbers)
const CONFIG = {
    RELOAD_DELAY_MS: 1000,              // Delay before page reload after action
    NOTIFICATION_DURATION_MS: 4000,     // How long notification shows  
    ANIMATION_DURATION_MS: 300,         // CSS animation duration
    REQUEST_TIMEOUT_MS: 10000,          // API request timeout
    MAX_RETRIES: 2,                     // Number of retry attempts
    RETRY_DELAY_MS: 1000,               // Delay between retries
    DEBOUNCE_MS: 300,                   // Click debounce delay
    NOTIFICATION_STACK_OFFSET: 80,      // Pixels between stacked notifications
    ID_PATTERN: /^[a-zA-Z0-9_-]+$/      // Valid testimonial ID pattern
};

//  Configurable API endpoints
const API_BASE = window.location.origin;
const ENDPOINTS = {
    approve: (id) => `${API_BASE}/admin/testimonials/${id}/approve`,
    reject: (id) => `${API_BASE}/admin/testimonials/${id}/reject`,
    feature: (id) => `${API_BASE}/admin/testimonials/${id}/feature`
};

/* ============================================================================
   UTILITY FUNCTIONS
   ============================================================================ */

//  Conditional logger (only logs in development)
const DEBUG = window.location.hostname === 'localhost' ||
    window.location.search.includes('debug=true');

const logger = {
    log: (...args) => DEBUG && console.log('[Admin]', ...args),
    error: (...args) => console.error('[Admin]', ...args),
    warn: (...args) => DEBUG && console.warn('[Admin]', ...args)
};

//  Centralized CSRF token retrieval with validation
function getCsrfToken() {
    const token = document.querySelector('meta[name="csrf-token"]')?.content;
    if (!token || token.trim() === '') {
        logger.error('CSRF token missing from page');
        return null;
    }
    return token.trim();
}

//  Validate testimonial ID
function validateId(id) {
    if (!id || typeof id !== 'string') {
        return { valid: false, error: 'Invalid testimonial ID' };
    }
    const trimmedId = id.trim();
    if (trimmedId === '') {
        return { valid: false, error: 'Testimonial ID is empty' };
    }
    if (!CONFIG.ID_PATTERN.test(trimmedId)) {
        return { valid: false, error: 'Invalid testimonial ID format' };
    }
    return { valid: true, id: trimmedId };
}

//  Debounce utility
function debounce(func, wait) {
    let timeout;
    return function (...args) {
        clearTimeout(timeout);
        timeout = setTimeout(() => func.apply(this, args), wait);
    };
}

/* ============================================================================
   NOTIFICATION SYSTEM
   ============================================================================ */

//  Track active notifications for stacking
let notificationStack = [];
let activeTimeouts = [];

/**
 * Shows a toast notification in the top-right corner
 *  XSS-safe using textContent instead of innerHTML
 *  Accessible with ARIA attributes
 *  Stacked notifications
 *  Timeout cleanup on navigation
 * 
 * @param {string} message - Text to display
 * @param {'success'|'error'} type - Notification type
 * @param {Function} [onUndo] - Optional undo callback 
 */
function showNotification(message, type, onUndo = null) {
    const notification = document.createElement('div');

    //  Calculate stack position
    const stackOffset = notificationStack.length * CONFIG.NOTIFICATION_STACK_OFFSET;

    //  ARIA attributes for accessibility
    notification.setAttribute('role', 'alert');
    notification.setAttribute('aria-live', 'assertive');
    notification.setAttribute('aria-atomic', 'true');
    notification.setAttribute('tabindex', '0');

    notification.className = `fixed right-4 px-6 py-4 rounded-xl shadow-lg z-50 flex items-center gap-3 animate-slide-in ${type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`;
    notification.style.top = `${96 + stackOffset}px`;
    notification.style.transition = `all ${CONFIG.ANIMATION_DURATION_MS}ms ease-out`;

    //  XSS-safe: Use createElement and textContent
    const icon = document.createElement('i');
    icon.className = `fa-solid ${type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'}`;

    const messageSpan = document.createElement('span');
    messageSpan.className = 'font-semibold';
    messageSpan.textContent = message; // Safe - no HTML parsing

    notification.appendChild(icon);
    notification.appendChild(messageSpan);

    //  Undo button if callback provided
    if (onUndo && typeof onUndo === 'function') {
        const undoBtn = document.createElement('button');
        undoBtn.className = 'ml-3 underline hover:no-underline focus:outline-none focus:ring-2 focus:ring-white';
        undoBtn.textContent = 'Undo';
        undoBtn.setAttribute('aria-label', 'Undo this action');
        undoBtn.onclick = () => {
            notification.remove();
            removeFromStack(notification);
            onUndo();
        };
        notification.appendChild(undoBtn);
    }

    //  Close button for accessibility
    const closeBtn = document.createElement('button');
    closeBtn.className = 'ml-2 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-white';
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    closeBtn.setAttribute('aria-label', 'Close notification');
    closeBtn.onclick = () => {
        dismissNotification(notification);
    };
    notification.appendChild(closeBtn);

    document.body.appendChild(notification);
    notificationStack.push(notification);

    // Focus for screen readers
    notification.focus();

    // Auto-dismiss
    const timeoutId = setTimeout(() => {
        dismissNotification(notification);
    }, CONFIG.NOTIFICATION_DURATION_MS);

    activeTimeouts.push(timeoutId);
}

function dismissNotification(notification) {
    notification.style.opacity = '0';
    notification.style.transform = 'translateX(100%)';

    const removeTimeout = setTimeout(() => {
        notification.remove();
        removeFromStack(notification);
        repositionNotifications();
    }, CONFIG.ANIMATION_DURATION_MS);

    activeTimeouts.push(removeTimeout);
}

function removeFromStack(notification) {
    notificationStack = notificationStack.filter(n => n !== notification);
}

function repositionNotifications() {
    notificationStack.forEach((n, i) => {
        n.style.top = `${96 + (i * CONFIG.NOTIFICATION_STACK_OFFSET)}px`;
    });
}

//  Clear timeouts before navigation
window.addEventListener('beforeunload', () => {
    activeTimeouts.forEach(clearTimeout);
    activeTimeouts = [];
});

/* ============================================================================
   CUSTOM CONFIRMATION MODAL
   ============================================================================ */

/**
 *  Non-blocking custom confirmation modal
 *  Descriptive confirmation text
 *  Optional reason input for rejections
 * 
 * @param {Object} options - Modal options
 * @param {string} options.title - Modal title
 * @param {string} options.message - Confirmation message
 * @param {string} options.confirmText - Confirm button text
 * @param {string} options.cancelText - Cancel button text
 * @param {boolean} [options.showReasonInput] - Show reason textarea
 * @param {string} [options.reasonPlaceholder] - Placeholder for reason input
 * @returns {Promise<{confirmed: boolean, reason?: string}>}
 */
function showConfirmModal(options) {
    return new Promise((resolve) => {
        const {
            title = 'Confirm Action',
            message = 'Are you sure?',
            confirmText = 'Confirm',
            cancelText = 'Cancel',
            showReasonInput = false,
            reasonPlaceholder = 'Enter reason (optional)...'
        } = options;

        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'modal-title');

        //  XSS-safe modal content
        const modalContent = document.createElement('div');
        modalContent.className = 'bg-white rounded-lg p-6 max-w-md shadow-xl mx-4';

        const titleEl = document.createElement('h3');
        titleEl.id = 'modal-title';
        titleEl.className = 'text-lg font-semibold mb-4';
        titleEl.textContent = title;

        const messageEl = document.createElement('p');
        messageEl.className = 'text-gray-600 mb-4';
        messageEl.textContent = message;

        modalContent.appendChild(titleEl);
        modalContent.appendChild(messageEl);

        //  Optional reason input
        let reasonInput = null;
        if (showReasonInput) {
            reasonInput = document.createElement('textarea');
            reasonInput.className = 'w-full border rounded-lg p-3 mb-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500';
            reasonInput.placeholder = reasonPlaceholder;
            reasonInput.rows = 3;
            reasonInput.setAttribute('aria-label', 'Rejection reason');
            modalContent.appendChild(reasonInput);
        }

        const buttonContainer = document.createElement('div');
        buttonContainer.className = 'flex gap-3 justify-end';

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'px-4 py-2 bg-gray-300 rounded hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-500';
        cancelBtn.textContent = cancelText;

        const confirmBtn = document.createElement('button');
        confirmBtn.className = 'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500';
        confirmBtn.textContent = confirmText;

        buttonContainer.appendChild(cancelBtn);
        buttonContainer.appendChild(confirmBtn);
        modalContent.appendChild(buttonContainer);
        modal.appendChild(modalContent);

        // Event handlers
        const cleanup = () => modal.remove();

        confirmBtn.onclick = () => {
            cleanup();
            resolve({
                confirmed: true,
                reason: reasonInput ? reasonInput.value.trim() : undefined
            });
        };

        cancelBtn.onclick = () => {
            cleanup();
            resolve({ confirmed: false });
        };

        // Close on backdrop click
        modal.onclick = (e) => {
            if (e.target === modal) {
                cleanup();
                resolve({ confirmed: false });
            }
        };

        // Close on Escape key
        const handleKeydown = (e) => {
            if (e.key === 'Escape') {
                cleanup();
                document.removeEventListener('keydown', handleKeydown);
                resolve({ confirmed: false });
            }
        };
        document.addEventListener('keydown', handleKeydown);

        document.body.appendChild(modal);

        // Focus confirm button or reason input
        if (reasonInput) {
            reasonInput.focus();
        } else {
            confirmBtn.focus();
        }
    });
}

/* ============================================================================
   API REQUEST HANDLER
   ============================================================================ */

/**
 *  Request with timeout
 *  Retry mechanism
 *  Safe JSON parsing
 *  HTTP status validation
 *  Network error differentiation
 * 
 * @param {string} url - API endpoint
 * @param {Object} options - Fetch options
 * @param {number} [retries] - Retry attempts remaining
 * @returns {Promise<{success: boolean, data?: any, error?: string}>}
 */
async function apiRequest(url, options, retries = CONFIG.MAX_RETRIES) {
    //  Check online status
    if (!navigator.onLine) {
        return { success: false, error: 'You are offline. Please check your connection.' };
    }

    //  Validate CSRF token
    const csrfToken = getCsrfToken();
    if (!csrfToken) {
        return { success: false, error: 'Security token missing. Please refresh the page.' };
    }

    //  Create abort controller for timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

    try {
        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'X-CSRF-Token': csrfToken,
                ...options.headers
            },
            signal: controller.signal
        });

        clearTimeout(timeoutId);

        //  HTTP status validation
        if (!response.ok) {
            if (response.status === 401) {
                return { success: false, error: 'Session expired. Please log in again.', redirect: '/login' };
            } else if (response.status === 403) {
                return { success: false, error: 'Access denied. You may not have permission.' };
            } else if (response.status === 404) {
                return { success: false, error: 'Testimonial not found.' };
            } else if (response.status >= 500) {
                throw new Error(`Server error: ${response.status}`);
            } else {
                return { success: false, error: `Request failed (${response.status})` };
            }
        }

        //  Check content type before parsing
        const contentType = response.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            return { success: false, error: 'Invalid server response.' };
        }

        const data = await response.json();
        return { success: true, data };

    } catch (error) {
        clearTimeout(timeoutId);

        //  Network error differentiation
        if (error.name === 'AbortError') {
            if (retries > 0) {
                logger.log(`Request timeout, retrying... (${retries} left)`);
                await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY_MS));
                return apiRequest(url, options, retries - 1);
            }
            return { success: false, error: 'Request timed out. Please try again.' };
        }

        if (error instanceof TypeError && error.message.includes('fetch')) {
            return { success: false, error: 'Network error. Please check your connection.' };
        }

        if (error instanceof SyntaxError) {
            return { success: false, error: 'Invalid server response.' };
        }

        //  Retry on server errors
        if (retries > 0 && error.message?.includes('Server error')) {
            logger.log(`Server error, retrying... (${retries} left)`);
            await new Promise(r => setTimeout(r, CONFIG.RETRY_DELAY_MS));
            return apiRequest(url, options, retries - 1);
        }

        logger.error('API request failed:', error);
        return { success: false, error: 'An unexpected error occurred.' };
    }
}

/* ============================================================================
   VISUAL FEEDBACK HELPERS
   ============================================================================ */

/**
 *  Set button loading state
 *  Visual indication of processing row
 */
function setProcessingState(id, action, isProcessing) {
    const button = document.querySelector(`[data-id="${id}"].${action}-btn`);
    const row = button?.closest('tr') || button?.closest('[data-testimonial-id]');

    if (isProcessing) {
        if (button) {
            button.disabled = true;
            button.dataset.originalHtml = button.innerHTML;
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Processing...';
        }
        if (row) {
            row.classList.add('opacity-50', 'pointer-events-none');
        }
    } else {
        if (button) {
            button.disabled = false;
            button.innerHTML = button.dataset.originalHtml || button.innerHTML;
        }
        if (row) {
            row.classList.remove('opacity-50', 'pointer-events-none');
        }
    }
}

/**
 *  Remove row with animation (preserves scroll)
 */
function removeRow(id, successColor = 'bg-green-100') {
    const button = document.querySelector(`[data-id="${id}"]`);
    const row = button?.closest('tr') || button?.closest('[data-testimonial-id]');

    if (row) {
        row.classList.add(successColor);
        row.style.transition = `all ${CONFIG.ANIMATION_DURATION_MS}ms ease-out`;

        setTimeout(() => {
            row.style.opacity = '0';
            row.style.transform = 'translateX(-100%)';

            setTimeout(() => {
                row.remove();

                // Check if table is now empty
                const tbody = document.querySelector('table tbody');
                if (tbody && tbody.children.length === 0) {
                    const emptyMessage = document.createElement('div');
                    emptyMessage.className = 'text-center py-8 text-gray-500 w-full col-span-full';
                    emptyMessage.textContent = 'No testimonials in this section';
                    tbody.appendChild(emptyMessage);
                }
            }, CONFIG.ANIMATION_DURATION_MS);
        }, 500);
    }
}

/* ============================================================================
   ACTION HANDLERS
   ============================================================================ */

/**
 *  Get testimonial details from DOM for confirmation
 */
function getTestimonialDetails(id) {
    const button = document.querySelector(`[data-id="${id}"]`);
    const row = button?.closest('tr') || button?.closest('[data-testimonial-id]');

    if (!row) return { userName: 'Unknown', messagePreview: '' };

    const userName = row.querySelector('[data-user-name]')?.textContent?.trim() ||
        row.querySelector('td:first-child')?.textContent?.trim() ||
        'this user';

    const messagePreview = row.querySelector('[data-message]')?.textContent?.trim() ||
        row.querySelector('td:nth-child(2)')?.textContent?.trim() ||
        '';

    return { userName, messagePreview };
}

/**
 * Handles approving a testimonial
 * Addresses:         
 */
async function handleApprove(id) {
    //  Validate ID
    const validation = validateId(id);
    if (!validation.valid) {
        showNotification(validation.error, 'error');
        return;
    }
    const validId = validation.id;

    //  Get details for descriptive confirmation
    const { userName, messagePreview } = getTestimonialDetails(validId);
    const confirmMessage = messagePreview
        ? `This will publish the testimonial on the homepage:\n\n"${messagePreview.substring(0, 100)}${messagePreview.length > 100 ? '...' : ''}"`
        : 'This will publish the testimonial on the homepage.';

    //  Non-blocking confirmation modal
    const result = await showConfirmModal({
        title: `Approve Testimonial from ${userName}?`,
        message: confirmMessage,
        confirmText: 'Approve',
        cancelText: 'Cancel'
    });

    if (!result.confirmed) {
        logger.log('Approval cancelled by user');
        return;
    }

    //   Set loading state
    setProcessingState(validId, 'approve', true);

    try {
        //  POST with body
        const { success, data, error, redirect } = await apiRequest(ENDPOINTS.approve(validId), {
            method: 'POST',
            body: JSON.stringify({ timestamp: Date.now(), source: 'admin_panel' })
        });

        if (redirect) {
            setTimeout(() => window.location.href = redirect, 2000);
        }

        if (!success) {
            setProcessingState(validId, 'approve', false);
            showNotification(error, 'error');
            return;
        }

        if (data.success) {
            //  Track action (if analytics available)
            trackAction('testimonial_approved', validId);

            //  Descriptive success message
            showNotification('Testimonial approved and published!', 'success');

            //  Remove row without full page reload
            removeRow(validId, 'bg-green-100');
        } else {
            setProcessingState(validId, 'approve', false);
            showNotification(data.message || 'Failed to approve testimonial', 'error');
        }

    } catch (error) {
        logger.error('Error approving testimonial:', error);
        setProcessingState(validId, 'approve', false);
        showNotification('Failed to approve testimonial. Please try again.', 'error');
    }
}

/**
 * Handles rejecting a testimonial
 * Addresses:          
 */
async function handleReject(id) {
    //  Validate ID
    const validation = validateId(id);
    if (!validation.valid) {
        showNotification(validation.error, 'error');
        return;
    }
    const validId = validation.id;

    //  Get details for descriptive confirmation
    const { userName } = getTestimonialDetails(validId);

    //   Non-blocking confirmation with reason input
    const result = await showConfirmModal({
        title: `Reject Testimonial from ${userName}?`,
        message: 'This will hide the testimonial from public view.',
        confirmText: 'Reject',
        cancelText: 'Cancel',
        showReasonInput: true,
        reasonPlaceholder: 'Reason for rejection (optional, for your records)...'
    });

    if (!result.confirmed) {
        logger.log('Rejection cancelled by user');
        return;
    }

    //   Set loading state
    setProcessingState(validId, 'reject', true);

    try {
        //   POST with body including reason
        const { success, data, error, redirect } = await apiRequest(ENDPOINTS.reject(validId), {
            method: 'POST',
            body: JSON.stringify({
                timestamp: Date.now(),
                source: 'admin_panel',
                reason: result.reason || null
            })
        });

        if (redirect) {
            setTimeout(() => window.location.href = redirect, 2000);
        }

        if (!success) {
            setProcessingState(validId, 'reject', false);
            showNotification(error, 'error');
            return;
        }

        if (data.success) {
            //  Track action
            trackAction('testimonial_rejected', validId);

            //  Descriptive success message
            showNotification('Testimonial rejected and hidden.', 'success');

            //  Remove row without full page reload
            removeRow(validId, 'bg-red-100');
        } else {
            setProcessingState(validId, 'reject', false);
            showNotification(data.message || 'Failed to reject testimonial', 'error');
        }

    } catch (error) {
        logger.error('Error rejecting testimonial:', error);
        setProcessingState(validId, 'reject', false);
        showNotification('Failed to reject testimonial. Please try again.', 'error');
    }
}

/**
 * Handles toggling featured status
 */
async function handleFeatureToggle(id) {
    const validation = validateId(id);
    if (!validation.valid) {
        showNotification(validation.error, 'error');
        return;
    }
    const validId = validation.id;

    setProcessingState(validId, 'feature', true);

    try {
        const { success, data, error, redirect } = await apiRequest(ENDPOINTS.feature(validId), {
            method: 'PATCH',
            body: JSON.stringify({ timestamp: Date.now() })
        });

        if (redirect) {
            setTimeout(() => window.location.href = redirect, 2000);
        }

        if (!success) {
            setProcessingState(validId, 'feature', false);
            showNotification(error, 'error');
            return;
        }

        if (data.success) {
            showNotification(data.message, 'success');
            // Save scroll position
            sessionStorage.setItem('adminScrollPosition', window.scrollY.toString());
            // Reload to reflect changes
            setTimeout(() => window.location.reload(), CONFIG.RELOAD_DELAY_MS);
        } else {
            setProcessingState(validId, 'feature', false);
            showNotification(data.message || 'Failed to toggle featured status', 'error');
        }
    } catch (error) {
        logger.error('Error toggling featured status:', error);
        setProcessingState(validId, 'feature', false);
        showNotification('Failed to toggle featured status. Please try again.', 'error');
    }
}

/* ============================================================================
   ANALYTICS / AUDIT
   ============================================================================ */

/**
 *  Track admin actions for audit
 */
function trackAction(action, resourceId) {
    // Google Analytics (if available)
    if (typeof gtag === 'function') {
        gtag('event', action, {
            event_category: 'Admin',
            event_label: 'Testimonial Management',
            value: resourceId
        });
    }

    logger.log(`Action tracked: ${action} for ${resourceId}`);
}

/* ============================================================================
   INITIALIZATION
   ============================================================================ */

//  Wrap in error boundary
(function initAdminTestimonials() {
    try {
        logger.log('admin-testimonials.js loaded');

        //  Browser compatibility check
        const requiredFeatures = {
            fetch: typeof fetch !== 'undefined',
            Promise: typeof Promise !== 'undefined',
            AbortController: typeof AbortController !== 'undefined'
        };

        const unsupported = Object.entries(requiredFeatures)
            .filter(([, supported]) => !supported)
            .map(([name]) => name);

        if (unsupported.length > 0) {
            logger.error('Unsupported browser features:', unsupported);
            alert("Your browser doesn't support required features. Please upgrade your browser.");
            return;
        }

        // Wait for DOM
        document.addEventListener('DOMContentLoaded', () => {
            logger.log('Testimonial event listeners initializing');

            //  Restore scroll position if saved
            const scrollPos = sessionStorage.getItem('adminScrollPosition');
            if (scrollPos) {
                window.scrollTo(0, parseInt(scrollPos));
                sessionStorage.removeItem('adminScrollPosition');
            }

            //  Debounced click handler
            const handleClick = debounce(async (e) => {
                const approveBtn = e.target.closest('.approve-btn');
                const rejectBtn = e.target.closest('.reject-btn');
                const featureBtn = e.target.closest('.feature-btn');

                if (approveBtn) {
                    const id = approveBtn.getAttribute('data-id');
                    await handleApprove(id);
                } else if (rejectBtn) {
                    const id = rejectBtn.getAttribute('data-id');
                    await handleReject(id);
                } else if (featureBtn) {
                    const id = featureBtn.getAttribute('data-id');
                    await handleFeatureToggle(id);
                }
            }, CONFIG.DEBOUNCE_MS);

            document.addEventListener('click', handleClick);
        });

        //  Online/offline detection
        window.addEventListener('offline', () => {
            showNotification('You are now offline.', 'error');
        });

        window.addEventListener('online', () => {
            showNotification('You are back online.', 'success');
        });

        //  Handle unhandled promise rejections
        window.addEventListener('unhandledrejection', (event) => {
            logger.error('Unhandled promise rejection:', event.reason);
        });

    } catch (error) {
        console.error('[Admin Testimonials] Critical initialization error:', error);

        // Show user-friendly error
        document.addEventListener('DOMContentLoaded', () => {
            const errorDiv = document.createElement('div');
            errorDiv.className = 'fixed top-4 right-4 bg-red-600 text-white p-4 rounded-lg shadow-lg z-50';
            errorDiv.textContent = 'Admin panel error. Please refresh the page.';
            document.body.appendChild(errorDiv);
        });
    }
})();

/* ============================================================================
   CSS ANIMATIONS
   ============================================================================ */

//  CSP-safe style injection with nonce support
(function injectStyles() {
    const style = document.createElement('style');

    // Check for CSP nonce
    const nonce = document.querySelector('meta[name="csp-nonce"]')?.content;
    if (nonce) {
        style.setAttribute('nonce', nonce);
    }

    style.textContent = `
        @keyframes slide-in {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        .animate-slide-in {
            animation: slide-in ${CONFIG.ANIMATION_DURATION_MS}ms ease-out;
        }
    `;

    document.head.appendChild(style);
})();
