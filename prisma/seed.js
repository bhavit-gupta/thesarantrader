#!/usr/bin/env node
/**
 * ============================================================================
 * FILE: seed.js
 * PURPOSE: Database seeding script - Initialize sample users for development
 * VERSION: 1.0.0
 * ============================================================================
 * 
 * DESCRIPTION:
 * Populates MongoDB with sample user accounts for development/demo purposes.
 * Courses are now managed dynamically via the admin page.
 * Runs via: npm run prisma:seed or npx prisma db seed
 * 
 * WHAT IT DOES:
 * 1. Validates environment configuration
 * 2. Connects to MongoDB via Prisma
 * 3. Creates 3 sample users (admin, test, kundan_raj)
 * 4. Uses upsert for users (prevents duplicates if run multiple times)
 * 5. Hashes passwords with bcrypt before storing
 * 6. Disconnects and exits
 * 
 * RUN COMMAND:
 * npm run prisma:seed
 * or
 * npx prisma db seed
 * 
 * OPTIONS:
 * --reset: Delete all users before seeding
 * DEBUG=true: Enable verbose Prisma logging
 * 
 * ENVIRONMENT:
 * Requires DATABASE_URL in .env pointing to MongoDB connection string
 * Optional: SEED_ADMIN_PASSWORD, SEED_USER_PASSWORD for custom passwords
 * 
 * SECURITY FEATURES:
 * - Passwords hashed with bcrypt (12 rounds)
 * - Environment detection prevents production seeding
 * - Input validation for all user fields
 * - Credentials loaded from environment variables
 * 
 * INDEX REQUIREMENTS:
 * User model should have:
 * - username: @unique (auto-indexed)
 * - email: @unique (auto-indexed)
 * - phone: @unique (auto-indexed)
 * - @@index([role]) for role-based queries (optional)
 * - @@index([createdAt]) for date sorting (optional)
 * 
 * NOTE ON COURSES:
 * Courses are no longer seeded here - they should be created via the admin dashboard
 * this allows dynamic course management without requiring database resets
 */

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt'); //  Added bcrypt import

// ============================================================================
// CONFIGURATION
// ============================================================================

const SEED_VERSION = '1.0.0'; //  Version tracking
const SEED_NAME = 'initial-users';
const BCRYPT_ROUNDS = 12; //  Secure password hashing

// Valid role values - matches schema enum 
const VALID_ROLES = Object.freeze({
    ADMIN: 'ADMIN',
    USER: 'USER'
});

// ============================================================================
// ENVIRONMENT VALIDATION 
// ============================================================================

//  Prevent accidental production seeding
if (process.env.NODE_ENV === 'production') {
    console.error('❌ SECURITY: Cannot seed production database!');
    console.error('   Set ALLOW_PRODUCTION_SEED=true to override (not recommended)');
    
    if (process.env.ALLOW_PRODUCTION_SEED !== 'true') {
        process.exit(1);
    }
    console.warn('⚠️ WARNING: Seeding production database (ALLOW_PRODUCTION_SEED=true)');
}

//  Database URL validation
if (!process.env.DATABASE_URL) {
    console.error('❌ Database connection failed: DATABASE_URL not set in .env');
    console.error('   Create .env file with: DATABASE_URL=mongodb+srv://...');
    process.exit(1);
}

//  Warn if DATABASE_URL looks like production
if (process.env.DATABASE_URL.includes('production')) {
    console.error('⚠️ WARNING: DATABASE_URL contains "production"');
    console.error('   This might be the real production database!');
    
    if (process.env.FORCE_SEED !== 'true') {
        console.error('   Set FORCE_SEED=true to proceed');
        process.exit(1);
    }
}

// ============================================================================
// PRISMA CLIENT INITIALIZATION
// ============================================================================

//  Configure Prisma logging based on DEBUG env var
const prisma = new PrismaClient({
    log: process.env.DEBUG === 'true' 
        ? ['query', 'info', 'warn', 'error']
        : ['error']
});

// ============================================================================
// VALIDATION FUNCTIONS 
// ============================================================================

/**
 * Validate email format
 * @param {string} email - Email to validate
 * @returns {boolean} True if valid
 */
const isValidEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

/**
 * Validate phone number (10 digits)
 * @param {string} phone - Phone to validate
 * @returns {boolean} True if valid
 */
