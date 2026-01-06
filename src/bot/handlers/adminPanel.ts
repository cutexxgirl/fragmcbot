import { BotContext } from '../../types/context';
import { isAdmin } from '../../utils/permissions';
import { Markup } from 'telegraf';
import { SupportAgentManager } from '../../modules/admin/supportAgentManager';
import { prisma } from '../../database/prisma';
import { config } from '../../config';
import { BuildManager } from '../../modules/builds/manager';

export const showAdminPanel = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('👤 Управление пользователями', 'admin_user_management'),
      Markup.button.callback('👥 Управление агентами', 'admin_agents'),
    ],
    [
      Markup.button.callback('📊 Статистика', 'admin_stats'),
      Markup.button.callback('🎫 Управление тикетами', 'admin_tickets'),
    ],
    [
      Markup.button.callback('✅ Проверить подписки', 'admin_check_subs'),
      Markup.button.callback('📦 Управление сборками', 'admin_builds_menu'),
    ],
    [
      Markup.button.callback('🗑️ Очистка данных', 'admin_cleanup_menu'),
    ],
  ]);

  // Добавляем кнопку Супер-админ только для главного админа
  if (userId === config.bot.adminId) {
    keyboard.reply_markup.inline_keyboard.push([
      Markup.button.callback('⚙️ Супер-Админ', 'admin_superadmin_menu')
    ]);
  }

  const message = '⚙️ **Админ-панель**\n\nВыберите раздел:';

  if (ctx.callbackQuery) {
    try {
      await ctx.editMessageText(message, {
        parse_mode: 'Markdown',
        ...keyboard,
      });
    } catch (e) { /* Игнорируем */ }
  } else {
    await ctx.reply(message, {
      parse_mode: 'Markdown',
      ...keyboard,
    });
  }
};

// Управление агентами
export const showAgentsMenu = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('➕ Добавить агента', 'admin_add_agent')],
    [Markup.button.callback('➖ Удалить агента', 'admin_remove_agent')],
    [Markup.button.callback('📋 Список агентов', 'admin_list_agents')],
    [Markup.button.callback('◀️ Назад', 'admin_back')],
  ]);

  await ctx.editMessageText(
    '👥 **Управление агентами**\n\nВыберите действие:',
    {
      parse_mode: 'Markdown',
      ...keyboard,
    }
  );
};

// Статистика
// Главное меню статистики
export const showStatsMenu = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('📊 Общая статистика', 'admin_general_stats')],
    [Markup.button.callback('👤 Статистика агентов', 'admin_agent_stats')],
    [Markup.button.callback('◀️ Назад', 'admin_back')],
  ]);

  await ctx.editMessageText(
    '📊 **Статистика**\n\nВыберите раздел:',
    {
      parse_mode: 'Markdown',
      ...keyboard,
    }
  );
};

// Меню выбора периода для общей статистики
export const showGeneralStatsMenu = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('📅 За день', 'general_stats_day'),
      Markup.button.callback('📅 За неделю', 'general_stats_week'),
    ],
    [
      Markup.button.callback('📅 За месяц', 'general_stats_month'),
      Markup.button.callback('📅 Всё время', 'general_stats_all'),
    ],
    [Markup.button.callback('🗓 Свой период', 'general_stats_custom')],
    [Markup.button.callback('◀️ Назад', 'admin_stats')],
  ]);

  await ctx.editMessageText(
    '📊 **Общая статистика**\n\nВыберите период:',
    {
      parse_mode: 'Markdown',
      ...keyboard,
    }
  );
};

// Показать общую статистику за период
export const showGeneralStatsForPeriod = async (ctx: BotContext, period: 'day' | 'week' | 'month' | 'all') => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  await ctx.editMessageText('⏳ Собираю статистику...', { parse_mode: 'Markdown' });

  const { Analytics } = await import('../../modules/statistics/analytics');
  
  const stats = await Analytics.getGeneralStats(period);
  
  const periodNames = {
    day: 'за 24 часа',
    week: 'за неделю',
    month: 'за месяц',
    all: 'за всё время',
  };

  const message = Analytics.formatGeneralStats(stats, periodNames[period]);

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('◀️ Назад', 'admin_general_stats')],
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard,
  });
};

