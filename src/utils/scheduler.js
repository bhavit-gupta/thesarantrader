const { cleanupOldMessages } = require('../controllers/chat.controller');

/**
 * Initializes the background scheduler for cleanup tasks.
 * Runs once immediately on server start, then every 24 hours.
 */
const initScheduler = () => {
    console.log('⏰ [Scheduler] Initializing background tasks...');

    // Run cleanup immediately on startup so we don't wait 24h for the first run
    runCleanup();

    // Schedule subsequent runs every 24 hours
    // 24 hours * 60 mins * 60 secs * 1000 ms
    const INTERVAL_24H = 24 * 60 * 60 * 1000;

    setInterval(() => {
        runCleanup();
    }, INTERVAL_24H);

    console.log(`⏰ [Scheduler] Cleanup task scheduled every 24 hours.`);
};

const runCleanup = async () => {
    try {
        console.log('🧹 [Cleanup] Starting daily cleanup task...');
        await cleanupOldMessages();
        console.log('✅ [Cleanup] Daily cleanup completed successfully.');
    } catch (error) {
        console.error('❌ [Cleanup] Error running daily cleanup:', error);
    }
};

module.exports = { initScheduler };
