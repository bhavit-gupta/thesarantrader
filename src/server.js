/* -------------------------------------------------------------------------- */
/*                          SERVER ENTRY POINT                                */
/* -------------------------------------------------------------------------- */
/*
 * Purpose: Initializes and starts the Express HTTP server
 * 
 * Responsibilities:
 * 1. Load environment variables from .env
 * 2. Validate configuration
 * 3. Import configured Express app
 * 4. Start background scheduler for cleanup tasks
 * 5. Bind server to port and listen for connections
 * 6. Handle graceful shutdown
 * 
 * Lifecycle:
 * - server.js → app.js (middleware/routes) → controllers → models (Prisma)
 * 
 * Environment Variables Required:
 * - PORT: Server port (default: 3000)
 * - DATABASE_URL: MongoDB connection string
 * - SESSION_SECRET: Session encryption key
 * 
 * Server Features:
 * - Express 5.2.1
 * - Session-based authentication
 * - Background task scheduler (24h cleanup)
 * - CSRF protection
 * - Rate limiting
 * - Single-session enforcement
 * - Graceful shutdown
 * - Memory/CPU monitoring
 */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/*                    GLOBAL ERROR HANDLERS                                   */
/* -------------------------------------------------------------------------- */

/**
 * Handle uncaught exceptions - prevents silent crashes
 * Must be at the very top, before any other code
 */
process.on('uncaughtException', (error) => {
    console.error('❌ FATAL: Uncaught Exception');
    console.error('  Message:', error.message);
    console.error('  Stack:', error.stack);

    // Exit with failure code
    process.exit(1);
});

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ FATAL: Unhandled Promise Rejection');
    console.error('  Reason:', reason);
    console.error('  Promise:', promise);

    // Exit with failure code
    process.exit(1);
});

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

const fs = require('fs');
const path = require('path');
const os = require('os');

// Check if .env file exists before loading
const envPath = path.resolve(__dirname, '..', '.env');
if (!fs.existsSync(envPath)) {
    console.warn('⚠️ WARNING: .env file not found');
    console.warn('   Using environment variables or defaults');
}

require('dotenv').config({ override: true }); // Load environment variables from .env file (force override stale system vars)

/* -------------------------------------------------------------------------- */
/*                        DEPENDENCY VALIDATION                               */
/* -------------------------------------------------------------------------- */

/**
 * Check required packages before starting
 */
const requiredModules = [
    'express',
    'dotenv',
    '@prisma/client',
    'express-session',
    'helmet'
];

const missingModules = [];
requiredModules.forEach(module => {
    try {
        require.resolve(module);
    } catch (e) {
        missingModules.push(module);
    }
});

if (missingModules.length > 0) {
    console.error('❌ Missing required modules:', missingModules.join(', '));
    console.error('   Run: npm install');
    process.exit(1);
}

/* -------------------------------------------------------------------------- */
/*                      ENVIRONMENT VALIDATION                                */
/* -------------------------------------------------------------------------- */

// Get PORT (can be a number or a string/pipe for Passenger/Hostinger)
const PORT = process.env.PORT || 3000;

// Validate NODE_ENV
const VALID_ENVIRONMENTS = ['development', 'staging', 'production'];
const NODE_ENV = process.env.NODE_ENV || 'development';

if (!VALID_ENVIRONMENTS.includes(NODE_ENV)) {
    console.error(`❌ Invalid NODE_ENV: ${NODE_ENV}`);
    console.error(`   Must be one of: ${VALID_ENVIRONMENTS.join(', ')}`);
    process.exit(1);
}

/* -------------------------------------------------------------------------- */
/*                         APP & PRISMA LOADING                               */
/* -------------------------------------------------------------------------- */

let app;
try {
    // Wrap app require in error handling
    app = require('./app');
    console.log('✓ Express app loaded');
} catch (error) {
    console.error('❌ Failed to load Express app:', error.message);
    console.error('   Check syntax in app.js');
    process.exit(1);
}

