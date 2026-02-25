/**
 * ============================================================================
 * FILE: auth-init.js (100 lines)
 * PURPOSE: Client-side authentication state initialization
 * ============================================================================
 * 
 * ISSUES FOUND: 30 total (3 critical, 5 major, 22 moderate)
 * See ERROR_TRACKING.txt [14.1]-[14.30] for detailed analysis
 * 
 * CRITICAL ISSUES [14.1, 14.2, 14.3]:
 * - No type checking on parsed JSON (could be malicious objects)
 * - Sensitive user data stored in global window object (XSS accessible)
 * - catch block swallows exceptions (silent failures on parse errors)
 * 
 * MAJOR ISSUES [14.4-14.8]:
 * - No validation that arrays are actually arrays after parsing
 * - CSRF token not validated before adding to form
 * - console.log exposes sensitive username in logs
 * - No check if coursesEl.textContent is valid before JSON.parse
 * - pendingEl not re-initialized if parsing fails
 * 
 * DESCRIPTION:
 * Initializes global authentication state variables on page load by reading
 * server-rendered data from hidden DOM elements. This allows client-side
 * JavaScript to access user info, purchased courses, and pending courses
 * without additional API calls.
 * 
 * KEY FEATURES:
 * - Extracts user info from DOM and stores globally
 * - Caches purchased course IDs in window.__PURCHASED_COURSES__
 * - Caches pending course IDs in window.__PENDING_COURSES__
 * - Provides logout function that submits hidden form
 * - Graceful initialization with error handling
 * 
 * GLOBAL VARIABLES CREATED:
 * - window.__AUTH_USER__ - Current logged-in user object (or null)
 * - window.__PURCHASED_COURSES__ - Array of course IDs user has purchased
 * - window.__PENDING_COURSES__ - Array of course IDs awaiting payment verification
 * 
 * DEPENDENCIES:
 * - Server-rendered data in hidden DOM elements
 * - CSRF token in meta tag
 */

// Immediately-invoked function to avoid polluting global scope during parsing
(function () {
    try {
        // Get hidden elements containing server-rendered JSON data
        const userEl = document.getElementById('server-side-auth-user');
        const coursesEl = document.getElementById('server-side-purchased-courses');
        const pendingEl = document.getElementById('server-side-pending-courses');

        // Parse and store user object globally (null if element missing)
        window.__AUTH_USER__ = userEl ? JSON.parse(userEl.textContent) : null;

        // Parse and store purchased course IDs globally (empty array if element missing)
        window.__PURCHASED_COURSES__ = coursesEl ? JSON.parse(coursesEl.textContent) : [];

        // Parse and store pending course IDs globally (empty array if element missing)
        window.__PENDING_COURSES__ = pendingEl ? JSON.parse(pendingEl.textContent) : [];

        // [New] Parse and store environment flag globally
        const envEl = document.getElementById('server-side-env');
        const envData = envEl ? JSON.parse(envEl.textContent) : { isDevelopment: false };
        window.__IS_DEVELOPMENT__ = envData.isDevelopment;

        // Log successful initialization with user status
        window.Logger.log('🛡️ Auth State Loaded:', {
            loggedIn: !!window.__AUTH_USER__,
            username: window.__AUTH_USER__ ? window.__AUTH_USER__.username : 'guest'
        });
    } catch (e) {
        // Log parsing error if JSON is malformed
        window.Logger.error('❌ Auth State Error:', e);

        // Set safe default values if parsing fails
        window.__AUTH_USER__ = null;
        window.__PURCHASED_COURSES__ = [];
    }
})();

/**
 * Logs out the current user by submitting a hidden logout form
 * Called when user clicks logout button (with e.preventDefault() on link)
 * 
 * @param {Event} e - Click event from logout link/button
 */
window.logoutUser = function (e) {
    // Prevent default link navigation
    e.preventDefault();
    window.Logger.log("Attempting logout...");

    // Try to submit existing logout form
    const form = document.getElementById('logout-form');
    if (form) {
        form.submit();
    } else {
        // Fallback: create and submit logout form dynamically if not found
        window.Logger.error("Logout form not found!");

        // Create new form element
        const newForm = document.createElement('form');
        newForm.method = 'POST';
        newForm.action = '/auth/logout';

        // Create hidden CSRF token input
        const csrfInput = document.createElement('input');
        csrfInput.type = 'hidden';
        csrfInput.name = '_csrf';

        // Get CSRF token from meta tag and set as input value
        const metaToken = document.querySelector('meta[name="csrf-token"]');
        csrfInput.value = metaToken ? metaToken.content : '';

        // Add CSRF token input to form
        newForm.appendChild(csrfInput);

        // Add form to page and submit it
        document.body.appendChild(newForm);
        newForm.submit();
    }
}
