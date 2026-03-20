import { prisma } from '../../database/prisma';
import { bot } from '../../bot';
import { config, SubscriptionLevel } from '../../config';

/**
 * SubscriptionManager - утилиты для управления подписками.
 * Основная логика в lifecycle/syncUserStatus.
 */
export class SubscriptionManager {
  
  /**
   * Выдача доступа к дополнительным сборкам (expiresAtExtra)
   */
  static async grantExtraAccess(userId: bigint, days: number) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + days);

    await prisma.user.update({
      where: { telegramId: userId },
      data: { expiresAtExtra: expiryDate },
    });

    console.log(`✅ Granted extra builds access to user ${userId} until ${expiryDate}`);
  }

  /**
   * Снятие доступа к дополнительным сборкам
   */
  static async revokeExtraAccess(userId: bigint) {
    await prisma.user.update({
      where: { telegramId: userId },
      data: { expiresAtExtra: null },
    });

    console.log(`❌ Revoked extra builds access from user ${userId}`);
  }

  /**
   * Создание одноразовой пригласительной ссылки в группу
   */
  static async createInviteLink(groupId: bigint, expireHours: number = 1): Promise<string> {
    const inviteLink = await bot.telegram.createChatInviteLink(Number(groupId), {
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + (expireHours * 3600),
    });
    
    return inviteLink.invite_link;
  }
}