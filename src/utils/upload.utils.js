/* -------------------------------------------------------------------------- */
/*                        IMAGE UPLOAD & COMPRESSION                          */
/* -------------------------------------------------------------------------- */
/*
 * Purpose: Handles image processing and optimization for uploaded files
 */

const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;
const crypto = require('crypto');
const os = require('os');
const diskusage = require('diskusage');
const lockfile = require('proper-lockfile');

/* -------------------------------------------------------------------------- */
/*                                CONFIGURATION                                */
/* -------------------------------------------------------------------------- */

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const MAX_DIMENSION = 4000;            // 4000px
const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MIN_DISK_SPACE = 500 * 1024 * 1024; // 500MB

const COMPRESSION_PRESETS = {
    thumbnail: { maxWidth: 300, maxHeight: 300, quality: 60 },
    chat: { maxWidth: 1200, maxHeight: 1200, quality: 80 },
    course: { maxWidth: 1920, maxHeight: 1080, quality: 85 }
};

/* -------------------------------------------------------------------------- */
/*                               HELPERS                                      */
/* -------------------------------------------------------------------------- */

/**
 * Validates magic bytes (file signature) for images
 */
function validateMagicBytes(buffer) {
    // JPEG: FF D8 FF
    if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) return true;
    // PNG: 89 50 4E 47
    if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) return true;
    // GIF: 47 49 46 38
    if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) return true;
    // WebP: 52 49 46 46 (RIFF) ... 57 45 42 50 (WEBP)
    if (buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46) return true;
    return false;
}

/**
 * Sanitizes filename to prevent directory traversal
 */
