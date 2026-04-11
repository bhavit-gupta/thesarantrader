/**
 * ============================================================================
 * BACKUP SERVICE - TheSaranTrader
 * ============================================================================
 * 
 * PURPOSE:
 * Automates the creation of full system backups including:
 * 1. Uploaded files (/public/uploads)
 * 2. Database records (exported as portable JSON)
 * 3. Future: Upload to Google Drive
 * 
 * DEPENDENCIES:
 * - archiver: For creating .zip archives
 * - googleapis: For Google Drive integration
 * 
 * USAGE:
 * node src/utils/backup.service.js --run
 */

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const prisma = require('./prisma');

/**
 * Creates a ZIP archive of the uploads directory
 * @param {string} sourceDir - Path to the directory to zip
 * @param {string} outPath - Path where the zip file will be saved
 */
async function createZip(sourceDir, outPath) {
    return new Promise((resolve, reject) => {
        const output = fs.createWriteStream(outPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        output.on('close', () => {

            resolve();
        });

        archive.on('error', (err) => reject(err));
        archive.pipe(output);
        archive.directory(sourceDir, false);
        archive.finalize();
    });
}

/**
 * Exports all database models to JSON files for portable backup
 * @param {string} outDir - Directory to save JSON files
 */
async function exportDatabaseJson(outDir) {
    const models = [
        'user', 'course', 'courseVideo', 'testimonial',
        'communityPost', 'chatMessage', 'purchase', 'session'
    ];

    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }



    for (const model of models) {
        try {
            const data = await prisma[model].findMany();
            const filePath = path.join(outDir, `${model}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));

        } catch (error) {
            console.error(`  ❌ Failed to export ${model}:`, error.message);
        }
    }
}

/**
 * Main orchestrator for full backup
 */
async function runFullBackup() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDir = path.join(__dirname, '../../backups', `backup-${timestamp}`);
    const zipPath = `${backupDir}.zip`;



    try {
        // 1. Create temporary directory for DB exports
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        // 2. Export Database
        await exportDatabaseJson(backupDir);

        // 3. Zip everything (Exports + Uploads)
        const uploadsDir = path.join(__dirname, '../../public/uploads');
        const finalZipArchive = path.join(__dirname, '../../backups', `backup-full-${timestamp}.zip`);

        // We'll zip the temp database export dir and the uploads dir together
        const output = fs.createWriteStream(finalZipArchive);
        const archive = archiver('zip', { zlib: { level: 9 } });

        return new Promise((resolve, reject) => {
            output.on('close', () => {

                // Cleanup temp dir
                fs.rmSync(backupDir, { recursive: true, force: true });
                resolve(finalZipArchive);
            });

            archive.on('error', (err) => reject(err));
            archive.pipe(output);

            // Add database JSONs
            archive.directory(backupDir, 'database');

            // Add uploads
            if (fs.existsSync(uploadsDir)) {
                archive.directory(uploadsDir, 'uploads');
            }

            archive.finalize();
        });
    } catch (error) {
        console.error('❌ Backup Failed:', error.message);
        throw error;
    }
}

async function uploadToGDrive(filePath) {
    if (process.env.GOOGLE_DRIVE_ENABLED !== 'true') {

        return false;
    }

    if (!process.env.GOOGLE_DRIVE_FOLDER_ID) {
        console.error(`☁️ [GDrive] Error: GOOGLE_DRIVE_FOLDER_ID is missing in .env`);
        return false;
    }



    // TODO: Implement actual googleapis.drive.files.create()


    // TODO: Implement old GDrive backup cleanup (drive.files.list & drive.files.delete)


    return true;
}

/**
 * Deletes local ZIP backup files older than a specified number of days
 * Prevents the VPS hard drive from filling up.
 * @param {number} keepDays - Number of days to retain local backups
 */
function cleanOldLocalBackups(keepDays = 3) {
    const backupDir = path.join(__dirname, '../../backups');
    if (!fs.existsSync(backupDir)) return;

    const files = fs.readdirSync(backupDir);
    const now = Date.now();
    const maxAgeMs = keepDays * 24 * 60 * 60 * 1000;
    
    let deletedCount = 0;

    for (const file of files) {
        if (!file.endsWith('.zip')) continue;
        
        const filePath = path.join(backupDir, file);
        const stats = fs.statSync(filePath);
        
        if (now - stats.mtimeMs > maxAgeMs) {

            fs.unlinkSync(filePath);
            deletedCount++;
        }
    }
    
    if (deletedCount > 0) {

    }
}

// CLI Support
if (require.main === module) {
    if (process.argv.includes('--run')) {
        runFullBackup()
            .then(async (zipPath) => {
                await uploadToGDrive(zipPath);
                process.exit(0);
            })
            .catch(err => {
                console.error(err);
                process.exit(1);
            });
    }
}

module.exports = { runFullBackup, uploadToGDrive, cleanOldLocalBackups };
