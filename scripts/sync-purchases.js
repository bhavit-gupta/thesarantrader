const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
    console.log("🔄 Starting Purchase <-> User Sync...");
    let createdPurchases = 0;
    let updatedUsers = 0;

    try {
        // 1. Fetch all users with purchased courses
        // Note: Prisma filter for non-empty array might need raw query or just fetch all and filter in JS if schema doesn't support isEmpty for array filtering easily in Mongo
        // In Mongo, Arrays are just fields. unique/sparse might affect it.
        // Simple way: fetch all, filter in JS.
        const allUsers = await prisma.user.findMany();
        const users = allUsers.filter(u => u.purchasedCourseIds && u.purchasedCourseIds.length > 0);

        // 2. Fetch all purchases
        const purchases = await prisma.purchase.findMany();

        // 3. Fetch all courses for price lookup
        const allCourses = await prisma.course.findMany();
        const courseMap = {};
        allCourses.forEach(c => courseMap[c.id] = c);

        console.log(`📊 Found ${users.length} users with courses and ${purchases.length} purchase records.`);

        // SIDE A: User has course -> Ensure Purchase exists
        for (const user of users) {
            if (!user.purchasedCourseIds) continue;

            for (const courseId of user.purchasedCourseIds) {
                // Check if purchase exists for this user+course
                const existingPurchase = purchases.find(p => p.userId === user.id && p.courseId === courseId);

                if (!existingPurchase) {
                    // Create missing purchase record
                    const course = courseMap[courseId];
                    const amount = course ? course.price : 0;

                    await prisma.purchase.create({
                        data: {
                            userId: user.id,
                            courseId: courseId,
                            amount: amount,
                            status: 'migrated', // Mark as migrated/synced
                            date: new Date()
                        }
                    });
                    createdPurchases++;
                    console.log(`[+] Created missing purchase record for User ${user.username} - Course ${course ? course.title : courseId}`);
                }
            }
        }

        // SIDE B: Purchase exists -> Ensure User has course ID
        for (const purchase of purchases) {
            const user = await prisma.user.findUnique({ where: { id: purchase.userId } });

            if (user) {
                if (!user.purchasedCourseIds.includes(purchase.courseId)) {
                    // Start updates
                    const updatedIds = [...user.purchasedCourseIds, purchase.courseId];

                    await prisma.user.update({
                        where: { id: user.id },
                        data: { purchasedCourseIds: updatedIds }
                    });
                    updatedUsers++;
                    console.log(`[+] Added missing course ID to User ${user.username} - Course ${purchase.courseId}`);
                }
            } else {
                console.warn(`[!] Orphaned purchase record found (User ID ${purchase.userId} not found)`);
            }
        }

        console.log("\n✅ Sync Completed!");
        console.log(`- Created ${createdPurchases} Purchase records`);
        console.log(`- Updated ${updatedUsers} User records`);

    } catch (e) {
        console.error("❌ Error during sync:", e);
    } finally {
        await prisma.$disconnect();
    }
}

main();
