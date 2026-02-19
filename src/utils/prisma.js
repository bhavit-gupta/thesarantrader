/* ---------------- DEPENDENCIES ---------------- */
const { PrismaClient } = require('@prisma/client');

/* ---------------- PRISMA CLIENT ---------------- */
const prisma = new PrismaClient();

module.exports = prisma;
