import { prisma } from '../database/prisma';
import { config } from '../config';

export const isAdmin = async (userId: bigint): Promise<boolean> => {
  // Главный админ из конфига
  if (userId === config.bot.adminId) {
    return true;
  }
  
  // Проверяем в БД
  const admin = await prisma.admin.findUnique({
    where: { telegramId: userId, isActive: true },
  });
  
  return !!admin;
};

export const isSupportAgent = async (userId: bigint): Promise<boolean> => {
  const agent = await prisma.supportAgent.findUnique({
    where: { telegramId: userId, isActive: true },
  });
  
  return !!agent;
};

export const ensureAdmin = async (userId: bigint): Promise<void> => {
  const admin = await isAdmin(userId);
  if (!admin) {
    throw new Error('Недостаточно прав');
  }
};