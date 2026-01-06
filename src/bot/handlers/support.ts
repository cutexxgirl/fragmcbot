import { BotContext } from '../../types/context';
import { SupportSystem } from '../../modules/support';
import { Markup } from 'telegraf';
import { isAdmin } from '../../utils/permissions';
import { prisma } from '../../database/prisma';

export const supportHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    const userIsAdmin = await isAdmin(userId);
    
    // Получаем данные пользователя для проверки hasPromoAccess
    const user = await prisma.user.findUnique({
      where: { telegramId: userId },
    });

    const activeTicket = await SupportSystem.getUserActiveTicket(userId);

    if (activeTicket) {
      const buttons: string[][] = [
        ['❌ Закрыть тикет'],
        ['👤 Профиль', '🆘 Поддержка'],
      ];
      
      if (user?.hasPromoAccess) {
        buttons.push(['🎁 Акция']);
      }
      
      if (userIsAdmin) {
        buttons.push(['⚙️ Админ-панель']);
      }

      await ctx.reply(
        `У вас уже есть открытый тикет #${activeTicket.id}\n\n` +
        `Отправьте сообщение, и оно будет переслано в поддержку.`,
        Markup.keyboard(buttons).resize()
      );
      
      ctx.session.activeTicketId = activeTicket.id;
      return;
    }

    await ctx.reply(
      '🆘 **Техническая поддержка**\n\n' +
      'Опишите вашу проблему или задайте вопрос.\n' +
      'Вы можете отправить текст, фото, видео или GIF.',
      { 
        parse_mode: 'Markdown',
        reply_markup: {
          force_reply: true,
        }
      }
    );

    ctx.session.awaitingTicketMessage = true;

  } catch (error) {
    console.error('Error in support handler:', error);
    await ctx.reply('❌ Произошла ошибка. Попробуйте позже.');
  }
};

export const closeTicketHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    const userIsAdmin = await isAdmin(userId);
    
    const user = await prisma.user.findUnique({
      where: { telegramId: userId },
    });

    if (!ctx.session.activeTicketId) {
      await ctx.reply('У вас нет открытых тикетов.');
      return;
    }

    const result = await SupportSystem.closeTicket(ctx.session.activeTicketId, userId);

    if (result.success) {
      ctx.session.activeTicketId = undefined;
      
      const buttons: string[][] = [
        ['👤 Профиль', '🆘 Поддержка'],
      ];
      
      if (user?.hasPromoAccess) {
        buttons.push(['🎁 Акция']);
      }
      
      if (userIsAdmin) {
        buttons.push(['⚙️ Админ-панель']);
      }

      await ctx.reply(
        '✅ Тикет закрыт. Спасибо за обращение!',
        Markup.keyboard(buttons).resize()
      );
    } else {
      await ctx.reply(`❌ ${result.message}`);
    }

  } catch (error) {
    console.error('Error closing ticket:', error);
    await ctx.reply('❌ Произошла ошибка при закрытии тикета.');
  }
};

export const handleTicketMessage = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    const username = ctx.from!.username;
    const userIsAdmin = await isAdmin(userId);
    
    const user = await prisma.user.findUnique({
      where: { telegramId: userId },
    });
    
    if (!ctx.message) return;

    if (ctx.session.awaitingTicketMessage) {
      // Передаем полный объект сообщения
      const result = await SupportSystem.createTicket(userId, username, ctx.message);

      if (result.success) {
        ctx.session.awaitingTicketMessage = false;
        ctx.session.activeTicketId = result.ticketId;
        
        const buttons: string[][] = [
          ['❌ Закрыть тикет'],
          ['👤 Профиль', '🆘 Поддержка'],
        ];
        
        if (user?.hasPromoAccess) {
          buttons.push(['🎁 Акция']);
        }
        
        if (userIsAdmin) {
          buttons.push(['⚙️ Админ-панель']);
        }

        await ctx.reply(
          `✅ Тикет #${result.ticketId} создан!\n\n` +
          `Ожидайте ответа от службы поддержки.\n` +
          `Вы можете продолжить писать сообщения, они будут пересланы.`,
          Markup.keyboard(buttons).resize()
        );
      } else {
        await ctx.reply(`❌ ${result.message}`);
      }
      return;
    }

    if (ctx.session.activeTicketId) {
      // Передаем полный объект сообщения
      const result = await SupportSystem.sendMessage(
        ctx.session.activeTicketId,
        userId,
        ctx.message
      );

      if (result.success) {
        await ctx.reply('✅ Сообщение отправлено в поддержку');
      } else {
        await ctx.reply(`❌ ${result.message}`);
        if (result.message === 'Тикет закрыт') {
          ctx.session.activeTicketId = undefined;
        }
      }
    }

  } catch (error) {
    console.error('Error handling ticket message:', error);
    await ctx.reply('❌ Произошла ошибка при отправке сообщения.');
  }
};