// Запрос кастомного периода
export const requestCustomPeriod = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  await ctx.editMessageText(
    '🗓 **Свой период**\n\n' +
    'Отправьте даты в формате:\n' +
    '`01.01.2024-31.01.2024`\n\n' +
    'Или отправьте /start для отмены',
    { 
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'admin_general_stats')]])
    }
  );

  ctx.session.awaitingCustomStatsPeriod = true;
};

// Обработка ввода кастомного периода
export const handleCustomPeriodInput = async (ctx: BotContext) => {
  if (!ctx.session.awaitingCustomStatsPeriod) return;
  if (!ctx.message || !('text' in ctx.message)) return;

  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const input = ctx.message.text.trim();
  
  // Парсим даты в формате "01.01.2024-31.01.2024"
  const match = input.match(/^(\d{2})\.(\d{2})\.(\d{4})-(\d{2})\.(\d{2})\.(\d{4})$/);
  
  if (!match) {
    await ctx.reply(
      '❌ Неверный формат. Используйте:\n`01.01.2024-31.01.2024`',
      { parse_mode: 'Markdown' }
    );
    return;
  }

  const [_, d1, m1, y1, d2, m2, y2] = match;
  
  const startDate = new Date(parseInt(y1), parseInt(m1) - 1, parseInt(d1));
  const endDate = new Date(parseInt(y2), parseInt(m2) - 1, parseInt(d2), 23, 59, 59);

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    await ctx.reply('❌ Некорректные даты. Проверьте правильность ввода.');
    return;
  }

  if (startDate > endDate) {
    await ctx.reply('❌ Начальная дата не может быть позже конечной.');
    return;
  }

  ctx.session.awaitingCustomStatsPeriod = false;

  const loadingMsg = await ctx.reply('⏳ Собираю статистику...');

  const { Analytics } = await import('../../modules/statistics/analytics');
  
  const stats = await Analytics.getGeneralStats('custom', startDate, endDate);
  
  const periodText = `${d1}.${m1}.${y1} - ${d2}.${m2}.${y2}`;
  const message = Analytics.formatGeneralStats(stats, periodText);

  await ctx.reply(message, { parse_mode: 'Markdown' });
  
  try {
    await ctx.telegram.deleteMessage(loadingMsg.chat.id, loadingMsg.message_id);
  } catch {}
};

// Управление тикетами
export const showTicketsMenu = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑️ Удалить все тикеты', 'admin_delete_all_tickets')],
    [Markup.button.callback('🔄 Сбросить счётчик', 'admin_reset_ticket_counter')],
    [Markup.button.callback('◀️ Назад', 'admin_back')],
  ]);

  await ctx.editMessageText(
    '🎫 **Управление тикетами**\n\n⚠️ Внимание: удаление необратимо!',
    {
      parse_mode: 'Markdown',
      ...keyboard,
    }
  );
};

// Добавить агента - запрашиваем ID
export const requestAgentId = async (ctx: BotContext, action: 'add' | 'remove' | 'stats') => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const actionText = action === 'add' ? 'добавления' : action === 'remove' ? 'удаления' : 'статистики';
  
  await ctx.editMessageText(
    `Отправьте Telegram ID пользователя для ${actionText}:\n\n` +
    `Формат: просто число, например: \`1256563025\`\n\n` +
    `Для отмены отправьте /start`,
    { parse_mode: 'Markdown' }
  );

  ctx.session.awaitingAgentAction = action;
};

// Список агентов
export const showAgentsList = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const message = await SupportAgentManager.listAgents();
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('◀️ Назад', 'admin_agents')],
  ]);

  await ctx.editMessageText(message, {
    parse_mode: 'Markdown',
    ...keyboard,
  });
};

// Показать общую статистику
export const showGeneralStats = async (ctx: BotContext, period: 'day' | 'week' | 'month') => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const stats = await SupportAgentManager.getAllAgentsStats(period);
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('◀️ Назад', 'admin_stats')],
  ]);

  await ctx.editMessageText(stats, {
    parse_mode: 'Markdown',
    ...keyboard,
  });
};

// Удалить все тикеты
export const deleteAllTickets = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Да, удалить', 'admin_confirm_delete_tickets'),
      Markup.button.callback('❌ Отмена', 'admin_tickets'),
    ],
  ]);

  await ctx.editMessageText(
    '⚠️ **Подтверждение удаления**\n\n' +
    'Вы уверены, что хотите удалить ВСЕ тикеты?\n' +
    'Это действие необратимо!',
    {
      parse_mode: 'Markdown',
      ...keyboard,
    }
  );
};

