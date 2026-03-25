/**
 * ============================================================================
 * FILE: courses.js
 * PURPOSE: Course catalog and enrollment management
 * ============================================================================
 * 
 * DESCRIPTION:
 * Handles course display, filtering, and enrollment across multiple pages.
 * 
 * ISSUES FIXED: All 30 issues [19.1-19.30] addressed
 * ============================================================================
 */

(function () {
    'use strict';

    // =========================================================================
    // CONFIGURATION
    // =========================================================================
    const CONFIG = Object.freeze({
        REQUEST_TIMEOUT_MS: 15000,
        DEBUG: false,
        API_ENDPOINTS: Object.freeze({
            COURSES: '/api/courses'
        }),
        // [19.5, 19.6, 19.30] Whitelist of allowed Tailwind color classes
        ALLOWED_COLORS: Object.freeze([
            'blue', 'green', 'red', 'yellow', 'purple', 'pink', 'indigo',
            'orange', 'teal', 'cyan', 'slate', 'gray', 'amber', 'emerald'
        ]),
        ALLOWED_BG_COLORS: Object.freeze([
            'blue-50', 'blue-100', 'green-50', 'green-100', 'red-50', 'red-100',
            'yellow-50', 'yellow-100', 'purple-50', 'purple-100', 'indigo-50',
            'indigo-100', 'orange-50', 'orange-100', 'slate-50', 'slate-100',
            'amber-50', 'amber-100', 'emerald-50', 'emerald-100', 'pink-50',
            'pink-100', 'teal-50', 'teal-100', 'cyan-50', 'cyan-100', 'gray-50',
            'gray-100'
        ]),
        YOUTUBE_EMBED_BASE: 'https://www.youtube.com/embed/'
    });

    // =========================================================================
    // I18N STRINGS
    // =========================================================================
    const STRINGS = Object.freeze({
        LOADING: 'Loading course details...',
        ERROR_FETCH: 'Failed to load courses. Please try again.',
        ERROR_TIMEOUT: 'Request timed out. Please try again.',
        ERROR_NETWORK: 'Network error. Please check your connection.',
        NO_COURSES: 'No courses available at this time.',
        COURSE_NOT_FOUND: 'Course not found',
        BROWSE_COURSES: 'Browse all courses',
        LOGIN_TO_ENROLL: 'Login to Enroll',
        ALREADY_ENROLLED: 'Already Enrolled',
        AWAITING_VERIFICATION: 'Awaiting Verification',
        ENROLL_NOW: 'Enroll Now',
        ENROLLMENT_CLOSED: 'Enrollment Closed',
        GO_TO_DASHBOARD: 'Go to Learning Dashboard →',
        PAYMENT_PENDING: 'Your payment proof has been submitted. Admin will verify shortly.'
    });

    // =========================================================================
    // STATE MANAGEMENT
    // =========================================================================
    const state = {
        courses: [],          //  Always initialized as array
        fetchError: false,
        isLoading: false,
        abortController: null
    };

    // =========================================================================
    // LOGGER
    // =========================================================================
    const Logger = {
        debug: (...args) => CONFIG.DEBUG && console.log('[Courses:Debug]', ...args),
        info: (...args) => CONFIG.DEBUG && console.info('[Courses:Info]', ...args),
        warn: (...args) => console.warn('[Courses:Warn]', ...args),
        error: (...args) => console.error('[Courses:Error]', ...args)
    };

    // =========================================================================
    // VALIDATION UTILITIES
    // =========================================================================

    /**
     * Escape HTML to prevent XSS
     * [19.2, 19.7, 19.8, 19.14, 19.15] XSS prevention
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
     * Validate course ID
     *  Type validation
     * @param {*} courseId - Course ID to validate
     * @returns {boolean} Valid or not
     */
    function isValidCourseId(courseId) {
        if (courseId == null) return false;
        const id = String(courseId).trim();
        return id.length > 0 && /^[a-zA-Z0-9_-]+$/.test(id);
    }

    /**
     * Validate color against whitelist
     * [19.5, 19.6] Prevent template injection
     * @param {string} color - Color name
     * @returns {string} Safe color or default
     */
    function safeColor(color) {
        if (!color || typeof color !== 'string') return 'slate';
        const normalized = color.toLowerCase().trim();
        return CONFIG.ALLOWED_COLORS.includes(normalized) ? normalized : 'slate';
    }

    /**
     * Validate background color against whitelist
     * @param {string} bgColor - Background color
     * @returns {string} Safe bg color or default
     */
    function safeBgColor(bgColor) {
        if (!bgColor || typeof bgColor !== 'string') return 'slate-100';
        const normalized = bgColor.toLowerCase().trim();
        return CONFIG.ALLOWED_BG_COLORS.includes(normalized) ? normalized : 'slate-100';
    }

    /**
     * Validate number value
     * [19.16, 19.17, 19.18] Numeric validation
     * @param {*} value - Value to validate
     * @param {number} defaultVal - Default value
     * @returns {number} Safe number
     */
    function safeNumber(value, defaultVal = 0) {
        const num = parseFloat(value);
        return isNaN(num) || !isFinite(num) ? defaultVal : num;
    }

    /**
     * Validate integer
     * @param {*} value - Value to validate
     * @param {number} defaultVal - Default value
     * @returns {number} Safe integer
     */
    function safeInt(value, defaultVal = 0) {
        const num = parseInt(value, 10);
        return isNaN(num) ? defaultVal : num;
    }

    /**
     * Validate date
     * [19.10, 19.29] Date validation
     * @param {*} dateValue - Date to validate
     * @returns {Date|null} Valid Date or null
     */
    function safeDate(dateValue) {
        if (!dateValue) return null;
        const date = new Date(dateValue);
        return isNaN(date.getTime()) ? null : date;
    }

    /**
     * Format date safely
     *  Handle undefined formatDate
     * @param {*} dateValue - Date to format
     * @returns {string} Formatted date or fallback
     */
    function formatDateSafe(dateValue) {
        const date = safeDate(dateValue);
        if (!date) return 'TBD';

        // Use window.formatDate if available, otherwise basic format
        if (typeof window.formatDate === 'function') {
            try {
                return window.formatDate(dateValue);
            } catch {
                // Fall through to basic format
            }
        }

        return date.toLocaleDateString('en-IN', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    }

    /**
     * Check if enrollment is closed
     *  Safe date comparison
     * @param {*} deadline - Enrollment deadline
     * @returns {boolean} True if closed
     */
    function isEnrollmentClosed(deadline) {
        const deadlineDate = safeDate(deadline);
        if (!deadlineDate) return false;
        return new Date() > deadlineDate;
    }

    /**
     * Validate course structure
     *  Structure validation
     * @param {*} course - Course object
     * @returns {object|null} Validated course or null
     */
    function validateCourse(course) {
        if (!course || typeof course !== 'object') return null;

        return {
            id: course.id ?? '',
            title: String(course.title || 'Untitled Course'),
            description: String(course.description || ''),
            price: safeNumber(course.price, 0),
            originalPrice: safeNumber(course.originalPrice, course.price || 0),
            users: safeInt(course.users, 0),
            icon: String(course.icon || '📚'),
            iconBg: safeBgColor(course.iconBg),
            iconColor: safeColor(course.iconColor),
            badge: course.badge ? String(course.badge) : null,
            badgeColor: safeColor(course.badgeColor),
            startDate: course.startDate || null,
            endDate: course.endDate || null,
            enrollmentDeadline: course.enrollmentDeadline || null,
            demoVideoUrl: course.demoVideoUrl || null
        };
    }

    /**
     * Check if array is valid
     * [19.3, 19.9, 19.13] Array validation
     * @param {*} arr - Value to check
     * @returns {boolean} True if valid array
     */
    function isValidArray(arr) {
        return Array.isArray(arr);
    }

    /**
     * Safely check if ID is in array
     * [19.9, 19.25] Safe array operations
     * @param {*} arr - Array to check
     * @param {*} id - ID to find
     * @returns {boolean} True if found
     */
    function arrayContainsId(arr, id) {
        if (!isValidArray(arr) || id == null) return false;
        const stringId = String(id);
        return arr.some(item => String(item) === stringId);
    }

    // =========================================================================
    // YOUTUBE EMBED VALIDATION
    // =========================================================================

    /**
     * Convert YouTube URL to embed URL with validation
     * [19.4, 19.24] HTTPS and URL validation
     * @param {string} url - YouTube URL
     * @returns {string|null} Safe embed URL or null
     */
    function toYouTubeEmbed(url) {
        if (!url || typeof url !== 'string' || url.trim() === '') {
            return null;
        }

        // Extract video ID using regex
        const match = url.match(/(?:youtube\.com\/watch\?v=|youtube\.com\/embed\/|youtu\.be\/)([a-zA-Z0-9_-]{11})/);

        if (!match || !match[1]) {
            Logger.debug('Invalid YouTube URL:', url);
            return null;
        }

        const videoId = match[1];

        //  Always use HTTPS
        const embedUrl = `${CONFIG.YOUTUBE_EMBED_BASE}${videoId}`;

        // Validate final URL
        if (!embedUrl.startsWith('https://www.youtube.com/embed/')) {
            return null;
        }

        return embedUrl;
    }



    // =========================================================================
    // FETCH WITH TIMEOUT
    // =========================================================================

    /**
     * Fetch with timeout
     *  Request timeout
     * @param {string} url - URL to fetch
     * @returns {Promise<object>} Response data
     */
    async function fetchWithTimeout(url) {
        const controller = new AbortController();
        state.abortController = controller;

        const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

        try {
            const response = await fetch(url, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();

            //  Validate response is array
            if (!isValidArray(data)) {
                throw new Error('Invalid API response format');
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
    // DATA LOADING
    // =========================================================================

    /**
     * Fetch courses from API
     *  Initialize array on error
     */
    async function fetchCourses() {
        state.fetchError = false;
        state.isLoading = true;

        try {
            const data = await fetchWithTimeout(CONFIG.API_ENDPOINTS.COURSES);

            //  Clear previous data
            state.courses = [];

            // Validate and store each course
            data.forEach(item => {
                const validated = validateCourse(item);
                if (validated && isValidCourseId(validated.id)) {
                    state.courses.push(validated);
                }
            });

            Logger.debug('Loaded courses:', state.courses.length);

        } catch (error) {
            Logger.error('Error fetching courses:', error.message);
            state.fetchError = true;
            state.courses = []; //  Always initialize
        } finally {
            state.isLoading = false;
        }
    }

    // =========================================================================
    // COURSE CARD RENDERING
    // =========================================================================

    /**
     * Create course card element
     * [19.7, 19.8, 19.14, 19.15] Safe HTML creation
     * @param {object} course - Validated course
     * @returns {HTMLElement} Course card
     */
    function createCourseCard(course) {
        const card = document.createElement('div');
        card.className = 'bg-white rounded-2xl shadow-lg overflow-hidden hover:shadow-xl transition-all duration-300 group';

        // Header with icon
        const header = document.createElement('div');
        header.className = 'relative';

        const iconDiv = document.createElement('div');
        iconDiv.className = `aspect-video bg-${course.iconBg} w-full flex items-center justify-center text-${course.iconColor} text-5xl`;
        iconDiv.textContent = course.icon;
        header.appendChild(iconDiv);

        // Badge
        if (course.badge) {
            const badge = document.createElement('div');
            badge.className = `absolute top-4 right-4 bg-${course.badgeColor}-100 text-${course.badgeColor}-600 text-xs font-bold px-3 py-1 rounded-full border border-${course.badgeColor}-200`;
            badge.textContent = course.badge;
            header.appendChild(badge);
        }

        card.appendChild(header);

        // Body
        const body = document.createElement('div');
        body.className = 'p-6';

        // Users count
        const usersDiv = document.createElement('div');
        usersDiv.className = 'flex items-center gap-2 mb-3';
        usersDiv.innerHTML = `<span class="text-xs text-slate-500 font-medium"><i class="fa-solid fa-user-group text-blue-500 mr-1"></i> ${escapeHtml(String(course.users))} users enrolled</span>`;
        body.appendChild(usersDiv);

        // Title
        const title = document.createElement('h3');
        title.className = 'text-lg font-bold text-slate-800 mb-2 group-hover:text-blue-600 transition-colors line-clamp-2';
        title.textContent = course.title;
        body.appendChild(title);

        // Description
        const desc = document.createElement('p');
        desc.className = 'text-slate-600 text-sm mb-4 line-clamp-2';
        desc.textContent = course.description;
        body.appendChild(desc);

        // Dates section
        if (course.startDate) {
            const datesDiv = document.createElement('div');
            datesDiv.className = 'mb-4 space-y-1 text-xs font-medium text-slate-500';

            // Start date
            const startDiv = document.createElement('div');
            startDiv.className = 'flex items-center gap-2';
            startDiv.innerHTML = '<i class="fa-regular fa-calendar text-blue-500"></i>';
            const startSpan = document.createElement('span');
            startSpan.textContent = `Starts: ${formatDateSafe(course.startDate)}`;
            startDiv.appendChild(startSpan);
            datesDiv.appendChild(startDiv);

            // End date
            if (course.endDate) {
                const endDiv = document.createElement('div');
                endDiv.className = 'flex items-center gap-2';
                endDiv.innerHTML = '<i class="fa-regular fa-flag text-red-500"></i>';
                const endSpan = document.createElement('span');
                endSpan.textContent = `Ends: ${formatDateSafe(course.endDate)}`;
                endDiv.appendChild(endSpan);
                datesDiv.appendChild(endDiv);
            }

            // Enrollment deadline
            if (course.enrollmentDeadline) {
                const deadlineDiv = document.createElement('div');
                deadlineDiv.className = 'flex items-center gap-2';
                deadlineDiv.innerHTML = '<i class="fa-solid fa-hourglass-half text-orange-500"></i>';
                const deadlineSpan = document.createElement('span');
                deadlineSpan.className = isEnrollmentClosed(course.enrollmentDeadline) ? 'text-red-500 font-bold' : '';
                deadlineSpan.textContent = `Enroll by: ${formatDateSafe(course.enrollmentDeadline)}`;
                deadlineDiv.appendChild(deadlineSpan);
                datesDiv.appendChild(deadlineDiv);
            }

            body.appendChild(datesDiv);
        }

        // Footer with price and action
        const footer = document.createElement('div');
        footer.className = 'flex items-center justify-between mt-6 pt-4 border-t border-slate-100';

        // Price
        const priceDiv = document.createElement('div');
        priceDiv.innerHTML = `<span class="text-2xl font-bold text-slate-800">₹${escapeHtml(String(course.price))}</span><span class="text-sm text-slate-400 line-through ml-2">₹${escapeHtml(String(course.originalPrice))}</span>`;
        footer.appendChild(priceDiv);

        // Action button
        const actionEl = createCourseActionButton(course);
        footer.appendChild(actionEl);

        body.appendChild(footer);
        card.appendChild(body);

        return card;
    }

    /**
     * Create action button for course card
     *  Safe array checks
     * @param {object} course - Course object
     * @returns {HTMLElement} Action element
     */
    function createCourseActionButton(course) {
        const isPurchased = arrayContainsId(window.__PURCHASED_COURSES__, course.id);
        const isPending = arrayContainsId(window.__PENDING_COURSES__, course.id);
        const closed = isEnrollmentClosed(course.enrollmentDeadline);

        if (isPurchased) {
            const div = document.createElement('div');
            div.className = 'px-4 py-2 rounded-lg bg-green-50 text-green-700 font-semibold text-sm border border-green-100 flex items-center gap-1';
            div.innerHTML = `<i class="fa-solid fa-circle-check"></i> ${escapeHtml(STRINGS.ALREADY_ENROLLED)}`;
            return div;
        }

        if (isPending) {
            const div = document.createElement('div');
            div.className = 'px-4 py-2 rounded-lg bg-amber-50 text-amber-600 font-semibold text-sm border border-amber-200 flex items-center gap-1';
            div.innerHTML = `<i class="fa-solid fa-clock"></i> ${escapeHtml(STRINGS.AWAITING_VERIFICATION)}`;
            return div;
        }

        if (closed) {
            const btn = document.createElement('button');
            btn.disabled = true;
            btn.className = 'px-4 py-2 rounded-lg bg-slate-100 text-slate-400 font-semibold text-sm cursor-not-allowed';
            btn.textContent = STRINGS.ENROLLMENT_CLOSED;
            return btn;
        }

        //  Properly encode URL
        const link = document.createElement('a');
        link.href = `/enroll?id=${encodeURIComponent(String(course.id))}`;
        link.className = 'px-4 py-2 rounded-lg bg-slate-50 text-slate-700 font-semibold text-sm hover:bg-blue-600 hover:text-white transition-all transform hover:-translate-y-0.5';
        link.textContent = STRINGS.ENROLL_NOW;
        return link;
    }

    // =========================================================================
    // COURSE GRID RENDERING
    // =========================================================================

    /**
     * Render courses grid
     * [19.3, 19.22] Safe array handling
     */
    function renderCourses() {
        const grid = document.getElementById('courses-grid');
        if (!grid) return;

        const errorEl = document.getElementById('courses-error');
        const emptyEl = document.getElementById('courses-empty');

        // Remove skeleton loaders
        grid.querySelectorAll('.course-skeleton').forEach(el => el.remove());

        // Handle error state
        if (state.fetchError) {
            grid.classList.add('hidden');
            if (emptyEl) emptyEl.classList.add('hidden');
            if (errorEl) errorEl.classList.remove('hidden');
            return;
        }

        //  Validate courses array
        if (!isValidArray(state.courses) || state.courses.length === 0) {
            grid.classList.add('hidden');
            if (errorEl) errorEl.classList.add('hidden');
            if (emptyEl) emptyEl.classList.remove('hidden');
            return;
        }

        // Hide error/empty, show grid
        if (errorEl) errorEl.classList.add('hidden');
        if (emptyEl) emptyEl.classList.add('hidden');
        grid.classList.remove('hidden');

        // Clear existing content
        grid.innerHTML = '';

        // Render each course
        state.courses.forEach(course => {
            const card = createCourseCard(course);
            grid.appendChild(card);
        });

        Logger.debug('Rendered courses:', state.courses.length);
    }

    // =========================================================================
    // ENROLLMENT PAGE RENDERING
    // =========================================================================

    /**
     * Render enrollment page
     * [19.2, 19.26] Safe parameter handling
     */
    function renderEnrollmentPage() {
        const container = document.getElementById('enrollment-container');
        if (!container) return;

        //  Safe URL parameter extraction
        let courseId = null;
        try {
            const urlParams = new URLSearchParams(window.location.search);
            courseId = urlParams.get('id');
        } catch {
            Logger.error('Failed to parse URL parameters');
        }

        // Show loading if courses not ready
        if (state.isLoading || state.courses.length === 0) {
            container.innerHTML = `<div class="col-span-full text-center py-20">${escapeHtml(STRINGS.LOADING)}</div>`;
            return;
        }

        //  Validate courseId before use
        if (!isValidCourseId(courseId)) {
            renderCourseNotFound(container, courseId);
            return;
        }

        // Find course
        const course = state.courses.find(c => String(c.id) === String(courseId));

        if (!course) {
            renderCourseNotFound(container, courseId);
            return;
        }

        renderCourseDetails(container, course);
    }

    /**
     * Render course not found message
     *  XSS prevention
     * @param {HTMLElement} container - Container element
     * @param {string} courseId - Course ID
     */
    function renderCourseNotFound(container, courseId) {
        const wrapper = document.createElement('div');
        wrapper.className = 'col-span-2 text-center py-20';

        const heading = document.createElement('h2');
        heading.className = 'text-3xl font-bold text-slate-800 mb-4';
        heading.textContent = `${STRINGS.COURSE_NOT_FOUND}${courseId ? ` (ID: ${escapeHtml(String(courseId).substring(0, 50))})` : ''}`;
        wrapper.appendChild(heading);

        const link = document.createElement('a');
        link.href = '/courses';
        link.className = 'text-blue-600 hover:text-blue-700 font-semibold';
        link.textContent = STRINGS.BROWSE_COURSES;
        wrapper.appendChild(link);

        container.innerHTML = '';
        container.appendChild(wrapper);
    }

    /**
     * Create enrollment action button
     *  Safe redirect handling
     * @param {object} course - Course object
     * @returns {string} HTML string
     */
    function createEnrollmentAction(course) {
        const isPurchased = arrayContainsId(window.__PURCHASED_COURSES__, course.id);
        const isPending = arrayContainsId(window.__PENDING_COURSES__, course.id);

        if (!window.__AUTH_USER__) {
            //  Safe redirect - only use pathname, not full URL
            const currentPath = window.location.pathname + window.location.search;
            const safeRedirect = encodeURIComponent(currentPath);
            return `
                <a href="/login?redirect=${safeRedirect}" class="w-full block text-center py-4 bg-slate-800 text-white font-bold rounded-xl shadow-lg hover:bg-slate-900 transition-all transform hover:-translate-y-0.5 text-lg">
                    ${escapeHtml(STRINGS.LOGIN_TO_ENROLL)}
                </a>`;
        }

        if (isPurchased) {
            return `
                <div class="w-full py-4 bg-green-50 text-green-700 font-bold rounded-xl border border-green-100 flex items-center justify-center gap-2 text-lg">
                    <i class="fa-solid fa-circle-check"></i> ${escapeHtml(STRINGS.ALREADY_ENROLLED)}
                </div>
                <a href="/dashboard" class="block text-center text-sm font-semibold text-blue-600 hover:text-blue-700 mt-2">
                    ${escapeHtml(STRINGS.GO_TO_DASHBOARD)}
                </a>`;
        }

        if (isPending) {
            return `
                <div class="w-full py-4 bg-amber-50 text-amber-700 font-bold rounded-xl border border-amber-200 flex items-center justify-center gap-2 text-lg">
                    <i class="fa-solid fa-clock"></i> ${escapeHtml(STRINGS.AWAITING_VERIFICATION)}
                </div>
                <p class="text-center text-sm text-amber-600 mt-2">
                    ${escapeHtml(STRINGS.PAYMENT_PENDING)}
                </p>`;
        }

        //  Encode course ID in URL
        return `
            <a href="/checkout/${encodeURIComponent(String(course.id))}" class="w-full block text-center py-4 bg-blue-600 text-white font-bold rounded-xl shadow-lg shadow-blue-500/25 hover:bg-blue-700 hover:shadow-blue-500/40 transition-all transform hover:-translate-y-0.5 text-lg">
                ${escapeHtml(STRINGS.ENROLL_NOW)} — ₹${escapeHtml(String(course.price))}
            </a>`;
    }

    /**
     * Render course details page
     * @param {HTMLElement} container - Container element
     * @param {object} course - Course object
     */
    function renderCourseDetails(container, course) {
        const embedUrl = toYouTubeEmbed(course.demoVideoUrl);
        const actionButton = createEnrollmentAction(course);
        const discount = course.originalPrice > 0
            ? Math.round((1 - course.price / course.originalPrice) * 100)
            : 0;

        // Build video/icon section
        let mediaSection = '';
        if (embedUrl) {
            //  Only use validated HTTPS YouTube URL
            mediaSection = `<div class="aspect-video w-full rounded-xl overflow-hidden mb-6 shadow-lg"><iframe class="w-full h-full" src="${escapeHtml(embedUrl)}" title="Course Demo Video" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen loading="lazy"></iframe></div>`;
        } else {
            mediaSection = `<div class="aspect-video bg-${course.iconBg} w-full rounded-xl overflow-hidden flex items-center justify-center text-${course.iconColor} text-6xl mb-6">${escapeHtml(course.icon)}</div>`;
        }

        container.innerHTML = `
        <div class="space-y-8">
            <div class="bg-white rounded-2xl p-8 shadow-sm border border-slate-100">
                ${mediaSection}

                <div class="flex items-center gap-2 mb-4">
                    <span class="bg-blue-100 text-blue-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">Course</span>
                    ${course.badge ? `<span class="bg-${course.badgeColor}-100 text-${course.badgeColor}-700 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">${escapeHtml(course.badge)}</span>` : ''}
                </div>

                <h1 class="text-3xl font-bold text-slate-800 mb-4">${escapeHtml(course.title)}</h1>
                <p class="text-slate-600 text-lg mb-6 leading-relaxed">${escapeHtml(course.description)}</p>

                <div class="border-t border-slate-100 pt-6">
                    <h3 class="text-sm font-bold text-slate-800 uppercase tracking-widest mb-4">What you'll learn</h3>
                    <ul class="space-y-3">
                        <li class="flex items-start gap-3 text-slate-600"><span class="text-green-500 font-bold">✓</span>Comprehensive understanding of market dynamics</li>
                        <li class="flex items-start gap-3 text-slate-600"><span class="text-green-500 font-bold">✓</span>Risk management strategies used by pros</li>
                        <li class="flex items-start gap-3 text-slate-600"><span class="text-green-500 font-bold">✓</span>Real-world case studies and live trading sessions</li>
                    </ul>
                </div>
            </div>
        </div>

        <!-- Buying / Pricing Card -->
        <div class="lg:sticky lg:top-28">
            <div class="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
                <!-- Price Header -->
                <div class="bg-gradient-to-r from-blue-600 to-blue-500 p-6 text-white text-center">
                    <p class="text-sm font-medium opacity-80 mb-1">Course Price</p>
                    <div class="flex items-center justify-center gap-3">
                        <span class="text-4xl font-bold">₹${escapeHtml(String(course.price))}</span>
                        <span class="text-lg line-through opacity-60">₹${escapeHtml(String(course.originalPrice))}</span>
                    </div>
                    <span class="inline-block mt-2 px-3 py-1 rounded-full bg-white/20 text-xs font-bold">${discount}% OFF</span>
                </div>

                <!-- Action Button Container -->
                <div class="p-6 space-y-4">
                    ${actionButton}

                    <!-- Course Highlights -->
                    <div class="space-y-3 pt-4 border-t border-slate-100">
                        <h4 class="text-sm font-bold text-slate-800 uppercase tracking-wider">This course includes</h4>
                        <div class="flex items-center gap-3 text-sm text-slate-600">
                            <span class="text-blue-500">📹</span> Live trading sessions with Kundan Sir
                        </div>
                        <div class="flex items-center gap-3 text-sm text-slate-600">
                            <span class="text-blue-500">📱</span> Access on Mobile and Web
                        </div>
                        <div class="flex items-center gap-3 text-sm text-slate-600">
                            <span class="text-blue-500">📊</span> Real-world case studies
                        </div>
                        <div class="flex items-center gap-3 text-sm text-slate-600">
                            <span class="text-blue-500">👥</span> Exclusive Community Access
                        </div>
                        <div class="flex items-center gap-3 text-sm text-slate-600">
                            <span class="text-blue-500">💬</span> Doubt clearing support
                        </div>
                    </div>

                    <!-- Stats -->
                    <div class="flex items-center justify-between pt-4 border-t border-slate-100 text-sm">
                        <div class="text-center">
                            <p class="font-bold text-slate-800">Verified</p>
                            <p class="text-slate-500 text-xs">Content</p>
                        </div>
                        <div class="text-center">
                            <p class="font-bold text-slate-800">${escapeHtml(String(course.users))}+</p>
                            <p class="text-slate-500 text-xs">Users</p>
                        </div>
                        <div class="text-center">
                            <p class="font-bold text-slate-800">24/7</p>
                            <p class="text-slate-500 text-xs">Support</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
        `;
    }

    // =========================================================================
    // INITIALIZATION
    // =========================================================================

    /**
     * Initialize courses module
     */
    async function initialize() {
        Logger.debug('Initializing courses.js');

        //  Only render if elements exist
        const hasGrid = document.getElementById('courses-grid');
        const hasEnrollment = document.getElementById('enrollment-container');

        if (!hasGrid && !hasEnrollment) {
            Logger.debug('No course elements found, skipping initialization');
            return;
        }

        // Fetch courses
        await fetchCourses();

        // Render appropriately
        if (hasGrid) renderCourses();
        if (hasEnrollment) renderEnrollmentPage();

        Logger.debug('Courses.js initialization complete');
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
    window.CoursesModule = {
        fetchCourses,
        renderCourses,
        renderEnrollmentPage,
        getCourses: () => [...state.courses],
        getCourse: (id) => state.courses.find(c => String(c.id) === String(id)) || null,
        // Utilities
        escapeHtml,
        isValidCourseId,
        toYouTubeEmbed,
        formatDateSafe
    };

    // Legacy global exports
    window.fetchCourses = fetchCourses;
    window.renderCourses = renderCourses;
    window.renderEnrollmentPage = renderEnrollmentPage;
    window.toYouTubeEmbed = toYouTubeEmbed;

})();
