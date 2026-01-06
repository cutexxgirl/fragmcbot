import { BotContext } from '../../types/context';
import { UserManager } from '../../modules/user/manager';
import { Markup } from 'telegraf';
import { prisma } from '../../database/prisma';
import { User } from '@prisma/client';
import { SUBSCRIPTION_NAMES, SubscriptionLevel } from '../../config';
import { isAdmin } from '../../utils/permissions';
import { showAdminPanel } from './adminPanel';

// --- ХЕЛПЕРЫ ---

const formatDate = (date: Date | null) => {
    if (!date) return 'Нет';
    const now = new Date();
    if (date < now) return '❌ Истекло';
    const days = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return `✅ ${date.toLocaleDateString('ru-RU')} (${days} д.)`;
};

const generateProfileText = (user: User): string => {
    const subscriptionLevelName = user.subscriptionLevel 
      ? SUBSCRIPTION_NAMES[user.subscriptionLevel as SubscriptionLevel] 
      : 'Нет';
    const subscriptionStatus = (user.status === 'active' && !user.isFrozen && !user.bannedAt) ? '✅ Активна' : '❌ Не активна';

    // Экранируем спецсимволы для Markdown
    const escMd = (s: string) => s.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1');

    return `
👤 **Профиль пользователя**

🆔 **ID:** \`${user.telegramId}\`
👥 **Username:** ${user.username ? '@' + escMd(user.username) : 'Не указан'}

📊 **Статус подписки:** ${subscriptionStatus}
🎯 **Уровень:** ${escMd(subscriptionLevelName)}
${user.bannedAt ? `🚫 **ЗАБАНЕН** (${escMd(user.banReason || 'без причины')})\n` : ''}
\`\`\`
🎮 Fragment: ${formatDate(user.expiresAtFragment)}
🔵 Pulse: ${formatDate(user.expiresAtPulse)}
🟢 Gear&Wire: ${formatDate(user.expiresAtGearwire)}
🟡 Ouch: ${formatDate(user.expiresAtOuch)}
\`\`\`
⭐ **Legacy:** ${user.isLegacy ? 'Да' : 'Нет'}
🧊 **Заморожен:** ${user.isFrozen ? 'Да' : 'Нет'}

_Fragment управляется автоматически через группы Boosty/Промо_
    `.trim();
};

// --- ОСНОВНЫЕ ФУНКЦИИ ---

export const requestUserQuery = async (ctx: BotContext) => {
  if (!(await isAdmin(BigInt(ctx.from!.id)))) return;

  await ctx.editMessageText(
    'Отправьте ID или @username пользователя для управления.',
    Markup.inlineKeyboard([[Markup.button.callback('◀️ Назад', 'admin_back')]])
  );
  ctx.session.awaitingUserSearch = true;
};

// Главная функция отображения карточки
export const findAndShowUserCard = async (ctx: BotContext) => {
    if (!(await isAdmin(BigInt(ctx.from!.id)))) return;
    
    let user: User | null = null;
    let query: string | null = null;

    // Режим поиска по тексту от админа
    if (ctx.message && 'text' in ctx.message) {
      query = ctx.message.text.trim();
      if(ctx.session) ctx.session.awaitingUserSearch = false;
      user = await UserManager.findUser(query);
    } 
    // Режим обновления по ID из кнопки
    else if (ctx.match && ctx.match[1]) {
      query = ctx.match[1];
      user = await UserManager.findUser(query);
    }

    if (!user) {
        const notFoundMessage = `❌ Пользователь "${query}" не найден.`;
        if (ctx.callbackQuery) await ctx.answerCbQuery(notFoundMessage);
        else await ctx.reply(notFoundMessage);
        return showAdminPanel(ctx);
    }

    const profileText = generateProfileText(user);
    const userId = user.telegramId;

    const keyboard = Markup.inlineKeyboard([
        // ТОЛЬКО доп сборки (Fragment убран!)
        [
            Markup.button.callback('✏️ Pulse', `user_edit_access_${userId}_pulse`),
            Markup.button.callback('✏️ Gear&Wire', `user_edit_access_${userId}_gearwire`)
        ],
        [
            Markup.button.callback('✏️ Ouch', `user_edit_access_${userId}_ouch`),
            Markup.button.callback(user.isLegacy ? '❌ Убрать Legacy' : '⭐ Дать Legacy', `user_toggle_legacy_${userId}`)
        ],
        [
            Markup.button.callback(user.isFrozen ? '✅ Разморозить' : '🧊 Заморозить', `user_toggle_freeze_${userId}`),
            Markup.button.callback(user.bannedAt ? '✅ Разбанить' : '🚫 Забанить', `user_toggle_ban_${userId}`)
        ],
        [Markup.button.callback('🔄 Обновить', `user_refresh_${userId}`)],
        [Markup.button.callback('◀️ Назад в админку', 'admin_back')],
    ]);

    if (ctx.callbackQuery) {
        try { 
            await ctx.editMessageText(profileText, { parse_mode: 'Markdown', ...keyboard }); 
        } catch(e) {
            // Сообщение не изменилось - игнорируем
        }
    } else {
        await ctx.reply(profileText, { parse_mode: 'Markdown', ...keyboard });
    }
};