// Подтверждение удаления тикетов
export const confirmDeleteTickets = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  try {
    await prisma.ticketMessage.deleteMany({});
    const result = await prisma.supportTicket.deleteMany({});

    await ctx.editMessageText(
      `✅ Удалено ${result.count} тикетов`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Назад', 'admin_tickets')],
        ]),
      }
    );
  } catch (error) {
    console.error('Error deleting tickets:', error);
    await ctx.editMessageText('❌ Ошибка при удалении тикетов');
  }
};

// Сброс счётчика тикетов
export const resetTicketCounter = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Да, сбросить', 'admin_confirm_reset_counter'),
      Markup.button.callback('❌ Отмена', 'admin_tickets'),
    ],
  ]);

  await ctx.editMessageText(
    '⚠️ **Подтверждение сброса**\n\n' +
    'Вы уверены, что хотите сбросить счётчик тикетов?\n' +
    'Следующий тикет будет иметь ID = 1',
    {
      parse_mode: 'Markdown',
      ...keyboard,
    }
  );
};

// Подтверждение сброса счётчика
export const confirmResetCounter = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  try {
    await prisma.ticketMessage.deleteMany({});
    await prisma.supportTicket.deleteMany({});
    await prisma.$executeRaw`ALTER SEQUENCE support_tickets_id_seq RESTART WITH 1`;

    await ctx.editMessageText(
      '✅ Счётчик тикетов сброшен!\nСледующий тикет будет иметь ID = 1',
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Назад', 'admin_tickets')],
        ]),
      }
    );
  } catch (error) {
    console.error('Error resetting counter:', error);
    await ctx.editMessageText('❌ Ошибка при сбросе счётчика');
  }
};

// Проверка подписок
export const checkSubscriptions = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  await ctx.editMessageText('🔄 Запускаю проверку подписок...', { parse_mode: 'Markdown' });

  const { checkAllSubscriptions } = await import('../../services/cron/index');
  await checkAllSubscriptions();

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('◀️ Назад', 'admin_back')],
  ]);

  await ctx.editMessageText('✅ Проверка подписок завершена!', {
    parse_mode: 'Markdown',
    ...keyboard,
  });
};

// Статистика конкретного агента
export const showSpecificAgentStats = async (ctx: BotContext, agentId: bigint, period: 'day' | 'week' | 'month') => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const stats = await SupportAgentManager.getAgentStats(agentId, period);
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('◀️ Назад', 'admin_stats')],
  ]);

  await ctx.editMessageText(stats, {
    parse_mode: 'Markdown',
    ...keyboard,
  });
};

// Меню очистки данных
export const showDataCleanupMenu = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('🗑️ Очистить всё', 'admin_cleanup_all')],
    [Markup.button.callback('🎫 Только тикеты', 'admin_cleanup_tickets')],
    [Markup.button.callback('📊 Только статистику', 'admin_cleanup_stats')],
    [Markup.button.callback('🎁 Только промо-заявки', 'admin_cleanup_promo')],
    [Markup.button.callback('◀️ Назад', 'admin_back')],
  ]);

  await ctx.editMessageText(
    '⚠️ **Очистка данных**\n\nВыберите что удалить:',
    {
      parse_mode: 'Markdown',
      ...keyboard,
    }
  );
};

// Подтверждение полной очистки
export const confirmCleanupAll = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  const keyboard = Markup.inlineKeyboard([
    [
      Markup.button.callback('✅ Да, удалить ВСЁ', 'admin_execute_cleanup_all'),
      Markup.button.callback('❌ Отмена', 'admin_cleanup_menu'),
    ],
  ]);

  await ctx.editMessageText(
    '⚠️ **ВНИМАНИЕ!**\n\n' +
    'Будут удалены:\n' +
    '• Все тикеты и сообщения\n' +
    '• Вся статистика\n' +
    '• Все промо-заявки\n' +
    '• Все запланированные задачи\n\n' +
    '**Пользователи НЕ будут удалены!**\n\n' +
    'Это действие НЕОБРАТИМО!',
    {
      parse_mode: 'Markdown',
      ...keyboard,
    }
  );
};

