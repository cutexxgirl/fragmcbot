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
      
      const { generateFragmentId } = await import('../../utils/fragmentId');
      
      user = await prisma.user.create({
        data: {
          telegramId: userId,
          fragmentId: await generateFragmentId(),
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

    // 2.5 Гарантируем наличие Fragment ID (Ленивая миграция)
    if (!user.fragmentId) {
        const { generateFragmentId } = await import('../../utils/fragmentId');
        let newFid = await generateFragmentId();
        
        // Простая защита от коллизий (одна попытка, можно улучшить циклом)
        const exists = await prisma.user.findUnique({ where: { fragmentId: newFid } });
        if (exists) newFid = await generateFragmentId();

        user = await prisma.user.update({
            where: { telegramId: userId },
            data: { fragmentId: newFid }
        });
        console.log(`[Lifecycle] Generated new FID for ${userId}: ${newFid}`);
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
        
        // Проверяем expiresAtExtra для Legend/Spark
        if (membershipInfo.level === 'legend' || membershipInfo.level === 'spark') {
          // Синхронизируем expiresAtExtra с основной подпиской
          if (user.expiresAtExtra?.getTime() !== user.expiresAtFragment.getTime()) {
            console.log(`[Lifecycle] User ${userId} has ${membershipInfo.level} - syncing expiresAtExtra`);
            updateData.expiresAtExtra = user.expiresAtFragment;
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

      // Legend и Spark получают доступ к доп. сборкам
      if (membershipInfo.level === 'legend' || membershipInfo.level === 'spark') {
        console.log(`[Lifecycle] User ${userId} has ${membershipInfo.level} - granting extra builds access`);
        updateData.expiresAtExtra = newExpiresAt;
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

      // KICK FROM PRIVATE CHANNEL IF DOWNGRADED
      // Если уровень больше не Legend/Spark, то кикаем из закрытого канала
      if (membershipInfo.level !== 'legend' && membershipInfo.level !== 'spark') {
           const closedChannelId = config.channel.closed;
           if (closedChannelId && closedChannelId !== BigInt(0)) {
               try {
                   // Пробуем кикнуть (бан+разбан). Если юзера нет в чате, может упасть ошибка, игнорируем
                   // Fire-and-forget для скорости
                   ctx.telegram.banChatMember(closedChannelId.toString(), Number(userId))
                       .then(() => ctx.telegram.unbanChatMember(closedChannelId.toString(), Number(userId)))
                       .catch(() => {}); // Игнорируем ошибки (юзера нет в чате и т.д.)
               } catch (e) {
                   // Sync check error
               }
           }
      }

      return {
        status: 'BOOSTY_ACTIVE',
        level: membershipInfo.level,
        expiresAt: newExpiresAt
      };
    }

    // СЦЕНАРИЙ 2: Нет Boosty, но есть акционная задача ИЛИ флаг промо-доступа
    if (activePromoTask || (user.hasPromoAccess && user.expiresAtFragment && user.expiresAtFragment > now)) {
      const expiryDate = activePromoTask ? activePromoTask.scheduledFor : user.expiresAtFragment!;
      console.log(`[Lifecycle] User ${userId} has promo access until ${expiryDate}`);
      
      // Проверка на "косметическое" обновление
      if (user.status === UserStatus.ACTIVE && 
          user.expiresAtFragment?.getTime() === expiryDate.getTime()) {
        console.log(`[Lifecycle] No update needed for promo user ${userId}`);
        return {
          status: 'PROMO_ACTIVE',
          level: user.subscriptionLevel as SubscriptionLevel || SubscriptionLevel.NOVICE,
          expiresAt: expiryDate
        };
      }

      // Обновляем пользователя (у промо всегда убираем Legacy)
      await prisma.user.update({
        where: { telegramId: userId },
        data: {
          status: UserStatus.ACTIVE,
          isFrozen: false,
          // subscriptionLevel не меняем, он уже установлен при активации
          expiresAtFragment: expiryDate
        }
      });

      return {
        status: 'PROMO_ACTIVE',
        level: user.subscriptionLevel as SubscriptionLevel || SubscriptionLevel.NOVICE,
        expiresAt: expiryDate
      };
    }

    // СЦЕНАРИЙ 2.5: Подаренный доступ (Shared)
    // Проверяем, есть ли активная запись в SharedAccess
    const sharedAccess = await prisma.sharedAccess.findFirst({
        where: {
            guestId: userId,
            expiresAt: { gt: now }
        },
        include: { owner: true }
    });

    if (sharedAccess) {
         console.log(`[Lifecycle] User ${userId} has shared access from ${sharedAccess.ownerId}`);
         
         const ownerLevel = sharedAccess.owner.subscriptionLevel;
         // Уровень доступа гостя зависит от владельца
         // Legend дает доступ, но сам гость считается Novice (в плане прав дарения), 
         // хотя получает доступ к лаунчеру.
         // Но судя по profile.ts, мы просто ставим статус SHARED.
         
         // Проверка на "косметическое" обновление
         if (user.status === UserStatus.SHARED && 
             user.expiresAtFragment?.getTime() === sharedAccess.expiresAt.getTime()) {
             console.log(`[Lifecycle] No update needed for shared user ${userId}`);
             return {
                 status: 'BOOSTY_ACTIVE', // Используем 'BOOSTY_ACTIVE' для корректного отображения в start.ts или добавим новый кейс
                 level: SubscriptionLevel.NOVICE, // Гость получает базовый доступ
                 expiresAt: sharedAccess.expiresAt
             };
         }
         
         const isRenewal = user.status === UserStatus.EXPIRED || user.status === UserStatus.INACTIVE || user.status === UserStatus.SHARED;
         
         await prisma.user.update({
             where: { telegramId: userId },
             data: {
                 status: UserStatus.SHARED,
                 isFrozen: false,
                 subscriptionLevel: SubscriptionLevel.NOVICE, // Уровень прав в боте (не путать с уровнем доступа к файлам)
                 expiresAtFragment: sharedAccess.expiresAt,
                 expiresAtExtra: sharedAccess.expiresAt, // Даем доступ и к доп сборкам, так как дарят Legend/Spark
                 giftedById: sharedAccess.ownerId,
                 hasPromoAccess: false
             }
         });
         
         // Лог
         if (isRenewal && user.status !== UserStatus.SHARED) {
             await logEvent('new_subscription', userId, { type: 'shared', from: sharedAccess.ownerId.toString() });
         }

         return {
             status: 'BOOSTY_ACTIVE', // Возвращаем как активный, чтобы startHandler показал меню
             level: SubscriptionLevel.NOVICE,
             expiresAt: sharedAccess.expiresAt
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
        subscriptionLevel: null
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
      
      // KICK FROM PRIVATE CHANNEL IF NEEDED
      // Сценарий "Истек" или "Нет доступа" - кикаем из закрытого канала
      if (updateData.status && (updateData.status === UserStatus.EXPIRED || updateData.status === UserStatus.INACTIVE)) {
           try {
               const closedChannelId = config.channel.closed;
               if (closedChannelId !== BigInt(0)) {
                   await ctx.telegram.banChatMember(closedChannelId.toString(), Number(userId));
                   await ctx.telegram.unbanChatMember(closedChannelId.toString(), Number(userId)); // Сразу разбан, чтобы мог зайти потом
                   console.log(`[Lifecycle] Kicked user ${userId} from private channel`);
               }
           } catch (e) {
               console.error(`[Lifecycle] Failed to kick user ${userId} from private channel:`, e);
           }
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