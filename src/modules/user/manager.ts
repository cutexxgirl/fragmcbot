import { prisma } from '../../database/prisma';
import { User } from '@prisma/client';

type UpdateResult = { success: boolean; message: string };

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * ONE_DAY_MS);
}

/**
 * UserManager - управление пользователями через админку
 * ВАЖНО: Fragment НЕ управляется вручную! Только через lifecycle (группы Boosty/Промо).
 */
export const UserManager = {
  /**
   * Поиск пользователя по ID, username или fragmentId
   */
  async findUser(query: string): Promise<User | null> {
    if (!query) return null;

    // По username
    if (query.startsWith('@')) {
      const username = query.slice(1).trim();
      if (!username) return null;
      return prisma.user.findFirst({
        where: { username: { equals: username, mode: 'insensitive' } },
      });
    }

    // По fragmentId (формат ABC-XYZ)
    if (/^[A-Z]{3}-[A-Z]{3}$/i.test(query)) {
      return prisma.user.findUnique({ where: { fragmentId: query.toUpperCase() } });
    }

    // По telegramId
    try {
      const id = BigInt(query);
      return prisma.user.findUnique({ where: { telegramId: id } });
    } catch {
      return null;
    }
  },

  /**
   * Изменение доступа к дополнительным сборкам (через expiresAtExtra)
   */
  async updateExtraAccess(userId: bigint, days: number): Promise<UpdateResult> {
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) {
      return { success: false, message: '❌ Пользователь не найден.' };
    }

    const current = user.expiresAtExtra;
    let newExpiry: Date | null;

    if (days === 0) {
      // Забрать доступ
      newExpiry = null;
    } else if (days > 0) {
      // Выдать на N дней от сегодня
      newExpiry = addDays(new Date(), days);
    } else {
      // Уменьшить на N дней от текущей даты
      const base = current && current.getTime() > Date.now() ? current : new Date();
      newExpiry = addDays(base, days);
    }

    await prisma.user.update({
      where: { telegramId: userId },
      data: { expiresAtExtra: newExpiry },
    });

    const niceDate = newExpiry ? newExpiry.toLocaleDateString('ru-RU') : 'Нет';
    const action =
      days === 0
        ? '❌ Доступ к доп. сборкам отозван'
        : days > 0
        ? `✅ Доступ к доп. сборкам выдан на ${days} дн.`
        : `⚠️ Доступ к доп. сборкам сокращён на ${Math.abs(days)} дн.`;
    
    return {
      success: true,
      message: `${action}\n📅 Действует до: ${niceDate}`,
    };
  },

  /**
   * Заморозка/разморозка пользователя
   */
  async setFreeze(userId: bigint, freeze: boolean): Promise<UpdateResult> {
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) return { success: false, message: '❌ Пользователь не найден.' };

    await prisma.user.update({
      where: { telegramId: userId },
      data: { isFrozen: freeze },
    });

    return {
      success: true,
      message: freeze ? '🧊 Пользователь заморожен.' : '✅ Пользователь разморожен.',
    };
  },

  /**
   * Бан пользователя
   */
  async banUser(userId: bigint, reason?: string): Promise<UpdateResult> {
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) return { success: false, message: '❌ Пользователь не найден.' };

    await prisma.user.update({
      where: { telegramId: userId },
      data: { bannedAt: new Date(), banReason: reason || null },
    });

    return { success: true, message: '🚫 Пользователь забанен.' };
  },

  /**
   * Разбан пользователя
   */
  async unbanUser(userId: bigint): Promise<UpdateResult> {
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) return { success: false, message: '❌ Пользователь не найден.' };

    await prisma.user.update({
      where: { telegramId: userId },
      data: { bannedAt: null, banReason: null },
    });

    return { success: true, message: '✅ Пользователь разбанен.' };
  },
};