// Выполнение полной очистки
export const executeCleanupAll = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  try {
    await ctx.editMessageText('🔄 Очистка данных...', { parse_mode: 'Markdown' });

    await prisma.ticketMessage.deleteMany({});
    await prisma.supportTicket.deleteMany({});
    await prisma.statisticEvent.deleteMany({});
    await prisma.promoRequest.deleteMany({});
    await prisma.scheduledTask.deleteMany({});

    await prisma.$executeRaw`ALTER SEQUENCE support_tickets_id_seq RESTART WITH 1`;
    await prisma.$executeRaw`ALTER SEQUENCE promo_requests_id_seq RESTART WITH 1`;

    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback('◀️ В админ-панель', 'admin_back')],
    ]);

    await ctx.editMessageText(
      '✅ **Очистка завершена!**\n\n' +
      'Все данные удалены:\n' +
      '• Тикеты\n' +
      '• Статистика\n' +
      '• Промо-заявки\n' +
      '• Задачи\n\n' +
      'Счётчики сброшены.',
      {
        parse_mode: 'Markdown',
        ...keyboard,
      }
    );
  } catch (error) {
    console.error('Error cleaning up data:', error);
    await ctx.editMessageText('❌ Ошибка при очистке данных');
  }
};

// Очистка только тикетов
export const executeCleanupTickets = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  try {
    await prisma.ticketMessage.deleteMany({});
    const result = await prisma.supportTicket.deleteMany({});
    await prisma.$executeRaw`ALTER SEQUENCE support_tickets_id_seq RESTART WITH 1`;

    await ctx.editMessageText(
      `✅ Удалено ${result.count} тикетов. Счётчик сброшен.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Назад', 'admin_cleanup_menu')],
        ]),
      }
    );
  } catch (error) {
    console.error('Error cleaning up tickets:', error);
    await ctx.editMessageText('❌ Ошибка при очистке тикетов');
  }
};

// Очистка статистики
export const executeCleanupStats = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  try {
    const result = await prisma.statisticEvent.deleteMany({});

    await ctx.editMessageText(
      `✅ Удалено ${result.count} событий статистики.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Назад', 'admin_cleanup_menu')],
        ]),
      }
    );
  } catch (error) {
    console.error('Error cleaning up stats:', error);
    await ctx.editMessageText('❌ Ошибка при очистке статистики');
  }
};

// Очистка промо-заявок
export const executeCleanupPromo = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }

  try {
    const result = await prisma.promoRequest.deleteMany({});
    await prisma.$executeRaw`ALTER SEQUENCE promo_requests_id_seq RESTART WITH 1`;

    await ctx.editMessageText(
      `✅ Удалено ${result.count} промо-заявок. Счётчик сброшен.`,
      {
        parse_mode: 'Markdown',
        ...Markup.inlineKeyboard([
          [Markup.button.callback('◀️ Назад', 'admin_cleanup_menu')],
        ]),
      }
    );
  } catch (error) {
    console.error('Error cleaning up promo:', error);
    await ctx.editMessageText('❌ Ошибка при очистке промо-заявок');
  }
};

// Супер-админ меню (упрощенное)
export const showSuperAdminMenu = async (ctx: BotContext) => {
  const adminId = BigInt(ctx.from!.id);
  if (adminId !== config.bot.adminId) {
    return ctx.answerCbQuery('⛔ Доступно только главному администратору.');
  }

  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback('💥 ПОЛНАЯ ОЧИСТКА БД', 'sa_wipe_all_data')],
    [Markup.button.callback('◀️ Назад', 'admin_back')],
  ]);

  const messageText = '⚙️ **Меню Супер-Админа**\n\n⚠️ Здесь только опасные операции!';

  try {
    await ctx.editMessageText(messageText, { parse_mode: 'Markdown', ...keyboard });
  } catch (error: any) {
    if (error.description?.includes('message is not modified')) {
      await ctx.answerCbQuery();
    }
  }
};

