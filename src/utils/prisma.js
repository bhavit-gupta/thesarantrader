/* -------------------------------------------------------------------------- */
/*                        PRISMA DATABASE CLIENT                              */
/* -------------------------------------------------------------------------- */
/*
 * Purpose: Centralized Prisma Client instance for the entire application
 * 
 * Features:
 * - Error handling on initialization
 * - Connection validation at startup
 * - Graceful shutdown handling
 * - Query logging and metrics
 * - Connection pool configuration
 * - Transaction documentation
 * - Retry logic for transient failures
 * - Query timeout protection
 * - Connection pool health monitoring
 * - Sensitive data masking
 * 
 * Database: MongoDB (via Prisma ORM)
 * 
 * BACKUP STRATEGY:
 * MongoDB Atlas: Automated daily backups included
 * Self-hosted: Use mongodump --uri mongodb://... --out ./backups/
 * 
 * SQL INJECTION PREVENTION:
 * ✅ SAFE - Prisma parameterizes automatically:
 *    await prisma.user.findUnique({ where: { email: userInput } });
 * ✅ SAFE - Query parameterization:
 *    await prisma.$queryRaw`SELECT * FROM User WHERE email = ${email}`;
 * ❌ UNSAFE - Never use string interpolation for queries
 * 
 * TRANSACTION EXAMPLE:
 *    await prisma.$transaction(async (tx) => {
 *        const user = await tx.user.create({ data: { name: 'John' } });
 *        await tx.purchase.create({ data: { userId: user.id, courseId: '123' } });
 *    });
 * 
 * COMMON PATTERNS:
 * COUNT:  await prisma.user.count({ where: { role: 'admin' } });
 * INCLUDE: await prisma.user.findUnique({ where: { id }, include: { purchases: true } });
 * SELECT: await prisma.user.findMany({ select: { id: true, email: true } });
 * AGGREGATE: await prisma.purchase.aggregate({ _sum: { amount: true } });
 */
/* -------------------------------------------------------------------------- */

const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const path = require('path');

/* -------------------------------------------------------------------------- */
/*                              CONFIGURATION                                 */
/* -------------------------------------------------------------------------- */

// Environment-specific logging
const LOG_CONFIG = {
    development: process.env.PRISMA_LOG_QUERY === 'true' ? ['query', 'info', 'warn', 'error'] : ['info', 'warn', 'error'],
    staging: ['warn', 'error'],
    production: ['error'],
    test: ['error']
};

const currentEnv = process.env.NODE_ENV || 'development';
const logLevel = LOG_CONFIG[currentEnv] || LOG_CONFIG.development;

// Query timeout (default 30 seconds)
const QUERY_TIMEOUT_MS = parseInt(process.env.QUERY_TIMEOUT_MS || '30000', 10);

// Health check interval (default 60 seconds)
const HEALTH_CHECK_INTERVAL_MS = parseInt(process.env.DB_HEALTH_CHECK_INTERVAL_MS || '60000', 10);

// Retry configuration
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 100;

/* -------------------------------------------------------------------------- */
/*                         PRISMA CLIENT INITIALIZATION                       */
/* -------------------------------------------------------------------------- */

/**
 * Singleton Prisma Client instance with comprehensive configuration.
 * 
 * Available Models:
 * - prisma.user
 * - prisma.course
 * - prisma.courseVideo
 * - prisma.purchase
 * - prisma.testimonial
 * - prisma.chatRoom
 * - prisma.chatMessage
 * - prisma.communityPost
 * - prisma.communityLike
 * - prisma.session
 * - prisma.seedHistory (internal)
 */
let prisma;

// Error handling on initialization
try {
    prisma = new PrismaClient({
        log: logLevel.includes('query')
            ? [
                { level: 'query', emit: 'event' },
                { level: 'error', emit: 'stdout' },
                { level: 'warn', emit: 'stdout' }
            ]
            : logLevel
    });
    console.log('✓ Prisma Client initialized');
} catch (error) {
    console.error('❌ FATAL: Failed to initialize Prisma Client');
    console.error('   Error:', error.message);
    console.error('   DATABASE_URL:', process.env.DATABASE_URL ? 'SET' : 'NOT SET');
    process.exit(1);
}


/* -------------------------------------------------------------------------- */
/*                          RETRY & TIMEOUT HELPERS                           */
/* -------------------------------------------------------------------------- */

/**
 * Execute a database operation with retry logic for transient failures.
 */
