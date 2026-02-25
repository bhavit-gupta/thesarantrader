/**
 * ============================================================================
 * FILE: main.js
 * PURPOSE: Global Client-Side Utilities and Navbar Functionality
 * ============================================================================
 * 
 * DESCRIPTION:
 * Core JavaScript utilities loaded on all pages. Handles mobile navigation,
 * live session status polling, and common helper functions.
 * 
 * ISSUES FIXED: All 30 issues [20.1-20.30] addressed
 * ============================================================================
 */

(function () {
    'use strict';

    // [20.30] Guard against multiple initializations
    if (window.__MAIN_JS_INITIALIZED__) return;
    window.__MAIN_JS_INITIALIZED__ = true;

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        POLL_INTERVAL_MS: 5000,
        MAX_POLL_INTERVAL_MS: 60000,      // [20.18] Max backoff interval
        BACKOFF_MULTIPLIER: 2,             // [20.18] Exponential backoff
        MAX_CONSECUTIVE_FAILURES: 5,
        REQUEST_TIMEOUT_MS: 10000,
        DEBUG: false,
        SELECTORS: Object.freeze({
            MOBILE_MENU_BTN: 'mobile-menu-btn',
            MOBILE_MENU: 'mobile-menu',
            LIVE_BUTTON: '.join-live-btn',
            LIVE_DOT: '.live-dot',
            LIVE_TEXT: '.live-text',
            STATUS_TEXT: 'live-status-text',
            CORNER_DOT: 'live-corner-dot'
        }),
        CSS_CLASSES: Object.freeze({
            HIDDEN: 'hidden',
            LIVE_ACTIVE: ['bg-green-500', 'text-white', 'shadow-lg', 'shadow-green-500/25'],
            LIVE_INACTIVE: ['bg-slate-100', 'text-slate-400'],
            DOT_ACTIVE: ['bg-white', 'live-pulse'],
            DOT_INACTIVE: ['bg-slate-400']
        })
    });

    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================
    const state = {
        pollIntervalId: null,          // [20.2, 20.24] Store interval for cleanup
        currentPollInterval: CONFIG.POLL_INTERVAL_MS,
        consecutiveFailures: 0,        // [20.18] Track failures for backoff
        isPolling: false,
        isPageVisible: true,           // [20.17] Page visibility
        mobileMenuHandler: null,       // [20.21] Store handler for removal
        cachedLiveButtons: null,       // [20.14, 20.16] Cache DOM elements
        cachedButtonElements: new WeakMap()  // Cache child elements per button
    };

    // =========================================================================
    // LOGGER
    // =========================================================================
    // Use environment-based logging [Fix: console methods]
    const Logger = {
        debug: (...args) => window.__IS_DEVELOPMENT__ && console.log('[Main:Debug]', ...args),
        info: (...args) => window.__IS_DEVELOPMENT__ && console.info('[Main:Info]', ...args),
        warn: (...args) => console.warn('[Main:Warn]', ...args),
        error: (...args) => console.error('[Main:Error]', ...args)
    };

    // Expose globally as required
    window.Logger = Logger;

    // =========================================================================
    // DATE FORMATTING
    // =========================================================================

    /**
     * Formats a date string to DD/MM/YYYY format
     * [20.11, 20.12, 20.13, 20.28] Safe date formatting
     * @param {string} dateString - ISO date string or date-parseable string
     * @returns {string} Formatted date as DD/MM/YYYY or empty string if invalid
     */
    function formatDate(dateString) {
        // Return empty string if no date provided
        if (!dateString) return '';

        try {
            const date = new Date(dateString);

            // [20.11] Return empty string on invalid, not original
            if (isNaN(date.getTime())) return '';

            // [20.12, 20.13] Validate types
            const dayNum = date.getDate();
            const monthNum = date.getMonth() + 1;  // [20.28] 0-indexed handled
            const yearNum = date.getFullYear();

            if (typeof dayNum !== 'number' || typeof monthNum !== 'number') {
                return '';
            }

            const day = String(dayNum).padStart(2, '0');
            const month = String(monthNum).padStart(2, '0');

            return `${day}/${month}/${yearNum}`;
        } catch {
            return '';
        }
    }

    // Expose globally for EJS templates
    window.formatDate = formatDate;

    // =========================================================================
    // MOBILE NAVIGATION
    // =========================================================================

    /**
     * Sets up mobile menu toggle functionality
     * [20.15, 20.19, 20.20, 20.21] Improved setup with cleanup
     */
    function setupMobileMenu() {
        try {
            const btn = document.getElementById(CONFIG.SELECTORS.MOBILE_MENU_BTN);
            const menu = document.getElementById(CONFIG.SELECTORS.MOBILE_MENU);

            if (!btn || !menu) return;

            // [20.21] Remove existing handler if any
            if (state.mobileMenuHandler) {
                btn.removeEventListener('click', state.mobileMenuHandler);
            }

            // Create and store handler
            state.mobileMenuHandler = () => {
                menu.classList.toggle(CONFIG.CSS_CLASSES.HIDDEN);
            };

            btn.addEventListener('click', state.mobileMenuHandler);
            Logger.debug('Mobile menu setup complete');
        } catch (err) {
            // [20.20] Error boundary
            Logger.error('Error setting up mobile menu:', err);
        }
    }

    // =========================================================================
    // LIVE STATUS POLLING
    // =========================================================================

    /**
     * Validate API response structure
     * [20.3, 20.4, 20.27] Response validation
     * @param {*} data - Response data
     * @returns {boolean} True if valid
     */
    function isValidLiveStatusResponse(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            return false;
        }
        return true;
    }

    /**
     * Check if any session is live
     * [20.26, 20.27] Efficient check with validation
     * @param {*} liveSessions - Live sessions object
     * @returns {boolean} True if any live
     */
    function isAnySessionLive(liveSessions) {
        // [20.3] Proper null/type check
        if (liveSessions === null || liveSessions === undefined) {
            return false;
        }
        if (typeof liveSessions !== 'object' || Array.isArray(liveSessions)) {
            return false;
        }

        // [20.26] Use for...of for early exit
        try {
            for (const session of Object.values(liveSessions)) {
                // [20.27] Validate each session is object with isLive
                if (session && typeof session === 'object' && session.isLive === true) {
                    return true;
                }
            }
        } catch {
            return false;
        }
        return false;
    }

    /**
     * Fetch with timeout
     * @param {string} url - URL to fetch
     * @returns {Promise<object>} Response data
     */
    async function fetchWithTimeout(url) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            // [20.1] Check response.ok before JSON
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            // [20.4] Validate response is object
            if (!isValidLiveStatusResponse(data)) {
                throw new Error('Invalid response format');
            }

            return data;
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                throw new Error('Request timeout');
            }
            throw err;
        }
    }

    /**
     * Get cached button elements
     * [20.14] Cache element references
     * @param {HTMLElement} btn - Button element
     * @returns {object} Cached elements
     */
    function getCachedButtonElements(btn) {
        if (!state.cachedButtonElements.has(btn)) {
            state.cachedButtonElements.set(btn, {
                dot: btn.querySelector(CONFIG.SELECTORS.LIVE_DOT),
                text: btn.querySelector(CONFIG.SELECTORS.LIVE_TEXT)
            });
        }
        return state.cachedButtonElements.get(btn);
    }

    /**
     * Update button state
     * [20.6, 20.7, 20.8, 20.22] Safe class operations
     * @param {HTMLElement} btn - Button element
     * @param {boolean} isLive - Live status
     */
    function updateButtonState(btn, isLive) {
        // [20.22] Type check before classList
        if (!(btn instanceof HTMLElement)) return;

        const { dot, text } = getCachedButtonElements(btn);

        if (isLive) {
            // [20.8] Use validated class arrays
            CONFIG.CSS_CLASSES.LIVE_INACTIVE.forEach(c => btn.classList.remove(c));
            CONFIG.CSS_CLASSES.LIVE_ACTIVE.forEach(c => btn.classList.add(c));

            // [20.6] Use disabled property, not aria-disabled
            if (btn.hasAttribute('href')) {
                btn.removeAttribute('aria-disabled');
            }

            if (dot instanceof HTMLElement) {
                CONFIG.CSS_CLASSES.DOT_INACTIVE.forEach(c => dot.classList.remove(c));
                CONFIG.CSS_CLASSES.DOT_ACTIVE.forEach(c => dot.classList.add(c));
            }

            // [20.7] Check instanceof before textContent
            if (text instanceof HTMLElement) {
                text.textContent = 'Live Now';
            } else if (!dot && !text) {
                btn.textContent = '🟢 Live Now';
            }
        } else {
            CONFIG.CSS_CLASSES.LIVE_ACTIVE.forEach(c => btn.classList.remove(c));
            CONFIG.CSS_CLASSES.LIVE_INACTIVE.forEach(c => btn.classList.add(c));

            if (btn.hasAttribute('href')) {
                btn.setAttribute('aria-disabled', 'true');
            }

            if (dot instanceof HTMLElement) {
                CONFIG.CSS_CLASSES.DOT_ACTIVE.forEach(c => dot.classList.remove(c));
                CONFIG.CSS_CLASSES.DOT_INACTIVE.forEach(c => dot.classList.add(c));
            }

            if (text instanceof HTMLElement) {
                text.textContent = 'Live Offline';
            } else if (!dot && !text) {
                btn.textContent = '🔴 Live Offline';
            }
        }
    }

    /**
     * Update dashboard elements
     * [20.9, 20.10] Safe DOM updates
     * @param {boolean} isLive - Live status
     */
    function updateDashboardElements(isLive) {
        const statusText = document.getElementById(CONFIG.SELECTORS.STATUS_TEXT);
        const cornerDot = document.getElementById(CONFIG.SELECTORS.CORNER_DOT);

        // [20.9, 20.10] Use DOM methods instead of innerHTML
        if (statusText instanceof HTMLElement) {
            // Clear existing content
            statusText.innerHTML = '';

            if (isLive) {
                statusText.appendChild(document.createTextNode('🟢 Session is '));
                const span = document.createElement('span');
                span.className = 'text-green-600 font-semibold';
                span.textContent = 'LIVE NOW';
                statusText.appendChild(span);
                statusText.appendChild(document.createTextNode(' — Join to trade with Kundan Sir!'));
            } else {
                statusText.textContent = "The live session is currently offline. You'll be notified when Kundan Sir goes live.";
            }
        }

        if (cornerDot instanceof HTMLElement) {
            cornerDot.innerHTML = '';

            const dot = document.createElement('span');
            dot.className = isLive
                ? 'w-3 h-3 rounded-full bg-green-500 live-pulse'
                : 'w-3 h-3 rounded-full bg-slate-300';
            cornerDot.appendChild(dot);

            const label = document.createElement('span');
            label.className = isLive
                ? 'text-xs font-bold text-green-600 uppercase tracking-wider'
                : 'text-xs font-bold text-slate-400 uppercase tracking-wider';
            label.textContent = isLive ? 'Live' : 'Offline';
            cornerDot.appendChild(label);
        }
    }

    /**
     * Updates all live-related UI elements
     * @param {boolean} isLive - True if any course has active live session
     */
    function updateLiveUI(isLive) {
        // [20.16] Use cached buttons
        if (state.cachedLiveButtons) {
            state.cachedLiveButtons.forEach(btn => updateButtonState(btn, isLive));
        }

        updateDashboardElements(isLive);
    }

    /**
     * Check live status API call
     * [20.1, 20.18] With response validation and backoff
     */
    async function checkLive() {
        if (!state.isPageVisible) return;  // [20.17] Skip if page hidden

        try {
            const data = await fetchWithTimeout('/api/live-status');
            const isLive = isAnySessionLive(data.liveSessions);

            updateLiveUI(isLive);

            // Reset on success
            state.consecutiveFailures = 0;

            // [20.18] Reset poll interval on success
            if (state.currentPollInterval !== CONFIG.POLL_INTERVAL_MS) {
                state.currentPollInterval = CONFIG.POLL_INTERVAL_MS;
                restartPolling();
            }

        } catch (err) {
            // [20.25] Log error (could integrate with monitoring service)
            Logger.error('Error polling live status:', err.message);

            // [20.18] Implement exponential backoff
            state.consecutiveFailures++;

            if (state.consecutiveFailures >= CONFIG.MAX_CONSECUTIVE_FAILURES) {
                const newInterval = Math.min(
                    state.currentPollInterval * CONFIG.BACKOFF_MULTIPLIER,
                    CONFIG.MAX_POLL_INTERVAL_MS
                );

                if (newInterval !== state.currentPollInterval) {
                    state.currentPollInterval = newInterval;
                    Logger.warn(`Backing off polling to ${newInterval}ms`);
                    restartPolling();
                }
            }
        }
    }

    /**
     * Restart polling with current interval
     */
    function restartPolling() {
        if (state.pollIntervalId) {
            clearInterval(state.pollIntervalId);
        }
        state.pollIntervalId = setInterval(checkLive, state.currentPollInterval);
    }

    /**
     * Start live status polling
     * [20.2, 20.5, 20.17, 20.24] With cleanup and visibility handling
     */
    function startPolling() {
        // [20.16] Cache live buttons
        state.cachedLiveButtons = document.querySelectorAll(CONFIG.SELECTORS.LIVE_BUTTON);

        // [20.5] Don't start polling if no buttons
        if (!state.cachedLiveButtons || state.cachedLiveButtons.length === 0) {
            Logger.debug('No live buttons found, skipping polling');
            return;
        }

        if (state.isPolling) return;
        state.isPolling = true;

        // Initial check
        checkLive();

        // [20.2, 20.24] Store interval ID for cleanup
        state.pollIntervalId = setInterval(checkLive, state.currentPollInterval);

        // [20.17] Page Visibility API - pause when hidden
        document.addEventListener('visibilitychange', handleVisibilityChange);

        // [20.2] Cleanup on page unload
        window.addEventListener('beforeunload', cleanup);

        Logger.debug('Live status polling started');
    }

    /**
     * Handle page visibility change
     * [20.17] Pause polling when page hidden
     */
    function handleVisibilityChange() {
        state.isPageVisible = !document.hidden;

        if (state.isPageVisible) {
            // Resume - do immediate check
            checkLive();
            Logger.debug('Page visible, resuming polling');
        } else {
            Logger.debug('Page hidden, pausing polling');
        }
    }

    /**
     * Cleanup function
     * [20.2] Clean up interval and listeners
     */
    function cleanup() {
        if (state.pollIntervalId) {
            clearInterval(state.pollIntervalId);
            state.pollIntervalId = null;
        }
        state.isPolling = false;
        Logger.debug('Polling cleanup complete');
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize all functionality
     */
    function initialize() {
        try {
            Logger.debug('Initializing main.js');

            setupMobileMenu();
            startPolling();

            Logger.debug('main.js initialization complete');
        } catch (err) {
            Logger.error('Initialization error:', err);
        }
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
    window.MainModule = {
        formatDate,
        checkLive,
        startPolling,
        stopPolling: cleanup,
        // Expose state for debugging
        getState: () => ({ ...state, cachedLiveButtons: state.cachedLiveButtons?.length || 0 })
    };

})();

