import { BotContext } from '../../types/context';
import { prisma } from '../../database/prisma';
import { mainKeyboard } from '../keyboards/main';
import { isAdmin } from '../../utils/permissions';
import { SUBSCRIPTION_NAMES, config } from '../../config';
import { syncUserStatus } from '../../modules/lifecycle';

export const startHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    const username = ctx.from!.username || null;
    const firstName = ctx.from!.first_name || null;
    const userIsAdmin = await isAdmin(userId);

    // Обновляем username и firstName если нужно
    const existingUser = await prisma.user.findUnique({
      where: { telegramId: userId },
    });

    if (existingUser && (existingUser.username !== username || existingUser.firstName !== firstName)) {
      await prisma.user.update({
        where: { telegramId: userId },
        data: { username, firstName },
      });
    }

    // Синхронизируем статус пользователя
    const result = await syncUserStatus(userId);

    // Получаем обновленного пользователя для клавиатуры
    const updatedUser = await prisma.user.findUnique({
      where: { telegramId: userId },
    });

    if (!updatedUser) {
      await ctx.reply('Произошла ошибка. Попробуйте позже.');
      return;
    }

    // Формируем ответ в зависимости от результата
    switch (result.status) {
      case 'BANNED':
        await ctx.reply(
          result.message || 'Вы заблокированы.',
          mainKeyboard(updatedUser, userIsAdmin)
        );
        break;

      case 'BOOSTY_ACTIVE':
        const levelName = result.level ? SUBSCRIPTION_NAMES[result.level] : 'Неизвестно';
        const expiryDate = result.expiresAt 
          ? result.expiresAt.toLocaleDateString('ru-RU')
          : 'неизвестна';

        await ctx.reply(
          `✅ Добро пожаловать в Fragment! 🎮\n\n` +
          `Ваша подписка активна.\n` +
          `📊 Уровень: ${levelName}\n` +
          `📅 Действует до: ${expiryDate}`,
          mainKeyboard(updatedUser, userIsAdmin)
        );

        // Напоминание про пароль для новых пользователей
        if (!updatedUser.passwordHash) {
          await ctx.reply(
            '🔐 <b>Не забудьте установить пароль!</b>\n\n' +
            'Для входа в лаунчер вам понадобится пароль.\n' +
            'Нажмите "👤 Профиль" → "🔐 Установить пароль"',
            { parse_mode: 'HTML' }
          );
        }
        break;

      case 'PROMO_ACTIVE':
        const promoExpiryDate = result.expiresAt
          ? result.expiresAt.toLocaleDateString('ru-RU')
          : 'неизвестна';

        await ctx.reply(
          `🎁 Добро пожаловать в Fragment! 🎮\n\n` +
          `Ваш акционный доступ активен.\n` +
          `📊 Уровень: Новичок\n` +
          `📅 Действует до: ${promoExpiryDate}`,
          mainKeyboard(updatedUser, userIsAdmin)
        );

        // Напоминание про пароль для новых пользователей
        if (!updatedUser.passwordHash) {
          await ctx.reply(
            '🔐 <b>Не забудьте установить пароль!</b>\n\n' +
            'Для входа в лаунчер вам понадобится пароль.\n' +
            'Нажмите "👤 Профиль" → "🔐 Установить пароль"',
            { parse_mode: 'HTML' }
          );
        }
        break;

      case 'NO_ACCESS':
        // Разные сообщения в зависимости от состояния
        if (updatedUser.isFrozen && updatedUser.status === 'active') {
          // Прогульщик
          await ctx.reply(
            `⚠️ **Ваша подписка заморожена**\n\n` +
            `Вы покинули группу до окончания срока подписки.\n` +
            `Чтобы возобновить доступ, вернитесь в группу Boosty.\n\n` +
            `Срок подписки истечет: ${updatedUser.expiresAtFragment?.toLocaleDateString('ru-RU') || 'неизвестно'}`,
            {
              parse_mode: 'Markdown',
              ...mainKeyboard(updatedUser, userIsAdmin)
            }
          );
        } else if (updatedUser.status === 'expired') {
          // Истекла подписка
          await ctx.reply(
            `❌ **Ваша подписка истекла**\n\n` +
            `Пожалуйста, продлите её на [Boosty](https://boosty.to/frgmc)\n\n` +
            `После продления вернитесь в группу и нажмите /start`,
            {
              parse_mode: 'Markdown',
              ...mainKeyboard(updatedUser, userIsAdmin)
            }
          );
        } else {
          // Новый пользователь
          const globalPromo = await prisma.admin.findUnique({
            where: { telegramId: config.bot.adminId },
            select: { isPromoEnabled: true }
          });

          const promoText = globalPromo?.isPromoEnabled 
            ? '\n\n💡 Сейчас доступна промо-акция! Используйте кнопку "Акция" в меню.'
            : '';

          await ctx.reply(
            `👋 Добро пожаловать в Fragment!\n\n` +
            `Для активации подписки необходимо:\n` +
            `1. Оформить подписку на [Boosty](https://boosty.to/frgmc)\n` +
            `2. Вступить в одну из закрытых групп\n` +
            `3. Нажать /start для активации\n\n` +
            `❓ Если у вас есть подписка, но доступ не активируется:\n` +
            `Примите приглашение у бота @boosty_to_bot${promoText}`,
            {
              parse_mode: 'Markdown',
              ...mainKeyboard(updatedUser, userIsAdmin)
            }
          );
        }
        break;

      case 'ERROR':
        await ctx.reply(
          result.message || 'Произошла ошибка. Попробуйте позже.',
          mainKeyboard(updatedUser, userIsAdmin)
        );
        break;
    }

  } catch (error) {
    console.error('Error in start handler:', error);
    await ctx.reply('Произошла ошибка. Попробуйте позже.');
  }
};