import { prisma } from '../../database/prisma';
import { User } from '@prisma/client';

type BuildCodeName = 'pulse' | 'gearwire' | 'ouch';
type UpdateResult = { success: boolean; message: string };

const EXPIRES_FIELD_MAP: Record<BuildCodeName, keyof User> = {
  pulse: 'expiresAtPulse',
  gearwire: 'expiresAtGearwire',
  ouch: 'expiresAtOuch',
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * ONE_DAY_MS);
}

function normalizeBuildCode(code: string): BuildCodeName | null {
  const c = code.toLowerCase() as BuildCodeName;
  return (['pulse', 'gearwire', 'ouch'] as BuildCodeName[]).includes(c) ? c : null;
}

/**
 * UserManager - управление пользователями через админку
 * ВАЖНО: Fragment НЕ управляется вручную! Только через lifecycle (группы Boosty/Промо).
 */
export const UserManager = {
  /**
   * Поиск пользователя по ID или username
   */
  async findUser(query: string): Promise<User | null> {
    if (!query) return null;

    if (query.startsWith('@')) {
      const username = query.slice(1).trim();
      if (!username) return null;
      return prisma.user.findFirst({
        where: { username: { equals: username, mode: 'insensitive' } },
      });
    }

    try {
      const id = BigInt(query);
      return prisma.user.findUnique({ where: { telegramId: id } });
    } catch {
      return null;
    }
  },

  /**
   * Изменение доступа к дополнительным сборкам (Pulse, Gearwire, Ouch)
   * Fragment НЕ поддерживается - управляется автоматически!
   */
  async updateAccess(
    userId: bigint,
    buildCodeName: string,
    days: number
  ): Promise<UpdateResult> {
    // Защита: Fragment нельзя менять вручную
    if (buildCodeName.toLowerCase() === 'fragment') {
      return {
        success: false,
        message: '❌ Fragment управляется автоматически через группы Boosty/Промо. Используйте систему промо-заявок или членство в группах.',
      };
    }

    const code = normalizeBuildCode(buildCodeName);
    if (!code) {
      return { success: false, message: '❌ Неизвестная сборка. Доступны: pulse, gearwire, ouch' };
    }

    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) {
      return { success: false, message: '❌ Пользователь не найден.' };
    }

    const field = EXPIRES_FIELD_MAP[code];
    const current = user[field] as Date | null;
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
      data: { [field]: newExpiry },
    });

    const niceDate = newExpiry ? newExpiry.toLocaleDateString('ru-RU') : 'Нет';
    const action =
      days === 0
        ? '❌ Доступ отозван'
        : days > 0
        ? `✅ Доступ выдан/продлён на ${days} дн.`
        : `⚠️ Доступ сокращён на ${Math.abs(days)} дн.`;
    
    return {
      success: true,
      message: `${action}\n📅 Новый срок для ${code}: ${niceDate}`,
    };
  },

  /**
   * Включение/выключение Legacy статуса
   * Legacy = 3 доп. сборки на 1000 дней
   */
  async toggleLegacy(userId: bigint): Promise<UpdateResult> {
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) return { success: false, message: '❌ Пользователь не найден.' };

    const newValue = !user.isLegacy;

    if (newValue) {
      const nowPlus1000 = addDays(new Date(), 1000);
      await prisma.user.update({
        where: { telegramId: userId },
        data: {
          isLegacy: true,
          expiresAtPulse: nowPlus1000,
          expiresAtGearwire: nowPlus1000,
          expiresAtOuch: nowPlus1000,
        },
      });
      return { success: true, message: '⭐ Legacy включён. Доступ к 3 сборкам продлён на 1000 дней.' };
    } else {
      await prisma.user.update({
        where: { telegramId: userId },
        data: { isLegacy: false },
      });
      return { success: true, message: '❌ Legacy отключён.' };
    }
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