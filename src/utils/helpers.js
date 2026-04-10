/* -------------------------------------------------------------------------- */
/*                              HELPER UTILITIES                              */
/* -------------------------------------------------------------------------- */
/*
 * Purpose: Shared utility functions for user and course operations
 * 
 * 
 * Features:
 * - Retrieve user's purchased courses (with caching)
 * - Course access control middleware
 * - Admin bypass with audit logging
 * - ObjectId validation for security
 * - Query deduplication for performance
 * 
 * Schema Dependencies:
 * - User.purchasedCourseIds: String[] @db.ObjectId
 * - User.role: String (UserRole enum: 'user' | 'admin')
 * 
 * Usage:
 * - Used across controllers and routes for purchase validation
 * - Prevents unauthorized access to paid content
 */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const prisma = require('./prisma');
const { withRetry } = require('./prisma');
const { GLOBAL_CHAT_ID } = require('./constants');

/* -------------------------------------------------------------------------- */
/*                           VALIDATION UTILITIES                             */
/* -------------------------------------------------------------------------- */

/**
 * Validate MongoDB ObjectId format
 * Prevents NoSQL injection by ensuring only valid 24-char hex strings are accepted
 * 
 * @param {string} id - The ID to validate
 * @returns {boolean} True if valid ObjectId format
 */
function isValidObjectId(id) {
    if (!id || typeof id !== 'string') return false;
    // MongoDB ObjectId is a 24-character hex string
    return /^[a-fA-F0-9]{24}$/.test(id);
}

/**
 * Valid user roles (enum-like validation)
 */
const VALID_ROLES = Object.freeze(['USER', 'ADMIN']);

/* -------------------------------------------------------------------------- */
/*                         AJAX DETECTION                                     */
/* -------------------------------------------------------------------------- */

/**
 * Detect AJAX/API requests with proper Accept header parsing
 * Works in Express 4 and 5 (req.xhr is deprecated in Express 5)
 * 
 * @param {Object} req - Express request object
 * @returns {boolean} True if request expects JSON response
 */
function isAjaxRequest(req) {
    const acceptHeader = req.headers.accept || '';
    const xRequestedWith = req.headers['x-requested-with'] || '';

    // Check X-Requested-With header (common AJAX pattern)
    if (xRequestedWith.toLowerCase() === 'xmlhttprequest') {
        return true;
    }

    // Parse Accept header with quality values
    // Check for application/json or fetch-specific triggers
    if (acceptHeader.includes('application/json') || req.path.startsWith('/api')) {
        return true;
    }

    return false;
}

/* -------------------------------------------------------------------------- */
/*                         QUERY DEDUPLICATION                               */
/* -------------------------------------------------------------------------- */

/**
 * Pending queries map for deduplication
 * Prevents duplicate database queries for concurrent requests
 */
const pendingQueries = new Map();

/* -------------------------------------------------------------------------- */
/*                         IN-MEMORY CACHE                                   */
/* -------------------------------------------------------------------------- */

/**
 * Simple in-memory cache for purchased courses
 * For distributed deployments, replace with Redis
 * 
 * Structure: Map<userId, { courses: Set, timestamp: number }>
 */
const courseCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Clear expired cache entries periodically
 */
setInterval(() => {
    const now = Date.now();
    for (const [userId, entry] of courseCache.entries()) {
        if (now - entry.timestamp > CACHE_TTL_MS) {
            courseCache.delete(userId);
        }
    }
}, 60 * 1000); // Clean every minute

/* -------------------------------------------------------------------------- */
/*                         ACCESS METRICS                                     */
/* -------------------------------------------------------------------------- */

/**
 * Access check metrics for observability
 */
const accessMetrics = {
    totalChecks: 0,
    accessGranted: 0,
    accessDenied: 0,
    cacheHits: 0,
    cacheMisses: 0
};

