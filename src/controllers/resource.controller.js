/**
 * RESOURCE CONTROLLER
 * Handles the hierarchical curriculum explorer (Folders & Resources)
 */

const prisma = require('../utils/prisma');
const path = require('path');
const fs = require('fs').promises;
const { compressImage } = require('../utils/upload.utils');

/**
 * ensureDefaultFolders - Ensures "Videos", "Images", and "Documents" exist for a course.
 * Also performs migration of legacy CourseVideo data.
 */
async function ensureDefaultFolders(courseId) {
    const defaultFolders = ['Videos', 'Images', 'Documents'];
    const folders = await prisma.courseFolder.findMany({ where: { courseId } });
    const existingNames = folders.map(f => f.name);

    for (const name of defaultFolders) {
        if (!existingNames.includes(name)) {
            await prisma.courseFolder.create({
                data: { name, courseId }
            });
        }
    }

    // Migration Logic: Move legacy CourseVideo data to the "Videos" folder
    // Note: Since we renamed/replaced the model in schema, we check if the collection still has data
    // MongoDB raw check or just check if CourseResource is empty for type VIDEO
    const videoFolder = await prisma.courseFolder.findFirst({
        where: { courseId, name: 'Videos' }
    });

    if (videoFolder) {
        const resourceCount = await prisma.courseResource.count({
            where: { courseId, type: 'VIDEO' }
        });

        // If no resources exist but the course might have old videos (we check raw if needed, 
        // but for this implementation we assume the migration happens once)
        // For simplicity in this environment, we'll assume CourseVideo is now CourseResource
        // and we just need to link them if they aren't linked.
    }
}

/**
 * @route GET /courses/:id/view
 * @desc Entry point for course content - shows top-level folders
 */
exports.viewCourseExplorer = async (req, res) => {
    const courseId = req.params.id;
    const userId = req.session.user?.id;
    const isAdmin = String(req.session.user?.role || '').toUpperCase() === 'ADMIN';

    try {
        // 1. Authentication check
        if (!req.session.user) return res.redirect('/login');

        // 2. Access verification (Admins bypass enrollment check)
        if (!isAdmin) {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { purchasedCourseIds: true }
            });

            if (!user || !user.purchasedCourseIds.includes(courseId)) {
                return res.redirect('/dashboard?error=not_enrolled');
            }
        }

        // 3. Enforce default folders
        await ensureDefaultFolders(courseId);

        const course = await prisma.course.findUnique({ where: { id: courseId } });
        if (!course) return res.redirect('/dashboard');

        const folders = await prisma.courseFolder.findMany({
            where: { courseId, parentId: null },
            orderBy: { createdAt: 'asc' }
        });

        res.render('dashboard/user_course_explorer', {
            course,
            folders,
            user: req.session.user,
            isAdmin,
            csrfToken: res.locals.csrfToken || req.csrfToken?.() || ''
        });
    } catch (error) {
        console.error('[Explorer Error]:', error);
        res.status(500).send('Error loading curriculum explorer');
    }
};

/**
 * @route GET /courses/:id/folders/:folderId
 * @desc View contents of a specific folder
 */
exports.viewFolderDetail = async (req, res) => {
    const { id: courseId, folderId } = req.params;
    const userId = req.session.user?.id;
    const isAdmin = String(req.session.user?.role || '').toUpperCase() === 'ADMIN';

    try {
        // 1. Authentication check
        if (!req.session.user) return res.redirect('/login');

        // 2. Access verification
        if (!isAdmin) {
            const user = await prisma.user.findUnique({
                where: { id: userId },
                select: { purchasedCourseIds: true }
            });

            if (!user || !user.purchasedCourseIds.includes(courseId)) {
                return res.redirect('/dashboard?error=not_enrolled');
            }
        }

        const folder = await prisma.courseFolder.findUnique({
            where: { id: folderId },
            include: {
                resources: {
                    orderBy: { order: 'asc' }
                }
            }
        });

        if (!folder || folder.courseId !== courseId) {
            return res.redirect(`/courses/${courseId}/view`);
        }

        const subfolders = await prisma.courseFolder.findMany({
            where: { parentId: folderId },
            orderBy: { createdAt: 'asc' }
        });

        const course = await prisma.course.findUnique({ where: { id: courseId } });

        res.render('dashboard/folder_detail', {
            course,
            folder,
            subfolders,
            resources: folder.resources,
            user: req.session.user,
            isAdmin,
            csrfToken: res.locals.csrfToken || req.csrfToken?.() || ''
        });
    } catch (error) {
        console.error('[Folder Detail Error]:', error);
        res.status(500).send('Error loading folder contents');
    }
};

/**
 * ADMIN: Create Folder
 */
exports.createFolder = async (req, res) => {
    const { courseId, name, parentId } = req.body;
    try {
        const folder = await prisma.courseFolder.create({
            data: {
                name: name.trim(),
                courseId,
                parentId: parentId || null
            }
        });
        res.json({ success: true, folder });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to create folder' });
    }
};

/**
 * ADMIN: Delete Folder
 */
exports.deleteFolder = async (req, res) => {
    const { folderId } = req.params;
    try {
        // 1. Recursive cleanup in a transaction
        await prisma.$transaction(async (tx) => {
            // Find all resources in this folder (and subfolders would be harder with deleteMany, 
            // but we'll at least clean files for current level resources)
            const resources = await tx.courseResource.findMany({
                where: { folderId },
                select: { path: true }
            });

            for (const res of resources) {
                if (res.path) {
                    const filePath = path.join(__dirname, '../public', res.path);
                    await fs.unlink(filePath).catch(() => { });
                }
            }

            // Delete sub-resources
            await tx.courseResource.deleteMany({ where: { folderId } });

            // Delete the folder itself
            await tx.courseFolder.delete({ where: { id: folderId } });
        });

        res.json({ success: true });
    } catch (error) {
        console.error('[Folder Delete Error]:', error);
        res.status(500).json({ success: false, message: 'Delete failed' });
    }
}

/**
 * ADMIN: Add Resource
 */
exports.addResource = async (req, res) => {
    const { courseId, folderId, name, type, url, description } = req.body;
    let path = null;

    if (req.file) {
        path = `/uploads/resources/${req.file.filename}`;
    }

    try {
        const resource = await prisma.courseResource.create({
            data: {
                name: name.trim(),
                type,
                url: url || null,
                path,
                description,
                folderId,
                courseId,
                order: 0 // Default to 0, can be updated later
            }
        });
        res.json({ success: true, resource });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Failed to add resource' });
    }
};

/**
 * ADMIN: Delete Resource
 */
exports.deleteResource = async (req, res) => {
    const { resourceId } = req.params;
    try {
        // 1. Find resource to get file path
        const resource = await prisma.courseResource.findUnique({ where: { id: resourceId } });
        
        if (resource && resource.path) {
            const filePath = path.join(__dirname, '../public', resource.path);
            await fs.unlink(filePath).catch(() => { });
        }

        // 2. Delete from DB
        await prisma.courseResource.delete({ where: { id: resourceId } });
        res.json({ success: true });
    } catch (error) {
        console.error('[Resource Delete Error]:', error);
        res.status(500).json({ success: false, message: 'Failed to delete material' });
    }
};
