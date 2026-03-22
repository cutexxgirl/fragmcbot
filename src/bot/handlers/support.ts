import { Markup } from 'telegraf';
import { SupportSystem } from '../../modules/support';
import { BotContext } from '../../types/context';
import { isAdmin } from '../../utils/permissions';

const SUPPORT_INTRO_TEXT = [
  '🆘 <b>Техническая поддержка</b>',
  '',
  'Пишем сюда только по:',
  '• лаунчеру',
  '• сайту',
  '• боту',
  '• чистой сборке Fragment без ваших модов, шейдеров и правок',
  '',
  'Не пишем сюда по:',
  '• локальной игре с друзьями',
  '• серверной версии сборки — её сейчас нет',
  '• вашим модам, шейдерам, конфигам и любым правкам сборки',
  '• проблемам ПК, Windows, драйверов, Java и прочему на стороне пользователя',
  '',
  'Новый тикет по той же причине после ответа или закрытия = бан.',
  'Проект ведёт один человек. Если я не отвечаю, значит я сплю.',
  '',
  'Опишите проблему одним сообщением. Можно отправить текст, фото, видео или GIF.',
].join('\n');

const buildSupportKeyboard = (userIsAdmin: boolean, withCloseTicket = false) => {
  const buttons: string[][] = [['👤 Профиль', '🆘 Поддержка']];

  if (withCloseTicket) {
    buttons.unshift(['❌ Закрыть тикет']);
  }

  if (userIsAdmin) {
    buttons.push(['⚙️ Админ-панель']);
  }

  return Markup.keyboard(buttons).resize();
};

export const supportHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    const userIsAdmin = await isAdmin(userId);
    const activeTicket = await SupportSystem.getUserActiveTicket(userId);

    if (activeTicket) {
      await ctx.reply(
        `У вас уже открыт тикет #${activeTicket.id}.\n\nПишите в него. Новый тикет по той же причине не нужен.`,
        buildSupportKeyboard(userIsAdmin, true)
      );

      ctx.session.activeTicketId = activeTicket.id;
      return;
    }

    await ctx.reply(SUPPORT_INTRO_TEXT, {
      parse_mode: 'HTML',
      reply_markup: {
        force_reply: true,
      },
    });

    ctx.session.awaitingTicketMessage = true;
  } catch (error) {
    console.error('Error in support handler:', error);
    await ctx.reply('❌ Ошибка. Попробуйте позже.');
  }
};

export const closeTicketHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    const userIsAdmin = await isAdmin(userId);

    if (!ctx.session.activeTicketId) {
      await ctx.reply('У вас нет открытых тикетов.');
      return;
    }

    const result = await SupportSystem.closeTicket(ctx.session.activeTicketId, userId);

    if (result.success) {
      ctx.session.activeTicketId = undefined;

      await ctx.reply(
        '✅ Тикет закрыт.\n\nЕсли проблема новая и другая — откройте новый тикет.\nНовый тикет по той же причине = бан.',
        buildSupportKeyboard(userIsAdmin)
      );
    } else {
      await ctx.reply(`❌ ${result.message}`);
    }
  } catch (error) {
    console.error('Error closing ticket:', error);
    await ctx.reply('❌ Ошибка при закрытии тикета.');
  }
};

export const handleTicketMessage = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    const username = ctx.from!.username;
    const userIsAdmin = await isAdmin(userId);

    if (!ctx.message) return;

    if (ctx.session.awaitingTicketMessage) {
      const result = await SupportSystem.createTicket(userId, username, ctx.message);

      if (result.success) {
        ctx.session.awaitingTicketMessage = false;
        ctx.session.activeTicketId = result.ticketId;

        await ctx.reply(
          `✅ Тикет #${result.ticketId} создан.\n\nДальше пишите сюда только по этой проблеме.\nНовый тикет по той же причине = бан.`,
          buildSupportKeyboard(userIsAdmin, true)
        );
      } else {
        if ((result as { banned?: boolean }).banned) {
          ctx.session.awaitingTicketMessage = false;
          ctx.session.activeTicketId = undefined;
        }

        await ctx.reply(`❌ ${result.message}`);
      }
      return;
    }

    if (ctx.session.activeTicketId) {
      const result = await SupportSystem.sendMessage(
        ctx.session.activeTicketId,
        userId,
        ctx.message
      );

      if (result.success) {
        await ctx.reply('✅ Сообщение отправлено в поддержку.');
      } else {
        await ctx.reply(`❌ ${result.message}`);
        if (result.message === 'Тикет закрыт') {
          ctx.session.activeTicketId = undefined;
        }
      }
    }
  } catch (error) {
    console.error('Error handling ticket message:', error);
    await ctx.reply('❌ Ошибка при отправке сообщения.');
  }
};