/**
 * Get access metrics (for /metrics endpoint)
 * @returns {Object} Access metrics
 */
function getAccessMetrics() {
    return { ...accessMetrics };
}

/* -------------------------------------------------------------------------- */
/*                            COURSE ACCESS HELPERS                           */
/* -------------------------------------------------------------------------- */

/**
 * Fetch purchased course IDs for a specific user.
 * 
 * Features:
 * - Validates userId as valid ObjectId
 * - Validates returned courseIds are valid ObjectIds
 * - Implements caching with 5-minute TTL
 * - Deduplicates concurrent queries
 * - Uses ISO timestamps for logging
 * - Documents schema dependency
 * 
 * Schema Dependency:
 * - model User { purchasedCourseIds String[] @db.ObjectId }
 * 
 * @param {string} userId - MongoDB ObjectId of the user
 * @returns {Promise<Set<string>>} Set of courseIds the user has purchased
 * 
 * @example
 * const courses = await getUserPurchasedCourses(req.session.user.id);
 * if (courses.has(courseId)) {
 *   // Grant access
 * }
 */
async function getUserPurchasedCourses(userId) {
    // Guard clause - validate userId
    if (!userId || !isValidObjectId(userId)) {
        if (userId) {
            const timestamp = new Date().toISOString();
            console.warn(`[${timestamp}] Invalid userId format: ${userId}`);
        }
        return new Set();
    }

    // Check cache first
    const cached = courseCache.get(userId);
    if (cached && (Date.now() - cached.timestamp < CACHE_TTL_MS)) {
        accessMetrics.cacheHits++;
        return cached.courses;
    }

    accessMetrics.cacheMisses++;

    // Deduplicate concurrent queries
    if (pendingQueries.has(userId)) {
        return pendingQueries.get(userId);
    }

    // Create query promise
    const queryPromise = (async () => {
        try {
            // Query with retry for resilience
            const user = await withRetry(
                () => prisma.user.findUnique({
                    where: { id: userId },
                    select: { purchasedCourseIds: true }
                }),
                2 // Max 2 retries
            );

            if (!user || !user.purchasedCourseIds) {
                return new Set();
            }

            // Validate and convert to Set for O(1) lookup
            const validIds = user.purchasedCourseIds
                .filter(id => isValidObjectId(id))
                .map(id => String(id));

            const coursesSet = new Set(validIds);

            // Update cache
            courseCache.set(userId, {
                courses: coursesSet,
                timestamp: Date.now()
            });

            return coursesSet;

        } catch (e) {
            // Log error with timestamp, don't reveal internals
            const timestamp = new Date().toISOString();
            console.error(`[${timestamp}] Course fetch error for user ${userId}:`, e.message);
            return new Set();
        }
    })();

    // Store pending query
    pendingQueries.set(userId, queryPromise);

    // Clean up after query completes
    queryPromise.finally(() => {
        pendingQueries.delete(userId);
    });

    return queryPromise;
}

/**
 * Clear cached courses for a user (call after purchase)
 * @param {string} userId - User ID to clear cache for
 */
function clearUserCourseCache(userId) {
    if (userId) {
        courseCache.delete(userId);
    }
}

/**
 * Middleware factory function to check if user has purchased a specific course.
 * 
 * Behavior:
 * - Admins: Always granted access (bypass with audit log)
 * - Unauthenticated: Redirected to login (or 401 for AJAX)
 * - Unpurchased: Redirected to courses page (or 403 for AJAX)
 * - Purchased: Access granted via next()
 * 
 * Behavior:
 * - Admins: Always granted access (bypass with audit log)
 * - Unauthenticated: Redirected to login (or 401 for AJAX)
 * - Unpurchased: Redirected to courses page (or 403 for AJAX)
 * - Purchased: Access granted via next()
 * 
 * @param {string} courseIdParam - The name of the req.params key for courseId (default: 'courseId')
 * @returns {Function} Express middleware function
 * 
 * @example
 * // Protect video access
 * router.get('/videos/:courseId', requireCoursePurchase(), videoController);
 * 
 * // Custom param name
 * router.get('/course/:cid/materials', requireCoursePurchase('cid'), materialController);
 */
