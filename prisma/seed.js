const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const courses = [
    {
        title: "March Batch: Options Trading",
        description: "Master the skills of risk management and profitable trading strategies.",
        rating: 4.6,
        students: 800,
        price: 4000,
        originalPrice: 8000,
        badge: "Bestseller",
        badgeColor: "orange",
        icon: "💹",
        iconBg: "blue-50",
        iconColor: "blue-500"
    },
    {
        title: "Technical Analysis Masterclass",
        description: "Learn to read charts, patterns, and indicators like a pro.",
        rating: 4.9,
        students: 500,
        price: 3500,
        originalPrice: 7000,
        icon: "📊",
        iconBg: "indigo-50",
        iconColor: "indigo-500"
    },
    {
        title: "Long-term Wealth Creation",
        description: "Understand company fundamentals and build a long-term portfolio.",
        rating: 4.7,
        students: 300,
        price: 2999,
        originalPrice: 6000,
        icon: "🏢",
        iconBg: "green-50",
        iconColor: "green-500"
    },
    {
        title: "Options Trading: Zero to Hero",
        description: "A complete guide from basics to advanced strategies.",
        rating: 5.0,
        students: 100,
        price: 4999,
        originalPrice: 10000,
        badgeColor: "purple",
        icon: "🚀",
        iconBg: "purple-50",
        iconColor: "purple-500"
    }
];

const users = [
    { username: "admin", email: "admin@example.com", phone: "9876543210", password: "password123", role: "admin", name: "Admin User" },
    { username: "testuser", email: "test@example.com", phone: "9999999999", password: "password123", role: "user", name: "Test User" },
    { username: "kundan_raj", email: "kundan@example.com", phone: "9876543211", password: "password123", role: "user", name: "Kundan Raj" }
];

async function main() {
    console.log(`Start seeding ...`);

    // Seed Users
    for (const u of users) {
        const user = await prisma.user.upsert({
            where: { email: u.email },
            update: {},
            create: u,
        });
        console.log(`Created user with id: ${user.id}`);
    }

    // Seed Courses
    // Note: Since courses don't have unique fields to check against easily like email, 
    // we'll check by title to avoid duplicates or just create them if the DB is empty.
    // For simplicity in this migration, we'll try to find by title first.

    for (const c of courses) {
        const existingCourse = await prisma.course.findFirst({
            where: { title: c.title }
        });

        if (!existingCourse) {
            const course = await prisma.course.create({
                data: c,
            });
            console.log(`Created course with id: ${course.id}`);
        } else {
            console.log(`Course "${c.title}" already exists.`);
        }
    }

    console.log(`Seeding finished.`);
}

main()
    .then(async () => {
        await prisma.$disconnect();
    })
    .catch(async (e) => {
        console.error(e);
        await prisma.$disconnect();
        process.exit(1);
    });
