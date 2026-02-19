const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function migrateLikes() {
    console.log("🔄 Starting Like Migration...");

    try {
        const posts = await prisma.communityPost.findMany();
        console.log(`Processing ${posts.length} posts...`);

        let migratedCount = 0;

        for (const post of posts) {
            if (post.likedBy && post.likedBy.length > 0) {
                console.log(`- Post ${post.id}: Migrating ${post.likedBy.length} likes...`);

                for (const userId of post.likedBy) {
                    try {
                        // Check if like already exists to avoid duplicates
                        const existingLike = await prisma.communityLike.findUnique({
                            where: {
                                postId_userId: {
                                    postId: post.id,
                                    userId: userId
                                }
                            }
                        });

                        if (!existingLike) {
                            await prisma.communityLike.create({
                                data: {
                                    postId: post.id,
                                    userId: userId
                                }
                            });
                            migratedCount++;
                        }
                    } catch (e) {
                        console.error(`  ⚠️ Failed to migrate like for User ${userId} on Post ${post.id}`, e.message);
                    }
                }
            }
        }

        console.log(`✅ Migration Complete. Created ${migratedCount} new CommunityLike records.`);

    } catch (error) {
        console.error("❌ Migration Failed:", error);
    } finally {
        await prisma.$disconnect();
    }
}

migrateLikes();
