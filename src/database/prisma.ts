import { PrismaClient } from '@prisma/client';
import { config } from '../config';

const globalForPrisma = global as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: [], // отключает все типы логов
    // log: config.environment === 'development' ? ['query', 'error', 'warn'] : ['error'],
  });

if (config.environment !== 'production') globalForPrisma.prisma = prisma;