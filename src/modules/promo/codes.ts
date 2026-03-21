import { prisma } from '../../database/prisma';
import { SubscriptionLevel, UserStatus, config } from '../../config';
import { logEvent } from '../statistics/logger';

const BACKOFF_TIMES = [0, 5000, 30000, 5 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];
const LEVELS = ['novice', 'adept', 'legend', 'spark'];

type PromoActivationResult =
  | { success: true; code: string; grantDays: number; level: string }
  | { success: false; message: string; countAsFailedAttempt?: boolean };

type PromoCooldownUser = {
  lastPromoAttemptAt: Date | null;
  promoAttempts: number | null;
};

const hasErrorCode = (error: unknown, code: string) =>
  typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === code;

const promoFailure = (message: string, countAsFailedAttempt = false): PromoActivationResult => ({
  success: false,
  message,
  countAsFailedAttempt
});

const promoSuccess = (code: string, grantDays: number, level: string): PromoActivationResult => ({
  success: true,
  code,
  grantDays,
  level
});

export async function checkPromoCooldown(user: PromoCooldownUser): Promise<{ allowed: boolean; waitTimeMs?: number }> {
  if (!user.lastPromoAttemptAt) return { allowed: true };

  const attempt = user.promoAttempts || 0;
  if (attempt === 0) return { allowed: true };

  const index = Math.min(attempt, BACKOFF_TIMES.length - 1);
  const requiredDelay = BACKOFF_TIMES[index];
  const passed = Date.now() - user.lastPromoAttemptAt.getTime();

  if (passed < requiredDelay) {
    return { allowed: false, waitTimeMs: requiredDelay - passed };
  }

  return { allowed: true };
}

export async function registerFailedAttempt(userId: bigint) {
  await prisma.user.update({
    where: { telegramId: userId },
    data: {
      promoAttempts: { increment: 1 },
      lastPromoAttemptAt: new Date()
    }
  });
}

export async function resetPromoAttempts(userId: bigint) {
  await prisma.user.update({
    where: { telegramId: userId },
    data: {
      promoAttempts: 0,
      lastPromoAttemptAt: null
    }
  });
}

const getHigherLevel = (currentLevel: string | null, promoLevel: string) => {
  if (!currentLevel) return promoLevel;

  const currentIndex = LEVELS.indexOf(currentLevel);
  const promoIndex = LEVELS.indexOf(promoLevel);

  if (currentIndex === -1 || promoIndex === -1) {
    return promoLevel;
  }

  return currentIndex > promoIndex ? currentLevel : promoLevel;
};

const requiresExtraAccess = (level: string) =>
  level === SubscriptionLevel.LEGEND || level === SubscriptionLevel.SPARK;

export async function activatePromoCode(
  userId: bigint,
  codeInput: string,
  ctx?: any
): Promise<{ success: boolean; message: string }> {
  const code = codeInput.trim();

  if (ctx && config.channel.main) {
    try {
      const channelId = config.channel.main.toString();
      const chatMember = await ctx.telegram.getChatMember(channelId, Number(userId));
      const status = chatMember.status;

      if (status === 'left' || status === 'kicked') {
        return {
          success: false,
          message: `❌ Для активации промокода необходимо быть подписанным на наш канал!\n\n${process.env.CHANNEL_LINK || '@fragmcru'}`
        };
      }
    } catch (error) {
      console.error('Error checking channel subscription:', error);
      return {
        success: false,
        message: '⚠️ Ошибка при проверке подписки. Убедитесь, что бот является администратором канала, или попробуйте позже.'
      };
    }
  }

  let result: PromoActivationResult;

  try {
    result = await prisma.$transaction(async (tx: any) => {
      const promo = await tx.promoCode.findUnique({
        where: { code }
      });

      if (!promo || !promo.isActive) {
        return promoFailure('Промокод не найден или неактивен.', true);
      }

      if (promo.validUntil && promo.validUntil < new Date()) {
        return promoFailure('Срок действия промокода истек.', true);
      }

      const existingActivation = await tx.promoActivation.findUnique({
        where: {
          userId_promoId: {
            userId,
            promoId: promo.id
          }
        }
      });

      if (existingActivation) {
        return promoFailure('Вы уже активировали этот промокод.', true);
      }

      const user = await tx.user.findUnique({ where: { telegramId: userId } });
      if (!user) {
        return promoFailure('User error');
      }

      const promoUpdateWhere: any = { id: promo.id };
      if (promo.maxActivations !== -1) {
        promoUpdateWhere.activationsCount = { lt: promo.maxActivations };
      }

      const updateResult = await tx.promoCode.updateMany({
        where: promoUpdateWhere,
        data: {
          activationsCount: { increment: 1 }
        }
      });

      if (updateResult.count === 0) {
        return promoFailure('Лимит активаций этого промокода исчерпан.', true);
      }

      await tx.promoActivation.create({
        data: {
          userId,
          promoId: promo.id
        }
      });

      const now = new Date();
      const newExpiresAt =
        user.expiresAtFragment && user.expiresAtFragment > now
          ? new Date(user.expiresAtFragment)
          : new Date(now);
      newExpiresAt.setDate(newExpiresAt.getDate() + promo.grantDays);

      const newLevel = getHigherLevel(user.subscriptionLevel, promo.grantLevel);

      await tx.user.update({
        where: { telegramId: userId },
        data: {
          status: UserStatus.ACTIVE,
          subscriptionLevel: newLevel,
          expiresAtFragment: newExpiresAt,
          expiresAtExtra: requiresExtraAccess(newLevel) ? newExpiresAt : user.expiresAtExtra,
          hasPromoAccess: true,
          promoAttempts: 0,
          lastPromoAttemptAt: null
        }
      });

      return promoSuccess(promo.code, promo.grantDays, newLevel);
    });
  } catch (error) {
    if (hasErrorCode(error, 'P2002')) {
      await registerFailedAttempt(userId);
      return { success: false, message: 'Вы уже активировали этот промокод.' };
    }

    throw error;
  }

  if (!result.success) {
    if (result.countAsFailedAttempt) {
      await registerFailedAttempt(userId);
    }
    return { success: false, message: result.message };
  }

  await logEvent('promo_code_activation', userId, {
    code: result.code,
    grantDays: result.grantDays
  });

  let successMsg =
    `✅ Промокод активирован!\n` +
    `Вам выдана подписка уровня ${result.level} на ${result.grantDays} дней.\n\n` +
    `🔄 Напишите /start для обновления меню.`;

  if (requiresExtraAccess(result.level)) {
    successMsg += `\n\n🔒 Доступ к закрытому каналу: /private`;
  }

  return { success: true, message: successMsg };
}
