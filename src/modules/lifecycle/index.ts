import { prisma } from '../../database/prisma';
import { checkUserGroups } from '../subscription/checker';
import { bot } from '../../bot';
import { UserStatus, SubscriptionLevel, config } from '../../config';
import { logEvent } from '../statistics/logger';
import { BotContext } from '../../types/context';

interface SyncResult {
  status: 'BOOSTY_ACTIVE' | 'PROMO_ACTIVE' | 'NO_ACCESS' | 'BANNED' | 'ERROR';
  level?: SubscriptionLevel | null;
  expiresAt?: Date | null;
  message?: string;
}

/**
 * Главная функция синхронизации статуса пользователя.
 * Единая точка истины для определения доступа пользователя.
 */
export async function syncUserStatus(userId: bigint): Promise<SyncResult> {
  try {
    console.log(`[Lifecycle] Starting sync for user ${userId}`);
    
    // 1. Получаем или создаем пользователя
    let user = await prisma.user.findUnique({
      where: { telegramId: userId }
    });

    if (!user) {
      console.log(`[Lifecycle] Creating new user ${userId}`);
      const { generateToken } = await import('../../utils/token');
      
      // Проверяем глобальный рубильник акции
      const adminSettings = await prisma.admin.findUnique({
        where: { telegramId: config.bot.adminId },
      });
      
      const isPromoEnabled = adminSettings?.isPromoEnabled || false;
      
      user = await prisma.user.create({
        data: {
          telegramId: userId,
          accessToken: generateToken(),
          status: UserStatus.INACTIVE,
          hasPromoAccess: isPromoEnabled,
        }
      });
      
      await logEvent('start', userId);
    }

    // 2. Проверяем бан
    if (user.bannedAt) {
      console.log(`[Lifecycle] User ${userId} is banned`);
      return {
        status: 'BANNED',
        message: `Вы заблокированы. Причина: ${user.banReason || 'Нарушение правил'}`
      };
    }

    // 3. Получаем источники правды
    const ctx = { telegram: bot.telegram } as BotContext;
    const membershipInfo = await checkUserGroups(ctx, userId);
    
    const now = new Date();
    const activePromoTask = await prisma.scheduledTask.findFirst({
      where: {
        userId: userId,
        taskType: 'remove_from_group',
        executed: false,
        scheduledFor: { gt: now }
      },
      orderBy: {
        scheduledFor: 'desc'
      }
    });

    console.log(`[Lifecycle] User ${userId} - Boosty level: ${membershipInfo.level}, Has promo: ${!!activePromoTask}`);

    // 4. ИЕРАРХИЯ ПРИНЯТИЯ РЕШЕНИЙ

    // СЦЕНАРИЙ 1: Пользователь в группе Boosty (высший приоритет)
    if (membershipInfo.level !== null) {
      console.log(`[Lifecycle] User ${userId} has Boosty subscription: ${membershipInfo.level}`);
      
      // Проверка на "косметическое" обновление
      if (user.status === UserStatus.ACTIVE && 
          !user.isFrozen && 
          user.subscriptionLevel === membershipInfo.level &&
          user.expiresAtFragment && 
          user.expiresAtFragment > now) {
        console.log(`[Lifecycle] No update needed for user ${userId}`);
        
        // Подготовим данные для потенциального обновления
        let needsUpdate = false;
        let updateData: any = {};
        
        // Забираем право на акцию, если оно было
        if (user.hasPromoAccess) {
          updateData.hasPromoAccess = false;
          needsUpdate = true;
        }
        
        // НОВАЯ ЛОГИКА: Проверяем Legacy статус для Легенды
        if (membershipInfo.level === 'legend') {
          // Если у пользователя Легенда, но Legacy статус не установлен правильно
          if (!user.isLegacy || 
              user.expiresAtPulse?.getTime() !== user.expiresAtFragment.getTime() ||
              user.expiresAtGearwire?.getTime() !== user.expiresAtFragment.getTime() ||
              user.expiresAtOuch?.getTime() !== user.expiresAtFragment.getTime()) {
            
            console.log(`[Lifecycle] User ${userId} has Legend but Legacy status needs sync`);
            updateData.isLegacy = true;
            updateData.expiresAtPulse = user.expiresAtFragment;
            updateData.expiresAtGearwire = user.expiresAtFragment;
            updateData.expiresAtOuch = user.expiresAtFragment;
            needsUpdate = true;
          }
        } else {
          // Для других уровней убираем Legacy, если он есть
          if (user.isLegacy) {
            console.log(`[Lifecycle] User ${userId} has ${membershipInfo.level} but Legacy status is true - removing`);
            updateData.isLegacy = false;
            needsUpdate = true;
          }
        }
        
        // Обновляем только если есть изменения
        if (needsUpdate) {
          await prisma.user.update({
            where: { telegramId: userId },
            data: updateData
          });
        }
        
        return {
          status: 'BOOSTY_ACTIVE',
          level: membershipInfo.level,
          expiresAt: user.expiresAtFragment
        };
      }

      // Рассчитываем новую дату истечения
      let newExpiresAt: Date;
      
      // Если был заморожен - размораживаем с той же датой
      if (user.isFrozen && user.expiresAtFragment && user.expiresAtFragment > now) {
        console.log(`[Lifecycle] User ${userId} was frozen - unfreezing with same date`);
        newExpiresAt = user.expiresAtFragment;
      } 
      // Если дата истекла или её нет - даём новый период
      else if (!user.expiresAtFragment || user.expiresAtFragment <= now) {
        console.log(`[Lifecycle] User ${userId} expired or new - setting new period`);
        newExpiresAt = new Date();
        newExpiresAt.setDate(newExpiresAt.getDate() + 31);
      }
      // Если активен и дата в будущем - оставляем как есть
      else {
        console.log(`[Lifecycle] User ${userId} keeping existing date`);
        newExpiresAt = user.expiresAtFragment;
      }

      const isRenewal = user.status === UserStatus.EXPIRED;

      // Готовим данные для обновления
      let updateData: any = {
        status: UserStatus.ACTIVE,
        isFrozen: false,
        subscriptionLevel: membershipInfo.level,
        expiresAtFragment: newExpiresAt,
        hasPromoAccess: false,
        ...(isRenewal && { lastRenewedAt: new Date() })
      };

      // НОВАЯ ЛОГИКА: Легенда = Легаси
      if (membershipInfo.level === 'legend') {
        console.log(`[Lifecycle] User ${userId} has Legend subscription - granting Legacy status`);
        updateData = {
          ...updateData,
          isLegacy: true,
          expiresAtPulse: newExpiresAt,
          expiresAtGearwire: newExpiresAt,
          expiresAtOuch: newExpiresAt
        };
      } else {
        // Для других уровней (adept, novice) убираем Legacy статус
        console.log(`[Lifecycle] User ${userId} has ${membershipInfo.level} subscription - removing Legacy status`);
        updateData = {
          ...updateData,
          isLegacy: false
        };
      }

      // Обновляем пользователя
      await prisma.user.update({
        where: { telegramId: userId },
        data: updateData
      });

      // Логирование
      if (isRenewal) {
        await logEvent('renew_subscription', userId, { level: membershipInfo.level });
      } else if (user.status === UserStatus.INACTIVE) {
        await logEvent('new_subscription', userId, { level: membershipInfo.level });
      }

      // Отменяем все задачи remove_from_group для этого пользователя
      await prisma.scheduledTask.updateMany({
        where: {
          userId: userId,
          taskType: 'remove_from_group',
          executed: false
        },
        data: {
          executed: true,
          executedAt: new Date()
        }
      });

      return {
        status: 'BOOSTY_ACTIVE',
        level: membershipInfo.level,
        expiresAt: newExpiresAt
      };
    }

    // СЦЕНАРИЙ 2: Нет Boosty, но есть акционная задача
    if (activePromoTask) {
      console.log(`[Lifecycle] User ${userId} has promo access until ${activePromoTask.scheduledFor}`);
      
      // Проверка на "косметическое" обновление
      if (user.status === UserStatus.ACTIVE && 
          user.expiresAtFragment?.getTime() === activePromoTask.scheduledFor.getTime()) {
        console.log(`[Lifecycle] No update needed for promo user ${userId}`);
        return {
          status: 'PROMO_ACTIVE',
          level: SubscriptionLevel.NOVICE,
          expiresAt: activePromoTask.scheduledFor
        };
      }

      // Обновляем пользователя (у промо всегда убираем Legacy)
      await prisma.user.update({
        where: { telegramId: userId },
        data: {
          status: UserStatus.ACTIVE,
          isFrozen: false,
          subscriptionLevel: SubscriptionLevel.NOVICE,
          expiresAtFragment: activePromoTask.scheduledFor,
          isLegacy: false
        }
      });

      return {
        status: 'PROMO_ACTIVE',
        level: SubscriptionLevel.NOVICE,
        expiresAt: activePromoTask.scheduledFor
      };
    }

    // СЦЕНАРИЙ 3: Нет ни подписки Boosty, ни акции
    console.log(`[Lifecycle] User ${userId} has no access`);
    
    // Проверка на "косметическое" обновление
    if (user.status === UserStatus.EXPIRED || user.status === UserStatus.INACTIVE) {
      console.log(`[Lifecycle] User ${userId} already in ${user.status} state`);
      return {
        status: 'NO_ACCESS',
        level: null,
        expiresAt: null
      };
    }

    // Если статус был ACTIVE
    if (user.status === UserStatus.ACTIVE) {
      let updateData: any = { 
        subscriptionLevel: null,
        isLegacy: false
      };

      if (user.expiresAtFragment && user.expiresAtFragment > now) {
        // Сценарий "Прогульщик" - досрочный выход из группы
        console.log(`[Lifecycle] User ${userId} left group early - freezing`);
        updateData.isFrozen = true;
      } else {
        // Сценарий "Истек" - срок подписки прошел
        console.log(`[Lifecycle] User ${userId} subscription expired`);
        updateData.status = UserStatus.EXPIRED;
      }

      await prisma.user.update({
        where: { telegramId: userId },
        data: updateData
      });

      await logEvent('cancel_subscription', userId, { 
        reason: updateData.isFrozen ? 'left_early' : 'expired' 
      });
    }

    return {
      status: 'NO_ACCESS',
      level: null,
      expiresAt: null
    };
    
  } catch (error) {
    console.error(`[Lifecycle] Error syncing user ${userId}:`, error);
    return {
      status: 'ERROR',
      message: 'Произошла ошибка при проверке статуса'
    };
  }
}