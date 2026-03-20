import { prisma } from '../../database/prisma';
import { bot } from '../../bot';
import { config, SubscriptionLevel, UserStatus } from '../../config';
import { Markup } from 'telegraf';
import { logEvent } from '../statistics/logger';
import { BotContext } from '../../types/context';
import { Update } from 'telegraf/types';
import { SubscriptionManager } from '../subscription/manager';

function escapeHtml(text: string): string {
  const htmlEntities: { [key: string]: string } = {
    '<': '&lt;',
    '>': '&gt;',
    '&': '&amp;',
    '"': '&quot;',
    "'": '&#39;'
  };
  
  return text.replace(/[<>&"']/g, char => htmlEntities[char]);
}

export class PromoSystem {
  
  static async createPromoRequest(
    userId: bigint,
    username: string | undefined,
    message: string,
    photoIds: string[]
  ): Promise<{ success: boolean; requestId?: number; message: string }> {
    try {
      const existingRequest = await prisma.promoRequest.findFirst({
        where: { userId, status: 'pending' },
      });

      if (existingRequest) {
        return {
          success: false,
          message: 'У вас уже есть активная заявка на акцию',
        };
      }

      const user = await prisma.user.findUnique({
        where: { telegramId: userId },
      });

      if (user?.status === UserStatus.ACTIVE) {
        return {
          success: false,
          message: 'У вас уже есть активная подписка',
        };
      }

      let isSubscribedToChannel = false;
      try {
        const member = await bot.telegram.getChatMember(String(config.channel.main), Number(userId));
        isSubscribedToChannel = ['member', 'administrator', 'creator'].includes(member.status);
      } catch (error) {
        console.log(`[Promo] Could not check channel subscription for ${userId}:`, error);
      }

      const request = await prisma.promoRequest.create({
        data: { 
          userId, 
          username, 
          message, 
          photoUrl: photoIds[0],
          status: 'pending' 
        },
      });

      await logEvent('promo_click', userId, { requestId: request.id });

      const escapedMessage = escapeHtml(message);
      const escapedUsername = username ? escapeHtml(username) : 'Нет username';
      const subscriptionStatus = isSubscribedToChannel 
        ? '✅ Подписан на канал (+2 дня бонус)'
        : '❌ Не подписан на канал';

      const messageText = `
🎁 <b>НОВАЯ ЗАЯВКА НА АКЦИЮ #${request.id}</b>

👤 <b>Пользователь:</b> @${escapedUsername}
🆔 <b>ID:</b> <code>${userId}</code>
📢 <b>Канал:</b> ${subscriptionStatus}

💬 <b>Сообщение:</b>
${escapedMessage}
      `.trim();

      const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('✅ Выдать доступ', `promo_grant_${request.id}`)],
        [Markup.button.callback('❌ Отклонить', `promo_reject_${request.id}`)],
      ]);

      if (photoIds.length === 0) {
        await bot.telegram.sendMessage(Number(config.bot.adminId), messageText, {
          parse_mode: 'HTML',
          ...keyboard,
        });
      } else if (photoIds.length === 1) {
        await bot.telegram.sendPhoto(Number(config.bot.adminId), photoIds[0], {
          caption: messageText,
          parse_mode: 'HTML',
          ...keyboard,
        });
      } else {
        const mediaGroup = photoIds.map((photoId, index) => ({
          type: 'photo' as const,
          media: photoId,
          caption: index === 0 ? messageText : undefined,
          parse_mode: index === 0 ? 'HTML' as const : undefined,
        }));

        await bot.telegram.sendMediaGroup(Number(config.bot.adminId), mediaGroup);
        
        await bot.telegram.sendMessage(
          Number(config.bot.adminId), 
          `📎 Управление заявкой #${request.id}:`,
          keyboard
        );
      }

      const replyMessage = isSubscribedToChannel
        ? `✅ Заявка #${request.id} отправлена!\n\n🎁 Спасибо за подписку на канал! Вы получите +2 дня бонусом.`
        : `✅ Заявка #${request.id} отправлена!\n\n💡 Подсказка: подпишитесь на канал @fragmcru и получите +2 дня бонусом при следующей заявке!`;

      return { success: true, requestId: request.id, message: replyMessage };

    } catch (error) {
      console.error('Error creating promo request:', error);
      return { success: false, message: 'Ошибка при создании заявки' };
    }
  }

  static async showGrantAccessMenu(ctx: BotContext, requestId: number) {
    const request = await prisma.promoRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      return ctx.answerCbQuery('❌ Заявка не найдена');
    }
    if (request.status !== 'pending') {
      return ctx.answerCbQuery('❌ Заявка уже обработана');
    }

    if (ctx.callbackQuery) {
      try { await ctx.deleteMessage(); } catch (e) {}
    }

    if (!ctx.session.promoSelection || ctx.session.promoSelection.requestId !== requestId) {
      ctx.session.promoSelection = { requestId, accesses: [] };
    }

    const selection = ctx.session.promoSelection;
    const selectedText = selection.accesses.length > 0
      ? `\n\n✅ <b>Выбрано:</b>\n${selection.accesses.map((a: any) => `• ${a.type} - ${a.days} дн.`).join('\n')}`
      : '\n\n❌ Ничего не выбрано';
      
    const messageText = `🎁 <b>НОВАЯ ЗАЯВКА НА АКЦИЮ #${requestId}</b>\n\n` +
                        `👤 <b>Пользователь:</b> @${request.username || 'unknown'}\n` +
                        `🆔 <b>ID:</b> <code>${request.userId}</code>\n\n` +
                        `💬 <b>Сообщение:</b>\n${request.message || ''}\n` +
                        `${selectedText}`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('🎮 Fragment', `promo_select_${requestId}_fragment`)],
      [Markup.button.callback('📦 Доп. сборки', `promo_select_${requestId}_extra`)],
      [Markup.button.callback('✅ ПОДТВЕРДИТЬ', `promo_confirm_${requestId}`)],
      [Markup.button.callback('🗑️ Очистить', `promo_clear_${requestId}`)],
      [Markup.button.callback('❌ Отмена', `promo_reject_${requestId}`)],
    ]);

    await ctx.reply(messageText, { parse_mode: 'HTML', ...keyboard });
    
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery();
    }
  }

  static async selectAccessType(ctx: BotContext, requestId: number, accessType: string) {
    const keyboard = Markup.inlineKeyboard([
      [
        Markup.button.callback('1 день', `promo_add_${requestId}_${accessType}_1`),
        Markup.button.callback('7 дней', `promo_add_${requestId}_${accessType}_7`),
      ],
      [
        Markup.button.callback('10 дней', `promo_add_${requestId}_${accessType}_10`),
        Markup.button.callback('14 дней', `promo_add_${requestId}_${accessType}_14`),
      ],
      [
        Markup.button.callback('30 дней', `promo_add_${requestId}_${accessType}_30`),
        Markup.button.callback('Свой срок ✏️', `promo_custom_${requestId}_${accessType}`),
      ],
      [Markup.button.callback('◀️ Назад', `promo_grant_${requestId}`)],
    ]);

    await ctx.editMessageReplyMarkup(keyboard.reply_markup);
    await ctx.answerCbQuery(`Выберите срок для ${accessType}`);
  }

  static async requestCustomDuration(ctx: BotContext, requestId: number, accessType: string) {
    const update = ctx.update as Update.CallbackQueryUpdate;
    const originalMessage = update.callback_query.message;

    if (!originalMessage) {
      return ctx.answerCbQuery('❌ Ошибка: не найдено исходное сообщение');
    }

    const baseText = ('caption' in originalMessage) ? originalMessage.caption : ('text' in originalMessage ? originalMessage.text : '');
    const newText = (baseText || '').split('\n\n<b>Введите')[0] + 
                    '\n\n<b>Введите срок доступа:</b>\n' +
                    '<code>45</code> - 45 дней\n' +
                    '<code>10s</code> - 10 секунд\n' +
                    '<code>5m</code> - 5 минут\n' +
                    '<code>2h</code> - 2 часа';
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('◀️ Назад', `promo_select_${requestId}_${accessType}`)]
    ]);

    try {
      await ctx.editMessageText(newText, { parse_mode: 'HTML', ...keyboard });
    } catch (e) {}

    ctx.session.awaitingPromoCustomDays = { requestId, accessType };
    await ctx.answerCbQuery();
  }

  static async addToSelection(ctx: BotContext, requestId: number, accessType: string, days: number) {
    if (!ctx.session.promoSelection || ctx.session.promoSelection.requestId !== requestId) {
      ctx.session.promoSelection = { requestId, accesses: [] };
    }

    const existing = ctx.session.promoSelection.accesses.findIndex((a) => a.type === accessType);
    
    if (existing !== -1) {
      ctx.session.promoSelection.accesses[existing].days = days;
    } else {
      ctx.session.promoSelection.accesses.push({ type: accessType, days });
    }

    if (ctx.callbackQuery) {
      await ctx.answerCbQuery(`✅ ${accessType} (${days} дн.) добавлено`);
    } else {
      await ctx.reply(`✅ Добавлено: ${accessType} на ${days} дн.`);
    }

    await PromoSystem.showGrantAccessMenu(ctx, requestId);
  }

  static async clearSelection(ctx: BotContext, requestId: number) {
    if (!ctx.session.promoSelection) {
      ctx.session.promoSelection = { requestId, accesses: [] };
    }
    ctx.session.promoSelection.accesses = [];
    await ctx.answerCbQuery('🗑️ Выбор очищен');
    await PromoSystem.showGrantAccessMenu(ctx, requestId);
  }

  static async confirmAndGrant(ctx: BotContext, requestId: number, adminId: bigint) {
    const selection = ctx.session.promoSelection;

    if (!selection || selection.accesses.length === 0) {
      await ctx.answerCbQuery('❌ Ничего не выбрано');
      return;
    }

    await ctx.editMessageText(
      `💰 Введите сумму доната (в рублях):\n\n` +
      `Например: \`500\`\n\n` +
      `Или отправьте \`0\` если донат неизвестен`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'admin_back')]])
      }
    );

    ctx.session.awaitingPromoDonation = { requestId, adminId };
  }

  static async handleDonationInput(ctx: BotContext) {
    if (!ctx.session.awaitingPromoDonation) return;
    if (!ctx.message || !('text' in ctx.message)) return;

    const { requestId, adminId } = ctx.session.awaitingPromoDonation;
    const amount = parseInt(ctx.message.text.trim(), 10);

    if (isNaN(amount) || amount < 0) {
      await ctx.reply('❌ Введите корректную сумму (число >= 0)');
      return;
    }

    ctx.session.awaitingPromoDonation = undefined;

    await prisma.promoRequest.update({
      where: { id: requestId },
      data: { donationAmount: amount },
    });

    await ctx.reply(`✅ Сумма ${amount} ₽ сохранена. Продолжаю выдачу доступа...`);

    await this.grantAccessAfterDonation(ctx, requestId, adminId);
  }

  private static async grantAccessAfterDonation(ctx: BotContext, requestId: number, adminId: bigint) {
    const selection = ctx.session.promoSelection!;
    
    const request = await prisma.promoRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.status !== 'pending') {
      await ctx.reply('❌ Заявка не найдена или уже обработана');
      return;
    }

    // Обрабатываем каждый тип доступа
    for (const access of selection.accesses) {
      const days = access.days;

      switch (access.type) {
        case 'fragment':
          const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);

          await prisma.user.update({
            where: { telegramId: request.userId },
            data: {
              status: UserStatus.ACTIVE,
              subscriptionLevel: SubscriptionLevel.NOVICE,
              expiresAtFragment: expiresAt,
              hasPromoAccess: false,
              donationAmount: request.donationAmount, // ← Копируем сумму доната
            },
          });

          // Создаем задачу БЕЗ groupId
          await prisma.scheduledTask.create({
            data: {
              userId: request.userId,
              taskType: 'remove_from_group',
              groupId: null, // ← Убрали привязку к группе
              scheduledFor: expiresAt,
            },
          });

          console.log(`[Promo] Granted Fragment access to ${request.userId} for ${days} days`);
          break;

        case 'extra':
          // Доп. сборки через expiresAtExtra
          const extraExpiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
          await prisma.user.update({
            where: { telegramId: request.userId },
            data: { expiresAtExtra: extraExpiresAt },
          });
          console.log(`[Promo] Granted extra builds access to ${request.userId} for ${days} days`);
          break;
      }
    }

    await prisma.promoRequest.update({
      where: { id: requestId },
      data: {
        status: 'approved',
        processedAt: new Date(),
        processedBy: adminId,
      },
    });

    await logEvent('promo_approved', request.userId, { requestId });

    const accessList = selection.accesses.map((a: any) => `• ${a.type} (${a.days} дн.)`).join('\n');
    
    try {
      // Убрали всю логику про группы и ссылки
      const finalMessage = `✅ Ваша заявка на акцию одобрена!\n\n<b>Выданные доступы:</b>\n${accessList}\n\n📱 Пропишите /start для активации доступа.`;

      const updatedUser = await prisma.user.findUnique({
        where: { telegramId: request.userId },
      });

      if (updatedUser) {
        const { isAdmin } = await import('../../utils/permissions');
        const userIsAdmin = await isAdmin(request.userId);
        const { mainKeyboard } = await import('../../bot/keyboards/main');

        await bot.telegram.sendMessage(
          Number(request.userId),
          finalMessage,
          {
            parse_mode: 'HTML',
            ...mainKeyboard(updatedUser, userIsAdmin),
          }
        );
      }
    } catch (error) {
      console.error('Cannot notify user:', error);
    }

    ctx.session.promoSelection = undefined;
    
    const donationInfo = request.donationAmount 
      ? `\n💰 Сумма доната: ${request.donationAmount} ₽` 
      : '';
    
    await ctx.reply(`✅ Доступы выданы успешно!${donationInfo}`);
  }

  static async rejectRequest(requestId: number, adminId: bigint) {
    const request = await prisma.promoRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.status !== 'pending') {
      return { success: false, message: 'Заявка не найдена или уже обработана' };
    }

    await prisma.promoRequest.update({
      where: { id: requestId },
      data: {
        status: 'rejected',
        processedAt: new Date(),
        processedBy: adminId,
      },
    });

    await logEvent('promo_rejected', request.userId, { requestId });

    try {
      await bot.telegram.sendMessage(
        Number(request.userId),
        '❌ Ваша заявка на акцию отклонена.'
      );
    } catch (error) {
      console.log('Cannot notify user');
    }

    return { success: true, message: 'Заявка отклонена' };
  }
}