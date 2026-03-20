import { BotContext } from '../../types/context';
import { checkPromoCooldown, activatePromoCode } from '../../modules/promo/codes';
import { prisma } from '../../database/prisma';

export const promoCodeHandler = async (ctx: BotContext) => {
  if (!ctx.message || !('text' in ctx.message)) return;

  const parts = ctx.message.text.trim().split(/\s+/);
  // /promo CODE
  if (parts.length < 2) {
    return ctx.reply('Использование: /promo <ВАШ_КОД>');
  }

  const code = parts[1];
  const userId = ctx.from!.id;

  // 1. Получаем юзера с анти-спам полями
  const user = await prisma.user.findUnique({
    where: { telegramId: BigInt(userId) }
  });

  if (!user) return ctx.reply('Ошибка пользователя.');

  // 1.5 Проверка: Только для новых или неактивных (не для действующих подписчиков)
  if (user.status === 'active' && user.expiresAtFragment && user.expiresAtFragment > new Date()) {
      return ctx.reply('⛔ Промокоды доступны только для новых пользователей или тех, у кого нет активной подписки.');
  }

  // 2. Проверяем кулдаун
  const cooldown = await checkPromoCooldown(user);
  if (!cooldown.allowed) {
    const secondsLeft = Math.ceil((cooldown.waitTimeMs || 0) / 1000);
    
    let timeText = `${secondsLeft} сек.`;
    if (secondsLeft > 60) timeText = `${Math.ceil(secondsLeft / 60)} мин.`;
    if (secondsLeft > 3600) timeText = `${Math.ceil(secondsLeft / 3600)} ч.`;
    
    return ctx.reply(`⏳ Слишком много попыток. Попробуйте через ${timeText}`);
  }

  // 3. Активируем
  const result = await activatePromoCode(BigInt(userId), code, ctx);
  
  await ctx.reply(result.message);
};
