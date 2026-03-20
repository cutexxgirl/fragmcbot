import { BotContext } from '../../types/context';
import { prisma } from '../../database/prisma';
import { Markup } from 'telegraf';
import { SubscriptionLevel } from '../../config';
import { generateFragmentId } from '../../utils/fragmentId';

const SLOT_LIMITS = {
  [SubscriptionLevel.LEGEND]: 1,
  [SubscriptionLevel.SPARK]: 2,
};

const REQUIRED_CHANNEL_ID = '-1002464218138';

// Главное меню шеринга
export const handleShareAccess = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    const user = await prisma.user.findUnique({
      where: { telegramId: userId },
      include: { sharedByMe: { include: { guest: true } } }
    });

    if (!user || user.status !== 'active' || user.isFrozen) {
      return ctx.answerCbQuery('❌ Доступно только для активных подписчиков');
    }

    const limit = SLOT_LIMITS[user.subscriptionLevel as keyof typeof SLOT_LIMITS] || 0;
    
    if (limit === 0) {
        return ctx.answerCbQuery('❌ Ваш уровень подписки не позволяет делиться доступом');
    }

    const buttons = [];
    
    // Генерируем кнопки для слотов
    for (let i = 0; i < limit; i++) {
        const share = user.sharedByMe[i];
        if (share) {
const beneName = share.guest.fragmentId ? `FID: ${share.guest.fragmentId}` : (share.guest.username ? `@${share.guest.username}` : `ID: ${share.guest.telegramId}`);
            buttons.push([Markup.button.callback(`👤 ${beneName} (Удалить)`, `share_revoke_${share.id}`)]);
        } else {
            buttons.push([Markup.button.callback(`➕ Добавить пользователя (Слот ${i + 1})`, `share_add_${i}`)]);
        }
    }

    buttons.push([Markup.button.callback('◀️ Назад', 'profile_back')]); // Нужно будет добавить обработчик profile_back, который вернет в профиль

    await ctx.reply(
        `🎁 <b>Управление доступом</b>\n\n` +
        `Вы можете поделиться своим доступом с друзьями.\n` +
        `Ваш лимит: <b>${limit} чел.</b>\n` +
        `Доступ предоставляется на весь срок вашей подписки.`, 
        {
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard(buttons)
        }
    );
    
    if (ctx.callbackQuery) await ctx.answerCbQuery();

  } catch (error) {
    console.error('Error in share access handler:', error);
    await ctx.answerCbQuery('❌ Ошибка');
  }
};

// Запрос ID пользователя для добавления
export const handleShareAdd = async (ctx: BotContext) => {
    if (!ctx.match) return;
    // const slotIndex = parseInt(ctx.match[1]); // Пока не используем индекс, просто проверяем лимит
    
    await ctx.reply(
        '👤 <b>Отправьте Fragment ID (FID) пользователя</b>\n\n' +
        'Пользователь должен быть зарегистрирован в боте (нажать /start) и быть подписан на наш новостной канал.',
        { parse_mode: 'HTML' }
    );
    
    ctx.session.awaitingShareUser = true;
    await ctx.answerCbQuery();
};

