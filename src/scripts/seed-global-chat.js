/**
 * Database seeding script for the Global Chatroom
 * Ensures a 'Course' record exists for the global chatroom with a fixed ID.
 */

const { PrismaClient } = require('@prisma/client');
const { GLOBAL_CHAT_ID, GLOBAL_CHAT_DEFAULTS } = require('../utils/constants');

const prisma = new PrismaClient();

async function seedGlobalChat() {
    console.log('🌱 Seeding Global Chatroom...');

    try {
        const existingRoom = await prisma.course.findUnique({
            where: { id: GLOBAL_CHAT_ID }
        });

        if (existingRoom) {
            console.log('✅ Global Chatroom already exists. Updating metadata...');
            await prisma.course.update({
                where: { id: GLOBAL_CHAT_ID },
                data: {
                    title: GLOBAL_CHAT_DEFAULTS.title,
                    icon: GLOBAL_CHAT_DEFAULTS.icon,
                    description: GLOBAL_CHAT_DEFAULTS.description,
                    price: 0,
                    originalPrice: 0,
                    badge: GLOBAL_CHAT_DEFAULTS.badge,
                    badgeColor: GLOBAL_CHAT_DEFAULTS.badgeColor
                }
            });
        } else {
            console.log('🆕 Creating Global Chatroom...');
            await prisma.course.create({
                data: {
                    id: GLOBAL_CHAT_ID,
                    title: GLOBAL_CHAT_DEFAULTS.title,
                    icon: GLOBAL_CHAT_DEFAULTS.icon,
                    description: GLOBAL_CHAT_DEFAULTS.description,
                    price: 0,
                    originalPrice: 0,
                    badge: GLOBAL_CHAT_DEFAULTS.badge,
                    badgeColor: GLOBAL_CHAT_DEFAULTS.badgeColor,
                    level: "Community",
                    isLive: false,
                    users: 0
                }
            });
        }

        console.log('🚀 Global Chatroom seed complete!');
    } catch (error) {
        console.error('❌ Error seeding Global Chatroom:', error);
    } finally {
        await prisma.$disconnect();
    }
}

seedGlobalChat();