// Import prisma utilities
const { validateConnection, getStatus } = require('./utils/prisma');
const prisma = require('./utils/prisma');

// Share prisma instance via app.locals
app.locals.prisma = prisma;

/* -------------------------------------------------------------------------- */
/*                        MONITORING UTILITIES                                */
/* -------------------------------------------------------------------------- */

// Track startup time for uptime calculation
const startTime = Date.now();

/**
 * Get formatted uptime
 */
function getUptime() {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${mins}m`;
}

/**
 * Get memory usage in human-readable format
 */
function getMemoryUsage() {
    const usage = process.memoryUsage();
    return {
        heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB',
        external: Math.round(usage.external / 1024 / 1024) + 'MB',
        rss: Math.round(usage.rss / 1024 / 1024) + 'MB'
    };
}

/**
 * Sanitize database URL for logging (hide credentials)
 */
function sanitizeDbUrl(url) {
    if (!url) return 'NOT SET';
    try {
        // Handle standard URLs first
        const parsed = new URL(url);
        return `${parsed.protocol}//{masked}@${parsed.host}/${parsed.pathname.slice(1)}`;
    } catch {
        // Fallback for complex multi-host MongoDB Replica Set strings
        if (url.startsWith('mongodb://')) {
            const atIndex = url.indexOf('@');
            if (atIndex !== -1) {
                return `mongodb://{masked}@${url.substring(atIndex + 1).split('?')[0]}`;
            }
        }
        return 'INVALID URL FORMAT';
    }
}

/* -------------------------------------------------------------------------- */
/*                         HEALTH ENDPOINTS                                   */
/* -------------------------------------------------------------------------- */

/**
 * Kubernetes liveness probe
 */
app.get('/healthz', (req, res) => {
    res.status(200).json({
        status: 'alive',
        pid: process.pid,
        uptime: getUptime()
    });
});

/**
 * Kubernetes readiness probe
 */
app.get('/ready', async (req, res) => {
    try {
        // Quick DB check
        const isConnected = await validateConnection();
        if (isConnected) {
            res.status(200).json({ status: 'ready' });
        } else {
            res.status(503).json({ status: 'not_ready', error: 'Database not connected' });
        }
    } catch (error) {
        res.status(503).json({ status: 'not_ready', error: error.message });
    }
});

/* -------------------------------------------------------------------------- */
/*                        REQUEST METRICS                                     */
/* -------------------------------------------------------------------------- */

const metrics = {
    totalRequests: 0,
    totalErrors: 0,
    startTime: Date.now()
};

/**
 * Track request metrics
 */
app.use((req, res, next) => {
    metrics.totalRequests++;

    res.on('finish', () => {
        if (res.statusCode >= 500) {
            metrics.totalErrors++;
        }
    });

    next();
});

/**
 * Expose metrics endpoint
 */
app.get('/metrics', (req, res) => {
    res.json({
        ...metrics,
        memory: getMemoryUsage(),
        uptime: getUptime(),
        pid: process.pid
    });
});

/* -------------------------------------------------------------------------- */
/*                         BACKGROUND TASK SCHEDULER                          */
/* -------------------------------------------------------------------------- */

let schedulerHandle = null;

/**
 * Initialize background scheduler for automated cleanup tasks.
 * Only runs on primary instance (for PM2 cluster mode)
 * Wrapped in try/catch for error handling
 * Delayed start for better startup performance
 * Detailed logging
 * 
 * Tasks Scheduled:
 * - Chat message cleanup (7+ days old)
 * - Community post cleanup (30+ days old)
 * 
 * Frequency: Every 24 hours
 */