// Обработка ввода пользователя (текстом)
export const handleShareUserInput = async (ctx: BotContext) => {
    if (!ctx.message || !('text' in ctx.message)) return;
    const input = ctx.message.text.trim().replace('@', '');
    const ownerId = BigInt(ctx.from!.id);

    try {
        // Поиск пользователя
        // Поиск пользователя СТРОГО по Fragment ID
        const beneficiary = await prisma.user.findUnique({
            where: { 
                fragmentId: input.toUpperCase() // Приводим к верхнему регистру, так как FID это обычно буквы
            }
        });
        
        // Если не нашли по уникальному (может быть вводили с кейс-инсенситив, но у нас unique, так что лучше findFirst с mode insensitive, но fragmentId @unique требует точности или findFirst)
        // Чтобы сделать Case Insensitive поиск по Unique полю в Prisma иногда надо использовать findFirst
        /* 
        const beneficiary = await prisma.user.findFirst({
            where: { fragmentId: { equals: input, mode: 'insensitive' } }
        });
        */

        if (!beneficiary) {
            return ctx.reply('❌ Пользователь не найден. Убедитесь, что он запустил бота.');
        }

        if (beneficiary.telegramId === ownerId) {
            return ctx.reply('❌ Нельзя добавить самого себя.');
        }

        if (beneficiary.status === 'active') {
            return ctx.reply('❌ У этого пользователя уже есть активная подписка.');
        }
        
        if (beneficiary.status === 'shared') {
             return ctx.reply('❌ Этому пользователю уже подарили доступ.');
        }

        // Проверка лимитов владельца
        const owner = await prisma.user.findUnique({
             where: { telegramId: ownerId },
             include: { sharedByMe: true }
        });
        
        if (!owner) return;

        const limit = SLOT_LIMITS[owner.subscriptionLevel as keyof typeof SLOT_LIMITS] || 0;
        if (owner.sharedByMe.length >= limit) {
             ctx.session.awaitingShareUser = false;
             return ctx.reply('❌ У вас нет свободных слотов.');
        }

        // Проверка подписки на канал
        try {
            const member = await ctx.telegram.getChatMember(REQUIRED_CHANNEL_ID, Number(beneficiary.telegramId));
            if (['left', 'kicked'].includes(member.status)) {
                ctx.session.awaitingShareUser = false;
                return ctx.reply('❌ Пользователь не подписан на наш канал!');
            }
        } catch (error) {
            console.error('Channel check failed:', error);
            // Если бот не админ или другая ошибка - пока пропускаем или предупреждаем
            // return ctx.reply('❌ Ошибка проверки подписки на канал. Убедитесь, что бот является администратором канала.');
        }

        // Выдача доступа
        let expiryDate: Date;
        if (owner.subscriptionLevel === SubscriptionLevel.LEGEND) {
             // Legend: 14 дней от текущего момента
             expiryDate = new Date();
             expiryDate.setDate(expiryDate.getDate() + 14);
        } else {
             // Spark: до конца подписки владельца
             expiryDate = owner.expiresAtFragment || new Date(); 
        }
        
        // Создаем связь
        await prisma.sharedAccess.create({
            data: {
                ownerId: ownerId,
                guestId: beneficiary.telegramId,
                expiresAt: expiryDate
            }
        });

        // Обновляем пользователя
        await prisma.user.update({
            where: { telegramId: beneficiary.telegramId },
            data: {
                status: 'shared',
                giftedById: ownerId,
                expiresAtExtra: expiryDate, 
                expiresAtFragment: expiryDate
            }
        });
        
        ctx.session.awaitingShareUser = false;
        await ctx.reply(`✅ Доступ успешно выдан пользователю @${beneficiary.username || beneficiary.telegramId}!`);

        // Уведомляем получателя
        try {
            await ctx.telegram.sendMessage(
                Number(beneficiary.telegramId), 
                `🎁 <b>Вам подарили доступ!</b>\n\nПользователь с FID <code>${owner.fragmentId || 'Hidden'}</code> поделился с вами подпиской Fragment.\nНажмите /start для обновления.`,
                { parse_mode: 'HTML' }
            );
        } catch (e) { console.error('Failed to notify beneficiary', e); }

        // Возвращаемся в меню
        await handleShareAccess(ctx);

    } catch (error) {
        console.error('Error adding share user:', error);
        ctx.reply('❌ Произошла ошибка при добавлении пользователя.');
    }
};

// Отзыв доступа
export const handleShareRevoke = async (ctx: BotContext) => {
    if (!ctx.match) return;
    const shareId = parseInt(ctx.match[1]);
    
    try {
        const share = await prisma.sharedAccess.findUnique({
            where: { id: shareId },
            include: { guest: true }
        });
        
        if (!share) return ctx.answerCbQuery('❌ Запись не найдена');
        
        // Удаляем связь
        await prisma.sharedAccess.delete({ where: { id: shareId } });
        
        // Сбрасываем статус пользователя
        await prisma.user.update({
            where: { telegramId: share.guestId },
            data: {
                status: 'inactive',
                giftedById: null,
                expiresAtExtra: null,
                expiresAtFragment: null
            }
        });
        
        await ctx.answerCbQuery('✅ Доступ отозван');
        await handleShareAccess(ctx); // Обновляем меню

        // Уведомляем
        try {
             await ctx.telegram.sendMessage(Number(share.guestId), '❌ Ваш подарочный доступ был отозван.');
        } catch (e) {}

    } catch (error) {
        console.error('Error revoking share:', error);
        ctx.answerCbQuery('❌ Ошибка');
    }
};
