const { PrismaClient } = require('@prisma/client');
const fs = require('fs');
const prisma = new PrismaClient();

async function listCourses() {
    try {
        const courses = await prisma.course.findMany();
        const output = JSON.stringify(courses, null, 2);
        fs.writeFileSync('course_list.json', output);
        console.log('Courses written to course_list.json');
    } catch (e) {
        console.error(e);
    } finally {
        await prisma.$disconnect();
    }
}

listCourses();
