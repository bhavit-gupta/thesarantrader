const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrate() {
    console.log('🚀 Starting Curriculum Migration...');

    try {
        // 1. Get all courses
        const courses = await prisma.course.findMany();
        
        for (const course of courses) {
            console.log(`📦 Processing Course: ${course.title} (${course.id})`);

            // 2. Ensure default folders exist
            const folderTypes = ['Videos', 'Images', 'Documents'];
            for (const name of folderTypes) {
                await prisma.courseFolder.upsert({
                    where: { id: 'dummy' }, // We use findFirst + create for non-unique-id upserts in mongo
                    create: { name, courseId: course.id },
                    update: {},
                    where: { id: '000000000000000000000000' } // Placeholder
                }).catch(async () => {
                    const existing = await prisma.courseFolder.findFirst({
                        where: { courseId: course.id, name }
                    });
                    if (!existing) {
                        return await prisma.courseFolder.create({
                            data: { name, courseId: course.id }
                        });
                    }
                    return existing;
                });
            }

            const videoFolder = await prisma.courseFolder.findFirst({
                 where: { courseId: course.id, name: 'Videos' }
            });

            // 3. Migrate from raw CourseVideo collection (using raw mongo)
            // Note: Since CourseVideo is no longer in schema, we use $runCommandRaw to find records
            const rawVideos = await prisma.$runCommandRaw({
                find: 'CourseVideo',
                filter: { courseId: { $oid: course.id } }
            });

            if (rawVideos && rawVideos.cursor && rawVideos.cursor.firstBatch) {
                const videos = rawVideos.cursor.firstBatch;
                console.log(`🎥 Found ${videos.length} legacy videos.`);

                for (const vid of videos) {
                    // Check if already migrated
                    const exists = await prisma.courseResource.findFirst({
                        where: { name: vid.title, folderId: videoFolder.id }
                    });

                    if (!exists) {
                        await prisma.courseResource.create({
                            data: {
                                name: vid.title,
                                type: 'VIDEO',
                                url: vid.youtubeUrl,
                                description: vid.description,
                                thumbnailUrl: vid.thumbnailUrl,
                                folderId: videoFolder.id,
                                courseId: course.id,
                                order: vid.order || 0
                            }
                        });
                    }
                }
            }
        }

        console.log('✅ Migration Complete.');
    } catch (error) {
        console.error('❌ Migration Failed:', error);
    } finally {
        await prisma.$disconnect();
    }
}

migrate();