function initializeScheduler() {
    // Only start scheduler on primary process
    const instanceId = process.env.INSTANCE_ID || process.env.pm_id || '0';
    const isSchedulerEnabled = process.env.SCHEDULER_ENABLED !== 'false';

    if (!isSchedulerEnabled) {
        console.log('⏩ Scheduler disabled via SCHEDULER_ENABLED=false');
        return;
    }

    if (instanceId !== '0' && instanceId !== undefined) {
        console.log(`⏩ Scheduler skipped on instance ${instanceId} (only runs on instance 0)`);
        return;
    }

    // Delay scheduler start by 30 seconds
    console.log('⏳ Scheduler will start in 30 seconds...');

    setTimeout(() => {
        try {
            // Wrap scheduler init in try/catch
            console.log('🔧 Initializing background scheduler...');
            const { initScheduler } = require('./utils/scheduler.js');
            schedulerHandle = initScheduler();
            console.log('✓ Background scheduler started');
        } catch (error) {
            // Don't crash server if scheduler fails
            console.error('❌ Scheduler initialization failed:', error.message);
            console.error('   Continuing without scheduler - cleanup tasks will not run');
        }
    }, 30000);
}

/* -------------------------------------------------------------------------- */
/*                          GRACEFUL SHUTDOWN                                 */
/* -------------------------------------------------------------------------- */

let server = null;
let isShuttingDown = false;

/**
 * Graceful shutdown handler
 * Handles SIGTERM/SIGINT signals
 * Drains existing connections
 * Has timeout for scheduler cleanup
 */
async function gracefulShutdown(signal) {
    if (isShuttingDown) {
        console.log('Shutdown already in progress...');
        return;
    }

    isShuttingDown = true;
    console.log(`\n⏹️ ${signal} received. Shutting down gracefully...`);

    // Shutdown timeout
    const shutdownTimeout = setTimeout(() => {
        console.error('❌ Shutdown timeout (30s), forcing exit');
        process.exit(1);
    }, 30000);

    try {
        // Stop scheduler first
        if (schedulerHandle && typeof schedulerHandle.stop === 'function') {
            try {
                schedulerHandle.stop();
                console.log('✓ Scheduler stopped');
            } catch (error) {
                console.error('⚠️ Error stopping scheduler:', error.message);
            }
        }

        // Stop accepting new connections
        if (server) {
            await new Promise((resolve) => {
                server.close(() => {
                    console.log('✓ HTTP server closed');
                    resolve();
                });
            });
        }

        // Close database connection
        await prisma.$disconnect();
        console.log('✓ Database disconnected');

        clearTimeout(shutdownTimeout);
        console.log('✓ Graceful shutdown complete');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error during shutdown:', error.message);
        clearTimeout(shutdownTimeout);
        process.exit(1);
    }
}

// Signal handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// SIGUSR2 for nodemon/PM2 restart
process.on('SIGUSR2', () => {
    console.log('⚠️ SIGUSR2 received, preparing for restart...');
    gracefulShutdown('SIGUSR2');
});

/* -------------------------------------------------------------------------- */
/*                        MEMORY MONITORING                                   */
/* -------------------------------------------------------------------------- */

/**
 * Monitor memory and CPU periodically
 */
function startMonitoring() {
    // Memory monitoring every 5 minutes
    setInterval(() => {
        const mem = getMemoryUsage();
        const heapUsedMB = parseInt(mem.heapUsed);

        if (heapUsedMB > 500) {
            console.warn('⚠️ High memory usage:', mem);
        }
    }, 5 * 60 * 1000);

    // CPU monitoring every minute
    let lastCpuUsage = process.cpuUsage();
    setInterval(() => {
        const currentCpuUsage = process.cpuUsage(lastCpuUsage);
        lastCpuUsage = process.cpuUsage();

        const totalCPU = (currentCpuUsage.user + currentCpuUsage.system) / 1e6;
        if (totalCPU > 50) { // More than 50% of interval spent on CPU
            console.warn(`⚠️ High CPU usage: ${totalCPU.toFixed(2)}s per minute`);
        }
    }, 60000);
}

