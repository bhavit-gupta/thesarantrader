/**
 * verify-all.js
 * 
 * Master verification script for The Saran Trader.
 * Checks environment, database connectivity, and core backend health.
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const path = require('path');
const fs = require('fs');

async function runVerification() {
    console.log('\n🔍 [VERIFICATION] Starting Master Integrity Check...\n');
    let success = true;

    // 1. Check Environment Variables
    console.log('📋 Checking Environment Variables...');
    const requiredEnv = ['DATABASE_URL', 'SESSION_SECRET', 'NODE_ENV'];
    requiredEnv.forEach(env => {
        if (!process.env[env]) {
            console.warn(`   ⚠️  Missing ENV: ${env}`);
            // Note: DON'T fail on NODE_ENV if it's just local dev, but warn.
        } else {
            console.log(`   ✅ ${env} is set.`);
        }
    });

    // 2. Test Database Connectivity
    try {
        console.log('\n🗄️  Testing Database Connectivity (Prisma)...');
        await prisma.$connect();
        const userCount = await prisma.user.count();
        const courseCount = await prisma.course.count();
        console.log(`   ✅ DB Connected.`);
        console.log(`   📊 Stats: ${userCount} Users, ${courseCount} Courses found.`);
    } catch (error) {
        console.error('   ❌ Database Connection Failed!', error.message);
        success = false;
    }

    // 3. Verify Critical File Structure
    console.log('\n📁 Verifying Critical File Structure...');
    const criticalDirs = [
        'src/controllers',
        'src/routes',
        'src/middleware',
        'src/utils',
        'src/views',
        'src/public/stylesheets',
        'src/public/javascripts'
    ];

    criticalDirs.forEach(dir => {
        const absPath = path.join(__dirname, dir);
        if (fs.existsSync(absPath)) {
            console.log(`   ✅ ${dir} exists.`);
        } else {
            console.error(`   ❌ Missing directory: ${dir}`);
            success = false;
        }
    });

    // 4. Check Public Assets
    const assets = [
        'src/public/stylesheets/output.css',
        'src/public/javascripts/main.js'
    ];
    assets.forEach(asset => {
        if (fs.existsSync(path.join(__dirname, asset))) {
            console.log(`   ✅ Asset ${asset} present.`);
        } else {
            console.warn(`   ⚠️  Asset missing: ${asset}`);
        }
    });

    // 5. Final Summary
    console.log('\n----------------------------------------');
    if (success) {
        console.log('🚀 SYSTEM STATUS: [HEALTHY]');
    } else {
        console.log('🚨 SYSTEM STATUS: [ERROR - Check Logs]');
    }
    console.log('----------------------------------------\n');

    await prisma.$disconnect();
    process.exit(success ? 0 : 1);
}

runVerification().catch(err => {
    console.error('Verification script crashed:', err);
    process.exit(1);
});
