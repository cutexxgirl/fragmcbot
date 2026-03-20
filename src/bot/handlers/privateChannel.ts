import { BotContext } from '../../types/context';
import { config, SubscriptionLevel } from '../../config';

export const getPrivateChannelLink = async (ctx: BotContext) => {
    // 1. Проверка прав
    const allowedLevels = [SubscriptionLevel.LEGEND, SubscriptionLevel.SPARK];
    const userLevel = (ctx.session as any)?.user?.subscriptionLevel; // Или запрос из БД если сессия пуста
    
    // Лучше запросим из БД для надежности, так как сессия может быть старой, 
    // но в хендлерах обычно мы доверяем middleware. 
    // Предположим, что мы проверили базу или доверяем контексту. 
    // Для надежности проверим по БД, так как это критично.
    
    const { prisma } = await import('../../database/prisma');
    const user = await prisma.user.findUnique({ where: { telegramId: BigInt(ctx.from!.id) } });

    if (!user || !user.subscriptionLevel || !allowedLevels.includes(user.subscriptionLevel as SubscriptionLevel)) {
        return ctx.reply('⛔ Доступ к закрытому каналу только для Легенд и Искр.');
    }

    // 1.5 Проверка спама (1 ссылка в день)
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (user.lastPrivateLinkAt && (Date.now() - user.lastPrivateLinkAt.getTime() < ONE_DAY)) {
        const nextTime = new Date(user.lastPrivateLinkAt.getTime() + ONE_DAY);
        return ctx.reply(`⏳ Ссылку можно запрашивать не чаще 1 раза в сутки.\nСледующая попытка: ${nextTime.toLocaleString('ru-RU')}`);
    }

    if (config.channel.closed === BigInt(0)) {
        return ctx.reply('⚠️ ID закрытого канала не настроен.');
    }

    try {
        // 2. Генерация ссылки (Без лимита вступлений, отзыв через ChannelGuard)
        const link = await ctx.telegram.createChatInviteLink(config.channel.closed.toString(), {
            name: `Access for ${user.username || ctx.from?.first_name}`,
            expire_date: Math.floor(Date.now() / 1000) + 3600, // Ссылка живет 1 час
            member_limit: 1 // СТРОГО 1 вступление
        });

        // 2.5 Сохраняем инвайт в БД
        await prisma.invite.create({
            data: {
                inviteLink: link.invite_link,
                userId: user.telegramId
            }
        });

        // 3. Обновляем время последнего запроса
        await prisma.user.update({
            where: { telegramId: user.telegramId },
            data: { lastPrivateLinkAt: new Date() }
        });

        await ctx.reply(`🔒 Вход в закрытый канал:\n${link.invite_link}\n\nСсылка одноразовая и действует 1 час.`);
    } catch (e: any) {
        console.error('Failed to create invite link:', e);
        if (e.description && e.description.includes('chat not found')) {
             await ctx.reply('❌ Ошибка: Бот не видит закрытый канал.\nУбедитесь, что:\n1. Бот добавлен в канал.\n2. Бот является администратором.\n3. ID канала указан верно.');
        } else {
             await ctx.reply(`❌ Ошибка при создании ссылки: ${e.message || 'Неизвестная ошибка'}`);
        }
    }
};
