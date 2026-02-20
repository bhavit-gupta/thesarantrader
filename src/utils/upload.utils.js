const sharp = require('sharp');
const path = require('path');
const fs = require('fs').promises;

/**
 * Compresses an image file from a temporary location to its final destination as a WebP.
 * @param {Object} file - The file object from multer (req.file)
 * @param {string} destinationDir - The directory where the compressed image should be saved (absolute path)
 * @param {number} maxWidth - Maximum width (default 1200)
 * @param {number} maxHeight - Maximum height (default 1200)
 * @returns {Promise<string>} - The filename of the compressed image
 */
async function compressImage(file, destinationDir, maxWidth = 1200, maxHeight = 1200) {
    if (!file) return null;

    const fileName = file.filename;
    const inputPath = file.path;

    // Explicitly convert to .webp for consistency and best compression across all platforms
    const webpFileName = fileName.split('.').slice(0, -1).join('.') + '.webp';
    const outputPath = path.join(destinationDir, webpFileName);

    try {
        // Ensure destination directory exists
        await fs.mkdir(destinationDir, { recursive: true });

        // Process with Sharp: Resize, convert to WebP, and compress
        // We use 'inside' fit and withoutEnlargement to keep pixel density high but file size low
        await sharp(inputPath)
            .resize({
                width: maxWidth,
                height: maxHeight,
                fit: 'inside',
                withoutEnlargement: true
            })
            .webp({ quality: 80 })
            .toFile(outputPath);

        // Success! Now remove the original large temporary file
        try {
            await fs.unlink(inputPath);
        } catch (err) {
            console.error('Warning: Could not delete temp file:', inputPath, err);
        }

        return webpFileName;
    } catch (error) {
        console.error('Error compressing image:', error);
        // If compression fails, we return null or throw to let the caller handle it.
        // We choose to throw here to bubble up to the controller error handling.
        throw error;
    }
}

module.exports = { compressImage };
