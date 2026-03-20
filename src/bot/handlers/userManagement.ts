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
    const subscriptionStatus = (user.status === 'active' && !user.isFrozen && !user.bannedAt) ? '✅ Активна' : 
      (user.status === 'shared' ? '🎁 Подарено' : '❌ Не активна');

    // Экранируем спецсимволы для Markdown
    const escMd = (s: string) => s.replace(/([_*[\]()~`>#+=|{}.!-])/g, '\\$1');

    return `
👤 **Профиль пользователя**

🆔 **ID:** \`${user.telegramId}\`
🔖 **Fragment ID:** \`${user.fragmentId || 'Не присвоен'}\`
👥 **Username:** ${user.username ? '@' + escMd(user.username) : 'Не указан'}

📊 **Статус:** ${subscriptionStatus}
🎯 **Уровень:** ${escMd(subscriptionLevelName)}
${user.bannedAt ? `🚫 **ЗАБАНЕН** (${escMd(user.banReason || 'без причины')})\n` : ''}
\`\`\`
🎮 Fragment: ${formatDate(user.expiresAtFragment)}
📦 Доп. сборки: ${formatDate(user.expiresAtExtra)}
\`\`\`
${user.giftedById ? `🎁 **Подарено от:** \`${user.giftedById}\`\n` : ''}
🧊 **Заморожен:** ${user.isFrozen ? 'Да' : 'Нет'}

_Fragment управляется через Boosty/Промо_
_Доп. сборки — через Legend/Spark/подарок_
    `.trim();
};

// --- ОСНОВНЫЕ ФУНКЦИИ ---

export const requestUserQuery = async (ctx: BotContext) => {
  if (!(await isAdmin(BigInt(ctx.from!.id)))) return;

  await ctx.editMessageText(
    'Отправьте ID, @username или Fragment ID (ABC-XYZ) пользователя.',
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
        // Управление доступом к доп. сборкам
        [Markup.button.callback('📦 Изменить доступ к доп. сборкам', `user_edit_extra_${userId}`)],
        [
            Markup.button.callback(user.isFrozen ? '✅ Разморозить' : '🧊 Заморозить', `user_toggle_freeze_${userId}`),
            Markup.button.callback(user.bannedAt ? '✅ Разбанить' : '🚫 Забанить', `user_toggle_ban_${userId}`)
        ],
        [
            Markup.button.callback('🔍 Live Check (Группы)', `user_live_check_${userId}`),
            Markup.button.callback('🔄 Обновить БД', `user_refresh_${userId}`)
        ],
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

// --- LIVE CHECK ---
import { checkUserGroups } from '../../modules/subscription/checker';
import { config } from '../../config';

export const handleLiveCheck = async (ctx: BotContext) => {
    if (!(await isAdmin(BigInt(ctx.from!.id)))) return;
    if (!ctx.match) return;

    const userId = BigInt(ctx.match[1]);
    const user = await prisma.user.findUnique({ 
        where: { telegramId: userId },
        include: { sharedByMe: true, sharedToMe: true, promoActivations: true }
    });

    if (!user) return ctx.answerCbQuery('User not found');

    await ctx.answerCbQuery('🔍 Проверяю...');

    let report = `🕵️‍♂️ **Live Check Report** for \`${userId}\`\n\n`;

    // 1. Проверка групп (Boosty)
    report += `**📡 Boosty Groups Check:**\n`;
    try {
        const membership = await checkUserGroups(ctx, userId);
        report += `• Computed Level: **${membership.level || 'NONE'}**\n`;
    } catch (e: any) {
        report += `• Error: ${e.message}\n`;
    }
    
    // Детально по группам
    const groupsToCheck = [
        { name: 'Spark', id: config.groups.spark },
        { name: 'Legend', id: config.groups.legend },
        { name: 'Adept', id: config.groups.adept },
        { name: 'Novice', id: config.groups.novice },
        { name: 'Promo', id: config.groups.promo }
    ];

    for (const g of groupsToCheck) {
        try {
            const member = await ctx.telegram.getChatMember(g.id.toString(), Number(userId));
            const statusIcon = ['member', 'administrator', 'creator'].includes(member.status) ? '✅' : '❌';
            report += `• ${g.name}: ${statusIcon} (${member.status})\n`;
        } catch (e) {
            report += `• ${g.name}: ❓ (Bot not in group?)\n`;
        }
    }

    // 2. Проверка канала
    report += `\n**📢 Channel Check:**\n`;
    try {
        const member = await ctx.telegram.getChatMember(config.channel.closed.toString(), Number(userId));
        const statusIcon = ['member', 'administrator', 'creator'].includes(member.status) ? '✅' : '❌';
        report += `• Private Channel: ${statusIcon} (${member.status})\n`;
    } catch (e) {
        report += `• Private Channel: ❓ (Error)\n`;
    }

    // 3. Проверка БД связей
    report += `\n**💾 Database Relations:**\n`;
    if (user.sharedToMe.length > 0) {
        report += `• Gifted Access: ✅ From ${user.sharedToMe[0].ownerId}\n`;
    } else {
        report += `• Gifted Access: ❌\n`;
    }
    
    if (user.sharedByMe.length > 0) {
        report += `• Shared To: ${user.sharedByMe.length} users\n`;
    }

    if (user.promoActivations.length > 0) {
        report += `• Promo Activations: ${user.promoActivations.length}\n`;
    }

    // Кнопка назад к профилю
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.callback('🔙 К профилю', `user_refresh_${userId}`)]
    ]);

    await ctx.reply(report, { parse_mode: 'Markdown', ...keyboard });
};

export const requestExtraAccessDays = async (ctx: BotContext) => {
    if (!(await isAdmin(BigInt(ctx.from!.id)))) return;
    if (!ctx.match) return;
    
    const userId = ctx.match[1];

    ctx.session.awaitingExtraAccessDays = BigInt(userId);

    await ctx.editMessageText(
        `На сколько дней изменить доступ к **доп. сборкам** для пользователя \`${userId}\`?\n\n` +
        '• `30` - продлить на 30 дней\n' +
        '• `-10` - укоротить на 10 дней\n' +
        '• `0` - полностью забрать доступ',
        { 
            parse_mode: 'Markdown',
            ...Markup.inlineKeyboard([[Markup.button.callback('❌ Отмена', `user_refresh_${userId}`)]])
        }
    );
};

export const handleExtraAccessDaysInput = async (ctx: BotContext) => {
    if (!(await isAdmin(BigInt(ctx.from!.id)))) return;
    if (!ctx.message || !('text' in ctx.message) || !ctx.session.awaitingExtraAccessDays) return;

    const userId = ctx.session.awaitingExtraAccessDays;
    const days = parseInt(ctx.message.text, 10);

    if (isNaN(days)) {
        return ctx.reply('❌ Ошибка. Введите число.');
    }

    ctx.session.awaitingExtraAccessDays = undefined;
    const result = await UserManager.updateExtraAccess(userId, days);
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