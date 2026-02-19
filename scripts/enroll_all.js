const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function enrollUserInAllCourses() {
    try {
        console.log('🔍 Starting enrollment process...');

        // 1. Find the test user
        const user = await prisma.user.findUnique({
            where: { username: 'testuser' }
        });

        if (!user) {
            console.error('❌ User "testuser" not found!');
            return;
        }
        console.log(`✅ Found user: ${user.username} (${user.id})`);

        // 2. Find all courses
        const courses = await prisma.course.findMany();
        if (courses.length === 0) {
            console.log('⚠️ No courses found in the database.');
            return;
        }
        console.log(`✅ Found ${courses.length} courses.`);

        // 3. Check Live Links and Enroll
        const courseIds = [];
        console.log('\n--- Course Status Check ---');
        courses.forEach(course => {
            const hasLink = course.liveLink && course.liveLink.trim().length > 0;
            const statusIcon = hasLink ? '✅' : '❌';
            console.log(`${statusIcon} Course: "${course.title}" (ID: ${course.id}) - Live Link: ${hasLink ? course.liveLink : 'MISSING'}`);

            courseIds.push(course.id);
        });
        console.log('---------------------------\n');

        // 4. Enroll User
        console.log(`🔄 Enrolling ${user.username} in all ${courses.length} courses...`);

        // We use set to ensure uniqueness if we were appending, but here we likely want to just OVERWRITE or merge unique.
        // Prisma push appends. Let's get existing IDs first to avoid duplicates if we run this multiple times.
        // Actually, let's just use set to replace the entire list with all course Ids to be sure.

        await prisma.user.update({
            where: { id: user.id },
            data: {
                purchasedCourseIds: {
                    set: courseIds // Overwrite with all course IDs
                }
            }
        });

        console.log('🎉 Enrollment successful! User now has access to all courses.');
        console.log('ℹ️  If the "Go Live" button was disabled, check the "Course Status Check" above. Courses marked with ❌ need a Live Link added via the "Edit" button in the Admin Dashboard.');

    } catch (e) {
        console.error('❌ Error:', e);
    } finally {
        await prisma.$disconnect();
    }
}

enrollUserInAllCourses();
