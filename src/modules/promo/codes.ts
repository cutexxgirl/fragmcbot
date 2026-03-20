import { prisma } from '../../database/prisma';
import { User, PromoCode } from '@prisma/client';
import { UserStatus, SubscriptionLevel } from '../../config';
import { logEvent } from '../statistics/logger';
import { syncUserStatus } from '../lifecycle';

const BACKOFF_TIMES = [0, 5000, 30000, 5 * 60 * 1000, 60 * 60 * 1000, 24 * 60 * 60 * 1000];

/**
 * Проверка кулдауна на ввод промокода
 */
export async function checkPromoCooldown(user: User): Promise<{ allowed: boolean; waitTimeMs?: number }> {
    if (!user.lastPromoAttemptAt) return { allowed: true };
    
    const attempt = user.promoAttempts || 0;
    // Если попыток 0 (значит предыдущая была успешна или сброшена), то кулдаун 0
    if (attempt === 0) return { allowed: true };

    const index = Math.min(attempt, BACKOFF_TIMES.length - 1);
    const requiredDelay = BACKOFF_TIMES[index]; // ms
    
    const passed = Date.now() - user.lastPromoAttemptAt.getTime();
    
    if (passed < requiredDelay) {
        return { allowed: false, waitTimeMs: requiredDelay - passed };
    }
    return { allowed: true };
}

/**
 * Регистрация НЕУДАЧНОЙ попытки (увеличиваем счетчик)
 */
export async function registerFailedAttempt(userId: bigint) {
    await prisma.user.update({
        where: { telegramId: userId },
        data: {
            promoAttempts: { increment: 1 },
            lastPromoAttemptAt: new Date()
        }
    });
}

/**
 * Сброс счетчика (при успехе)
 */
export async function resetPromoAttempts(userId: bigint) {
    await prisma.user.update({
        where: { telegramId: userId },
        data: {
            promoAttempts: 0,
            lastPromoAttemptAt: null
        }
    });
}

/**
 * Активация промокода
 */
import { config } from '../../config';

/**
 * Активация промокода
 */
export async function activatePromoCode(userId: bigint, codeInput: string, ctx?: any): Promise<{ success: boolean; message: string }> {
    const code = codeInput.trim();
    
    // 1. Ищем код
    const promo = await prisma.promoCode.findUnique({
        where: { code }
    });

    if (!promo || !promo.isActive) {
        await registerFailedAttempt(userId);
        return { success: false, message: 'Промокод не найден или неактивен.' };
    }

    // 2. Проверяем валидность кода (срок, кол-во)
    if (promo.validUntil && promo.validUntil < new Date()) {
        await registerFailedAttempt(userId);
        return { success: false, message: 'Срок действия промокода истек.' };
    }
    
    if (promo.maxActivations !== -1 && promo.activationsCount >= promo.maxActivations) {
        await registerFailedAttempt(userId);
        return { success: false, message: 'Лимит активаций этого промокода исчерпан.' };
    }

    // 2.5 Проверка подписки на канал (если передан контекст)
    // 2.5 Проверка подписки на канал (если передан контекст)
    if (ctx && config.channel.main) {
        try {
            const channelId = config.channel.main.toString();
            // Handle negative IDs standard
            const chatMember = await ctx.telegram.getChatMember(channelId, Number(userId));
            const status = chatMember.status;
            
            // Allow: creator, administrator, member. (restricted? maybe)
            // Block: left, kicked.
            if (status === 'left' || status === 'kicked') {
                return { 
                    success: false, 
                    message: `❌ Для активации промокода необходимо быть подписанным на наш канал!\n\n${process.env.CHANNEL_LINK || '@fragmcru'}` 
                };
            }
        } catch (error) {
            console.error('Error checking channel subscription:', error);
            // STRICT MODE: Если не удалось проверить (например, бот не админ), лучше отказать и попросить админа проверить.
            // Иначе дыра в безопасности.
            return {
                success: false,
                message: '⚠️ Ошибка при проверке подписки. Убедитесь, что бот является администратором канала, или попробуйте позже.'
            };
        }
    }

    // 3. Проверяем, активировал ли уже этот юзер
    const activation = await prisma.promoActivation.findUnique({
        where: {
            userId_promoId: {
                userId,
                promoId: promo.id
            }
        }
    });

    if (activation) {
         // Тут спорно: считать ли повторную активацию за ошибку? Да, чтобы не спамили.
        await registerFailedAttempt(userId);
        return { success: false, message: 'Вы уже активировали этот промокод.' };
    }

    // 4. АКТИВАЦИЯ
    
    // Обновляем статистику промокода
    await prisma.promoCode.update({
        where: { id: promo.id },
        data: { activationsCount: { increment: 1 } }
    });

    // Создаем запись об активации
    await prisma.promoActivation.create({
        data: {
            userId,
            promoId: promo.id
        }
    });
    
    // Выдаем награду Юзеру
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    if (!user) return { success: false, message: 'User error' };

    // Рассчитываем новую дату
    let newExpiresAt = user.expiresAtFragment && user.expiresAtFragment > new Date() 
        ? user.expiresAtFragment 
        : new Date();
        
    // Добавляем дни
    newExpiresAt.setDate(newExpiresAt.getDate() + promo.grantDays);
    
    // Определяем уровень (если у юзера уже выше, не понижаем)
    let newLevel = promo.grantLevel;
    // Простая логика приоритетов: Spark > Legend > Adept > Novice
    const levels = ['novice', 'adept', 'legend', 'spark'];
    if (user.subscriptionLevel && levels.indexOf(user.subscriptionLevel) > levels.indexOf(newLevel)) {
        newLevel = user.subscriptionLevel;
    }

    // Обновляем юзера
    await prisma.user.update({
        where: { telegramId: userId },
        data: {
            status: UserStatus.ACTIVE,
            subscriptionLevel: newLevel,
            expiresAtFragment: newExpiresAt,
            hasPromoAccess: true, // Mark as Promo user to prevent auto-freeze
            // Сбрасываем счетчик ошибок
            promoAttempts: 0,
            lastPromoAttemptAt: null
        }
    });
    
    // Даем доп доступ если уровень позволяет
    if (newLevel === SubscriptionLevel.LEGEND || newLevel === SubscriptionLevel.SPARK) {
         await prisma.user.update({
            where: { telegramId: userId },
            data: { expiresAtExtra: newExpiresAt }
        });
    }

    await logEvent('promo_code_activation', userId, { code: promo.code, grantDays: promo.grantDays });
    
    let successMsg = `✅ Промокод активирован!\nВам выдана подписка уровня ${newLevel} на ${promo.grantDays} дней.\n\n🔄 Напишите /start для обновления меню.`;
    
    if (newLevel === SubscriptionLevel.LEGEND || newLevel === SubscriptionLevel.SPARK) {
        successMsg += `\n\n🔒 Доступ к закрытому каналу: /private`;
    }

    return { success: true, message: successMsg };
}