// Запрос подтверждения полной очистки БД
export const requestWipeConfirmation = async (ctx: BotContext) => {
  const adminId = BigInt(ctx.from!.id);
  if (adminId !== config.bot.adminId) {
    return ctx.answerCbQuery('⛔ Доступно только главному администратору.');
  }

  const confirmationCode = Math.floor(100000 + Math.random() * 900000).toString();

  await prisma.admin.update({
    where: { telegramId: adminId },
    data: {
      wipeConfirmationCode: confirmationCode,
      wipeConfirmationTimestamp: new Date(),
    },
  });

  await ctx.editMessageText(
    '**⚠️ ВНИМАНИЕ! ПОДТВЕРЖДЕНИЕ УДАЛЕНИЯ! ⚠️**\n\n' +
    'Это действие **НЕОБРАТИМО** удалит:\n' +
    '• **ВСЕХ пользователей**\n' +
    '• Все подписки и токены\n' +
    '• Все тикеты и сообщения поддержки\n' +
    '• Все сборки и их версии\n' +
    '• Всю статистику и все задачи\n\n' +
    '**БОТ ВЕРНЕТСЯ К ЗАВОДСКОМУ СОСТОЯНИЮ.**\n\n' +
    `Для подтверждения отправьте команду: \`/wipe_all_data ${confirmationCode}\`\n\n` +
    'Код действителен **60 секунд**.',
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Я передумал(а)', 'admin_superadmin_menu')]])
    }
  );
};

// Выполнение полной очистки БД
export const executeFullWipe = async (ctx: BotContext) => {
  const adminId = BigInt(ctx.from!.id);
  if (adminId !== config.bot.adminId) return;
  if (!ctx.message || !('text' in ctx.message)) return;

  const inputCode = ctx.message.text.split(' ')[1];
  if (!inputCode) {
    await ctx.reply('❌ Код подтверждения не указан. Операция отменена.');
    return;
  }

  const admin = await prisma.admin.findUnique({ where: { telegramId: adminId } });

  if (!admin || !admin.wipeConfirmationCode || !admin.wipeConfirmationTimestamp) {
    await ctx.reply('❌ Нет активного запроса на очистку. Операция отменена.');
    return;
  }

  const secondsPassed = (new Date().getTime() - admin.wipeConfirmationTimestamp.getTime()) / 1000;

  if (secondsPassed > 60) {
    await prisma.admin.update({ 
      where: { telegramId: adminId }, 
      data: { wipeConfirmationCode: null, wipeConfirmationTimestamp: null } 
    });
    await ctx.reply('❌ Код подтверждения истек. Операция отменена.');
    return;
  }

  if (inputCode !== admin.wipeConfirmationCode) {
    await ctx.reply('❌ Неверный код подтверждения. Операция отменена.');
    return;
  }

  try {
    await ctx.reply('✅ Код принят. Начинаю полную очистку базы данных...');

    // Удаляем ВСЁ в правильном порядке (из-за foreign keys)
    await prisma.$transaction([
      // 1. Сообщения тикетов (зависят от тикетов)
      prisma.ticketMessage.deleteMany(),
      
      // 2. Тикеты (зависят от пользователей)
      prisma.supportTicket.deleteMany(),
      
      // 3. Версии сборок (зависят от сборок)
      prisma.buildVersion.deleteMany(),
      
      // 4. Сборки
      prisma.build.deleteMany(),
      
      // 5. Статистика
      prisma.statisticEvent.deleteMany(),
      
      // 6. Промо-заявки
      prisma.promoRequest.deleteMany(),
      
      // 7. Запланированные задачи
      prisma.scheduledTask.deleteMany(),
      
      // 8. Агенты поддержки
      prisma.supportAgent.deleteMany(),
      
      // 9. ВСЕ пользователи
      prisma.user.deleteMany(),
      
      // 10. Все админы кроме главного
      prisma.admin.deleteMany({ where: { telegramId: { not: config.bot.adminId } } }),
    ]);

    // Сбрасываем счётчики последовательностей
    await prisma.$executeRaw`ALTER SEQUENCE support_tickets_id_seq RESTART WITH 1`;
    await prisma.$executeRaw`ALTER SEQUENCE ticket_messages_id_seq RESTART WITH 1`;
    await prisma.$executeRaw`ALTER SEQUENCE promo_requests_id_seq RESTART WITH 1`;
    await prisma.$executeRaw`ALTER SEQUENCE scheduled_tasks_id_seq RESTART WITH 1`;
    await prisma.$executeRaw`ALTER SEQUENCE statistic_events_id_seq RESTART WITH 1`;
    await prisma.$executeRaw`ALTER SEQUENCE builds_id_seq RESTART WITH 1`;
    await prisma.$executeRaw`ALTER SEQUENCE build_versions_id_seq RESTART WITH 1`;
    await prisma.$executeRaw`ALTER SEQUENCE support_agents_id_seq RESTART WITH 1`;
    await prisma.$executeRaw`ALTER SEQUENCE admins_id_seq RESTART WITH 1`;

    // Сбрасываем код подтверждения у главного админа
    await prisma.admin.update({
      where: { telegramId: adminId },
      data: {
        wipeConfirmationCode: null,
        wipeConfirmationTimestamp: null,
      },
    });

    await ctx.reply(
      '✅✅✅ **ПОЛНАЯ ОЧИСТКА ЗАВЕРШЕНА!**\n\n' +
      'Удалено:\n' +
      '• Все пользователи\n' +
      '• Все тикеты и сообщения\n' +
      '• Все сборки и версии\n' +
      '• Вся статистика\n' +
      '• Все промо-заявки\n' +
      '• Все задачи\n' +
      '• Все агенты поддержки\n' +
      '• Все админы кроме главного\n\n' +
      'Бот перезапускается...',
      { parse_mode: 'Markdown' }
    );
    
    // Перезапуск
    process.exit(1);

  } catch (error) {
    console.error('CRITICAL ERROR DURING WIPE:', error);
    await ctx.reply('❌ ПРОИЗОШЛА КРИТИЧЕСКАЯ ОШИБКА ВО ВРЕМЯ ОЧИСТКИ. Проверьте логи.');
  }
};