const isValidPhone = (phone) => {
    const phoneRegex = /^[0-9]{10}$/;
    return phoneRegex.test(phone);
};

/**
 * Validate username format (3-30 chars, alphanumeric + underscore)
 * @param {string} username - Username to validate
 * @returns {boolean} True if valid
 */
const isValidUsername = (username) => {
    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    return usernameRegex.test(username);
};

/**
 * Normalize phone number (remove non-digits)
 * @param {string} phone - Phone to normalize
 * @returns {string} Normalized phone
 */
const normalizePhone = (phone) => {
    return phone.replace(/\D/g, '');
};

/**
 * Validate a user object
 * @param {Object} user - User to validate
 * @returns {string[]} Array of error messages (empty if valid)
 */
const validateUser = (user) => {
    const errors = [];
    
    // Email validation
    if (!user.email || !isValidEmail(user.email)) {
        errors.push(`Invalid email: ${user.email}`);
    }
    
    // Phone validation
    const normalizedPhone = normalizePhone(user.phone || '');
    if (!isValidPhone(normalizedPhone)) {
        errors.push(`Invalid phone: ${user.phone} (must be 10 digits)`);
    }
    
    // Username validation 
    if (!user.username || !isValidUsername(user.username)) {
        errors.push(`Invalid username: ${user.username} (must be 3-30 chars, alphanumeric + underscore)`);
    }
    
    // Name validation
    if (!user.name || user.name.trim().length === 0) {
        errors.push('Name cannot be empty');
    }
    
    // Role validation 
    if (!Object.values(VALID_ROLES).includes(user.role)) {
        errors.push(`Invalid role: ${user.role} (must be '${VALID_ROLES.ADMIN}' or '${VALID_ROLES.USER}')`);
    }
    
    // Password validation 
    if (!user.password || user.password.length < 8) {
        errors.push('Password must be at least 8 characters');
    }
    
    return errors;
};

// ============================================================================
// SAMPLE DATA  Credentials from environment
// ============================================================================

/**
 * USERS ARRAY - Sample user accounts for development/testing
 * 
 *  Credentials loaded from environment variables with secure defaults
 *  isDemoAccount flag for test isolation
 */
const users = [
    {
        username: process.env.SEED_ADMIN_USERNAME || 'admin',
        email: process.env.SEED_ADMIN_EMAIL || 'admin@example.com',
        phone: normalizePhone(process.env.SEED_ADMIN_PHONE || '9876543210'),
        password: process.env.SEED_ADMIN_PASSWORD || 'changeme123!', //  From env
        role: VALID_ROLES.ADMIN,
        name: 'Admin User'
    },
    {
        username: process.env.SEED_USER1_USERNAME || 'testuser',
        email: process.env.SEED_USER1_EMAIL || 'test@example.com',
        phone: normalizePhone(process.env.SEED_USER1_PHONE || '9999999999'),
        password: process.env.SEED_USER_PASSWORD || 'changeme123!', //  From env
        role: VALID_ROLES.USER,
        name: 'Test User'
    },
    {
        username: process.env.SEED_USER2_USERNAME || 'kundan_raj',
        email: process.env.SEED_USER2_EMAIL || 'kundan@example.com',
        phone: normalizePhone(process.env.SEED_USER2_PHONE || '9876543211'),
        password: process.env.SEED_USER_PASSWORD || 'changeme123!', //  From env
        role: VALID_ROLES.USER,
        name: 'Kundan Raj'
    }
];

// ============================================================================
// SEEDING FUNCTION
// ============================================================================

/**
 * Main seeding function
 * Creates sample users in the database with proper validation and hashing
 * 
 * FEATURES:
 * -  Password hashing with bcrypt
 * -  Input validation before insert
 * -  Upsert by username (immutable identifier)
 * -  Transaction for all-or-nothing seeding
 * -  Clear logging of created vs skipped users
 * -  Optional --reset flag to clear data first
 * -  Statistics tracking
 * -  Duration tracking
 * -  Email uniqueness validation
 * -  Pre-compute password hashes before transaction
 */
