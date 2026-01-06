import { prisma } from '../../database/prisma';
import { bot } from '../../bot';
import { config, SubscriptionLevel } from '../../config';

/**
 * SubscriptionManager - утилиты для управления подписками.
 * ВАЖНО: Основная логика синхронизации теперь в lifecycle/syncUserStatus.
 * Здесь только вспомогательные методы для Legacy и доп. сборок.
 */
export class SubscriptionManager {
  
  /**
   * Выдача Legacy статуса (3 доп. сборки на 1000 дней)
   */
  static async grantLegacy(userId: bigint) {
    const legacyExpiryDate = new Date();
    legacyExpiryDate.setDate(legacyExpiryDate.getDate() + 1000);

    await prisma.user.update({
      where: { telegramId: userId },
      data: {
        isLegacy: true,
        expiresAtPulse: legacyExpiryDate,
        expiresAtGearwire: legacyExpiryDate,
        expiresAtOuch: legacyExpiryDate,
      },
    });

    console.log(`✅ Granted Legacy status to user ${userId}`);
  }

  /**
   * Снятие Legacy статуса
   */
  static async revokeLegacy(userId: bigint) {
    await prisma.user.update({
      where: { telegramId: userId },
      data: {
        isLegacy: false,
        expiresAtPulse: null,
        expiresAtGearwire: null,
        expiresAtOuch: null,
      },
    });

    console.log(`❌ Revoked Legacy status from user ${userId}`);
  }

  /**
   * Выдача доступа к дополнительной сборке
   */
  static async grantAdditionalBuild(
    userId: bigint,
    buildName: 'pulse' | 'gearwire' | 'ouch',
    days: number
  ) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);

    const fieldMap = {
      pulse: 'expiresAtPulse',
      gearwire: 'expiresAtGearwire',
      ouch: 'expiresAtOuch',
    };

    await prisma.user.update({
      where: { telegramId: userId },
      data: {
        [fieldMap[buildName]]: expiryDate,
      },
    });

    console.log(`✅ Granted ${buildName} access to user ${userId} until ${expiryDate}`);
  }

  /**
   * Создание пригласительной ссылки в группу
   */
  static async createInviteLink(groupId: bigint): Promise<string> {
    const inviteLink = await bot.telegram.createChatInviteLink(Number(groupId), {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 3600, // 1 час
    });
    
    return inviteLink.invite_link;
  }
}