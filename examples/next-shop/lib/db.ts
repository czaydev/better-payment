import { PrismaClient } from '@prisma/client';

/**
 * One Prisma client per process. Next.js reloads modules on every edit in dev,
 * so the client is kept on `globalThis` to avoid opening a connection per reload.
 */
const globalForPrisma = globalThis as unknown as { prismaClient?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prismaClient ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prismaClient = prisma;
