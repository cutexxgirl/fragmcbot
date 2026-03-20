import { prisma } from '../../database/prisma';
import { SubscriptionLevel } from '../../config';
import { BotContext } from '../../types/context';
import { Telegraf } from 'telegraf';
import { config } from '../../config';

// Функция отправки уведомлений о закрытом канале
export async function sendPrivateChannelNotifications(bot: Telegraf<BotContext>) {
    try {
        // Ищем пользователей с подпиской Legend/Spark, которые еще не получили уведомление
        const users = await prisma.user.findMany({
            where: {
                subscriptionLevel: {
                    in: [SubscriptionLevel.LEGEND, SubscriptionLevel.SPARK]
                },
                privateChannelLinkSent: false,
                status: 'active', // Только активным
                isFrozen: false
            },
            take: 20 // Ограничиваем пачку, чтобы не забить лимиты API 
        });

        if (users.length === 0) return;

        console.log(`[Notification] Found ${users.length} users to send private channel invite`);

        for (const user of users) {
            try {
                // Проверяем, не в канале ли уже пользователь
                let isMember = false;
                try {
                     const chatMember = await bot.telegram.getChatMember(config.channel.closed.toString(), Number(user.telegramId));
                     if (['member', 'administrator', 'creator'].includes(chatMember.status)) {
                         isMember = true;
                     }
                } catch (e) {
                    // Ignored (user not found or other error)
                }

                if (isMember) {
                     console.log(`[Notification] User ${user.telegramId} is ALREADY in the channel. Marking as sent without message.`);
                     await prisma.user.update({
                        where: { telegramId: user.telegramId },
                        data: { privateChannelLinkSent: true }
                    });
                    continue;
                }

                await bot.telegram.sendMessage(
                    Number(user.telegramId), 
                    '🎉 <b>Поздравляем! Вам доступен закрытый канал.</b>\n\n' +
                    'Там публикуются эксклюзивные материалы и ранние анонсы.\n\n' +
                    'Чтобы получить ссылку-приглашение, нажмите кнопку ниже или введите команду /private.\n' +
                    '(Ссылка одноразовая и действует 1 час).',
                    { 
                        parse_mode: 'HTML',
                        reply_markup: {
                            inline_keyboard: [[{ text: '🔒 Получить ссылку', callback_data: 'get_private_link_btn' }]]
                        }
                    }
                );

                // Отмечаем как отправленное
                await prisma.user.update({
                    where: { telegramId: user.telegramId },
                    data: { privateChannelLinkSent: true }
                });

            } catch (error) {
                console.error(`[Notification] Failed to send to ${user.telegramId}:`, error);
            }
        }

    } catch (e) {
        console.error('[Notification] Error in notification cron:', e);
    }
}
