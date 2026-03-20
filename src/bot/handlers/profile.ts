import { BotContext } from '../../types/context';
import { prisma } from '../../database/prisma';
import { UserStatus, SubscriptionLevel, SUBSCRIPTION_NAMES } from '../../config';
import { Markup } from 'telegraf';



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

    // HTML экранирование
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
    ];

    // Fragment ID
    if (user.fragmentId) {
      lines.push(`🔖 <b>FID:</b> <code>${esc(user.fragmentId)}</code>`);
    }
    lines.push('');

    // Статус подписки
    const isActive = (user.status === UserStatus.ACTIVE || user.status === UserStatus.SHARED) && !user.isFrozen;
    const statusIcon = isActive ? '✅' : '❌';
    const levelName = user.subscriptionLevel
      ? SUBSCRIPTION_NAMES[user.subscriptionLevel as SubscriptionLevel]
      : 'Нет';

    // Статус для подаренного доступа
    if (user.status === UserStatus.SHARED) {
      lines.push(`🎁 <b>Подаренный доступ:</b> ✅ Активен`);
    } else {
      lines.push(`${statusIcon} <b>Подписка:</b> ${esc(levelName)}`);
    }

    if (user.expiresAtFragment) {
      const fragmentExpiry = formatExpiry(user.expiresAtFragment);
      if (fragmentExpiry) {
        lines.push(`   └ ${fragmentExpiry}`);
      }
    }

    // Токен доступа
    lines.push('');
    if (isActive && user.accessToken) {
      lines.push(`🔑 <b>Токен доступа:</b> <code>${esc(user.accessToken)}</code>`);
      lines.push(`   └ Активен`);
    } else {
      lines.push(`🔑 <b>Токен доступа:</b> ❌ Неактивен`);
    }

    // Дополнительные сборки (через expiresAtExtra)
    if (user.expiresAtExtra) {
      const extraExpiry = formatExpiry(user.expiresAtExtra);
      const diff = user.expiresAtExtra.getTime() - now.getTime();
      if (extraExpiry && diff > 0) {
        lines.push('');
        lines.push(`📦 <b>Доп. сборки:</b> ${extraExpiry}`);
      }
    }

    // Даты
    lines.push('');
    lines.push(`🕒 <b>Регистрация:</b> ${esc(user.createdAt.toLocaleDateString('ru-RU'))}`);
    
    if (user.lastRenewedAt) {
      lines.push(`🔄 <b>Продление:</b> ${esc(user.lastRenewedAt.toLocaleDateString('ru-RU'))}`);
    }

    // Предупреждения
    if (user.isFrozen) {
      lines.push('');
      lines.push('⚠️ <b>Статус:</b> Заморожен');
    }

    if (user.status === UserStatus.EXPIRED) {
      lines.push('');
      lines.push('⚠️ <b>Подписка истекла.</b> Продлите на Boosty.');
    }

    // Кнопка переключения уведомлений удалена
    const passwordBtnText = user.passwordHash ? '🔐 Изменить пароль' : '🔐 Установить пароль';
    
    // Кнопка дарения для Legend/Spark
    const buttons = [
      [Markup.button.callback(passwordBtnText, 'set_password')]
    ];

    // Кнопка "Подарить доступ" для Legend/Spark
    if (user.subscriptionLevel === SubscriptionLevel.LEGEND || 
        user.subscriptionLevel === SubscriptionLevel.SPARK) {
      buttons.push([Markup.button.callback('🎁 Подарить доступ', 'share_access')]);
    }

    const keyboard = Markup.inlineKeyboard(buttons);

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      ...keyboard
    });

  } catch (error) {
    console.error('❌ Error in profile handler:', error);
    await ctx.reply(`❌ Произошла ошибка: ${error}`);
  }
};