async function main() {
    const startTime = Date.now(); //  Duration tracking
    console.log(`🌱 Seeding ${SEED_NAME} v${SEED_VERSION}...`);
    
    //  Handle --reset flag
    const shouldReset = process.argv.includes('--reset');
    if (shouldReset) {
        console.log('🗑️ Resetting database (--reset flag detected)...');
        await prisma.user.deleteMany({});
        console.log('✓ All users deleted');
    }
    
    // ========================================================================
    // VALIDATE ALL USERS FIRST 
    // ========================================================================
    console.log('\n📋 Validating user data...');
    
    for (const u of users) {
        const validationErrors = validateUser(u);
        if (validationErrors.length > 0) {
            throw new Error(
                `Validation failed for user ${u.username}:\n  - ${validationErrors.join('\n  - ')}`
            );
        }
    }
    console.log('✓ All user data valid');
    
    // ========================================================================
    // PRE-COMPUTE PASSWORD HASHES 
    // ========================================================================
    console.log('\n🔐 Hashing passwords...');
    
    const usersWithHashedPasswords = await Promise.all(
        users.map(async (u) => ({
            ...u,
            password: await bcrypt.hash(u.password, BCRYPT_ROUNDS)
        }))
    );
    console.log('✓ Passwords hashed');
    
    // ========================================================================
    // SEED USERS WITH TRANSACTION 
    // ========================================================================
    console.log('\n📝 Seeding users...');
    
    let created = 0;
    let skipped = 0;
    const results = [];
    
    try {
        await prisma.$transaction(async (tx) => {
            for (const u of usersWithHashedPasswords) {
                //  Check email uniqueness before upsert
                const emailUser = await tx.user.findUnique({
                    where: { email: u.email }
                });
                
                if (emailUser && emailUser.username !== u.username) {
                    throw new Error(
                        `Email ${u.email} already used by different user: ${emailUser.username}`
                    );
                }
                
                //  Check phone uniqueness
                const phoneUser = await tx.user.findUnique({
                    where: { phone: u.phone }
                });
                
                if (phoneUser && phoneUser.username !== u.username) {
                    throw new Error(
                        `Phone ${u.phone} already used by different user: ${phoneUser.username}`
                    );
                }
                
                // Check if user exists before upsert 
                const existingUser = await tx.user.findUnique({
                    where: { username: u.username }
                });
                
                //  Upsert by username (immutable identifier)
                //  Update fields if user exists
                const user = await tx.user.upsert({
                    where: { username: u.username },
                    update: {
                        email: u.email,
                        phone: u.phone,
                        name: u.name,
                        role: u.role
                        // Note: password not updated to allow user customization
                    },
                    create: u
                });
                
                //  Log created vs skipped
                if (existingUser) {
                    console.log(`ℹ️  User UPDATED: ${user.username} (${user.email})`);
                    skipped++;
                    results.push({ user: user.username, status: 'updated' });
                } else {
                    console.log(`✨ User CREATED: ${user.id} (${user.username})`);
                    created++;
                    results.push({ user: user.username, status: 'created' });
                }
            }
        });
    } catch (error) {
        console.error(`❌ Transaction rolled back due to error:`, error.message);
        throw error;
    }
    
    // ========================================================================
    // FINAL SUMMARY 
    // ========================================================================
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n📊 Seed Results:');
    console.table(results); //  Table format instead of loop
    
    console.log(`\n✅ Seeding finished in ${duration}s!`);
    console.log(`   Created: ${created}, Updated: ${skipped}, Total: ${users.length}`);
}

// ============================================================================
// ERROR HANDLING & EXECUTION 
// ============================================================================

/**
 * Execute main seeding function with proper error handling
 * 
 * FEATURES:
 * -  Safe disconnect on all exit paths
 * - Proper exit codes for CI/CD
 * - Signal handling for graceful shutdown
 */

//  Handle shutdown signals
process.on('SIGINT', async () => {
    console.log('\nShutdown signal received...');
    try {
        await prisma.$disconnect();
    } catch (e) {
        console.error('Failed to disconnect:', e.message);
    }
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('\nTermination signal received...');
    try {
        await prisma.$disconnect();
    } catch (e) {
        console.error('Failed to disconnect:', e.message);
    }
    process.exit(0);
});

// Execute main function
main()
    .then(async () => {
        // Success: disconnect and exit cleanly
        await prisma.$disconnect();
        console.log('Database connection closed');
        process.exit(0);
    })
    .catch(async (e) => {
        // Error: log, disconnect, and exit with error code
        console.error(`\n❌ Seeding error:`, e.message);
        try {
            await prisma.$disconnect();
        } catch (disconnectError) {
            console.error('Failed to disconnect:', disconnectError.message);
        }
        process.exit(1);
    });