const withRetry = async (fn, maxRetries = MAX_RETRIES) => {
    const RETRYABLE_CODES = ['P1001', 'P1002', 'P1008', 'P1017'];
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            const isLastAttempt = attempt === maxRetries - 1;
            const isRetryable = RETRYABLE_CODES.includes(error.code);
            if (isLastAttempt || !isRetryable) throw error;
            const delay = Math.pow(2, attempt) * RETRY_BASE_DELAY_MS;
            console.warn(`⚠️ Database retry ${attempt + 1}/${maxRetries} in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

/**
 * Execute a database operation with timeout protection.
 */
const withTimeout = async (fn, timeoutMs = QUERY_TIMEOUT_MS) => {
    return Promise.race([
        fn(),
        new Promise((_, reject) =>
            setTimeout(
                () => reject(new Error(`Query timeout after ${timeoutMs}ms`)),
                timeoutMs
            )
        )
    ]);
};

/* -------------------------------------------------------------------------- */
/*                          CONNECTION VALIDATION                             */
/* -------------------------------------------------------------------------- */

let isConnected = false;
let connectionValidated = false;

const validateConnection = async () => {
    try {
        // Step 1: Establish low-level connection
        // Use a 20-second timeout for the initial connection check
        await withTimeout(() => prisma.$connect(), 20000);

        // Step 2: Validate database access (catches "empty database name" errors)
        await withTimeout(() => prisma.$runCommandRaw({ ping: 1 }), 10000);

        isConnected = true;
        connectionValidated = true;
        console.log('✓ Database connection verified');
        return true;
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        isConnected = false;
        return false;
    }
};

// Validate on startup (non-blocking)
validateConnection().catch((err) => {
    console.error('Database validation error:', err.message);
});

/* -------------------------------------------------------------------------- */
/*                          GRACEFUL SHUTDOWN                                 */
/* -------------------------------------------------------------------------- */

const gracefulShutdown = async (signal) => {
    console.log(`🔌 [${signal}] Closing database connection...`);
    try {
        await prisma.$disconnect();
        console.log('✓ Database disconnected');
    } catch (error) {
        console.error('Error disconnecting database:', error.message);
    }
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/* -------------------------------------------------------------------------- */
/*                      QUERY LOGGING & METRICS                               */
/* -------------------------------------------------------------------------- */

// Query metrics storage
const queryMetrics = {};

// Mask sensitive data in logs
const maskSensitiveData = (query) => {
    if (!query) return query;
    return query
        .replace(/password\s*[=:]\s*['"][^'"]*['"]/gi, 'password=***')
        .replace(/email\s*[=:]\s*['"][^'"]*['"]/gi, 'email=***')
        .replace(/phone\s*[=:]\s*['"][^'"]*['"]/gi, 'phone=***')
        .replace(/\$2[aby]\$\d+\$[^'"]+/g, '***HASH***'); // bcrypt hashes
};

// Query event listener
if (logLevel.includes('query')) {
    prisma.$on('query', (e) => {
        const maskedQuery = maskSensitiveData(e.query);
        const queryKey = maskedQuery.substring(0, 50);

        // Performance profiling
        if (!queryMetrics[queryKey]) {
            queryMetrics[queryKey] = { count: 0, totalTime: 0, minTime: Infinity, maxTime: 0 };
        }
        queryMetrics[queryKey].count++;
        queryMetrics[queryKey].totalTime += e.duration;
        queryMetrics[queryKey].minTime = Math.min(queryMetrics[queryKey].minTime, e.duration);
        queryMetrics[queryKey].maxTime = Math.max(queryMetrics[queryKey].maxTime, e.duration);

        // Log in development (only if query logging is enabled)
        if (currentEnv === 'development' && process.env.PRISMA_LOG_QUERY === 'true') {
            console.log('🔍 Query:', maskedQuery.substring(0, 100));
            console.log('⏱️  Duration:', e.duration, 'ms');
        }

        // Warn on slow queries (>1s)
        if (e.duration > 1000) {
            console.warn(`⚠️ SLOW QUERY (${e.duration}ms):`, maskedQuery.substring(0, 100));
        }
    });
}

/* -------------------------------------------------------------------------- */
/*                     CONNECTION POOL HEALTH                                 */
/* -------------------------------------------------------------------------- */

let healthCheckInterval = null;

const startHealthCheck = () => {
    if (healthCheckInterval) return;

    healthCheckInterval = setInterval(async () => {
        try {
            const start = Date.now();
            await prisma.$runCommandRaw({ ping: 1 });
            const duration = Date.now() - start;

            if (!isConnected) {
                console.log('✓ Database reconnected');
                isConnected = true;
            }

            if (duration > 100) {
                console.warn('⚠️ Database ping slow:', duration, 'ms');
            }
        } catch (error) {
            if (isConnected) {
                console.error('❌ Database connection lost:', error.message);
                isConnected = false;

                // Attempt reconnection
                setTimeout(async () => {
                    try {
                        await prisma.$connect();
                        console.log('✓ Reconnection successful');
                        isConnected = true;
                    } catch (err) {
                        console.error('Reconnection failed:', err.message);
                    }
                }, 5000);
            }
        }
    }, HEALTH_CHECK_INTERVAL_MS);
};

// Start health check after initial connection
if (currentEnv !== 'test') {
    startHealthCheck();
}

/* -------------------------------------------------------------------------- */
/*                      PAGINATION HELPERS                                    */
/* -------------------------------------------------------------------------- */

/**
 * Paginate query results.
 * 
 * @param {string} model - Prisma model name (e.g., 'user', 'course')
 * @param {Object} where - Filter conditions
 * @param {number} page - Page number (1-indexed)
 * @param {number} pageSize - Items per page
 * @returns {Promise<Object>} { data, pagination }
 * 
 * @example
 * const result = await paginate('user', { role: 'user' }, 1, 10);
 */
const paginate = async (model, where = {}, page = 1, pageSize = 10) => {
    const skip = (page - 1) * pageSize;
    const [data, total] = await Promise.all([
        prisma[model].findMany({ where, skip, take: pageSize }),
        prisma[model].count({ where })
    ]);
    return {
        data,
        pagination: {
            page,
            pageSize,
            total,
            pages: Math.ceil(total / pageSize),
            hasNext: page * pageSize < total,
            hasPrev: page > 1
        }
    };
};

/* -------------------------------------------------------------------------- */
/*                      BULK OPERATIONS                                       */
/* -------------------------------------------------------------------------- */

const bulkHelpers = {
    /**
     * Create multiple records efficiently.
     */
    createMany: async (model, data) => {
        return prisma[model].createMany({ data, skipDuplicates: true });
    },

    /**
     * Delete multiple records by IDs.
     */
    deleteMany: async (model, ids) => {
        return prisma[model].deleteMany({
            where: { id: { in: ids } }
        });
    }
};

/* -------------------------------------------------------------------------- */
/*                      CIRCUIT BREAKER                                       */
/* -------------------------------------------------------------------------- */

const circuitBreaker = {
    state: 'CLOSED', // CLOSED, OPEN, HALF_OPEN
    failures: 0,
    lastFailure: null,
    threshold: 5,
    resetTimeout: 30000,

    async execute(fn) {
        if (this.state === 'OPEN') {
            const elapsed = Date.now() - this.lastFailure;
            if (elapsed > this.resetTimeout) {
                this.state = 'HALF_OPEN';
            } else {
                throw new Error('Database circuit breaker is OPEN');
            }
        }

        try {
            const result = await fn();
            if (this.state === 'HALF_OPEN') {
                this.state = 'CLOSED';
                this.failures = 0;
            }
            return result;
        } catch (error) {
            this.failures++;
            this.lastFailure = Date.now();

            if (this.failures >= this.threshold) {
                this.state = 'OPEN';
                console.error('🔴 Database circuit breaker OPEN');
            }
            throw error;
        }
    },

    getState() {
        return {
            state: this.state,
            failures: this.failures,
            lastFailure: this.lastFailure
        };
    }
};

/* -------------------------------------------------------------------------- */
/*                          STATUS & METRICS                                  */
/* -------------------------------------------------------------------------- */

/**
 * Get database connection and metrics status.
 */
const getStatus = () => {
    return {
        isConnected,
        connectionValidated,
        environment: currentEnv,
        circuitBreaker: circuitBreaker.getState(),
        metricsCount: Object.keys(queryMetrics).length
    };
};

/**
 * Get query performance metrics.
 */
const getQueryMetrics = () => {
    return queryMetrics;
};

/* -------------------------------------------------------------------------- */
/*                          TEST UTILITIES                                    */
/* -------------------------------------------------------------------------- */

// Test environment utilities
if (currentEnv === 'test') {
    /**
     * Clean up all test data.
     */
    global.cleanupDatabase = async () => {
        await prisma.chatMessage.deleteMany();
        await prisma.communityPost.deleteMany();
        await prisma.purchase.deleteMany();
        await prisma.testimonial.deleteMany();
        await prisma.courseVideo.deleteMany();
        await prisma.course.deleteMany();
        await prisma.user.deleteMany();
        console.log('✓ Test database cleaned');
    };
}

/* -------------------------------------------------------------------------- */
/*                          SCHEMA VALIDATION                                 */
/* -------------------------------------------------------------------------- */

// Check if schema exists
const schemaPath = path.join(__dirname, '../../prisma/schema.prisma');
if (!fs.existsSync(schemaPath)) {
    console.warn('⚠️ WARNING: schema.prisma not found at', schemaPath);
}

/* -------------------------------------------------------------------------- */
/*                                   EXPORTS                                  */
/* -------------------------------------------------------------------------- */

module.exports = prisma;

// Extended exports for advanced usage
module.exports.withRetry = withRetry;
module.exports.withTimeout = withTimeout;
module.exports.paginate = paginate;
module.exports.bulkHelpers = bulkHelpers;
module.exports.circuitBreaker = circuitBreaker;
module.exports.getStatus = getStatus;
module.exports.getQueryMetrics = getQueryMetrics;
module.exports.validateConnection = validateConnection;
