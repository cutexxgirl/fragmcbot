import { BotContext } from '../../types/context';
import { Markup } from 'telegraf';
import { getLauncherUrl } from '../keyboards/main';

export const instructionHandler = async (ctx: BotContext) => {
  try {
    const text = `
📖 **Инструкция по началу игры:**

1. **Установите пароль** в боте (Кнопка "👤 Профиль" -> "🔐 Установить пароль").
2. **Скачайте лаунчер** по кнопке ниже.
3. **Запустите лаунчер** и войдите, используя ваш токен и пароль.
4. Выберите нужную сборку и нажмите "Играть".

Приятной игры! 🎮
    `.trim();

    await ctx.reply(text, {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.url('🚀 Скачать лаунчер', getLauncherUrl())]
      ])
    });

  } catch (error) {
    console.error('Error in instruction handler:', error);
    await ctx.reply('❌ Ошибка при получении инструкции');
  }
};
