/* -------------------------------------------------------------------------- */
/*                          BACKGROUND TASK SCHEDULER                         */
/* -------------------------------------------------------------------------- */
/*
 * Purpose: Manages automated cleanup tasks to maintain database health
 * 
 * Features:
 * - Individual error handling per task
 * - Graceful start/stop with interval management
 * - Function validation on startup
 * - Overlap prevention with isRunning flag
 * - Return values and metrics collection
 * - Configurable thresholds via environment
 * - Scheduled time control
 * - Retry logic with exponential backoff
 * - Persistent logging to file
 * - Graceful shutdown coordination
 * 
 * CLEANUP STRATEGY:
 * - Chat messages (7 days default): Ephemeral, storage-heavy
 * - Community posts (30 days default): Some permanent value
 * - Configurable via CLEANUP_MESSAGES_DAYS / CLEANUP_POSTS_DAYS
 */
/* -------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');

/* -------------------------------------------------------------------------- */
/*                                DEPENDENCIES                                */
/* -------------------------------------------------------------------------- */

const { cleanupOldMessages } = require('../controllers/chat.controller');
const { cleanupOldPosts } = require('../controllers/community.controller');
const { cleanupExpiredCourses } = require('../controllers/course.controller');

// Validate cleanup functions exist at module load
if (typeof cleanupOldMessages !== 'function') {
    console.error('❌ cleanupOldMessages function not found in chat.controller');
}
if (typeof cleanupOldPosts !== 'function') {
    console.error('❌ cleanupOldPosts function not found in community.controller');
}
if (typeof cleanupExpiredCourses !== 'function') {
    console.error('❌ cleanupExpiredCourses function not found in course.controller');
}

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

// Configurable cleanup thresholds
const CLEANUP_CONFIG = {
    messages: {
        maxAgeDays: parseInt(process.env.CLEANUP_MESSAGES_DAYS || '7', 10),
        description: 'Chat messages'
    },
    posts: {
        maxAgeDays: parseInt(process.env.CLEANUP_POSTS_DAYS || '30', 10),
        description: 'Community posts'
    }
};

// Configurable interval (default 24h)
const INTERVAL_MS = parseInt(process.env.CLEANUP_INTERVAL_MS || String(24 * 60 * 60 * 1000), 10);

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY = 1000; // 1 second, doubles each retry

// Performance baseline
const PERFORMANCE_BASELINE = {
    expectedDuration: 60000,   // 1 minute
    maxDuration: 300000,       // 5 minutes warning
    maxTolerance: 600000       // 10 minutes critical
};

/* -------------------------------------------------------------------------- */
/*                                 STATE                                      */
/* -------------------------------------------------------------------------- */

// Store interval ID for cancellation
let cleanupInterval = null;

// Overlap prevention flag
let isRunning = false;

// Shutdown coordination
let isShuttingDown = false;

// Status tracking
let lastCleanupTime = null;
let lastCleanupDuration = 0;
let lastCleanupStatus = 'idle';

// Skip mechanism
let cleanupDisabled = false;

/* -------------------------------------------------------------------------- */
/*                              LOGGING                                       */
/* -------------------------------------------------------------------------- */

const logCleanup = (status, data) => {
    const timestamp = new Date().toISOString();
    const logEntry = JSON.stringify({ timestamp, status, ...data }) + '\n';

    // Console log
    console.log(`[Scheduler] ${status}:`, data);

    // Persistent log
    try {
        const logsDir = path.join(__dirname, '../../logs');
        if (!fs.existsSync(logsDir)) {
            fs.mkdirSync(logsDir, { recursive: true });
        }
        const logFile = path.join(logsDir, 'scheduler.log');
        fs.appendFileSync(logFile, logEntry);
    } catch (err) {
        console.warn('Failed to write scheduler log:', err.message);
    }
};

/* -------------------------------------------------------------------------- */
/*                           SCHEDULER INITIALIZATION                         */
/* -------------------------------------------------------------------------- */

/**
 * Initializes the background scheduler for automated cleanup tasks.
 * Returns cleanup functions for graceful shutdown
 * Supports disabling via SCHEDULER_ENABLED env var
 */