// Управление сборками
export const showBuildsMenu = async (ctx: BotContext) => {
  const builds = await prisma.build.findMany();
  
  const buttons = builds.map((build: { name: any; codeName: any; }) => 
    [Markup.button.callback(`⬆️ Загрузить "${build.name}"`, `build_upload_${build.codeName}`)]
  );

  buttons.push([Markup.button.callback('◀️ Назад', 'admin_back')]);

  const keyboard = Markup.inlineKeyboard(buttons);

  await ctx.editMessageText(
    '**📦 Управление сборками**\n\nВыберите действие:',
    { parse_mode: 'Markdown', ...keyboard }
  );
};

// Начинает процесс загрузки новой версии
export const startBuildUploadFlow = async (ctx: BotContext, buildCodeName: string) => {
  ctx.session.awaitingBuildFile = {
    step: 'version',
    buildCodeName: buildCodeName,
  };

  await ctx.editMessageText(
    `**Загрузка новой версии для \`${buildCodeName}\`**\n\n` +
    `Шаг 1/3: Отправьте номер версии (например, \`2.3.1\`).`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', 'admin_builds_menu')]])
    }
  );
};

// Обрабатывает ввод от админа во время загрузки сборки
export const handleBuildUploadInput = async (ctx: BotContext) => {
  const flowState = ctx.session.awaitingBuildFile;
  if (!flowState || !ctx.message) return;

  if ('text' in ctx.message) {
    const text = ctx.message.text;

    switch (flowState.step) {
      case 'version':
        flowState.version = text;
        flowState.step = 'description';
        await ctx.reply(
          `Шаг 2/3: Отправьте описание/ченджлог для версии **${text}**.`,
          { parse_mode: 'Markdown' }
        );
        break;
        
      case 'description':
        flowState.description = text;
        flowState.step = 'file';
        await ctx.reply(
          `Шаг 3/3: Теперь отправьте **архив** с файлами сборки.`,
          { parse_mode: 'Markdown' }
        );
        break;
    }
  }

  if ('document' in ctx.message && flowState.step === 'file') {
    const document = ctx.message.document;

    if (!flowState.version || !flowState.description) {
       await ctx.reply('❌ Что-то пошло не так, не хватает данных. Начните заново.');
       ctx.session.awaitingBuildFile = undefined;
       return;
    }

    await ctx.reply('⏳ Загружаю файл на сервер... Это может занять некоторое время.');

    const result = await BuildManager.addNewVersion(
      ctx,
      flowState.buildCodeName,
      flowState.version,
      flowState.description,
      document.file_id
    );
    
    await ctx.reply(result.message);
    ctx.session.awaitingBuildFile = undefined;

    await showAdminPanel(ctx);
  }
};

