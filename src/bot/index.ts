import { Telegraf, session } from 'telegraf';
import { config } from '../config';
import { BotContext } from '../types/context';
import { message } from 'telegraf/filters';
import { prisma } from '../database/prisma';

export const bot = new Telegraf<BotContext>(config.bot.token, {
  telegram: {
    apiRoot: 'http://127.0.0.1:8081'
  }
});

bot.use(session({
  defaultSession: () => ({
    awaitingPromoDonation: undefined,
    awaitingCustomStatsPeriod: false,
    activeTicketId: undefined,
    awaitingPromoProof: false,
    awaitingTicketMessage: false,
    awaitingAgentAction: undefined,
    pendingAgentId: undefined,
    promoSelection: undefined,
    awaitingAdminSetting: undefined,
    awaitingPromoCustomDays: undefined,
    awaitingBuildFile: undefined,
    awaitingUserSearch: false,
    awaitingAccessDays: undefined,
    awaitingShareUser: false
  }),
}));

// --- DEBUG: LOG ALL UPDATES ---
// bot.use(async (ctx, next) => {
//   // console.log(`[DEBUG] Update received: ${ctx.updateType}`);
//   // if (ctx.chat) console.log(`[DEBUG] Chat ID: ${ctx.chat.id}`);
//   // if (ctx.updateType === 'chat_member') {
//   //     console.log(`[DEBUG] CHAT_MEMBER UPDATE RAW:`, JSON.stringify(ctx.update, null, 2));
//   // }
//   await next();
// });

// --- Middleware для проверки бана ---
bot.use(async (ctx, next) => {
  const userId = ctx.from?.id;
  if (!userId) return;

  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(userId) },
    select: { bannedAt: true },
  });

  // Если забанен - игнорируем
  if (user && user.bannedAt) {
    return;
  }

  await next();
});


// --- Импорты обработчиков ---
import { startHandler } from './handlers/start';
import { profileHandler } from './handlers/profile';
import { instructionHandler } from './handlers/instruction';
import { adminCheckSubscriptionsHandler, adminCloseTicketHandler, enablePromoCommand, disablePromoCommand, banCommand, unbanCommand } from './handlers/admin';
import { supportHandler, closeTicketHandler, handleTicketMessage } from './handlers/support';
import { handleSupportGroupMessage } from './handlers/supportGroup';

import { 
  showAdminPanel, showAgentsMenu, showStatsMenu, showTicketsMenu, requestAgentId, showAgentsList, 
  showGeneralStats, deleteAllTickets, confirmDeleteTickets, resetTicketCounter, confirmResetCounter, 
  checkSubscriptions, showSpecificAgentStats, showDataCleanupMenu, confirmCleanupAll, executeCleanupAll, 
  executeCleanupTickets, executeCleanupStats, executeCleanupPromo,
  showSuperAdminMenu,
  showBuildsMenu, startBuildUploadFlow, handleBuildUploadInput, requestWipeConfirmation, executeFullWipe,
  showGeneralStatsMenu, 
  showGeneralStatsForPeriod,
  requestCustomPeriod,
  handleCustomPeriodInput,
} from './handlers/adminPanel';
import { 
  promoHandler, handlePromoProof, handlePromoGrant, handlePromoAccess, handlePromoAddSelection,
  handlePromoConfirm, handlePromoClearSelection, handlePromoReject, handlePromoBack,
  handlePromoRequestCustomDuration, handlePromoCustomDurationInput,
} from './handlers/promo';
import { handleAgentIdInput } from './handlers/adminAgentInput';
import { toggleGlobalPromoCommand } from './handlers/admin';
import { handleShareAccess, handleShareAdd, handleShareUserInput, handleShareRevoke } from './handlers/sharing';
import { validateSharedAccess } from '../modules/lifecycle/sharing';

import { 
  requestUserQuery, 
  findAndShowUserCard,
  requestExtraAccessDays,
  handleExtraAccessDaysInput,
  toggleBan,
  toggleFreeze,
  handleLiveCheck,
} from './handlers/userManagement';
import { PromoSystem } from '../modules/promo';
import { startPasswordFlow, handlePasswordInput } from './handlers/password';
import { startCronJobs } from '../services/cron';
import { setupChannelGuard } from '../modules/lifecycle/channelGuard';

// --- Регистрация команд ---
bot.command('start', startHandler);
bot.command('ban', banCommand); 
bot.command('unban', unbanCommand); 
bot.command('wipe_all_data', executeFullWipe);
bot.command('checksubs', adminCheckSubscriptionsHandler);
bot.command('close', adminCloseTicketHandler);
bot.command('promo_on', (ctx) => toggleGlobalPromoCommand(ctx));
bot.command('promo_off', (ctx) => toggleGlobalPromoCommand(ctx));
import { promoCodeHandler } from './handlers/promoCodeHandler';
bot.command('promo', promoCodeHandler);
import { getPrivateChannelLink } from './handlers/privateChannel';
bot.command('private', getPrivateChannelLink);
bot.hears('🔒 Закрытый канал', getPrivateChannelLink);
bot.action('get_private_link_btn', getPrivateChannelLink);

