import { BotContext } from '../../types/context';
import { prisma } from '../../database/prisma';
import bcrypt from 'bcrypt';

// Начало установки пароля (первый раз)
export const startPasswordFlow = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    const user = await prisma.user.findUnique({
      where: { telegramId: userId },
      select: { passwordHash: true }
    });

    ctx.session.awaitingPassword = true;

    if (user?.passwordHash) {
      // Смена пароля
      ctx.session.isChangingPassword = true;
      await ctx.reply(
        '🔐 <b>Смена пароля</b>\n\n' +
        'Введите новый пароль (минимум 6 символов).\n\n' +
        '⚠️ Не забудьте обновить пароль в месте, где вы его храните!',
        { parse_mode: 'HTML' }
      );
    } else {
      // Первая установка
      ctx.session.isChangingPassword = false;
      await ctx.reply(
        '🔐 <b>Установка пароля</b>\n\n' +
        'Придумайте надёжный пароль для входа в лаунчер.\n\n' +
        '📋 <b>Требования:</b>\n' +
        '• Минимум 6 символов\n' +
        '• Можно использовать буквы, цифры и спецсимволы\n\n' +
        '⚠️ <b>ВАЖНО:</b>\n' +
        '• Запишите пароль в надёжное место (НЕ в Телеграм!)\n' +
        '• Мы НЕ храним пароль в открытом виде — восстановить его нельзя\n' +
        '• Никому не сообщайте пароль, даже администрации\n\n' +
        'Введите пароль:',
        { parse_mode: 'HTML' }
      );
    }
  } catch (error) {
    console.error('Error starting password flow:', error);
    await ctx.reply('❌ Ошибка при запуске смены пароля.');
  }
};

// Обработка ввода пароля
export const handlePasswordInput = async (ctx: BotContext) => {
  try {
    if (!ctx.message || !('text' in ctx.message)) return;
    
    const password = ctx.message.text;
    const userId = BigInt(ctx.from!.id);

    // Проверка длины
    if (password.length < 6) {
      await ctx.reply('⚠️ Пароль должен быть не менее 6 символов. Попробуйте ещё раз.');
      return;
    }

    // Хэшируем и сохраняем
    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);

    await prisma.user.update({
      where: { telegramId: userId },
      data: { passwordHash },
    });

    // Сбрасываем состояние
    const wasChanging = ctx.session.isChangingPassword;
    ctx.session.awaitingPassword = false;
    ctx.session.isChangingPassword = false;

    // Разные сообщения для установки и смены
    if (wasChanging) {
      await ctx.reply('✅ Пароль успешно изменён!');
    } else {
      await ctx.reply(
        '✅ <b>Пароль успешно установлен!</b>\n\n' +
        'Теперь вы можете войти в лаунчер, используя:\n' +
        '• Токен доступа (из профиля)\n' +
        '• Этот пароль',
        { parse_mode: 'HTML' }
      );
    }

  } catch (error) {
    console.error('Error saving password:', error);
    await ctx.reply('❌ Ошибка при сохранении пароля.');
    ctx.session.awaitingPassword = false;
    ctx.session.isChangingPassword = false;
  }
};
