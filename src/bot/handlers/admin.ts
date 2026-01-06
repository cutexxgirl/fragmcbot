import { BotContext } from '../../types/context';
import { isAdmin } from '../../utils/permissions';
import { checkAllSubscriptions } from '../../services/cron';
import { SupportSystem } from '../../modules/support';
import { prisma } from '../../database/prisma';
import { UserManager } from '../../modules/user/manager';

/**
 * Команда: проверка всех подписок вручную
 */
export const adminCheckSubscriptionsHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    
    if (!(await isAdmin(userId))) {
      return;
    }

    await ctx.reply('🔄 Запускаю проверку подписок...');
    await checkAllSubscriptions();
    await ctx.reply('✅ Проверка завершена!');
  } catch (error) {
    console.error('Error in admin check handler:', error);
    await ctx.reply('❌ Ошибка при проверке подписок');
  }
};

/**
 * Команда: закрыть тикет поддержки
 * Использование: /закрыть 123
 */
export const adminCloseTicketHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    
    if (!(await isAdmin(userId))) {
      return;
    }

    if (!ctx.message || !('text' in ctx.message)) {
      return;
    }

    const match = ctx.message.text.match(/\/close\s+(\d+)/);
    
    if (!match) {
      await ctx.reply('❌ Использование: /close <ticket_id>');
      return;
    }

    const ticketId = parseInt(match[1]);
    const result = await SupportSystem.closeTicket(ticketId, userId);

    if (result.success) {
      await ctx.reply(`✅ Тикет #${ticketId} закрыт`);
    } else {
      await ctx.reply(`❌ ${result.message}`);
    }

  } catch (error) {
    console.error('Error in admin close ticket handler:', error);
    await ctx.reply('❌ Ошибка при закрытии тикета');
  }
};

/**
 * Глобальное включение/выключение акции для всех пользователей
 * Устанавливается в таблице Admin
 */
export const toggleGlobalPromoCommand = async (ctx: BotContext) => {
  const adminId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(adminId))) {
    return;
  }

  if (!ctx.message || !('text' in ctx.message)) {
    return;
  }

  const commandText = ctx.message.text;
  const enable = commandText.includes('promo_on');

  try {
    // Обновляем глобальную настройку в профиле админа
    await prisma.admin.update({
      where: { telegramId: adminId },
      data: { 
        isPromoEnabled: enable
      },
    });

    console.log('[Promo] Global promo flag set to:', enable);

    await ctx.reply(
      enable 
        ? `✅ Акция включена глобально\n\nНовые пользователи будут видеть кнопку "Акция" при первом /start`
        : `❌ Акция выключена глобально\n\nНовые пользователи НЕ будут видеть кнопку "Акция"`
    );
  } catch (error) {
    console.error('[Promo] Error updating global promo flag:', error);
    await ctx.reply('❌ Ошибка при обновлении статуса акции');
  }
};

/**
 * Включение акции для конкретного пользователя
 * Использование: /включить_акцию 123456789
 */
export const enablePromoCommand = async (ctx: BotContext) => {
  const adminId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(adminId))) {
    return;
  }

  if (!ctx.message || !('text' in ctx.message)) {
    return;
  }

  const match = ctx.message.text.match(/\/включить_акцию\s+(\d+)/);
  
  if (!match) {
    await ctx.reply('❌ Использование: /включить_акцию <telegram_id>');
    return;
  }

  const userId = BigInt(match[1]);
  
  await prisma.user.update({
    where: { telegramId: userId },
    data: { hasPromoAccess: true },
  });

  await ctx.reply(`✅ Кнопка акции включена для пользователя ${userId}`);
};

/**
 * Выключение акции для конкретного пользователя
 * Использование: /выключить_акцию 123456789
 */
export const disablePromoCommand = async (ctx: BotContext) => {
  const adminId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(adminId))) {
    return;
  }

  if (!ctx.message || !('text' in ctx.message)) {
    return;
  }

  const match = ctx.message.text.match(/\/выключить_акцию\s+(\d+)/);
  
  if (!match) {
    await ctx.reply('❌ Использование: /выключить_акцию <telegram_id>');
    return;
  }

  const userId = BigInt(match[1]);
  
  await prisma.user.update({
    where: { telegramId: userId },
    data: { hasPromoAccess: false },
  });

  await ctx.reply(`❌ Кнопка акции выключена для пользователя ${userId}`);
};

/**
 * Бан пользователя
 * Использование: /ban 123456789 Причина бана
 */
export const banCommand = async (ctx: BotContext) => {
  const adminId = BigInt(ctx.from!.id);
  if (!(await isAdmin(adminId))) return;
  if (!ctx.message || !('text' in ctx.message)) return;
  
  const parts = ctx.message.text.split(' ');
  const targetIdStr = parts[1];
  const reason = parts.slice(2).join(' ') || 'Причина не указана';

  if (!targetIdStr || !/^\d+$/.test(targetIdStr)) {
    return ctx.reply('❌ Использование: /ban <user_id> [причина]');
  }
  
  const targetId = BigInt(targetIdStr);
  const result = await UserManager.banUser(targetId, reason);
  await ctx.reply(result.message);
};

/**
 * Разбан пользователя
 * Использование: /unban 123456789
 */
export const unbanCommand = async (ctx: BotContext) => {
  const adminId = BigInt(ctx.from!.id);
  if (!(await isAdmin(adminId))) return;
  if (!ctx.message || !('text' in ctx.message)) return;

  const targetIdStr = ctx.message.text.split(' ')[1];
  if (!targetIdStr || !/^\d+$/.test(targetIdStr)) {
    return ctx.reply('❌ Использование: /unban <user_id>');
  }

  const targetId = BigInt(targetIdStr);
  const result = await UserManager.unbanUser(targetId);
  await ctx.reply(result.message);
};