// --- Регистрация кнопок (hears) ---
bot.hears('👤 Профиль', profileHandler);
bot.hears('🆘 Поддержка', supportHandler);
bot.hears('❌ Закрыть тикет', closeTicketHandler);
// bot.hears('🎁 Акция', promoHandler); // Скрыто по просьбе
bot.hears('⚙️ Админ-панель', showAdminPanel);
bot.hears('📖 Инструкция', instructionHandler);
bot.hears('✈️ Канал', (ctx) => {
  ctx.reply('Нажмите на кнопку, чтобы перейти в наш канал:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: 'Перейти в канал', url: 'https://t.me/fragmcru' }]
      ]
    }
  });
});
bot.hears('💬 Discord', async (ctx) => {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;

  // Проверяем, есть ли запись о последнем запросе и прошло ли меньше часа
  if (ctx.session.lastDiscordRequest && (now - ctx.session.lastDiscordRequest < oneHour)) {
    // Если меньше часа прошло, просто ничего не делаем (как ты и просила, хехе)
    console.log(`[Discord Link] Cooldown for user ${ctx.from.id}. Ignoring.`);
    return;
  }
  
  // Если прошло больше часа (или это первый раз), отправляем ссылку и обновляем время
  await ctx.reply('Перейти в Discord-сервер:\nhttps://discord.gg/BFCUdRPQSX');
  ctx.session.lastDiscordRequest = now;
}); 

// Кнопка скачать лаунчер
bot.hears('🚀 Скачать лаунчер', async (ctx) => {
  const { getLauncherUrl } = await import('./keyboards/main');
  await ctx.reply('📥 Нажмите кнопку ниже, чтобы скачать лаунчер:', {
    reply_markup: {
      inline_keyboard: [
        [{ text: '⬇️ Скачать FragmentLauncher', url: getLauncherUrl() }]
      ]
    }
  });
});

// --- Регистрация Инлайн-Кнопок (action) ---
bot.action('admin_stats', showStatsMenu);
bot.action('admin_general_stats', showGeneralStatsMenu);
bot.action('general_stats_day', (ctx) => showGeneralStatsForPeriod(ctx, 'day'));
bot.action('general_stats_week', (ctx) => showGeneralStatsForPeriod(ctx, 'week'));
bot.action('general_stats_month', (ctx) => showGeneralStatsForPeriod(ctx, 'month'));
bot.action('general_stats_all', (ctx) => showGeneralStatsForPeriod(ctx, 'all'));
bot.action('general_stats_custom', requestCustomPeriod);
bot.action('admin_back', showAdminPanel);
bot.action('admin_agents', showAgentsMenu);
bot.action('admin_tickets', showTicketsMenu);
bot.action('admin_check_subs', checkSubscriptions);
bot.action('admin_add_agent', (ctx) => requestAgentId(ctx, 'add'));
bot.action('admin_remove_agent', (ctx) => requestAgentId(ctx, 'remove'));
bot.action('admin_list_agents', showAgentsList);
bot.action('admin_agent_stats', (ctx) => requestAgentId(ctx, 'stats'));
bot.action('admin_stats_day', (ctx) => showGeneralStats(ctx, 'day'));
bot.action('admin_stats_week', (ctx) => showGeneralStats(ctx, 'week'));
bot.action('admin_stats_month', (ctx) => showGeneralStats(ctx, 'month'));
bot.action(/agent_stats_(\d+)_(day|week|month)/, (ctx) => {
  showSpecificAgentStats(ctx, BigInt(ctx.match[1]), ctx.match[2] as 'day' | 'week' | 'month');
});
bot.action('admin_delete_all_tickets', deleteAllTickets);
bot.action('admin_confirm_delete_tickets', confirmDeleteTickets);
bot.action('admin_reset_ticket_counter', resetTicketCounter);
bot.action('admin_confirm_reset_counter', confirmResetCounter);
bot.action('admin_cleanup_menu', showDataCleanupMenu);
bot.action('admin_cleanup_all', confirmCleanupAll);
bot.action('admin_execute_cleanup_all', executeCleanupAll);
bot.action('admin_cleanup_tickets', executeCleanupTickets);
bot.action('admin_cleanup_stats', executeCleanupStats);
bot.action('admin_cleanup_promo', executeCleanupPromo);

bot.action('admin_user_management', requestUserQuery);

bot.action('admin_superadmin_menu', showSuperAdminMenu);
// bot.action('sa_toggle_logging', toggleLogging);
// bot.action('sa_set_renewal_interval', (ctx) => requestNewSettingValue(ctx, 'renewal_interval'));
// bot.action('sa_set_security_interval', (ctx) => requestNewSettingValue(ctx, 'security_interval'));
// bot.action('sa_set_token_lifetime', (ctx) => requestNewSettingValue(ctx, 'token_lifetime'));
// bot.action('sa_reset_settings', resetSettings);
bot.action('sa_wipe_all_data', requestWipeConfirmation);