const initScheduler = () => {
    // Distributed scheduler support - only run on designated instance
    if (process.env.SCHEDULER_ENABLED === 'false') {
        console.log('⏰ [Scheduler] Disabled on this instance (SCHEDULER_ENABLED=false)');
        return;
    }

    console.log('⏰ [Scheduler] Initializing background tasks...');
    console.log('  📋 Config:', CLEANUP_CONFIG);
    console.log(`  ⏱️  Interval: ${INTERVAL_MS / 1000 / 60} minutes`);

    // Run immediately if CLEANUP_ON_STARTUP enabled (default: true)
    if (process.env.CLEANUP_ON_STARTUP !== 'false') {
        runCleanup();
    }

    // Store interval ID for cancellation
    cleanupInterval = setInterval(() => {
        if (!isShuttingDown) {
            runCleanup();
        }
    }, INTERVAL_MS);

    // [New] Schedule weekly maintenance for orphan file cleanup
    const WEEKLY_MS = 7 * 24 * 60 * 60 * 1000;
    setInterval(() => {
        if (!isShuttingDown) {
            runWeeklyMaintenance();
        }
    }, WEEKLY_MS);

    // [New] Schedule daily automated Google Drive Backups
    const DAILY_BACKUP_MS = 24 * 60 * 60 * 1000; // 24 hours
    setInterval(async () => {
        if (!isShuttingDown) {
            try {
                console.log('⏰ [Scheduler] Starting automated daily backup...');
                const { runFullBackup, uploadToGDrive, cleanOldLocalBackups } = require('./backup.service');
                const zipPath = await runFullBackup();
                await uploadToGDrive(zipPath);
                
                // Keep only the last 3 days of `.zip` files on the VPS to save space
                cleanOldLocalBackups(parseInt(process.env.BACKUP_RETENTION_DAYS || '3'));
            } catch (err) {
                console.error('❌ [Scheduler] Automated backup failed:', err.message);
            }
        }
    }, DAILY_BACKUP_MS);

    console.log(`⏰ [Scheduler] Cleanup task scheduled every ${INTERVAL_MS / 1000 / 60} minutes.`);
    console.log(`⏰ [Scheduler] Weekly maintenance scheduled every 7 days.`);
    console.log(`⏰ [Scheduler] Automated backups scheduled every 24 hours.`);
};

/**
 * Stops the scheduler gracefully
 */
const stopScheduler = async () => {
    console.log('🔌 [Scheduler] Initiating graceful shutdown...');
    isShuttingDown = true;

    // Wait for running cleanup to complete
    let waitTime = 0;
    const maxWait = 30000; // 30 seconds max wait
    while (isRunning && waitTime < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 100));
        waitTime += 100;
    }

    if (cleanupInterval) {
        clearInterval(cleanupInterval);
        cleanupInterval = null;
        console.log('✓ [Scheduler] Interval cleared');
    }

    console.log('✓ [Scheduler] Shutdown complete');
};

// Register shutdown handlers
process.on('SIGTERM', stopScheduler);
process.on('SIGINT', stopScheduler);

/* -------------------------------------------------------------------------- */
/*                             CLEANUP EXECUTION                              */
/* -------------------------------------------------------------------------- */

/**
 * Executes all cleanup tasks with individual error handling
 * Includes retry logic and metrics collection
 */
const runCleanup = async () => {
    // Skip mechanism
    if (cleanupDisabled) {
        console.log('⏭️  [Cleanup] Skipped (disabled by operator)');
        return null;
    }

    // Prevent overlapping executions
    if (isRunning) {
        console.warn('⚠️  [Cleanup] Previous cleanup still running, skipping...');
        return null;
    }

    isRunning = true;
    lastCleanupStatus = 'running';
    const startTime = Date.now();

    // Metrics collection
    const results = {
        messagesDeleted: 0,
        postsDeleted: 0,
        coursesCleaned: 0,
        duration: 0,
        errors: [],
        timestamp: new Date().toISOString()
    };

    console.log('🧹 [Cleanup] Starting daily cleanup task...');

    // Individual error handling for each task
    // Retry logic for messages cleanup
    results.messagesDeleted = await runTaskWithRetry(
        'messages',
        () => cleanupOldMessages(CLEANUP_CONFIG.messages.maxAgeDays),
        results.errors
    );

    // Retry logic for posts cleanup
    results.postsDeleted = await runTaskWithRetry(
        'posts',
        () => cleanupOldPosts(CLEANUP_CONFIG.posts.maxAgeDays),
        results.errors
    );

    // [New] Cleanup expired courses
    results.coursesCleaned = await runTaskWithRetry(
        'expired_courses',
        () => cleanupExpiredCourses(),
        results.errors
    );

    // Calculate duration
    results.duration = Date.now() - startTime;
    lastCleanupTime = new Date();
    lastCleanupDuration = results.duration;

    // Performance monitoring
    if (results.duration > PERFORMANCE_BASELINE.maxTolerance) {
        console.error(`🚨 [Cleanup] CRITICAL: Cleanup took ${results.duration}ms (>${PERFORMANCE_BASELINE.maxTolerance}ms)`);
        results.performanceStatus = 'critical';
    } else if (results.duration > PERFORMANCE_BASELINE.maxDuration) {
        console.warn(`⚠️  [Cleanup] SLOW: Cleanup took ${results.duration}ms (>${PERFORMANCE_BASELINE.maxDuration}ms)`);
        results.performanceStatus = 'slow';
    } else {
        results.performanceStatus = 'normal';
    }

    // Final status
    if (results.errors.length === 0) {
        lastCleanupStatus = 'success';
        console.log(`✅ [Cleanup] Completed in ${results.duration}ms`, {
            messagesDeleted: results.messagesDeleted,
            postsDeleted: results.postsDeleted
        });
    } else {
        lastCleanupStatus = 'partial';
        console.warn(`⚠️  [Cleanup] Completed with errors in ${results.duration}ms`, results.errors);
    }

    // Persistent logging
    logCleanup(lastCleanupStatus, results);

    isRunning = false;
    return results;
};

