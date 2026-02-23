/**
 * ============================================================================
 * FILE: auth.js
 * PURPOSE: Authentication form logic and validation
 * ============================================================================
 * 
 * DESCRIPTION:
 * Handles all client-side authentication form functionality including login,
 * signup, OTP verification, and password reset flows.
 * 
 * ISSUES FIXED: All 30 issues [15.1-15.30] addressed
 * ============================================================================
 */

(function() {
    'use strict';

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        REQUEST_TIMEOUT_MS: 15000,
        DEBOUNCE_MS: 300,
        OTP_LENGTH: 6,
        MIN_PASSWORD_LENGTH: 8,
        MAX_PASSWORD_LENGTH: 128,
        PHONE_MIN_LENGTH: 10,
        PHONE_MAX_LENGTH: 15,
        DEBUG: false,
        NOTIFICATION_DURATION_MS: 4000,
        PASSWORD_RULES: Object.freeze({
            minLength: 8,
            requireUppercase: true,
            requireLowercase: true,
            requireNumber: true,
            requireSpecial: true
        })
    });

    // =========================================================================
    // I18N STRINGS
    // =========================================================================
    const STRINGS = Object.freeze({
        SENDING: 'Sending...',
        GET_OTP: 'Get OTP',
        VERIFYING: 'Verifying...',
        VERIFY: 'Verify',
        RESETTING: 'Resetting...',
        RESET_PASSWORD: 'Reset Password',
        ERROR_GENERIC: 'An error occurred. Please try again.',
        ERROR_NETWORK: 'Network error. Please check your connection.',
        ERROR_TIMEOUT: 'Request timed out. Please try again.',
        ERROR_CSRF: 'Security token missing. Please refresh the page.',
        ERROR_INVALID_EMAIL: 'Please enter a valid email address.',
        ERROR_INVALID_PHONE: 'Please enter a valid phone number.',
        ERROR_INVALID_OTP: 'Please enter a valid {length}-digit OTP.',
        ERROR_PASSWORD_MISMATCH: 'Passwords do not match.',
        ERROR_PASSWORD_WEAK: 'Password must be at least 8 characters with uppercase, lowercase, number, and special character.',
        SUCCESS_OTP_SENT: 'OTP sent successfully!',
        SUCCESS_PASSWORD_RESET: 'Password reset successfully! Redirecting to login...',
        FIELD_EXISTS: 'This {field} is already registered.',
        SWITCH_TO_EMAIL: 'Reset using Email instead',
        SWITCH_TO_PHONE: 'Reset using Phone instead'
    });

    // =========================================================================
    // STATE MANAGEMENT (replaces global variables)
    // =========================================================================
    const state = {
        resetIdentifier: '',
        resetMethod: 'phone',
        pendingRequests: new Map(),
        abortControllers: new Map(),
        debounceTimers: new Map()
    };

    // =========================================================================
    // LOGGER (conditional debug logging)
    // =========================================================================
    const Logger = {
        debug: (...args) => CONFIG.DEBUG && console.log('[Auth:Debug]', ...args),
        info: (...args) => CONFIG.DEBUG && console.info('[Auth:Info]', ...args),
        warn: (...args) => console.warn('[Auth:Warn]', ...args),
        error: (...args) => console.error('[Auth:Error]', ...args)
    };

    // =========================================================================
    // VALIDATION UTILITIES
    // =========================================================================

    /**
     * Email validation with comprehensive regex
     * [15.8] Better email regex validation
     */
    const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

    /**
     * Phone validation supporting international formats
     * [15.9] International phone support
     */
    const PHONE_REGEX = /^[+]?[0-9]{10,15}$/;

    /**
     * Validate email format
     * @param {string} email - Email to validate
     * @returns {boolean} Valid or not
     */
    function isValidEmail(email) {
        if (!email || typeof email !== 'string') return false;
        const trimmed = email.trim();
        return trimmed.length > 0 && trimmed.length <= 254 && EMAIL_REGEX.test(trimmed);
    }

    /**
     * Validate phone number
     * @param {string} phone - Phone to validate
     * @returns {boolean} Valid or not
     */
    function isValidPhone(phone) {
        if (!phone || typeof phone !== 'string') return false;
        const cleaned = phone.replace(/[\s\-\(\)]/g, '');
        return PHONE_REGEX.test(cleaned);
    }

    /**
     * Validate OTP format
     * [15.7] Consistent OTP length validation
     * @param {string} otp - OTP to validate
     * @param {number} length - Expected length (default: 6)
     * @returns {boolean} Valid or not
     */
    function isValidOTP(otp, length = CONFIG.OTP_LENGTH) {
        if (!otp || typeof otp !== 'string') return false;
        const cleaned = otp.trim();
        return cleaned.length === length && /^\d+$/.test(cleaned);
    }

    /**
     * Validate password complexity
     * [15.4] Password complexity validation
     * @param {string} password - Password to validate
     * @returns {{ valid: boolean, errors: string[] }} Validation result
     */
    function validatePassword(password) {
        const errors = [];
        const rules = CONFIG.PASSWORD_RULES;

        if (!password || typeof password !== 'string') {
            return { valid: false, errors: ['Password is required'] };
        }

        if (password.length < rules.minLength) {
            errors.push(`At least ${rules.minLength} characters`);
        }

        if (password.length > CONFIG.MAX_PASSWORD_LENGTH) {
            errors.push(`Maximum ${CONFIG.MAX_PASSWORD_LENGTH} characters`);
        }

        if (rules.requireUppercase && !/[A-Z]/.test(password)) {
            errors.push('One uppercase letter');
        }

        if (rules.requireLowercase && !/[a-z]/.test(password)) {
            errors.push('One lowercase letter');
        }

        if (rules.requireNumber && !/[0-9]/.test(password)) {
            errors.push('One number');
        }

        if (rules.requireSpecial && !/[!@#$%^&*(),.?":{}|<>_\-+=\[\]\\\/~`]/.test(password)) {
            errors.push('One special character');
        }

        return { valid: errors.length === 0, errors };
    }

    /**
     * Escape HTML to prevent XSS
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
     * [15.2] CSRF token validation
     * @returns {string|null} CSRF token or null if invalid
     */
    function getCSRFToken() {
        const meta = document.querySelector('meta[name="csrf-token"]');
        if (!meta) {
            Logger.error('CSRF meta tag not found');
            return null;
        }

        const token = meta.getAttribute('content');
        if (!token || token.trim() === '') {
            Logger.error('CSRF token is empty');
            return null;
        }

        return token.trim();
    }

    // =========================================================================
    // FETCH WITH TIMEOUT & ERROR HANDLING
    // =========================================================================

    /**
     * Fetch with timeout and proper error handling
     * [15.1] response.ok check, [15.5] status checking, [15.6] timeout
     * @param {string} url - URL to fetch
     * @param {object} options - Fetch options
     * @param {string} requestId - Unique request ID for abort control
     * @returns {Promise<object>} JSON response
     */
    async function fetchWithTimeout(url, options = {}, requestId = null) {
        const csrfToken = getCSRFToken();
        if (!csrfToken) {
            throw new Error(STRINGS.ERROR_CSRF);
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

        if (requestId) {
            // Cancel any existing request with same ID
            if (state.abortControllers.has(requestId)) {
                state.abortControllers.get(requestId).abort();
            }
            state.abortControllers.set(requestId, controller);
        }

        try {
            const response = await fetch(url, {
                ...options,
                signal: controller.signal,
                headers: {
                    'Content-Type': 'application/json',
                    'csrf-token': csrfToken,
                    ...options.headers
                }
            });

            clearTimeout(timeoutId);

            // [15.1] Check response.ok before parsing
            if (!response.ok) {
                const errorText = await response.text().catch(() => 'Unknown error');
                throw new Error(`HTTP ${response.status}: ${errorText.substring(0, 100)}`);
            }

            // [15.5] Validate JSON response
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
            if (requestId) {
                state.abortControllers.delete(requestId);
            }
        }
    }

    // =========================================================================
    // NOTIFICATION SYSTEM (replaces alert())
    // =========================================================================

    /**
     * Show notification toast
     * [15.29] Custom notifications instead of alert()
     * @param {string} message - Message to display
     * @param {'success'|'error'|'warning'|'info'} type - Notification type
     */
    function showNotification(message, type = 'info') {
        // Remove existing notifications
        document.querySelectorAll('.auth-notification').forEach(n => n.remove());

        const notification = document.createElement('div');
        notification.className = 'auth-notification fixed top-4 right-4 z-50 max-w-sm p-4 rounded-lg shadow-lg transform transition-all duration-300 translate-x-full';
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

        notification.className += ` ${colors[type] || colors.info}`;

        const icon = document.createElement('i');
        icon.className = `fa-solid ${icons[type] || icons.info} mr-2`;

        const text = document.createElement('span');
        text.textContent = message;

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ml-4 text-white hover:text-gray-200 focus:outline-none';
        closeBtn.setAttribute('aria-label', 'Close notification');
        closeBtn.innerHTML = '<i class="fa-solid fa-times"></i>';
        closeBtn.addEventListener('click', () => {
            notification.classList.add('translate-x-full');
            setTimeout(() => notification.remove(), 300);
        });

        notification.appendChild(icon);
        notification.appendChild(text);
        notification.appendChild(closeBtn);

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
     * [15.10] Loading feedback during async operations
     * @param {HTMLElement} button - Button element
     * @param {boolean} loading - Loading state
     * @param {string} loadingText - Text while loading
     * @param {string} normalText - Normal text
     */
    function setButtonLoading(button, loading, loadingText = 'Loading...', normalText = 'Submit') {
        if (!button) return;

        button.disabled = loading;

        if (loading) {
            button.dataset.originalText = button.textContent;
            button.innerHTML = `<i class="fa-solid fa-spinner fa-spin mr-2"></i>${escapeHtml(loadingText)}`;
            button.setAttribute('aria-busy', 'true');
        } else {
            button.textContent = button.dataset.originalText || normalText;
            button.removeAttribute('aria-busy');
        }
    }

    /**
     * Set input error state
     * @param {HTMLElement} input - Input element
     * @param {boolean} hasError - Error state
     * @param {string} message - Error message (optional)
     */
    function setInputError(input, hasError, message = '') {
        if (!input) return;

        if (hasError) {
            input.classList.add('border-red-500', 'bg-red-50');
            input.setAttribute('aria-invalid', 'true');

            // Add error message
            if (message) {
                let errorEl = input.parentElement.querySelector('.input-error-message');
                if (!errorEl) {
                    errorEl = document.createElement('p');
                    errorEl.className = 'input-error-message text-xs text-red-500 mt-1';
                    input.parentElement.appendChild(errorEl);
                }
                errorEl.textContent = message;
            }
        } else {
            input.classList.remove('border-red-500', 'bg-red-50');
            input.removeAttribute('aria-invalid');

            const errorEl = input.parentElement?.querySelector('.input-error-message');
            if (errorEl) errorEl.remove();
        }
    }

    // =========================================================================
    // DEBOUNCE UTILITY
    // =========================================================================

    /**
     * Debounce function calls
     * [15.16] Debouncing for blur events
     * @param {string} key - Unique key for this debounce
     * @param {Function} fn - Function to debounce
     * @param {number} delay - Delay in ms
     */
    function debounce(key, fn, delay = CONFIG.DEBOUNCE_MS) {
        if (state.debounceTimers.has(key)) {
            clearTimeout(state.debounceTimers.get(key));
        }

        const timerId = setTimeout(() => {
            state.debounceTimers.delete(key);
            fn();
        }, delay);

        state.debounceTimers.set(key, timerId);
    }

    // =========================================================================
    // LOGIN METHOD TOGGLE
    // =========================================================================

    /**
     * Set login method (username/email/phone)
     * @param {'username'|'email'|'phone'} method - Login method
     */
    function setLoginMethod(method) {
        const label = document.getElementById('login-label');
        const input = document.getElementById('login-input');
        const btnUsername = document.getElementById('btn-username');
        const btnEmail = document.getElementById('btn-email');
        const btnPhone = document.getElementById('btn-phone');

        if (!label || !input) {
            Logger.warn('Login label or input not found');
            return;
        }

        // Reset all buttons
        [btnUsername, btnEmail, btnPhone].forEach(btn => {
            if (btn) {
                btn.className = 'hover:text-blue-600 pb-1 transition-colors';
                btn.setAttribute('aria-selected', 'false');
            }
        });

        const activeClass = 'text-blue-600 border-b-2 border-blue-600 pb-1 transition-colors';

        const loginTypeInput = document.getElementById('login-type');
        if (loginTypeInput) loginTypeInput.value = method;

        // Reset input attributes
        input.removeAttribute('pattern');
        input.removeAttribute('maxLength');
        input.oninput = null;

        switch (method) {
            case 'username':
                label.textContent = 'Username';
                input.type = 'text';
                input.placeholder = 'Enter your username';
                input.setAttribute('autocomplete', 'username');
                if (btnUsername) {
                    btnUsername.className = activeClass;
                    btnUsername.setAttribute('aria-selected', 'true');
                }
                break;

            case 'email':
                label.textContent = 'Email Address';
                input.type = 'email';
                input.placeholder = 'your@email.com';
                input.setAttribute('autocomplete', 'email');
                if (btnEmail) {
                    btnEmail.className = activeClass;
                    btnEmail.setAttribute('aria-selected', 'true');
                }
                break;

            case 'phone':
                label.textContent = 'Phone Number';
                input.type = 'tel';
                input.placeholder = '9876543210';
                input.pattern = '[0-9]{10,15}';
                input.maxLength = 15;
                input.setAttribute('autocomplete', 'tel');
                input.oninput = function() {
                    this.value = this.value.replace(/[^0-9+]/g, '');
                };
                if (btnPhone) {
                    btnPhone.className = activeClass;
                    btnPhone.setAttribute('aria-selected', 'true');
                }
                break;
        }

        Logger.debug('Login method set to:', method);
    }

    // =========================================================================
    // PASSWORD VISIBILITY TOGGLE
    // =========================================================================

    /**
     * Toggle password visibility
     * @param {string} inputId - Input element ID
     * @param {HTMLElement} button - Toggle button
     */
    function togglePassword(inputId, button) {
        const input = document.getElementById(inputId);
        const icon = button?.querySelector('i');

        if (!input || !icon) {
            Logger.warn('Password toggle elements not found');
            return;
        }

        const isPassword = input.type === 'password';
        input.type = isPassword ? 'text' : 'password';

        icon.classList.toggle('fa-eye', !isPassword);
        icon.classList.toggle('fa-eye-slash', isPassword);

        button.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
        button.setAttribute('aria-pressed', String(isPassword));
    }

    // =========================================================================
    // EXISTENCE CHECK (Username/Email/Phone)
    // =========================================================================

    /**
     * Check if field value already exists
     * @param {string} field - Field type (username/email/phone)
     * @param {string} value - Value to check
     * @param {HTMLElement} input - Input element
     */
    async function checkExistence(field, value, input) {
        if (!value || !input) return;

        const requestId = `existence-${field}`;

        try {
            const data = await fetchWithTimeout('/auth/check-existence', {
                method: 'POST',
                body: JSON.stringify({ field, value })
            }, requestId);

            if (data.exists) {
                setInputError(input, true, data.message || STRINGS.FIELD_EXISTS.replace('{field}', field));
                input.value = '';
                input.focus();
            } else {
                setInputError(input, false);
            }
        } catch (error) {
            Logger.error('Existence check failed:', error);
            // Don't show error to user for validation checks
        }
    }

    // =========================================================================
    // OTP FUNCTIONS
    // =========================================================================

    /**
     * Send OTP to email
     */
    async function sendOTP() {
        const emailInput = document.getElementById('email');
        if (!emailInput) return;

        const email = emailInput.value.trim();
        if (!isValidEmail(email)) {
            showNotification(STRINGS.ERROR_INVALID_EMAIL, 'error');
            emailInput.focus();
            return;
        }

        const otpContainer = document.getElementById('otp-container');
        const sendBtn = document.getElementById('btn-send-email-otp') || emailInput.nextElementSibling;

        setButtonLoading(sendBtn, true, STRINGS.SENDING, STRINGS.GET_OTP);

        try {
            const data = await fetchWithTimeout('/auth/send-otp', {
                method: 'POST',
                body: JSON.stringify({ identifier: email, type: 'email' })
            }, 'send-email-otp');

            if (data.success) {
                showNotification(data.message || STRINGS.SUCCESS_OTP_SENT, 'success');
                if (otpContainer) otpContainer.classList.remove('hidden');
            } else {
                showNotification(data.message || 'Failed to send OTP', 'error');
            }
        } catch (error) {
            Logger.error('Send OTP error:', error);
            showNotification(error.message || STRINGS.ERROR_GENERIC, 'error');
        } finally {
            setButtonLoading(sendBtn, false, '', STRINGS.GET_OTP);
        }
    }

    /**
     * Send OTP to mobile
     */
    async function sendMobileOTP() {
        const phoneInput = document.getElementById('phone');
        if (!phoneInput) return;

        const phone = phoneInput.value.trim();
        if (!isValidPhone(phone)) {
            showNotification(STRINGS.ERROR_INVALID_PHONE, 'error');
            phoneInput.focus();
            return;
        }

        const otpContainer = document.getElementById('mobile-otp-container');
        const sendBtn = document.getElementById('btn-send-mobile-otp') || phoneInput.nextElementSibling;
        const btn = (sendBtn && sendBtn.tagName === 'BUTTON') ? sendBtn : null;

        setButtonLoading(btn, true, STRINGS.SENDING, STRINGS.GET_OTP);

        try {
            const data = await fetchWithTimeout('/auth/send-otp', {
                method: 'POST',
                body: JSON.stringify({ identifier: phone, type: 'phone' })
            }, 'send-mobile-otp');

            if (data.success) {
                showNotification(data.message || STRINGS.SUCCESS_OTP_SENT, 'success');
                if (otpContainer) otpContainer.classList.remove('hidden');
            } else {
                showNotification(data.message || 'Failed to send OTP', 'error');
            }
        } catch (error) {
            Logger.error('Send Mobile OTP error:', error);
            showNotification(error.message || STRINGS.ERROR_GENERIC, 'error');
        } finally {
            setButtonLoading(btn, false, '', STRINGS.GET_OTP);
        }
    }

    // =========================================================================
    // SIGNUP VALIDATION
    // =========================================================================

    /**
     * Validate signup form
     * [15.4] Password complexity validation
     * @param {Event} event - Form submit event
     * @returns {boolean} Valid or not
     */
    function validateSignup(event) {
        const passwordInput = document.getElementById('password');
        const confirmPasswordInput = document.getElementById('confirm-password');
        const otpInput = document.getElementById('otp');
        const mobileOtpInput = document.getElementById('mobile-otp');

        if (!passwordInput || !confirmPasswordInput) return true;

        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        // Validate OTPs if present
        const otp = otpInput?.value || '';
        const mobileOtp = mobileOtpInput?.value || '';

        if (otpInput && !isValidOTP(otp)) {
            event.preventDefault();
            showNotification(STRINGS.ERROR_INVALID_OTP.replace('{length}', CONFIG.OTP_LENGTH), 'error');
            otpInput.focus();
            return false;
        }

        if (mobileOtpInput && !isValidOTP(mobileOtp)) {
            event.preventDefault();
            showNotification(STRINGS.ERROR_INVALID_OTP.replace('{length}', CONFIG.OTP_LENGTH), 'error');
            mobileOtpInput.focus();
            return false;
        }

        // Validate password complexity
        const passwordValidation = validatePassword(password);
        if (!passwordValidation.valid) {
            event.preventDefault();
            showNotification(`Password requirements: ${passwordValidation.errors.join(', ')}`, 'error');
            passwordInput.focus();
            return false;
        }

        // Check password match
        if (password !== confirmPassword) {
            event.preventDefault();
            showNotification(STRINGS.ERROR_PASSWORD_MISMATCH, 'error');
            confirmPasswordInput.focus();
            return false;
        }

        return true;
    }

    // =========================================================================
    // PASSWORD RESET FLOW
    // =========================================================================

    /**
     * Create input element for password reset
     * [15.11] createElement instead of innerHTML
     * @param {string} type - Input type
     * @param {string} id - Input ID
     * @param {string} placeholder - Placeholder text
     * @param {object} attrs - Additional attributes
     * @returns {HTMLElement} Input wrapper
     */
    function createResetInput(type, id, placeholder, attrs = {}) {
        const wrapper = document.createElement('div');
        wrapper.className = 'relative';

        const iconSpan = document.createElement('span');
        iconSpan.className = 'absolute inset-y-0 left-0 w-11 flex items-center justify-center text-slate-400 pointer-events-none';

        const icon = document.createElement('i');
        icon.className = `fa-solid ${type === 'email' ? 'fa-envelope' : 'fa-phone'} text-sm`;
        iconSpan.appendChild(icon);

        const input = document.createElement('input');
        input.type = type === 'tel' ? 'tel' : type;
        input.id = id;
        input.className = 'w-full pl-10 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all';
        input.placeholder = placeholder;
        input.required = true;
        input.setAttribute('autocomplete', type === 'email' ? 'email' : 'tel');

        if (type === 'tel') {
            input.className += ' font-mono';
            input.pattern = '[0-9]{10,15}';
            input.maxLength = 15;
            input.addEventListener('input', function() {
                this.value = this.value.replace(/[^0-9+]/g, '');
            });
        }

        Object.entries(attrs).forEach(([key, value]) => {
            input.setAttribute(key, value);
        });

        wrapper.appendChild(iconSpan);
        wrapper.appendChild(input);

        return wrapper;
    }

    /**
     * Switch to email reset method
     * [15.11] createElement instead of innerHTML
     */
    function switchToEmail() {
        state.resetMethod = 'email';
        const container = document.getElementById('identifier-section');
        if (!container) return;

        const label = container.querySelector('label');
        const inputWrapper = container.querySelector('.relative');
        const hint = container.querySelector('p.text-xs');
        const link = container.querySelector('p.text-sm');

        if (!label || !inputWrapper) return;

        label.textContent = 'Email Address';

        // Replace input wrapper content using createElement
        const newWrapper = createResetInput('email', 'reset-email', 'your@email.com');
        inputWrapper.replaceWith(newWrapper);

        if (hint) hint.textContent = "We'll send an OTP to verify your identity.";

        if (link) {
            link.innerHTML = '';
            const switchLink = document.createElement('a');
            switchLink.href = '#';
            switchLink.id = 'switch-phone-btn';
            switchLink.className = 'text-blue-600 hover:text-blue-700 hover:underline font-medium';
            switchLink.textContent = STRINGS.SWITCH_TO_PHONE;
            switchLink.addEventListener('click', (e) => {
                e.preventDefault();
                switchToPhone();
            });
            link.appendChild(switchLink);
        }

        Logger.debug('Switched to email reset method');
    }

    /**
     * Switch to phone reset method
     * [15.11] createElement instead of innerHTML
     */
    function switchToPhone() {
        state.resetMethod = 'phone';
        const container = document.getElementById('identifier-section');
        if (!container) return;

        const label = container.querySelector('label');
        const inputWrapper = container.querySelector('.relative');
        const hint = container.querySelector('p.text-xs');
        const link = container.querySelector('p.text-sm');

        if (!label || !inputWrapper) return;

        label.textContent = 'Phone Number';

        // Replace input wrapper content using createElement
        const newWrapper = createResetInput('tel', 'reset-phone', '9876543210');
        inputWrapper.replaceWith(newWrapper);

        if (hint) hint.textContent = "We'll send an OTP to verify your identity.";

        if (link) {
            link.innerHTML = '';
            const switchLink = document.createElement('a');
            switchLink.href = '#';
            switchLink.id = 'switch-email-btn';
            switchLink.className = 'text-blue-600 hover:text-blue-700 hover:underline font-medium';
            switchLink.textContent = STRINGS.SWITCH_TO_EMAIL;
            switchLink.addEventListener('click', (e) => {
                e.preventDefault();
                switchToEmail();
            });
            link.appendChild(switchLink);
        }

        Logger.debug('Switched to phone reset method');
    }

    /**
     * Send password reset OTP
     */
    async function sendResetOTP() {
        let identifier;
        let input;

        if (state.resetMethod === 'phone') {
            input = document.getElementById('reset-phone');
            identifier = input?.value.trim();

            if (!isValidPhone(identifier)) {
                showNotification(STRINGS.ERROR_INVALID_PHONE, 'error');
                input?.focus();
                return;
            }
        } else {
            input = document.getElementById('reset-email');
            identifier = input?.value.trim();

            if (!isValidEmail(identifier)) {
                showNotification(STRINGS.ERROR_INVALID_EMAIL, 'error');
                input?.focus();
                return;
            }
        }

        const sendBtn = document.querySelector('#identifier-section button');
        setButtonLoading(sendBtn, true, STRINGS.SENDING);

        try {
            const data = await fetchWithTimeout('/auth/forgot-password', {
                method: 'POST',
                body: JSON.stringify({ identifier, type: state.resetMethod })
            }, 'send-reset-otp');

            if (data.success) {
                // [15.3] Store in module state, not global
                state.resetIdentifier = identifier;
                showNotification(data.message || STRINGS.SUCCESS_OTP_SENT, 'success');

                const identifierSection = document.getElementById('identifier-section');
                const otpSection = document.getElementById('otp-section');

                if (identifierSection) identifierSection.classList.add('hidden');
                if (otpSection) otpSection.classList.remove('hidden');
            } else {
                showNotification(data.message || 'Error sending OTP', 'error');
            }
        } catch (error) {
            Logger.error('Send reset OTP error:', error);
            showNotification(error.message || STRINGS.ERROR_GENERIC, 'error');
        } finally {
            setButtonLoading(sendBtn, false);
        }
    }

    /**
     * Verify password reset OTP
     */
    async function verifyResetOTP() {
        const otpInput = document.getElementById('reset-otp');
        const otp = otpInput?.value.trim();

        if (!isValidOTP(otp)) {
            showNotification(STRINGS.ERROR_INVALID_OTP.replace('{length}', CONFIG.OTP_LENGTH), 'error');
            otpInput?.focus();
            return;
        }

        const verifyBtn = document.querySelector('#otp-section button');
        setButtonLoading(verifyBtn, true, STRINGS.VERIFYING);

        try {
            const data = await fetchWithTimeout('/auth/verify-reset-otp', {
                method: 'POST',
                body: JSON.stringify({ identifier: state.resetIdentifier, otp })
            }, 'verify-reset-otp');

            if (data.success) {
                const otpSection = document.getElementById('otp-section');
                const passwordSection = document.getElementById('password-section');

                if (otpSection) otpSection.classList.add('hidden');
                if (passwordSection) passwordSection.classList.remove('hidden');
            } else {
                showNotification(data.message || 'Invalid OTP', 'error');
                if (otpInput) {
                    otpInput.value = '';
                    otpInput.focus();
                }
            }
        } catch (error) {
            Logger.error('Verify reset OTP error:', error);
            showNotification(error.message || STRINGS.ERROR_GENERIC, 'error');
        } finally {
            setButtonLoading(verifyBtn, false);
        }
    }

    /**
     * Submit password reset
     * [15.4] Password complexity validation
     */
    async function submitPasswordReset() {
        const newPasswordInput = document.getElementById('new-password');
        const confirmPasswordInput = document.getElementById('confirm-new-password');

        const newPassword = newPasswordInput?.value || '';
        const confirmPassword = confirmPasswordInput?.value || '';

        if (!newPassword || !confirmPassword) {
            showNotification('Please fill in both password fields', 'error');
            return;
        }

        // Validate password complexity
        const passwordValidation = validatePassword(newPassword);
        if (!passwordValidation.valid) {
            showNotification(`Password requirements: ${passwordValidation.errors.join(', ')}`, 'error');
            newPasswordInput?.focus();
            return;
        }

        if (newPassword !== confirmPassword) {
            showNotification(STRINGS.ERROR_PASSWORD_MISMATCH, 'error');
            confirmPasswordInput?.focus();
            return;
        }

        const otpInput = document.getElementById('reset-otp');
        const otp = otpInput?.value.trim();

        const submitBtn = document.querySelector('#password-section button');
        setButtonLoading(submitBtn, true, STRINGS.RESETTING);

        try {
            const data = await fetchWithTimeout('/auth/reset-password', {
                method: 'POST',
                body: JSON.stringify({
                    identifier: state.resetIdentifier,
                    otp,
                    newPassword
                })
            }, 'submit-password-reset');

            if (data.success) {
                showNotification(STRINGS.SUCCESS_PASSWORD_RESET, 'success');

                // Clear sensitive state
                state.resetIdentifier = '';

                // [15.23] Safe redirect
                setTimeout(() => {
                    window.location.href = '/login';
                }, 2000);
            } else {
                showNotification(data.message || 'Error resetting password', 'error');
            }
        } catch (error) {
            Logger.error('Submit password reset error:', error);
            showNotification(error.message || STRINGS.ERROR_GENERIC, 'error');
        } finally {
            setButtonLoading(submitBtn, false);
        }
    }

    /**
     * Verify OTP (for verifyOTP.ejs page)
     * [15.7] Consistent OTP length
     */
    async function verifyOTP() {
        const otpInputs = document.querySelectorAll('.otp-input');
        let otp = '';
        otpInputs.forEach(input => {
            otp += input.value;
        });

        // Support both 4 and 6 digit OTPs for backward compatibility
        const expectedLength = otpInputs.length || CONFIG.OTP_LENGTH;

        if (otp.length !== expectedLength || !/^\d+$/.test(otp)) {
            showNotification(`Please enter a valid ${expectedLength}-digit OTP`, 'error');
            if (otpInputs[0]) otpInputs[0].focus();
            return;
        }

        // If we have a form, let it handle submission
        const form = document.querySelector('form');
        if (form) {
            // Create hidden input with combined OTP
            let hiddenOtp = form.querySelector('input[name="otp"]');
            if (!hiddenOtp) {
                hiddenOtp = document.createElement('input');
                hiddenOtp.type = 'hidden';
                hiddenOtp.name = 'otp';
                form.appendChild(hiddenOtp);
            }
            hiddenOtp.value = otp;
            form.submit();
        }
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize auth functionality
     */
    function initialize() {
        Logger.debug('Initializing auth.js');

        // Login Method Toggle
        const btnUsername = document.getElementById('btn-username');
        const btnEmail = document.getElementById('btn-email');
        const btnPhone = document.getElementById('btn-phone');

        if (btnUsername) btnUsername.addEventListener('click', () => setLoginMethod('username'));
        if (btnEmail) btnEmail.addEventListener('click', () => setLoginMethod('email'));
        if (btnPhone) btnPhone.addEventListener('click', () => setLoginMethod('phone'));

        // Password Toggle - [15.26] ARIA attributes
        document.querySelectorAll('.toggle-password-btn').forEach(btn => {
            btn.setAttribute('aria-label', 'Show password');
            btn.setAttribute('role', 'button');
            btn.addEventListener('click', function() {
                const inputId = this.getAttribute('data-target');
                togglePassword(inputId, this);
            });
        });

        // Signup Validation
        const signupForm = document.querySelector('form[action="/auth/register"]');
        if (signupForm) {
            signupForm.addEventListener('submit', validateSignup);
        }

        // Live Existence Check with debouncing [15.16]
        const checkFields = [
            { id: 'username', field: 'username' },
            { id: 'email', field: 'email' },
            { id: 'phone', field: 'phone' }
        ];

        checkFields.forEach(({ id, field }) => {
            const input = document.getElementById(id);
            if (input) {
                input.addEventListener('blur', () => {
                    const value = input.value.trim();
                    if (!value) return;

                    debounce(`check-${field}`, () => {
                        checkExistence(field, value, input);
                    });
                });
            }
        });

        // OTP Inputs Auto-focus [15.27] Keyboard navigation
        const otpInputs = document.querySelectorAll('.otp-input');
        if (otpInputs.length > 0) {
            otpInputs.forEach((input, index) => {
                input.setAttribute('aria-label', `OTP digit ${index + 1}`);
                input.setAttribute('autocomplete', 'one-time-code');

                input.addEventListener('input', (e) => {
                    // Only allow digits
                    e.target.value = e.target.value.replace(/[^0-9]/g, '');

                    if (e.target.value.length === 1 && index < otpInputs.length - 1) {
                        otpInputs[index + 1].focus();
                    }
                });

                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Backspace' && e.target.value === '' && index > 0) {
                        otpInputs[index - 1].focus();
                    }

                    // Arrow key navigation
                    if (e.key === 'ArrowLeft' && index > 0) {
                        otpInputs[index - 1].focus();
                    }
                    if (e.key === 'ArrowRight' && index < otpInputs.length - 1) {
                        otpInputs[index + 1].focus();
                    }
                });

                // Handle paste
                input.addEventListener('paste', (e) => {
                    e.preventDefault();
                    const pastedData = (e.clipboardData || window.clipboardData).getData('text');
                    const digits = pastedData.replace(/[^0-9]/g, '').split('');

                    otpInputs.forEach((inp, i) => {
                        if (digits[i]) {
                            inp.value = digits[i];
                        }
                    });

                    // Focus last filled or next empty
                    const lastIndex = Math.min(digits.length, otpInputs.length) - 1;
                    if (lastIndex >= 0) {
                        otpInputs[lastIndex].focus();
                    }
                });
            });
        }

        // Bind OTP buttons
        const emailInput = document.getElementById('email');
        if (emailInput) {
            const sendEmailBtn = emailInput.nextElementSibling;
            if (sendEmailBtn && sendEmailBtn.tagName === 'BUTTON') {
                sendEmailBtn.addEventListener('click', sendOTP);
            }
        }

        const phoneInput = document.getElementById('phone');
        if (phoneInput) {
            const sendPhoneBtn = phoneInput.nextElementSibling;
            if (sendPhoneBtn && sendPhoneBtn.tagName === 'BUTTON') {
                sendPhoneBtn.addEventListener('click', sendMobileOTP);
            }
        }

        // Password Reset Buttons - remove inline handlers
        const sendResetBtn = document.querySelector('button[onclick="sendResetOTP()"]');
        if (sendResetBtn) {
            sendResetBtn.removeAttribute('onclick');
            sendResetBtn.addEventListener('click', sendResetOTP);
        }

        const verifyResetBtn = document.querySelector('button[onclick="verifyResetOTP()"]');
        if (verifyResetBtn) {
            verifyResetBtn.removeAttribute('onclick');
            verifyResetBtn.addEventListener('click', verifyResetOTP);
        }

        const submitResetBtn = document.querySelector('button[onclick="submitPasswordReset()"]');
        if (submitResetBtn) {
            submitResetBtn.removeAttribute('onclick');
            submitResetBtn.addEventListener('click', submitPasswordReset);
        }

        // Switch Links
        const switchEmailLink = document.getElementById('switch-email-btn');
        if (switchEmailLink) {
            switchEmailLink.addEventListener('click', (e) => {
                e.preventDefault();
                switchToEmail();
            });
        }

        const switchPhoneLink = document.getElementById('switch-phone-btn');
        if (switchPhoneLink) {
            switchPhoneLink.addEventListener('click', (e) => {
                e.preventDefault();
                switchToPhone();
            });
        }

        Logger.debug('Auth.js initialization complete');
    }

    // Run initialization when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // =========================================================================
    // PUBLIC API (for legacy onclick handlers if still needed)
    // =========================================================================
    window.AuthModule = {
        setLoginMethod,
        togglePassword,
        sendOTP,
        sendMobileOTP,
        validateSignup,
        switchToEmail,
        switchToPhone,
        sendResetOTP,
        verifyResetOTP,
        submitPasswordReset,
        verifyOTP,
        // Utilities
        validatePassword,
        isValidEmail,
        isValidPhone,
        showNotification
    };

    // Legacy global function bindings for onclick handlers
    window.setLoginMethod = setLoginMethod;
    window.togglePassword = togglePassword;
    window.sendOTP = sendOTP;
    window.sendMobileOTP = sendMobileOTP;
    window.switchToEmail = switchToEmail;
    window.switchToPhone = switchToPhone;
    window.sendResetOTP = sendResetOTP;
    window.verifyResetOTP = verifyResetOTP;
    window.submitPasswordReset = submitPasswordReset;
    window.verifyOTP = verifyOTP;

})();