bot.action('admin_builds_menu', showBuildsMenu);
bot.action(/build_upload_(.+)/, (ctx) => startBuildUploadFlow(ctx, ctx.match[1]));

bot.action(/promo_grant_(\d+)/, handlePromoGrant);
bot.action(/promo_select_(\d+)_(\w+)/, handlePromoAccess);
bot.action(/promo_add_(\d+)_(\w+)_(\d+)/, handlePromoAddSelection);
bot.action(/promo_custom_(\d+)_(\w+)/, handlePromoRequestCustomDuration);
bot.action(/promo_confirm_(\d+)/, handlePromoConfirm);
bot.action(/promo_clear_(\d+)/, handlePromoClearSelection);
bot.action(/promo_reject_(\d+)/, handlePromoReject);
bot.action(/promo_back_(\d+)/, handlePromoBack);

// НОВЫЕ ACTIONS ДЛЯ КАРТОЧКИ ПОЛЬЗОВАТЕЛЯ
bot.action(/user_refresh_(\d+)/, findAndShowUserCard);
bot.action(/user_toggle_ban_(\d+)/, toggleBan);
bot.action(/user_toggle_freeze_(\d+)/, toggleFreeze);
bot.action(/user_edit_extra_(\d+)/, requestExtraAccessDays);
bot.action(/user_live_check_(\d+)/, handleLiveCheck);

// ШЕРИНГ ДОСТУПА
bot.action('share_access', handleShareAccess);
bot.action(/share_add_(\d+)/, handleShareAdd);
bot.action(/share_revoke_(\d+)/, handleShareRevoke);
bot.action('profile_back', profileHandler);


// bot.action('back_to_builds', (ctx) => showAvailableBuilds(ctx)); 
// bot.action(/build_select_(.+)/, showBuildVersions); 
// bot.action(/version_select_(\d+)/, sendBuildFile); 
bot.action('set_password', startPasswordFlow); 

// --- ОБРАБОТЧИКИ СООБЩЕНИЙ ---

bot.on('message', async (ctx, next) => {
  // Пропускаем команды
  if (ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/')) {
    return next();
  }

  // Для группы поддержки
  if (ctx.chat?.type !== 'private') {
    return handleSupportGroupMessage(ctx);
  }

  // Для личных сообщений - проверяем состояния сессии
  if (ctx.session?.awaitingUserSearch) return findAndShowUserCard(ctx);
  if (ctx.session?.awaitingExtraAccessDays) return handleExtraAccessDaysInput(ctx);
  // Исправление: awaitingShareUser добавлен в session
  if (ctx.session?.awaitingShareUser) return handleShareUserInput(ctx);
  if (ctx.session?.awaitingPromoCustomDays) return handlePromoCustomDurationInput(ctx);
  if (ctx.session?.awaitingBuildFile) return handleBuildUploadInput(ctx);
  if (ctx.session?.awaitingAgentAction || ctx.session?.awaitingAdminSetting) return handleAgentIdInput(ctx);
  if (ctx.session?.awaitingCustomStatsPeriod) return handleCustomPeriodInput(ctx);
  if (ctx.session?.awaitingPromoDonation) return PromoSystem.handleDonationInput(ctx);
  if ((ctx.session as any)?.awaitingPassword) return handlePasswordInput(ctx);
  
  // Для промо-фоток
  if (ctx.session?.awaitingPromoProof && ctx.message && 'photo' in ctx.message) {
    return handlePromoProof(ctx);
  }

  // Все остальное идет в поддержку
  return handleTicketMessage(ctx);
});

// --- Запуск и остановка бота ---
export const startBot = async () => {
  try {
    // Запускаем CRON задачи
    startCronJobs(bot);

    // Запускаем защиту канала (отзыв инвайтов)
    setupChannelGuard(bot);

    // Запускаем проверку шаринга при старте один раз
    validateSharedAccess().catch(err => console.error('Initial sharing validation failed:', err));

    console.log('🤖 Starting Telegram bot...');
    await bot.launch({
      allowedUpdates: [
        'message', 
        'callback_query', 
        'chat_member',     // REQUIRED for Channel Guard (joins/leaves)
        'my_chat_member',  // Bot status changes
        'channel_post'     // Optional, for channel messages
      ]
    });
    console.log('✅ Bot started successfully');
    console.log(`📱 Bot username: @${bot.botInfo?.username}`);

  } catch (error) {
    console.error('❌ Failed to start bot:', error);
    // УБРАН process.exit(1)
  }
};

process.once('SIGINT', () => {
  console.log('🛑 Stopping bot...');
  bot.stop('SIGINT');
});

process.once('SIGTERM', () => {
  console.log('🛑 Stopping bot...');
  bot.stop('SIGTERM');
});