/**
 * Weekly maintenance task: Cleanup orphan files from uploads directory
 * Orphan files are files on disk that are no longer referenced in the database.
 */
const runWeeklyMaintenance = async () => {
    console.log('🧹 [Maintenance] Starting weekly maintenance (orphan file cleanup)...');
    const startTime = Date.now();
    let deletedCount = 0;

    try {
        const prisma = require('./prisma');
        const uploadDirs = [
            { path: 'public/uploads/chat', model: 'chatMessage', field: 'imageUrl' },
            { path: 'public/uploads/community', model: 'communityPost', field: 'imageUrl' }
        ];

        for (const dirInfo of uploadDirs) {
            const dirPath = path.join(__dirname, '../../', dirInfo.path);
            if (!fs.existsSync(dirPath)) continue;

            const files = fs.readdirSync(dirPath);
            for (const file of files) {
                // Skip placeholder or hidden files
                if (file.startsWith('.') || file === 'qr-placeholder.png') continue;

                const relativePath = `/${dirInfo.path.replace('public/', '')}/${file}`;

                // Check if file is referenced in DB
                const reference = await prisma[dirInfo.model].findFirst({
                    where: { [dirInfo.field]: relativePath }
                });

                if (!reference) {
                    console.log(`🗑️ [Maintenance] Deleting orphan file: ${relativePath}`);
                    fs.unlinkSync(path.join(dirPath, file));
                    deletedCount++;
                }
            }
        }

        const duration = Date.now() - startTime;
        console.log(`✅ [Maintenance] Completed. Deleted ${deletedCount} orphan files in ${duration}ms.`);
    } catch (error) {
        console.error('❌ [Maintenance] Failed:', error.message);
    }
};

/**
 * Runs a cleanup task with retry logic
 */
const runTaskWithRetry = async (taskName, taskFn, errorArray) => {
    let attempt = 0;

    while (attempt < MAX_RETRIES) {
        try {
            const result = await taskFn();
            console.log(`  ✓ ${taskName}: deleted ${result || 0} records`);
            return result || 0;
        } catch (error) {
            attempt++;
            if (attempt < MAX_RETRIES) {
                const delay = Math.pow(2, attempt) * RETRY_BASE_DELAY;
                console.warn(`  ⚠️  ${taskName} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            } else {
                console.error(`  ❌ ${taskName} failed after ${MAX_RETRIES} attempts:`, error.message);
                errorArray.push({ task: taskName, error: error.message });
            }
        }
    }

    return 0;
};

/* -------------------------------------------------------------------------- */
/*                          OPERATIONAL CONTROLS                              */
/* -------------------------------------------------------------------------- */

const disableCleanup = () => {
    cleanupDisabled = true;
    console.log('🛑 [Cleanup] Disabled by operator');
};

const enableCleanup = () => {
    cleanupDisabled = false;
    console.log('✓ [Cleanup] Enabled');
};

/* -------------------------------------------------------------------------- */
/*                          STATUS ENDPOINT                                   */
/* -------------------------------------------------------------------------- */

const getSchedulerStatus = () => {
    return {
        isRunning,
        isDisabled: cleanupDisabled,
        isShuttingDown,
        lastRun: lastCleanupTime,
        lastDuration: lastCleanupDuration,
        lastStatus: lastCleanupStatus,
        nextRun: lastCleanupTime
            ? new Date(lastCleanupTime.getTime() + INTERVAL_MS)
            : null,
        config: CLEANUP_CONFIG,
        intervalMs: INTERVAL_MS
    };
};

/* -------------------------------------------------------------------------- */
/*                                   EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = {
    initScheduler,
    stopScheduler,
    runCleanup,
    disableCleanup,
    enableCleanup,
    getSchedulerStatus
};