function sanitizeFilename(filename) {
    return filename
        .replace(/\.\.\//g, '')
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .substring(0, 255);
}

/**
 * User friendly error messages
 */
function getUserFriendlyError(error) {
    const messages = {
        'ENOENT': 'Upload directory not found',
        'EACCES': 'No write permission to upload directory',
        'ENOMEM': 'Server out of memory - try smaller image',
        'File too large': 'Image exceeds maximum size (50MB)',
        'Invalid file type': 'Please upload a valid image (JPG, PNG, GIF, WebP)',
        'timeout': 'Image processing took too long',
        'Insufficient disk space': 'Server is out of storage space',
        'Suspicious file compression ratio': 'Security: Suspicious image file detected'
    };
    for (const [key, msg] of Object.entries(messages)) {
        if (error.message.includes(key)) return msg;
    }
    return 'Image processing failed. Please try again.';
}

/* -------------------------------------------------------------------------- */
/*                          IMAGE COMPRESSION LOGIC                           */
/* -------------------------------------------------------------------------- */

/**
 * Compresses an image with full security and reliability checks.
 * 
 * @param {Object} file - Multer file object
 * @param {string} destinationDir - Final storage directory
 * @param {string} preset - 'thumbnail', 'chat', or 'course'
 * @returns {Promise<string>} Final filename
 */
async function compressImage(file, destinationDir, preset = 'chat') {
    if (!file) return null;

    const startTime = Date.now();
    const inputPath = file.path;
    const config = COMPRESSION_PRESETS[preset] || COMPRESSION_PRESETS.chat;

    try {
        // 1. Basic Validations
        if (file.size > MAX_FILE_SIZE) throw new Error('File too large');
        if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) throw new Error('Invalid file type');

        // 2. Validate Magic Bytes
        const buffer = await fs.readFile(inputPath);
        if (!validateMagicBytes(buffer.slice(0, 12))) {
            throw new Error('File appears to be corrupted or not a valid image');
        }

        // 3. Disk space validation
        try {
            const usage = await diskusage.check(destinationDir);
            if (usage.available < MIN_DISK_SPACE) throw new Error('Insufficient disk space');
        } catch (e) {
            if (e.message !== 'Insufficient disk space') console.warn('Disk check failed:', e.message);
            else throw e;
        }

        // 4. Sanitize and Resolve Paths
        const sanitized = sanitizeFilename(file.filename);
        const hash = crypto.createHash('sha256').update(buffer).digest('hex');
        const cachedFileName = `${hash.substring(0, 16)}.webp`;
        const finalOutputPath = path.join(destinationDir, cachedFileName);
        const tempOutputPath = finalOutputPath + `.tmp-${Date.now()}`;

        // Ensure directory exists and check permissions
        await fs.mkdir(destinationDir, { recursive: true });
        const testFile = path.join(destinationDir, '.write-test-' + Date.now());
        await fs.writeFile(testFile, 'test').then(() => fs.unlink(testFile));

        // 5. Check Cache
        try {
            await fs.stat(finalOutputPath);
            console.log('📦 Image already compressed (cached)');
            await fs.unlink(inputPath).catch(() => { });
            return cachedFileName;
        } catch (e) { /* Not cached */ }

        /**
         * Sharp by default auto-rotates based on EXIF Orientation tag
         */
        const metadata = await sharp(inputPath).metadata();
        if (!metadata.width || !metadata.height) throw new Error('Could not read image metadata');

        // Bomb detection
        const estimatedDecompressed = metadata.width * metadata.height * (metadata.channels || 3);
        if (estimatedDecompressed / file.size > 50) throw new Error('Suspicious file compression ratio');

        // Lock file for concurrency
        let release;
        try { release = await lockfile.lock(destinationDir, { retries: 5 }); } catch (e) { /* ignore lock fail */ }

        const pipeline = sharp(inputPath)
            .rotate() // Auto-rotate
            .resize({
                width: config.maxWidth,
                height: config.maxHeight,
                fit: 'inside',
                withoutEnlargement: true
            })
            .withMetadata(false) // Strip sensitive metadata
            .webp({ quality: config.quality });

        // Animated support
        if (metadata.pages && metadata.pages > 1) {
            console.log('📽️ Animated image detected');
            // Logic for animated webp could be added here
        }

        // Process Image with timeout
        const sharpResult = await Promise.race([
            pipeline.toFile(tempOutputPath),
            new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 30000))
        ]);

        // 7. Atomic Commit
        const stats = await fs.stat(tempOutputPath);
        if (stats.size === 0) throw new Error('Output file empty');

        await fs.rename(tempOutputPath, finalOutputPath);
        if (release) await release();

        // Backup original
        const backupDir = path.join(destinationDir, '.originals');
        await fs.mkdir(backupDir, { recursive: true });
        await fs.copyFile(inputPath, path.join(backupDir, sanitized));

        // 8. Cleanup and Metrics
        await fs.unlink(inputPath);

        const duration = Date.now() - startTime;
        const ratio = ((1 - stats.size / file.size) * 100).toFixed(1);
        console.log('[Image Compression]', {
            file: sanitized,
            original: `${(file.size / 1024).toFixed(0)}KB`,
            compressed: `${(stats.size / 1024).toFixed(0)}KB`,
            ratio: `${ratio}%`,
            duration: `${duration}ms`
        });

        return cachedFileName;

    } catch (error) {
        // Cleanup on error
        console.error('Error compressing image:', error.stack || error);
        await fs.unlink(inputPath).catch(() => { });
        // Cleanup any partial temp files
        const files = await fs.readdir(destinationDir).catch(() => []);
        for (const f of files) {
            if (f.includes('.tmp-')) await fs.unlink(path.join(destinationDir, f)).catch(() => { });
        }

        throw new Error(getUserFriendlyError(error));
    }
}

/**
 * Scheduled cleanup of old temp files
 */
const cleanupOldTempFiles = async () => {
    try {
        const tempDir = os.tmpdir(); // Or your specific temp dir
        const maxAge = 24 * 60 * 60 * 1000;
        const now = Date.now();

        const files = await fs.readdir(tempDir);
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            const stats = await fs.stat(filePath);
            if (now - stats.mtimeMs > maxAge) await fs.unlink(filePath).catch(() => { });
        }
    } catch (e) { /* silent */ }
};
setInterval(cleanupOldTempFiles, 60 * 60 * 1000);

module.exports = { compressImage, validateMagicBytes };