function requireCoursePurchase(courseIdParam = 'courseId') {
    return async (req, res, next) => {
        accessMetrics.totalChecks++;

        // Set no-cache headers for access control responses
        res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.set('Pragma', 'no-cache');

        // Authentication and session validity check
        if (!req.session?.user?.id) {
            if (isAjaxRequest(req)) {
                return res.status(401).json({ success: false, message: 'Please log in' });
            }
            return res.redirect('/login');
        }

        const userId = req.session.user.id;
        const userRole = String(req.session.user.role || '').toUpperCase();

        // Validate role is a known value
        if (userRole && !VALID_ROLES.includes(userRole)) {
            const timestamp = new Date().toISOString();
            console.warn(`[${timestamp}] Unexpected user role: ${req.session.user.role} for user ${userId}`);
        }

        // Admin bypass with audit logging
        const isAdmin = userRole === 'ADMIN';
        if (isAdmin) {
            const courseId = req.params[courseIdParam] || req.params.id || req.params.courseId;
            const timestamp = new Date().toISOString();
            console.log(`[${timestamp}] 🔓 Admin bypass: ${userId} → ${courseId}`);
            accessMetrics.accessGranted++;
            return next();
        }

        // Validate param exists in route or fallback to common names
        let courseId = req.params[courseIdParam];

        if (!courseId) {
            // Fallback to common parameter names if the specific one isn't found
            courseId = req.params.id || req.params.courseId;
        }

        if (!courseId) {
            const timestamp = new Date().toISOString();
            console.error(`[${timestamp}] Route config error: param '${courseIdParam}' (and fallbacks) not found in ${req.originalUrl}`);
            return res.status(500).json({ success: false, message: 'Server configuration error' });
        }

        // --- BYPASS FOR GLOBAL CHAT ---
        if (courseId === GLOBAL_CHAT_ID) {
            accessMetrics.accessGranted++;
            return next();
        }
        // ------------------------------

        // Validate courseId format
        if (!isValidObjectId(courseId)) {
            if (isAjaxRequest(req)) {
                return res.status(400).json({ success: false, message: 'Invalid course ID' });
            }
            return res.status(400).send('Invalid course ID');
        }

        // Check if user has purchased the course (uses Set)
        const purchasedIds = await getUserPurchasedCourses(userId);

        // Future: Add checks for free courses, bundles, trials, subscriptions here
        // const hasFreeAccess = await checkFreeAccess(courseId);
        // const hasBundleAccess = await checkBundleAccess(userId, courseId);
        // const hasTrialAccess = await checkTrialAccess(userId, courseId);
        // const hasSubscription = await checkSubscription(userId);
        // const isSuspended = await checkSuspension(userId, courseId);

        if (purchasedIds.has(courseId)) {
            // User owns the course - grant access
            accessMetrics.accessGranted++;
            return next();
        }

        // Log failed access attempt for audit
        const timestamp = new Date().toISOString();
        console.warn(`[${timestamp}] ⚠️ Access denied: User ${userId} → Course ${courseId}`);
        accessMetrics.accessDenied++;

        // Generic redirect without revealing info
        if (isAjaxRequest(req)) {
            return res.status(403).json({ success: false, message: 'You must purchase this course to access' });
        }
        return res.redirect('/courses');
    };
}

/* -------------------------------------------------------------------------- */
/*                                   EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = {
    // Main functions
    getUserPurchasedCourses,
    requireCoursePurchase,
    clearUserCourseCache,

    // Utilities
    isValidObjectId,
    isAjaxRequest,
    getAccessMetrics,

    // Constants
    VALID_ROLES,
    CACHE_TTL_MS
};
