/**
 * ============================================================================
 * FILE: testimonials.js
 * PURPOSE: Homepage testimonials section dynamic loading
 * ============================================================================
 * 
 * DESCRIPTION:
 * Fetches and displays a limited set of approved testimonials on the homepage.
 * Shows only the 5 most recent testimonials with gradient avatars, star ratings,
 * and responsive card layout. Handles loading, empty, and error states.
 * 
 * ISSUES FIXED: All 30 issues [21.1-21.30] addressed
 * ============================================================================
 */

(function () {
    'use strict';

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        REQUEST_TIMEOUT_MS: 15000,
        MAX_TESTIMONIALS: 6,
        MAX_RATING: 5,
        MIN_RATING: 1,
        CACHE_KEY: 'testimonials_cache',
        CACHE_EXPIRY_MS: 60 * 60 * 1000, //  1 hour cache
        DEBUG: false,
        SELECTORS: Object.freeze({
            GRID: 'testimonials-grid'
        }),
        //  Centralized class names
        CLASSES: Object.freeze({
            CARD: 'bg-white p-8 rounded-2xl shadow-sm border border-slate-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300 group relative overflow-hidden',
            STAR: 'fa-solid fa-star text-yellow-400',
            ACCENT_LINE: 'absolute top-0 left-0 w-full h-1 bg-gradient-to-r opacity-0 group-hover:opacity-100 transition-opacity',
            STAR_CONTAINER: 'flex gap-1 mb-4',
            MESSAGE: 'text-slate-600 leading-relaxed mb-6 italic',
            AUTHOR_CONTAINER: 'flex items-center gap-4',
            AVATAR: 'w-12 h-12 rounded-full flex items-center justify-center text-white font-bold text-lg shadow-md bg-gradient-to-br',
            AUTHOR_NAME: 'text-sm font-bold text-slate-800',
            AUTHOR_ROLE: 'text-xs text-slate-500'
        })
    });

    // =========================================================================
    // I18N STRINGS
    // =========================================================================
    const STRINGS = Object.freeze({
        LOADING: 'Loading testimonials...',
        ERROR_FETCH: 'Failed to load testimonials. Please try again later.',
        ERROR_NETWORK: 'Network error. Please check your connection.',
        ERROR_TIMEOUT: 'Request timed out. Please try again.',
        NO_TESTIMONIALS: 'No testimonials yet',
        BE_FIRST: 'Be the first to share your experience!'
    });

    // [21.6, 21.27] Combined gradients object
    const GRADIENTS = Object.freeze([
        { avatar: 'from-blue-400 to-blue-600', accent: 'from-blue-500 to-purple-500' },
        { avatar: 'from-purple-400 to-purple-600', accent: 'from-purple-500 to-pink-500' },
        { avatar: 'from-green-400 to-teal-600', accent: 'from-green-500 to-teal-500' },
        { avatar: 'from-orange-400 to-red-600', accent: 'from-orange-500 to-red-500' },
        { avatar: 'from-indigo-400 to-blue-600', accent: 'from-indigo-500 to-blue-500' },
        { avatar: 'from-pink-400 to-rose-600', accent: 'from-pink-500 to-rose-500' }
    ]);

    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================
    const state = {
        testimonials: [],
        isLoading: false,
        abortController: null
    };

    // =========================================================================
    // LOGGER
    // =========================================================================
    const Logger = {
        debug: (...args) => CONFIG.DEBUG && console.log('[Testimonials:Debug]', ...args),
        info: (...args) => CONFIG.DEBUG && console.info('[Testimonials:Info]', ...args),
        warn: (...args) => console.warn('[Testimonials:Warn]', ...args),
        //  Only log safe message, not full error object
        error: (msg) => console.error('[Testimonials:Error]', msg)
    };

    // =========================================================================
    // VALIDATION UTILITIES
    // =========================================================================

    /**
     * Escape HTML to prevent XSS
     *  Fixed - complete function definition
     *  DOM-based escaping (safe and reliable)
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
     * Validate testimonial structure
     *  Required fields validation
     * @param {*} testimonial - Testimonial object
     * @returns {object|null} Validated testimonial or null
     */
    function validateTestimonial(testimonial) {
        if (!testimonial || typeof testimonial !== 'object') return null;

        //  Validate userName as string
        const userName = typeof testimonial.userName === 'string' && testimonial.userName.trim()
            ? testimonial.userName.trim()
            : null;

        if (!userName) return null;  // Required field

        // [21.4, 21.12] Validate rating as number 1-5
        let rating = 0;
        if (typeof testimonial.rating === 'number' &&
            Number.isInteger(testimonial.rating) &&
            testimonial.rating >= CONFIG.MIN_RATING &&
            testimonial.rating <= CONFIG.MAX_RATING) {
            rating = testimonial.rating;
        } else if (typeof testimonial.rating === 'string') {
            const parsed = parseInt(testimonial.rating, 10);
            if (!isNaN(parsed) && parsed >= CONFIG.MIN_RATING && parsed <= CONFIG.MAX_RATING) {
                rating = parsed;
            }
        }

        return {
            message: typeof testimonial.message === 'string' ? testimonial.message : '',
            userName,
            userRole: typeof testimonial.userRole === 'string' ? testimonial.userRole : 'User',
            rating: rating || CONFIG.MAX_RATING  // Default to 5 if invalid
        };
    }

    /**
     * Get gradient for index
     *  Safe gradient access with bounds checking
     * @param {number} index - Array index
     * @returns {object} Gradient object
     */
    function getGradient(index) {
        if (GRADIENTS.length === 0) {
            return { avatar: 'from-slate-400 to-slate-600', accent: 'from-slate-500 to-slate-700' };
        }
        return GRADIENTS[index % GRADIENTS.length];
    }

    /**
     * Get user initial
     *  Safe initial extraction
     * @param {string} userName - User name
     * @returns {string} Initial character
     */
    function getInitial(userName) {
        if (!userName || typeof userName !== 'string' || userName.length === 0) {
            return '?';
        }
        return userName.charAt(0).toUpperCase();
    }

    // =========================================================================
    // CACHE MANAGEMENT
    // =========================================================================

    /**
     * Get cached testimonials
     *  Cache with 1hr expiry
     * @returns {array|null} Cached testimonials or null
     */
    function getCachedTestimonials() {
        try {
            const cached = localStorage.getItem(CONFIG.CACHE_KEY);
            if (!cached) return null;

            const { timestamp, data } = JSON.parse(cached);
            if (Date.now() - timestamp > CONFIG.CACHE_EXPIRY_MS) {
                localStorage.removeItem(CONFIG.CACHE_KEY);
                return null;
            }

            if (Array.isArray(data)) {
                return data;
            }
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Set cached testimonials
     * @param {array} testimonials - Testimonials to cache
     */
    function setCachedTestimonials(testimonials) {
        try {
            localStorage.setItem(CONFIG.CACHE_KEY, JSON.stringify({
                timestamp: Date.now(),
                data: testimonials
            }));
        } catch {
            // Storage full or disabled - ignore
        }
    }

    // =========================================================================
    // FETCH WITH TIMEOUT
    // =========================================================================

    /**
     * Fetch with timeout
     * [21.1, 21.11, 21.25] Response validation and timeout
     * @param {string} url - URL to fetch
     * @returns {Promise<object>} Response data
     */
    async function fetchWithTimeout(url) {
        const controller = new AbortController();
        state.abortController = controller;

        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            //  Check response.ok before JSON parse
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            //  Validate response structure
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid response format');
            }

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
    // UI RENDERING
    // =========================================================================

    /**
     * Show loading state
     *  Loading indicator
     * @param {HTMLElement} grid - Grid element
     */
    function showLoading(grid) {
        grid.innerHTML = `
            <div class="col-span-full text-center py-12">
                <div class="animate-spin inline-block w-8 h-8 border-4 border-slate-300 border-t-blue-600 rounded-full mb-4"></div>
                <p class="text-slate-500">${escapeHtml(STRINGS.LOADING)}</p>
            </div>
        `;
    }

    /**
     * Show empty state
     *  Grid layout compatible
     * @param {HTMLElement} grid - Grid element
     */
    function showEmptyState(grid) {
        grid.innerHTML = `
            <div class="col-span-full bg-white rounded-2xl border border-dashed border-slate-300 p-12 text-center">
                <div class="text-5xl mb-4">💬</div>
                <h3 class="text-xl font-bold text-slate-800 mb-2">${escapeHtml(STRINGS.NO_TESTIMONIALS)}</h3>
                <p class="text-slate-500">${escapeHtml(STRINGS.BE_FIRST)}</p>
            </div>
        `;
    }

    /**
     * Show error state
     *  Error message display
     * @param {HTMLElement} grid - Grid element
     * @param {string} message - Error message
     */
    function showErrorState(grid, message) {
        grid.innerHTML = `
            <div class="col-span-full bg-red-50 rounded-2xl border border-red-200 p-8 text-center">
                <p class="text-red-600">${escapeHtml(message || STRINGS.ERROR_FETCH)}</p>
            </div>
        `;
    }

    /**
     * Create star rating element
     *  DOM-based star creation
     * @param {number} rating - Rating 1-5
     * @returns {HTMLElement} Star container
     */
    function createStarRating(rating) {
        const container = document.createElement('div');
        container.className = CONFIG.CLASSES.STAR_CONTAINER;

        const safeRating = Math.max(0, Math.min(CONFIG.MAX_RATING, rating));

        for (let i = 0; i < safeRating; i++) {
            const star = document.createElement('i');
            star.className = CONFIG.CLASSES.STAR;
            container.appendChild(star);
        }

        return container;
    }

    /**
     * Create testimonial card
     * [21.14, 21.21] DOM-based card creation
     * @param {object} testimonial - Validated testimonial
     * @param {number} index - Array index
     * @returns {HTMLElement} Card element
     */
    function createTestimonialCard(testimonial, index) {
        const gradient = getGradient(index);

        // Card container
        const card = document.createElement('div');
        card.className = CONFIG.CLASSES.CARD;

        // Accent line (top border on hover)
        const accentLine = document.createElement('div');
        accentLine.className = `${CONFIG.CLASSES.ACCENT_LINE} ${gradient.accent}`;
        card.appendChild(accentLine);

        // Star rating
        const stars = createStarRating(testimonial.rating);
        card.appendChild(stars);

        // Message
        const message = document.createElement('p');
        message.className = CONFIG.CLASSES.MESSAGE;
        message.textContent = `"${testimonial.message}"`;  // textContent escapes automatically
        card.appendChild(message);

        // Author container
        const authorContainer = document.createElement('div');
        authorContainer.className = CONFIG.CLASSES.AUTHOR_CONTAINER;

        // Avatar
        const avatar = document.createElement('div');
        avatar.className = `${CONFIG.CLASSES.AVATAR} ${gradient.avatar}`;
        avatar.textContent = getInitial(testimonial.userName);
        authorContainer.appendChild(avatar);

        // Author info
        const authorInfo = document.createElement('div');

        const authorName = document.createElement('p');
        authorName.className = CONFIG.CLASSES.AUTHOR_NAME;
        authorName.textContent = testimonial.userName;
        authorInfo.appendChild(authorName);

        const authorRole = document.createElement('p');
        authorRole.className = CONFIG.CLASSES.AUTHOR_ROLE;
        authorRole.textContent = testimonial.userRole;
        authorInfo.appendChild(authorRole);

        authorContainer.appendChild(authorInfo);
        card.appendChild(authorContainer);

        return card;
    }

    /**
     * Render testimonials grid
     *  Uses DocumentFragment for batch insert
     * @param {HTMLElement} grid - Grid element
     * @param {array} testimonials - Validated testimonials
     */
    function renderTestimonials(grid, testimonials) {
        grid.innerHTML = '';

        // [21.3, 21.10] Validate array before use
        if (!Array.isArray(testimonials) || testimonials.length === 0) {
            showEmptyState(grid);
            return;
        }

        //  Use DocumentFragment for batch DOM insertion
        const fragment = document.createDocumentFragment();

        // Limit to max testimonials
        const toShow = testimonials.slice(0, CONFIG.MAX_TESTIMONIALS);

        toShow.forEach((testimonial, index) => {
            const validated = validateTestimonial(testimonial);
            if (validated) {
                const card = createTestimonialCard(validated, index);
                fragment.appendChild(card);
            }
        });

        if (fragment.childNodes.length === 0) {
            showEmptyState(grid);
            return;
        }

        grid.appendChild(fragment);
        Logger.debug('Rendered testimonials:', fragment.childNodes.length);
    }

    // =========================================================================
    // MAIN LOAD FUNCTION
    // =========================================================================

    /**
     * Load testimonials from API or cache
     * @param {boolean} forceRefresh - If true, bypasses the local cache
     */
    async function loadTestimonials(forceRefresh = false) {
        //  Use configurable selector
        const grid = document.getElementById(CONFIG.SELECTORS.GRID);
        if (!grid) return;

        //  Check cache first (unless forced)
        if (!forceRefresh) {
            const cached = getCachedTestimonials();
            if (cached && cached.length > 0) {
                Logger.debug('Using cached testimonials');
                renderTestimonials(grid, cached);
                return;
            }
        }

        //  Show loading state
        showLoading(grid);
        state.isLoading = true;

        try {
            const data = await fetchWithTimeout('/api/testimonials/approved?featured=true');

            //  Validate response has testimonials array
            if (data.success && Array.isArray(data.testimonials)) {
                state.testimonials = data.testimonials;
                setCachedTestimonials(data.testimonials);
                renderTestimonials(grid, data.testimonials);
            } else {
                showEmptyState(grid);
            }

        } catch (error) {
            //  Only log safe message
            Logger.error(error.message || 'API request failed');
            showErrorState(grid, error.message);
        } finally {
            state.isLoading = false;
        }
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize testimonials module
     *  Wrapped in DOMContentLoaded
     */
    function initialize() {
        Logger.debug('Initializing testimonials.js');

        if (document.getElementById(CONFIG.SELECTORS.GRID)) {
            // Force refresh if there's a specific URL parameter (e.g., ?refresh_testimonials=true)
            const urlParams = new URLSearchParams(window.location.search);
            const forceRefresh = urlParams.get('refresh_testimonials') === 'true';
            loadTestimonials(forceRefresh);
        }
    }

    //  Wait for DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize);
    } else {
        initialize();
    }

    // =========================================================================
    // PUBLIC API
    // =========================================================================
    window.TestimonialsModule = {
        loadTestimonials,
        clearCache: () => {
            localStorage.removeItem(CONFIG.CACHE_KEY);
            state.testimonials = [];
        },
        getTestimonials: () => [...state.testimonials],
        // Utilities
        escapeHtml,
        validateTestimonial
    };

    // Legacy global
    window.loadTestimonials = loadTestimonials;

})();
