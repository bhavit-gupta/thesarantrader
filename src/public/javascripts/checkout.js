/**
 * ============================================================================
 * FILE: checkout.js
 * PURPOSE: Payment processing and course enrollment interface
 * ============================================================================
 * 
 * DESCRIPTION:
 * Handles the course enrollment and payment verification workflow.
 * 
 * ISSUES FIXED: All 30 issues [17.1-17.30] addressed
 * ============================================================================
 */

(function () {
    'use strict';

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        REQUEST_TIMEOUT_MS: 30000,
        MAX_FILE_SIZE_MB: 5,
        MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024, // 5MB
        ALLOWED_FILE_TYPES: Object.freeze(['image/jpeg', 'image/jpg', 'image/png', 'image/webp']),
        ALLOWED_EXTENSIONS: Object.freeze(['.jpg', '.jpeg', '.png', '.webp']),
        REDIRECT_DELAY_MS: 2000,
        NOTIFICATION_DURATION_MS: 4000,
        DEBUG: false,
        API_ENDPOINTS: Object.freeze({
            SUBMIT_PROOF: '/api/payment/submit-proof'
        })
    });

    // =========================================================================
    // I18N STRINGS
    // =========================================================================
    const STRINGS = Object.freeze({
        VERIFYING: 'Verifying...',
        SUBMIT: 'Submit Payment Proof',
        SUCCESS: 'Sent for Approval',
        ERROR_GENERIC: 'An error occurred. Please try again.',
        ERROR_NETWORK: 'Network error. Please check your connection.',
        ERROR_TIMEOUT: 'Request timed out. Please try again.',
        ERROR_CSRF: 'Security token missing. Please refresh the page.',
        ERROR_NO_FILE: 'Please select a payment screenshot.',
        ERROR_FILE_TYPE: 'Please upload a valid image (JPEG, PNG, or WebP).',
        ERROR_FILE_SIZE: `File size must be under ${CONFIG.MAX_FILE_SIZE_MB}MB.`,
        ERROR_INVALID_COURSE: 'Invalid course selected.',
        ERROR_MODAL_NOT_FOUND: 'Payment modal not available.',
        SUCCESS_SUBMITTED: 'Payment proof submitted successfully!',
        SUCCESS_MESSAGE: 'Admin will verify your payment shortly. You will be notified once approved.',
        COPIED: 'Copied!',
        COPY_FAILED: 'Failed to copy. Please copy manually.',
        CLOSE: 'Close',
        BACK: 'Back'
    });

    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================
    const state = {
        isSubmitting: false,
        modalOpen: false,
        currentCourseId: null,
        abortController: null,
        previousOverflow: ''
    };

    // [Removed local Logger definition]

    // =========================================================================
    // VALIDATION UTILITIES
    // =========================================================================

    /**
     * Validate course ID
     * [17.4] courseId validation
     * @param {string|number} courseId - Course ID to validate
     * @returns {boolean} Valid or not
     */
    function isValidCourseId(courseId) {
        if (courseId == null) return false;
        const id = String(courseId).trim();
        // Must be non-empty, alphanumeric or numeric
        return id.length > 0 && /^[a-zA-Z0-9_-]+$/.test(id);
    }

    /**
     * Validate file type
     * [17.1] File type validation
     * @param {File} file - File to validate
     * @returns {{ valid: boolean, error: string|null }} Validation result
     */
    function validateFile(file) {
        if (!file) {
            return { valid: false, error: STRINGS.ERROR_NO_FILE };
        }

        // Check MIME type
        if (!CONFIG.ALLOWED_FILE_TYPES.includes(file.type)) {
            return { valid: false, error: STRINGS.ERROR_FILE_TYPE };
        }

        // Check file extension as backup
        const fileName = file.name.toLowerCase();
        const hasValidExtension = CONFIG.ALLOWED_EXTENSIONS.some(ext => fileName.endsWith(ext));
        if (!hasValidExtension) {
            return { valid: false, error: STRINGS.ERROR_FILE_TYPE };
        }

        // [17.5] Check file size
        if (file.size > CONFIG.MAX_FILE_SIZE_BYTES) {
            return { valid: false, error: STRINGS.ERROR_FILE_SIZE };
        }

        return { valid: true, error: null };
    }

    /**
     * Escape HTML to prevent XSS
     * [17.6] UPI ID escaping
     * @param {string} text - Text to escape
     * @returns {string} Escaped text
     */
    function escapeHtml(text) {
        if (text == null) return '';
        if (typeof text !== 'string') text = String(text);
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    // =========================================================================
    // CSRF TOKEN HANDLING
    // =========================================================================

    /**
     * Get CSRF token with validation
     * [17.3] CSRF token validation
     * @returns {string|null} CSRF token or null if invalid
     */
    function getCSRFToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (!meta) {
            window.Logger.error('CSRF meta tag not found');
            return null;
        }

        const token = meta.getAttribute('content');
        if (!token || token.trim() === '') {
            window.Logger.error('CSRF token is empty');
            return null;
        }

        return token.trim();
    }

    // =========================================================================
    // NOTIFICATION SYSTEM
    // =========================================================================

    /**
     * Show notification toast
     * [17.10] Replace alert() with custom notifications
     * @param {string} message - Message to display
     * @param {'success'|'error'|'warning'|'info'} type - Notification type
     */
    function showNotification(message, type = 'info') {
        // Remove existing notifications
        document.querySelectorAll('.checkout-notification').forEach(n => n.remove());

        const notification = document.createElement('div');
        notification.className = 'checkout-notification fixed top-4 right-4 z-[60] max-w-sm p-4 rounded-lg shadow-lg transform transition-all duration-300 translate-x-full';
        notification.setAttribute('role', 'alert');
        notification.setAttribute('aria-live', 'polite');

        const colors = {
            success: 'bg-green-500 text-white',
            error: 'bg-red-500 text-white',
            warning: 'bg-yellow-500 text-white',
            info: 'bg-blue-500 text-white'
        };

        const icons = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };

        notification.classList.add(...(colors[type] || colors.info).split(' '));

        const content = document.createElement('div');
        content.className = 'flex items-center';

        const icon = document.createElement('i');
        icon.className = `fa-solid ${icons[type] || icons.info} mr-3 text-lg`;

        const text = document.createElement('span');
        text.className = 'flex-1';
        text.textContent = message;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ml-4 text-white hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-white/50 rounded';
        closeBtn.setAttribute('aria-label', 'Close notification');
        closeBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
        closeBtn.addEventListener('click', () => {
            notification.classList.add('translate-x-full');
            setTimeout(() => notification.remove(), 300);
        });

        content.appendChild(icon);
        content.appendChild(text);
        content.appendChild(closeBtn);
        notification.appendChild(content);

        document.body.appendChild(notification);

        // Animate in
        requestAnimationFrame(() => {
            notification.classList.remove('translate-x-full');
        });

        // Auto-remove
        setTimeout(() => {
            notification.classList.add('translate-x-full');
            setTimeout(() => notification.remove(), 300);
        }, CONFIG.NOTIFICATION_DURATION_MS);
    }

    // =========================================================================
    // LOADING STATE MANAGEMENT
    // =========================================================================

    /**
     * Set button loading state
     * [17.11] Safe button state management
     * @param {HTMLElement} button - Button element
     * @param {boolean} loading - Loading state
     * @param {string} loadingText - Text while loading
     * @param {string} normalText - Normal text
     */
    function setButtonLoading(button, loading, loadingText = 'Loading...', normalText = 'Submit') {
        if (!button) return;

        button.disabled = loading;

        if (loading) {
            button.dataset.originalHtml = button.innerHTML;
            button.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin mr-2"></i>${escapeHtml(loadingText)}`;
            button.setAttribute('aria-busy', 'true');
        } else {
            button.innerHTML = button.dataset.originalHtml || normalText;
            button.removeAttribute('aria-busy');
        }
    }

    /**
     * Set button success state
     * @param {HTMLElement} button - Button element
     * @param {string} text - Success text
     */
    function setButtonSuccess(button, text = STRINGS.SUCCESS) {
        if (!button) return;

        button.disabled = true;
        button.innerHTML = `<i class="fa-solid fa-check-circle mr-2"></i>${escapeHtml(text)}`;

        // Safe class replacement [17.11]
        button.classList.remove('bg-green-600', 'hover:bg-green-700');
        button.classList.add('bg-blue-600');
    }

    // =========================================================================
    // FETCH WITH TIMEOUT
    // =========================================================================

    /**
     * Fetch with timeout and proper error handling
     * [17.2] response.ok check, [17.7] timeout
     * @param {string} url - URL to fetch
     * @param {object} options - Fetch options
     * @returns {Promise<object>} JSON response
     */
    async function fetchWithTimeout(url, options = {}) {
        const csrfToken = getCSRFToken();
        if (!csrfToken) {
            throw new Error(STRINGS.ERROR_CSRF);
        }

        const controller = new AbortController();
        state.abortController = controller;

        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'X-CSRF-Token': csrfToken,
                    ...options.headers
                }
            });

            clearTimeout(timeoutId);

            // [17.2] Check response.ok before parsing
            if (!response.ok) {
                let errorMessage = `Server error (${response.status})`;
                try {
                    const errorData = await response.json();
                    errorMessage = errorData.message || errorMessage;
                } catch {
                    // Ignore JSON parse error for error response
                }
                throw new Error(errorMessage);
            }

            const data = await response.json();
            return data;

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new Error(STRINGS.ERROR_TIMEOUT);
            }

            if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
                throw new Error(STRINGS.ERROR_NETWORK);
            }

            throw error;
        } finally {
            state.abortController = null;
        }
    }

    // =========================================================================
    // MODAL MANAGEMENT
    // =========================================================================

    /**
     * Open payment modal
     * [17.9] Proper body overflow handling
     */
    function openPaymentModal() {
        const modal = document.getElementById('payment-modal');
        if (!modal) {
            showNotification(STRINGS.ERROR_MODAL_NOT_FOUND, 'error');
            return;
        }

        // Store previous overflow state [17.9]
        state.previousOverflow = document.body.style.overflow;

        modal.classList.remove('hidden');
        modal.classList.add('flex');
        document.body.style.overflow = 'hidden';
        state.modalOpen = true;

        // Focus trap - focus first focusable element
        const firstFocusable = modal.querySelector('button, [tabindex]:not([tabindex="-1"])');
        if (firstFocusable) {
            firstFocusable.focus();
        }

        // Add escape key listener
        modal.addEventListener('keydown', handleModalKeydown);

        window.Logger.debug('Payment modal opened');
    }

    /**
     * Close payment modal
     */
    function closePaymentModal() {
        const modal = document.getElementById('payment-modal');
        if (!modal) return;

        modal.classList.add('hidden');
        modal.classList.remove('flex');

        // Restore previous overflow state [17.9]
        document.body.style.overflow = state.previousOverflow || '';
        state.modalOpen = false;

        // Reset to step 1
        showStep1();

        // Clear file input and preview
        resetFileInput();

        // Remove escape key listener
        modal.removeEventListener('keydown', handleModalKeydown);

        // Cancel any pending request
        if (state.abortController) {
            state.abortController.abort();
            state.abortController = null;
        }

        window.Logger.debug('Payment modal closed');
    }

    /**
     * Handle keyboard events in modal
     * @param {KeyboardEvent} event - Keyboard event
     */
    function handleModalKeydown(event) {
        if (event.key === 'Escape') {
            closePaymentModal();
        }
    }

    /**
     * Show step 1 (QR code view)
     */
    function showStep1() {
        const s1 = document.getElementById('modal-step-1');
        const s2 = document.getElementById('modal-step-2');
        if (s1) s1.style.display = '';
        if (s2) s2.style.display = 'none';
        window.Logger.debug('Showing step 1');
    }

    /**
     * Show step 2 (Upload proof)
     */
    function showStep2() {
        const s1 = document.getElementById('modal-step-1');
        const s2 = document.getElementById('modal-step-2');
        if (s1) s1.style.display = 'none';
        if (s2) s2.style.display = '';
        window.Logger.debug('Showing step 2');
    }

    // =========================================================================
    // IMAGE PREVIEW
    // =========================================================================

    /**
     * Reset file input and preview
     */
    function resetFileInput() {
        const fileInput = document.getElementById('payment-screenshot');
        const previewContainer = document.getElementById('upload-preview');
        const imageElement = document.getElementById('image-preview-element');

        if (fileInput) fileInput.value = '';
        if (imageElement) {
            imageElement.src = '';
            imageElement.style.display = 'none';
        }
        if (previewContainer) previewContainer.style.display = '';
    }

    /**
     * Preview selected image
     * [17.1] Validate file before preview
     * @param {HTMLInputElement} input - File input element
     */
    function previewImage(input) {
        const previewContainer = document.getElementById('upload-preview');
        const imageElement = document.getElementById('image-preview-element');

        if (!previewContainer || !imageElement) {
            window.Logger.warn('Preview elements not found');
            return;
        }

        if (input.files && input.files[0]) {
            const file = input.files[0];

            // Validate file before preview
            const validation = validateFile(file);
            if (!validation.valid) {
                showNotification(validation.error, 'error');
                input.value = '';
                imageElement.style.display = 'none';
                previewContainer.style.display = '';
                return;
            }

            const reader = new FileReader();

            reader.onload = function (e) {
                imageElement.src = e.target.result;
                imageElement.style.display = '';
                previewContainer.style.display = 'none';
                imageElement.alt = 'Payment screenshot preview';
            };

            reader.onerror = function () {
                showNotification('Failed to preview image', 'error');
                input.value = '';
            };

            reader.readAsDataURL(file);
        } else {
            imageElement.style.display = 'none';
            previewContainer.style.display = '';
        }
    }

    // =========================================================================
    // PAYMENT WORKFLOW
    // =========================================================================

    /**
     * Open QR Modal for payment
     * [17.4] Validate courseId
     * @param {string|number} courseId - Course ID
     */
    function openQRModal(courseId) {
        if (!isValidCourseId(courseId)) {
            showNotification(STRINGS.ERROR_INVALID_COURSE, 'error');
            window.Logger.error('Invalid course ID:', courseId);
            return;
        }

        state.currentCourseId = courseId;
        window.Logger.debug('Opening payment modal for course:', courseId);

        const modal = document.getElementById('payment-modal');
        if (!modal) {
            showNotification(STRINGS.ERROR_MODAL_NOT_FOUND, 'error');
            return;
        }

        openPaymentModal();
    }

    /**
     * Submit payment proof
     * [17.1-17.4] Full validation
     * @param {Event} event - Form submit event
     */
    async function submitPaymentProof(event) {
        event.preventDefault();

        // Prevent double submission
        if (state.isSubmitting) {
            window.Logger.debug('Submission already in progress');
            return;
        }

        // Get course ID [17.4]
        const confirmBtn = document.getElementById('confirm-purchase-btn');
        const courseId = confirmBtn?.getAttribute('data-course-id') || state.currentCourseId;

        if (!isValidCourseId(courseId)) {
            showNotification(STRINGS.ERROR_INVALID_COURSE, 'error');
            return;
        }

        // Get form and file input
        const form = document.getElementById('payment-proof-form');
        const fileInput = document.getElementById('payment-screenshot');
        const submitBtn = document.getElementById('submit-proof-btn');

        if (!form || !fileInput || !submitBtn) {
            showNotification(STRINGS.ERROR_GENERIC, 'error');
            return;
        }

        // Validate file [17.1, 17.5]
        const file = fileInput.files?.[0];
        const validation = validateFile(file);
        if (!validation.valid) {
            showNotification(validation.error, 'error');
            return;
        }

        // Start submission
        state.isSubmitting = true;
        setButtonLoading(submitBtn, true, STRINGS.VERIFYING);

        // Prepare form data
        const formData = new FormData(form);
        formData.set('courseId', courseId);

        try {
            const data = await fetchWithTimeout(CONFIG.API_ENDPOINTS.SUBMIT_PROOF, {
                method: 'POST',
                body: formData
            });

            if (data.success) {
                setButtonSuccess(submitBtn);
                showNotification(STRINGS.SUCCESS_SUBMITTED, 'success');

                // Show detailed success message
                setTimeout(() => {
                    showNotification(STRINGS.SUCCESS_MESSAGE, 'info');
                }, 1000);

                // Redirect to dashboard
                setTimeout(() => {
                    window.location.href = '/dashboard';
                }, CONFIG.REDIRECT_DELAY_MS);
            } else {
                throw new Error(data.message || STRINGS.ERROR_GENERIC);
            }

        } catch (error) {
            window.Logger.error('Submission error:', error.message);
            showNotification(error.message, 'error');
            setButtonLoading(submitBtn, false, '', STRINGS.SUBMIT);
        } finally {
            state.isSubmitting = false;
        }
    }

    // =========================================================================
    // COPY UPI ID
    // =========================================================================

    /**
     * Copy UPI ID to clipboard
     * [17.6] Safe UPI handling
     */
    async function copyUpiId() {
        const upiElement = document.getElementById('upi-id-text');
        const copyBtn = document.getElementById('copy-upi-btn');

        if (!upiElement) {
            showNotification(STRINGS.COPY_FAILED, 'error');
            return;
        }

        const upiText = upiElement.textContent?.trim();
        if (!upiText) {
            showNotification(STRINGS.COPY_FAILED, 'error');
            return;
        }

        try {
            // Modern clipboard API
            if (navigator.clipboard && window.isSecureContext) {
                await navigator.clipboard.writeText(upiText);
            } else {
                // Fallback for older browsers
                const textArea = document.createElement('textarea');
                textArea.value = upiText;
                textArea.style.position = 'fixed';
                textArea.style.left = '-9999px';
                textArea.setAttribute('readonly', '');
                document.body.appendChild(textArea);
                textArea.select();
                document.execCommand('copy');
                document.body.removeChild(textArea);
            }

            // Update button icon
            if (copyBtn) {
                const icon = copyBtn.querySelector('i');
                if (icon) {
                    const originalClasses = icon.className;
                    icon.className = 'fa-solid fa-check text-green-600';
                    setTimeout(() => {
                        icon.className = originalClasses;
                    }, 2000);
                }
            }

            showNotification(STRINGS.COPIED, 'success');

        } catch (error) {
            window.Logger.error('Copy failed:', error);
            showNotification(STRINGS.COPY_FAILED, 'error');
        }
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize checkout functionality
     */
    function initialize() {
        window.Logger.debug('Initializing checkout.js');

        // Confirm Purchase Button
        const confirmBtn = document.getElementById('confirm-purchase-btn');
        if (confirmBtn) {
            confirmBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const courseId = confirmBtn.getAttribute('data-course-id');
                openQRModal(courseId);
            });
            window.Logger.debug('Confirm button initialized');
        }

        // Close Modal Button
        const closeBtn = document.getElementById('close-modal-btn');
        if (closeBtn) {
            closeBtn.addEventListener('click', (e) => {
                e.preventDefault();
                closePaymentModal();
            });
        }

        // Payment Done Button (Step 1 → Step 2)
        const paymentDoneBtn = document.getElementById('payment-done-btn');
        if (paymentDoneBtn) {
            paymentDoneBtn.addEventListener('click', (e) => {
                e.preventDefault();
                showStep2();
            });
        }

        // Back to QR Button
        const backBtn = document.getElementById('back-to-qr-btn');
        if (backBtn) {
            backBtn.addEventListener('click', (e) => {
                e.preventDefault();
                showStep1();
            });
        }

        // File Input Preview
        const fileInput = document.getElementById('payment-screenshot');
        if (fileInput) {
            // Add accept attribute for file picker [17.1]
            fileInput.setAttribute('accept', CONFIG.ALLOWED_FILE_TYPES.join(','));

            fileInput.addEventListener('change', () => {
                previewImage(fileInput);
            });
        }

        // Copy UPI Button
        const copyUpiBtn = document.getElementById('copy-upi-btn');
        if (copyUpiBtn) {
            copyUpiBtn.addEventListener('click', copyUpiId);
        }

        // Payment Form Submission
        const paymentForm = document.getElementById('payment-proof-form');
        if (paymentForm) {
            paymentForm.addEventListener('submit', submitPaymentProof);
        }

        // Click outside modal to close
        const modal = document.getElementById('payment-modal');
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closePaymentModal();
                }
            });
        }

        window.Logger.debug('Checkout.js initialization complete');
    }

    // Run initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    window.CheckoutModule = {
        openQRModal,
        closePaymentModal,
        showStep1,
        showStep2,
        submitPaymentProof,
        previewImage,
        copyUpiId,
        // Utilities
        validateFile,
        isValidCourseId,
        showNotification,
        getState: () => ({ ...state })
    };

    // Legacy global function bindings for onclick handlers
    window.openQRModal = openQRModal;
    window.submitPaymentProof = submitPaymentProof;
    window.previewImage = previewImage;
    window.showStep2 = showStep2;
    window.showStep1 = showStep1;
    window.closePaymentModal = closePaymentModal;
    window.openPaymentModal = openPaymentModal;

})();