/* -------------------------------------------------------------------------- */
/*                              SERVER STARTUP                                */
/* -------------------------------------------------------------------------- */

/**
 * Start the HTTP server after validating database connection.
 * Validates database connection before accepting requests
 * Handles port-in-use errors
 * Validates port availability
 * 
 * Startup Process:
 * 1. Validate database connection (fail-fast if DB unavailable)
 * 2. Start background scheduler for cleanup tasks
 * 3. Express app binds to specified PORT
 * 4. Server begins accepting HTTP requests
 */
(async () => {
    try {
        // Log environment variables at startup
        console.log(`
┌─────────────────────────────────────────────┐
│            SERVER STARTUP                   │
├─────────────────────────────────────────────┤
│ PID:          ${String(process.pid).padEnd(28)}│
│ Environment:  ${NODE_ENV.padEnd(28)}│
│ Port:         ${String(PORT).padEnd(28)}│
│ Node:         ${process.version.padEnd(28)}│
│ Database:     ${process.env.DATABASE_URL ? 'CONFIGURED'.padEnd(28) : 'NOT SET'.padEnd(28)}│
│ Session:      ${process.env.SESSION_SECRET ? 'CONFIGURED'.padEnd(28) : 'NOT SET'.padEnd(28)}│
│ Scheduler:    ${(process.env.SCHEDULER_ENABLED !== 'false' ? 'ENABLED' : 'DISABLED').padEnd(28)}│
└─────────────────────────────────────────────┘
        `);

        // Log request size limits
        console.log(`📊 Max request size: ${process.env.MAX_REQUEST_SIZE || '10kb'}`);

        // Validate database connection before accepting requests
        console.log('🔌 Validating database connection...');
        const isConnected = await validateConnection();

        if (!isConnected) {
            console.error('❌ Database connection failed. Server startup aborted.');
            console.error(`   Database URL: ${sanitizeDbUrl(process.env.DATABASE_URL)}`);
            process.exit(1);
        }

        console.log('✅ Database connection validated');
        console.log('📊 Database status:', getStatus());

        // Start background cleanup tasks
        initializeScheduler();

        // Log initial memory usage
        console.log('💾 Initial memory:', JSON.stringify(getMemoryUsage()));

        // Start monitoring
        startMonitoring();

        // Start HTTP server with error handling
        server = app.listen(PORT, () => {
            console.log(`
🚀 SERVER READY
────────────────────────────────────────────
Local URL:   http://localhost:${PORT}
Status:      Listening for requests...
Database:    MongoDB (Prisma)
Scheduler:   Will start in 30 seconds
────────────────────────────────────────────
            `);
        });

        // Handle port-in-use error
        server.on('error', (error) => {
            if (error.code === 'EADDRINUSE') {
                console.error(`❌ ERROR: Port ${PORT} is already in use`);
                console.error(`   Kill process: npx kill-port ${PORT}`);
                console.error('   Or use different port: PORT=3001 npm start');
            } else {
                console.error('❌ Server error:', error);
            }
            process.exit(1);
        });

    } catch (error) {
        console.error('❌ Server startup failed:', error);
        process.exit(1);
    }
})();

/* -------------------------------------------------------------------------- */
/*                         PRODUCTION RECOMMENDATIONS                         */
/* -------------------------------------------------------------------------- */

/**
 * Production deployment recommendations:
 * 
 * Use PM2 for process management:
 *   pm2 start src/server.js --name thesarantrader --instances 4 --exec-mode cluster
 * 
 * Or with ecosystem file (ecosystem.config.js):
 *   module.exports = {
 *     apps: [{
 *       name: 'thesarantrader',
 *       script: 'src/server.js',
 *       instances: 'max',
 *       exec_mode: 'cluster',
 *       env_production: {
 *         NODE_ENV: 'production',
 *         PORT: 3000
 *       }
 *     }]
 *   };
 * 
 * For crash dumps on Linux/Mac:
 *   ulimit -c unlimited
 */