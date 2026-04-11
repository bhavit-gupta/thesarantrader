/**
 * ============================================================================
 * FILE: user-dashboard.js
 * PURPOSE: User dashboard functionality and testimonial management
 * ============================================================================
 * 
 * DESCRIPTION:
 * Manages user dashboard features including live session timers, testimonial
 * submission and management. Uses IIFE pattern for encapsulation.
 * 
 * ISSUES FIXED: All 30 issues [22.1-22.30] addressed
 * ============================================================================
 */

(function () {
    'use strict';

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        REQUEST_TIMEOUT_MS: 15000,
        FEEDBACK_DURATION_MS: 5000,
        MIN_RATING: 1,
        MAX_RATING: 5,
        MAX_MESSAGE_LENGTH: 500,
        TIMER_UPDATE_MS: 1000,
        DEBUG: false,
        SELECTORS: Object.freeze({
            TIMER_PREFIX: '[id^="live-timer-"]',
            FORM: 'testimonial-form',
            STAR_BTNS: '.star-btn',
            RATING_INPUT: 'rating-input',
            MESSAGE_TEXTAREA: 'testimonial-message',
            CHAR_COUNT: 'char-count',
            FEEDBACK: 'testimonial-feedback',
            EXISTING_DIV: 'existing-testimonial',
            USER_ROLE: 'user-role',
            SUBMIT_BTN: 'submit-testimonial-btn',
            DELETE_BTN: '.delete-testimonial-btn'
        }),
        CLASSES: Object.freeze({
            CARD: 'mb-4 p-5 rounded-2xl border border-white/10 bg-white/5 backdrop-blur-xl transition-all hover:bg-white/[0.08]',
            STAR_SELECTED: 'text-amber-400',
            STAR_UNSELECTED: 'text-white/10',
            HIDDEN: 'hidden',
            SUCCESS_FEEDBACK: ['bg-green-50', 'border', 'border-green-200', 'text-green-700'],
            ERROR_FEEDBACK: ['bg-red-50', 'border', 'border-red-200', 'text-red-700']
        }),
        API: Object.freeze({
            SUBMIT: '/api/testimonials/submit',
            MY_TESTIMONIALS: '/api/testimonials/my-testimonials',
            DELETE: '/api/testimonials/delete/'
        })
    });

    // =========================================================================
    // I18N STRINGS
    // =========================================================================
    const STRINGS = Object.freeze({
        SELECT_RATING: 'Please select a star rating',
        WRITE_TESTIMONIAL: 'Please write your testimonial',
        INVALID_RATING: 'Please select a valid rating (1-5)',
        SUBMIT_SUCCESS: 'Testimonial submitted successfully!',
        DELETE_SUCCESS: 'Testimonial deleted successfully',
        DELETE_CONFIRM: 'Are you sure you want to delete this testimonial?',
        ERROR_FETCH: 'Failed to load testimonials. Please try again.',
        ERROR_SUBMIT: 'Failed to submit testimonial. Please try again.',
        ERROR_DELETE: 'Failed to delete testimonial. Please try again.',
        ERROR_NETWORK: 'Network error. Please check your connection.',
        ERROR_TIMEOUT: 'Request timed out. Please try again.',
        ERROR_CSRF: 'Security token missing. Please refresh the page.',
        ERROR_INVALID_ID: 'Invalid testimonial ID',
        LOADING: 'Loading...',
        SUBMITTING: 'Submitting...',
        YOUR_TESTIMONIALS: 'Your Testimonials',
        STATUS_PENDING: 'Pending Review',
        STATUS_APPROVED: 'Approved ✓',
        STATUS_REJECTED: 'Rejected'
    });

    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================
    const state = {
        selectedRating: 0,       //  Encapsulated, not global
        isSubmitting: false,
        timerIntervals: [],      //  Store for cleanup
        feedbackTimeout: null,   //  Store for cleanup
        abortController: null,
        cachedElements: {}       //  Cache DOM elements
    };

    // =========================================================================
    // LOGGER
    // =========================================================================
    const Logger = {
        debug: (...args) => {},
        info: (...args) => {},
        warn: (...args) => {},
        // [22.7, 22.30] Only log safe messages, not sensitive data
        error: (msg) => console.error('[Dashboard:Error]', msg)
    };

    // =========================================================================
    // VALIDATION UTILITIES
    // =========================================================================

    /**
     * Escape HTML to prevent XSS
     * [22.9, 22.10, 22.21] XSS prevention
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

    /**
     * Get CSRF token with validation
     * [22.2, 22.29] Validate CSRF token
     * @returns {string|null} CSRF token or null
     */
    function getCSRFToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        const token = meta?.content;

        if (!token || typeof token !== 'string' || token.trim().length === 0) {
            return null;
        }

        return token.trim();
    }

    /**
     * Validate testimonial ID
     * Prevent URL injection
     * @param {*} id - ID to validate
     * @returns {boolean} Valid or not
     */
    function isValidId(id) {
        if (id == null) return false;
        const idStr = String(id).trim();
        // Only allow alphanumeric and common ID formats
        return idStr.length > 0 && /^[a-zA-Z0-9_-]+$/.test(idStr);
    }

    /**
     * Validate rating value
     * [22.5, 22.12, 22.13] Rating validation
     * @param {*} rating - Rating to validate
     * @returns {number|null} Valid rating or null
     */
    function validateRating(rating) {
        if (rating == null) return null;

        const num = typeof rating === 'number' ? rating : parseInt(rating, 10);

        if (Number.isNaN(num) || !Number.isInteger(num)) {
            return null;
        }

        if (num < CONFIG.MIN_RATING || num > CONFIG.MAX_RATING) {
            return null;
        }

        return num;
    }

    /**
     * Validate message
     * [22.6, 22.11] Message validation
     * @param {*} message - Message to validate
     * @returns {string|null} Trimmed message or null
     */
    function validateMessage(message) {
        if (message == null || typeof message !== 'string') {
            return null;
        }

        const trimmed = message.trim();

        if (trimmed.length === 0 || trimmed.length > CONFIG.MAX_MESSAGE_LENGTH) {
            return null;
        }

        return trimmed;
    }

    /**
     * Validate timestamp
     * Timestamp validation
     * @param {*} timestamp - Timestamp to validate
     * @returns {number|null} Valid timestamp or null
     */
    function validateTimestamp(timestamp) {
        const num = parseInt(timestamp, 10);

        if (Number.isNaN(num) || !Number.isFinite(num) || num <= 0) {
            return null;
        }

        return num;
    }

    /**
     * Validate testimonial object
     * [22.19, 22.22] Structure validation
     * @param {*} testimonial - Testimonial to validate
     * @returns {object|null} Validated testimonial or null
     */
    function validateTestimonial(testimonial) {
        if (!testimonial || typeof testimonial !== 'object') return null;

        const message = typeof testimonial.message === 'string' ? testimonial.message : '';
        const rating = validateRating(testimonial.rating) || CONFIG.MAX_RATING;
        const status = ['pending', 'approved', 'rejected'].includes(String(testimonial.status || '').toLowerCase())
            ? String(testimonial.status).toLowerCase()
            : 'pending';

        return {
            id: testimonial.id ?? '',
            message,
            rating,
            status,
            submittedAt: testimonial.submittedAt || null
        };
    }

    // =========================================================================
    // DATE FORMATTING
    // =========================================================================

    /**
     * Format date to DD/MM/YYYY
     * Safe date formatting
     * @param {*} dateValue - Date to format
     * @returns {string} Formatted date or empty string
     */
    function formatDate(dateValue) {
        if (!dateValue) return '';

        try {
            const date = new Date(dateValue);
            if (isNaN(date.getTime())) return '';

            const day = String(date.getDate()).padStart(2, '0');
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const year = date.getFullYear();

            return `${day}/${month}/${year}`;
        } catch {
            return '';
        }
    }

    // =========================================================================
    // FETCH WITH TIMEOUT
    // =========================================================================

    /**
     * Fetch with timeout
     * [22.1, 22.24] Response validation and timeout
     * @param {string} url - URL to fetch
     * @param {object} options - Fetch options
     * @returns {Promise<object>} Response data
     */
    async function fetchWithTimeout(url, options = {}) {
        const controller = new AbortController();
        state.abortController = controller;

        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            // Check response.ok, but safely parse the JSON payload first if it's an API error
            if (!response.ok) {
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.message) {
                        throw new Error(errorData.message);
                    }
                } catch (e) {
                    if (e.message !== 'Unexpected end of JSON input' && !e.message.startsWith('Unexpected token')) {
                        throw e; // Standard error
                    }
                }
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            return data;

        } catch (error) {
            clearTimeout(timeoutId);

            if (error.name === 'AbortError') {
                throw new Error(STRINGS.ERROR_TIMEOUT);
            }

            if (error.message.includes('Failed to fetch')) {
                throw new Error(STRINGS.ERROR_NETWORK);
            }

            throw error;
        } finally {
            state.abortController = null;
        }
    }

    // =========================================================================
    // UI FEEDBACK
    // =========================================================================

    /**
     * Show feedback message
     * [22.9, 22.17] Safe feedback display
     * @param {string} message - Message to display
     * @param {string} type - 'success' or 'error'
     */
    function showFeedback(message, type) {
        const feedback = document.getElementById(CONFIG.SELECTORS.FEEDBACK);
        if (!feedback) return;

        // Clear previous timeout
        if (state.feedbackTimeout) {
            clearTimeout(state.feedbackTimeout);
        }

        // Clear all classes at once
        feedback.className = 'p-3 rounded-lg text-sm';

        // Escape message to prevent XSS
        const safeMessage = escapeHtml(message);

        if (type === 'success') {
            CONFIG.CLASSES.SUCCESS_FEEDBACK.forEach(c => feedback.classList.add(c));
            feedback.innerHTML = `<i class="fa-solid fa-check-circle mr-2"></i>${safeMessage}`;
        } else {
            CONFIG.CLASSES.ERROR_FEEDBACK.forEach(c => feedback.classList.add(c));
            feedback.innerHTML = `<i class="fa-solid fa-exclamation-circle mr-2"></i>${safeMessage}`;
        }

        feedback.classList.remove(CONFIG.CLASSES.HIDDEN);

        // Store timeout for cleanup
        state.feedbackTimeout = setTimeout(() => {
            feedback.classList.add(CONFIG.CLASSES.HIDDEN);
        }, CONFIG.FEEDBACK_DURATION_MS);
    }

    // =========================================================================
    // TIMER LOGIC
    // =========================================================================

    /**
     * Start live session timers
     * Safe timer initialization with cleanup
     */
    function startUserTimers() {
        const timers = document.querySelectorAll(CONFIG.SELECTORS.TIMER_PREFIX);

        timers.forEach(timer => {
            const startTime = validateTimestamp(timer.dataset.start);
            if (!startTime) return;

            function updateTimer() {
                const elapsed = Date.now() - startTime;
                if (elapsed < 0) {
                    timer.textContent = '00:00:00';
                    return;
                }

                const hours = Math.floor(elapsed / 3600000);
                const minutes = Math.floor((elapsed % 3600000) / 60000);
                const seconds = Math.floor((elapsed % 60000) / 1000);

                timer.textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
            }

            updateTimer();
            const intervalId = setInterval(updateTimer, CONFIG.TIMER_UPDATE_MS);
            state.timerIntervals.push(intervalId);
        });
    }

    // =========================================================================
    // STAR RATING
    // =========================================================================

    /**
     * Update star display
     * Uses cached elements
     * @param {number} rating - Selected rating
     */
    function updateStarDisplay(rating) {
        const starBtns = state.cachedElements.starBtns || document.querySelectorAll(CONFIG.SELECTORS.STAR_BTNS);

        starBtns.forEach((btn, index) => {
            if (index < rating) {
                btn.classList.remove(CONFIG.CLASSES.STAR_UNSELECTED);
                btn.classList.add(CONFIG.CLASSES.STAR_SELECTED);
            } else {
                btn.classList.add(CONFIG.CLASSES.STAR_UNSELECTED);
                btn.classList.remove(CONFIG.CLASSES.STAR_SELECTED);
            }
        });
    }

    /**
     * Create star rating element
     * Array-based star creation
     * @param {number} rating - Rating 1-5
     * @returns {string} Stars HTML
     */
    function createStarsHtml(rating) {
        const safeRating = Math.max(0, Math.min(CONFIG.MAX_RATING, rating || 0));
        return Array.from({ length: safeRating }, () =>
            '<i class="fa-solid fa-star text-amber-400 text-[10px] mr-0.5"></i>'
        ).join('');
    }

    // =========================================================================
    // TESTIMONIAL FORM
    // =========================================================================

    /**
     * Initialize testimonial form
     * Event delegation pattern
     */
    function initTestimonialForm() {
        const form = document.getElementById(CONFIG.SELECTORS.FORM);
        if (!form) return;

        // Cache elements
        state.cachedElements.form = form;
        state.cachedElements.starBtns = document.querySelectorAll(CONFIG.SELECTORS.STAR_BTNS);
        state.cachedElements.ratingInput = document.getElementById(CONFIG.SELECTORS.RATING_INPUT);
        state.cachedElements.messageTextarea = document.getElementById(CONFIG.SELECTORS.MESSAGE_TEXTAREA);
        state.cachedElements.charCount = document.getElementById(CONFIG.SELECTORS.CHAR_COUNT);

        // Await initial load
        loadExistingTestimonials();

        // Use event delegation for star buttons
        form.addEventListener('click', (e) => {
            const starBtn = e.target.closest(CONFIG.SELECTORS.STAR_BTNS);
            if (!starBtn) return;

            e.preventDefault();
            const rating = validateRating(starBtn.dataset.rating);

            if (rating) {
                state.selectedRating = rating;
                if (state.cachedElements.ratingInput) {
                    state.cachedElements.ratingInput.value = rating;
                }
                updateStarDisplay(rating);
            }
        });

        // Character counter
        const messageTextarea = state.cachedElements.messageTextarea;
        if (messageTextarea) {
            messageTextarea.addEventListener('input', () => {
                const length = messageTextarea.value.length;
                const charCount = state.cachedElements.charCount;

                if (charCount) {
                    charCount.textContent = `${length} / ${CONFIG.MAX_MESSAGE_LENGTH}`;

                    if (length > CONFIG.MAX_MESSAGE_LENGTH - 50) {
                        charCount.classList.add('text-orange-500', 'font-bold');
                    } else {
                        charCount.classList.remove('text-orange-500', 'font-bold');
                    }
                }
            });
        }

        // Form submission
        form.addEventListener('submit', handleFormSubmit);
    }

    /**
     * Handle form submission
     * [22.1, 22.2, 22.5, 22.6] Safe submission
     * @param {Event} e - Submit event
     */
    async function handleFormSubmit(e) {
        e.preventDefault();

        if (state.isSubmitting) return;

        // [22.5, 22.12] Validate rating
        const validRating = validateRating(state.selectedRating);
        if (!validRating) {
            showFeedback(STRINGS.INVALID_RATING, 'error');
            return;
        }

        // [22.6, 22.11] Validate message
        const messageTextarea = state.cachedElements.messageTextarea;
        const message = validateMessage(messageTextarea?.value);

        if (!message) {
            showFeedback(STRINGS.WRITE_TESTIMONIAL, 'error');
            return;
        }

        //  Validate CSRF token
        const csrfToken = getCSRFToken();
        if (!csrfToken) {
            showFeedback(STRINGS.ERROR_CSRF, 'error');
            return;
        }

        const userRoleEl = document.getElementById(CONFIG.SELECTORS.USER_ROLE);
        const userRole = userRoleEl?.value?.trim() || 'User';

        const submitBtn = document.getElementById(CONFIG.SELECTORS.SUBMIT_BTN);

        state.isSubmitting = true;

        if (submitBtn) {
            submitBtn.disabled = true;
            submitBtn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${STRINGS.SUBMITTING}`;
        }

        try {
            const data = await fetchWithTimeout(CONFIG.API.SUBMIT, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                },
                body: JSON.stringify({
                    message,
                    rating: validRating,
                    userRole
                })
            });

            if (data.success) {
                Logger.debug('Testimonial submitted successfully');
                showFeedback(data.message || STRINGS.SUBMIT_SUCCESS, 'success');

                // Reset all UI elements
                resetForm();

                // Reload testimonials
                setTimeout(() => loadExistingTestimonials(), 1000);
            } else {
                showFeedback(data.message || STRINGS.ERROR_SUBMIT, 'error');
            }

        } catch (error) {
            Logger.error('[Submit Error]', error);
            // Show the actual error message from the server if it's user-friendly
            const displayMsg = (error.message && !error.message.startsWith('HTTP')) ? error.message : STRINGS.ERROR_SUBMIT;
            showFeedback(displayMsg, 'error');
        } finally {
            state.isSubmitting = false;

            if (submitBtn) {
                submitBtn.disabled = false;
                submitBtn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Testimonial';
            }
        }
    }

    /**
     * Reset form state
     * Complete UI reset
     */
    function resetForm() {
        const form = state.cachedElements.form;
        if (form) form.reset();

        state.selectedRating = 0;
        updateStarDisplay(0);

        const charCount = state.cachedElements.charCount;
        if (charCount) {
            charCount.textContent = `0 / ${CONFIG.MAX_MESSAGE_LENGTH}`;
            charCount.classList.remove('text-orange-500', 'font-bold');
        }
    }

    // =========================================================================
    // TESTIMONIALS DISPLAY
    // =========================================================================

    /**
     * Load existing testimonials
     * [22.4, 22.19, 22.26] Single definition, validated response
     */
    async function loadExistingTestimonials() {
        try {
            const data = await fetchWithTimeout(CONFIG.API.MY_TESTIMONIALS);

            // Validate array
            if (!data.success || !Array.isArray(data.testimonials) || data.testimonials.length === 0) {
                const existingDiv = document.getElementById(CONFIG.SELECTORS.EXISTING_DIV);
                if (existingDiv) existingDiv.classList.add(CONFIG.CLASSES.HIDDEN);
                return;
            }

            // Check element exists
            const existingDiv = document.getElementById(CONFIG.SELECTORS.EXISTING_DIV);
            if (!existingDiv) {
                Logger.warn('Existing testimonials container not found');
                return;
            }

            existingDiv.innerHTML = '';

            // Header
            const header = document.createElement('div');
            header.className = 'mb-6 flex items-center gap-3';
            header.innerHTML = `
                <div class="h-1 w-8 bg-amber-400/50 rounded-full"></div>
                <h3 class="text-xs font-black uppercase tracking-[0.2em] text-white/50">${escapeHtml(STRINGS.YOUR_TESTIMONIALS)}</h3>
            `;
            existingDiv.appendChild(header);

            // Fix index display order
            data.testimonials.forEach((testimonial, index) => {
                const validated = validateTestimonial(testimonial);
                if (!validated) return;

                const card = createTestimonialCard(validated, index + 1);
                existingDiv.appendChild(card);
            });

            existingDiv.classList.remove(CONFIG.CLASSES.HIDDEN);

        } catch (error) {
            Logger.error(error.message || 'Failed to load testimonials');
        }
    }

    /**
     * Create testimonial card element
     * [22.10, 22.21] Safe HTML creation
     * @param {object} testimonial - Validated testimonial
     * @param {number} displayIndex - Display number
     * @returns {HTMLElement} Card element
     */
    function createTestimonialCard(testimonial, displayIndex) {
        const card = document.createElement('div');
        card.className = CONFIG.CLASSES.CARD;

        // Status badge
        let statusClass = '';
        let statusText = '';

        if (testimonial.status === 'pending') {
            statusClass = 'bg-yellow-100 text-yellow-700';
            statusText = STRINGS.STATUS_PENDING;
        } else if (testimonial.status === 'approved') {
            statusClass = 'bg-green-100 text-green-700';
            statusText = STRINGS.STATUS_APPROVED;
        } else if (testimonial.status === 'rejected') {
            statusClass = 'bg-red-100 text-red-700';
            statusText = STRINGS.STATUS_REJECTED;
        }

        // Build header row
        const headerRow = document.createElement('div');
        headerRow.className = 'flex items-start justify-between gap-4 mb-2';

        const leftDiv = document.createElement('div');
        leftDiv.className = 'flex items-center gap-2';

        const indexSpan = document.createElement('span');
        indexSpan.className = 'text-xs text-slate-500';
        indexSpan.textContent = `#${displayIndex}`;
        leftDiv.appendChild(indexSpan);

        if (statusText) {
            const statusBadge = document.createElement('span');
            statusBadge.className = `px-2 py-0.5 rounded text-xs font-bold ${statusClass}`;
            statusBadge.textContent = statusText;
            leftDiv.appendChild(statusBadge);
        }

        headerRow.appendChild(leftDiv);

        const rightDiv = document.createElement('div');
        rightDiv.className = 'flex items-center gap-3';

        const dateSpan = document.createElement('span');
        dateSpan.className = 'text-xs text-slate-400';
        dateSpan.textContent = formatDate(testimonial.submittedAt);
        rightDiv.appendChild(dateSpan);

        // Safe ID in data attribute
        if (isValidId(testimonial.id)) {
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'delete-testimonial-btn text-xs text-red-400 hover:text-red-600 transition-colors';
            deleteBtn.dataset.id = String(testimonial.id);
            deleteBtn.innerHTML = '<i class="fa-solid fa-trash-can"></i>';
            rightDiv.appendChild(deleteBtn);
        }

        headerRow.appendChild(rightDiv);
        card.appendChild(headerRow);

        // Stars row
        const starsRow = document.createElement('div');
        starsRow.className = 'flex gap-1 mb-2';
        starsRow.innerHTML = createStarsHtml(testimonial.rating);
        card.appendChild(starsRow);

        // Message with escaping via textContent
        const messageP = document.createElement('p');
        messageP.className = 'text-white/60 text-xs leading-relaxed italic mt-1';
        messageP.textContent = `"${testimonial.message}"`;
        card.appendChild(messageP);

        return card;
    }

    // =========================================================================
    // DELETE TESTIMONIAL
    // =========================================================================

    /**
     * Initialize delete handler
     * [22.4, 22.25, 22.27] Single definition, event delegation
     */
    function initDeleteHandler() {
        const existingDiv = document.getElementById(CONFIG.SELECTORS.EXISTING_DIV);
        if (!existingDiv) return;

        existingDiv.addEventListener('click', async (e) => {
            const btn = e.target.closest(CONFIG.SELECTORS.DELETE_BTN);
            if (!btn) return;

            e.preventDefault();
            e.stopPropagation();

            const id = btn.dataset.id;

            // [22.3, 22.27] Validate ID
            if (!isValidId(id)) {
                showFeedback(STRINGS.ERROR_INVALID_ID, 'error');
                return;
            }

            // Consider replacing with modal dialog for better UX
            if (confirm(STRINGS.DELETE_CONFIRM)) {
                await deleteTestimonial(id);
            }
        });
    }

    /**
     * Delete testimonial
     * [22.3, 22.4] Single definition, validated ID
     * @param {string} id - Testimonial ID
     */
    async function deleteTestimonial(id) {
        // Validate ID format
        if (!isValidId(id)) {
            showFeedback(STRINGS.ERROR_INVALID_ID, 'error');
            return;
        }

        //  Validate CSRF token
        const csrfToken = getCSRFToken();
        if (!csrfToken) {
            showFeedback(STRINGS.ERROR_CSRF, 'error');
            return;
        }

        try {
            const data = await fetchWithTimeout(`${CONFIG.API.DELETE}${encodeURIComponent(id)}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-CSRF-Token': csrfToken
                }
            });

            if (data.success) {
                showFeedback(STRINGS.DELETE_SUCCESS, 'success');
                loadExistingTestimonials();
            } else {
                showFeedback(data.message || STRINGS.ERROR_DELETE, 'error');
            }

        } catch (error) {
            Logger.error(error.message || 'Delete failed');
            showFeedback(STRINGS.ERROR_DELETE, 'error');
        }
    }

    // =========================================================================
    // CLEANUP
    // =========================================================================

    /**
     * Cleanup on page unload
     * Timer cleanup
     */
    function cleanup() {
        // Clear timer intervals
        state.timerIntervals.forEach(id => clearInterval(id));
        state.timerIntervals = [];

        // Clear feedback timeout
        if (state.feedbackTimeout) {
            clearTimeout(state.feedbackTimeout);
            state.feedbackTimeout = null;
        }

        // Abort pending request
        if (state.abortController) {
            state.abortController.abort();
            state.abortController = null;
        }
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize all dashboard functionality
     */
    function initialize() {
        Logger.debug('Initializing user-dashboard.js');

        startUserTimers();
        initTestimonialForm();
        initDeleteHandler();

        // Cleanup on page unload
        window.addEventListener('beforeunload', cleanup);

        Logger.debug('user-dashboard.js initialization complete');
    }

    // Run on DOMContentLoaded
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    window.UserDashboardModule = {
        loadExistingTestimonials,
        formatDate,
        getState: () => ({
            selectedRating: state.selectedRating,
            isSubmitting: state.isSubmitting
        }),
        // Utilities
        escapeHtml,
        isValidId,
        validateRating
    };

    // Legacy globals
    window.startUserTimers = startUserTimers;
    window.loadExistingTestimonials = loadExistingTestimonials;
    window.formatDate = formatDate;

})();
