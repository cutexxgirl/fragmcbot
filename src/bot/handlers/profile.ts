import { BotContext } from '../../types/context';
import { prisma } from '../../database/prisma';
import { UserStatus, SubscriptionLevel, SUBSCRIPTION_NAMES } from '../../config';
import { Markup } from 'telegraf';

export const toggleNotifications = async (ctx: BotContext) => {
  try {
    if (!ctx.match) return;
    
    const userId = BigInt(ctx.match[1]);
    
    // Проверка что пользователь меняет свои настройки
    if (userId !== BigInt(ctx.from!.id)) {
      await ctx.answerCbQuery('❌ Вы можете менять только свои настройки');
      return;
    }

    const user = await prisma.user.findUnique({
      where: { telegramId: userId },
    });

    if (!user) return;

    // Переключаем настройку
    const newValue = !user.notifyOnNewBuilds;
    
    await prisma.user.update({
      where: { telegramId: userId },
      data: { notifyOnNewBuilds: newValue },
    });

    const message = newValue 
      ? '🔔 Уведомления о новых версиях включены'
      : '🔕 Уведомления о новых версиях выключены';

    await ctx.answerCbQuery(message);
    
    // Обновляем профиль
    await profileHandler(ctx);
    
  } catch (error) {
    console.error('Error toggling notifications:', error);
    await ctx.answerCbQuery('❌ Ошибка');
  }
};

export const profileHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);

    const user = await prisma.user.findUnique({
      where: { telegramId: userId },
    });

    if (!user) {
      await ctx.reply('❌ Профиль не найден. Используйте /start для регистрации.');
      return;
    }

    const now = new Date();

    // HTML экранирование (важно для < > & ")
    const esc = (s: unknown) =>
      String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c] as string));

    // Расчёт времени до истечения
    const formatExpiry = (date: Date | null) => {
      if (!date) return null;
      const diff = date.getTime() - now.getTime();
      
      if (diff < 0) return '❌ истёк';
      
      const days = Math.floor(diff / (1000 * 60 * 60 * 24));
      const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      
      let result = `до ${esc(date.toLocaleDateString('ru-RU'))} `;
      
      if (days > 0) {
        result += `(${days} д.)`;
      } else if (hours > 0) {
        result += `(${hours} ч.)`;
      } else if (minutes > 0) {
        result += `(${minutes} мин.)`;
      } else {
        result += `(&lt; 1 мин.)`;
      }
      
      return result;
    };

    // Формируем сообщение профиля
    const username = user.username ? '@' + esc(user.username) : 'Не указан';
    const lines: string[] = [
      `👤 <b>Пользователь:</b> ${username}`,
      `🆔 <b>ID:</b> <code>${esc(user.telegramId)}</code>`,
      '',
    ];

    // Статус подписки Fragment
    const isFragmentActive = user.status === UserStatus.ACTIVE && !user.isFrozen;
    const fragmentIcon = isFragmentActive ? '✅' : '❌';
    const levelName = user.subscriptionLevel
      ? SUBSCRIPTION_NAMES[user.subscriptionLevel as SubscriptionLevel]
      : 'Нет';

    lines.push(`${fragmentIcon} <b>Подписка Fragment:</b> ${esc(levelName)}`);

    if (user.expiresAtFragment) {
      const fragmentExpiry = formatExpiry(user.expiresAtFragment);
      if (fragmentExpiry) {
        lines.push(`   └ ${fragmentExpiry}`);
      }
    }

    // Токен доступа
    lines.push('');
    if (isFragmentActive && user.accessToken) {
      lines.push(`🔑 <b>Токен доступа:</b> <code>${esc(user.accessToken)}</code>`);
      lines.push(`   └ Активен`);
    } else {
      lines.push(`🔑 <b>Токен доступа:</b> ❌ Неактивен`);
    }

    // Legacy статус
    if (user.isLegacy) {
      lines.push('');
      lines.push('⭐ <b>Legacy статус:</b> ✅ Активен');
    }

    // Дополнительные сборки
    const additionalBuilds: string[] = [];

    if (user.expiresAtPulse) {
      const pulseExpiry = formatExpiry(user.expiresAtPulse);
      const diff = user.expiresAtPulse.getTime() - now.getTime();
      if (pulseExpiry && diff > 0) {
        additionalBuilds.push(`🔵 <b>Pulse:</b> ${pulseExpiry}`);
      }
    }

    if (user.expiresAtGearwire) {
      const gearwireExpiry = formatExpiry(user.expiresAtGearwire);
      const diff = user.expiresAtGearwire.getTime() - now.getTime();
      if (gearwireExpiry && diff > 0) {
        additionalBuilds.push(`🟢 <b>Gear&amp;Wire:</b> ${gearwireExpiry}`); // <- экранируем &
      }
    }

    if (user.expiresAtOuch) {
      const ouchExpiry = formatExpiry(user.expiresAtOuch);
      const diff = user.expiresAtOuch.getTime() - now.getTime();
      if (ouchExpiry && diff > 0) {
        additionalBuilds.push(`🟡 <b>Ouch:</b> ${ouchExpiry}`);
      }
    }

    if (additionalBuilds.length > 0) {
      lines.push('');
      lines.push('<b>📦 Дополнительные сборки:</b>');
      lines.push(...additionalBuilds);
    }

    // Даты регистрации и продления
    lines.push('');
    lines.push(`🕒 <b>Регистрация:</b> ${esc(user.createdAt.toLocaleDateString('ru-RU'))}`);
    
    if (user.lastRenewedAt) {
      lines.push(`🔄 <b>Последнее продление:</b> ${esc(user.lastRenewedAt.toLocaleDateString('ru-RU'))}`);
    }

    // Статусы
    if (user.isFrozen) {
      lines.push('');
      lines.push('⚠️ <b>Статус:</b> Заморожен');
    }

    if (user.status === UserStatus.EXPIRED) {
      lines.push('');
      lines.push('⚠️ <b>Подписка истекла.</b> Продлите доступ на Boosty.');
    }

    // Кнопки управления
    const notifyIcon = user.notifyOnNewBuilds ? '🔔' : '🔕';
    const notifyText = user.notifyOnNewBuilds ? 'Уведомления вкл.' : 'Уведомления выкл.';
    
    // Текст кнопки пароля зависит от наличия пароля
    const passwordBtnText = user.passwordHash 
      ? '🔐 Изменить пароль' 
      : '🔐 Установить пароль';
    
    const keyboard = Markup.inlineKeyboard([
      [Markup.button.callback(`${notifyIcon} ${notifyText}`, `toggle_notify_${userId}`)],
      [Markup.button.callback(passwordBtnText, 'set_password')]
    ]);

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...keyboard
    });

  } catch (error) {
    console.error('❌ Error in profile handler:', error);
    await ctx.reply(`❌ Произошла ошибка при получении профиля: ${error}`);
  }
};