export const requestAccessDays = async (ctx: BotContext) => {
    if (!(await isAdmin(BigInt(ctx.from!.id)))) return;
    if (!ctx.match) return;
    
    const userId = ctx.match[1];
    const buildCodeName = ctx.match[2];

    // Защита: Fragment нельзя менять
    if (buildCodeName === 'fragment') {
        await ctx.answerCbQuery('❌ Fragment управляется автоматически');
        return;
    }

    ctx.session.awaitingAccessDays = { userId: BigInt(userId), buildCodeName };

    await ctx.editMessageText(
        `На сколько дней изменить доступ к **${buildCodeName}** для пользователя \`${userId}\`?\n\n` +
        '• `30` - продлить на 30 дней\n' +
        '• `-10` - укоротить на 10 дней\n' +
        '• `0` - полностью забрать доступ',
        { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `user_refresh_${userId}`)]])
        }
    );
};

export const handleAccessDaysInput = async (ctx: BotContext) => {
    if (!(await isAdmin(BigInt(ctx.from!.id)))) return;
    if (!ctx.message || !('text' in ctx.message) || !ctx.session.awaitingAccessDays) return;

    const { userId, buildCodeName } = ctx.session.awaitingAccessDays;
    const days = parseInt(ctx.message.text, 10);

    if (isNaN(days)) {
        return ctx.reply('❌ Ошибка. Введите число.');
    }

    // Защита: Fragment нельзя менять
    if (buildCodeName === 'fragment') {
        ctx.session.awaitingAccessDays = undefined;
        return ctx.reply('❌ Fragment управляется автоматически');
    }

    ctx.session.awaitingAccessDays = undefined;
    const result = await UserManager.updateAccess(userId, buildCodeName as any, days);
    await ctx.reply(result.message);

    // Обновляем карточку
    (ctx as any).match = ['', userId.toString()];
    await findAndShowUserCard(ctx);
};

export const toggleBan = async (ctx: BotContext) => {
    if (!(await isAdmin(BigInt(ctx.from!.id)))) return;
    if (!ctx.match) return;

    const userId = BigInt(ctx.match[1]);
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });
    
    let result;
    if (user?.bannedAt) {
        result = await UserManager.unbanUser(userId);
    } else {
        result = await UserManager.banUser(userId, 'Забанен администратором');
    }

    await ctx.answerCbQuery(result.message);
    await findAndShowUserCard(ctx);
};

export const toggleFreeze = async (ctx: BotContext) => {
    if (!(await isAdmin(BigInt(ctx.from!.id)))) return;
    if (!ctx.match) return;

    const userId = BigInt(ctx.match[1]);
    const user = await prisma.user.findUnique({ where: { telegramId: userId } });

    const result = await UserManager.setFreeze(userId, !user?.isFrozen);
    
    await ctx.answerCbQuery(result.message);
    await findAndShowUserCard(ctx);
};

export const toggleLegacy = async (ctx: BotContext) => {
    if (!(await isAdmin(BigInt(ctx.from!.id)))) return;
    if (!ctx.match) return;

    const userId = BigInt(ctx.match[1]);
    const result = await UserManager.toggleLegacy(userId);

    await ctx.answerCbQuery(result.message);
    await findAndShowUserCard(ctx);
};