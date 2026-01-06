import { BotContext } from '../../types/context';
import { PromoSystem } from '../../modules/promo';
import { isAdmin } from '../../utils/permissions';
import { Markup } from 'telegraf';

export const promoHandler = async (ctx: BotContext) => {
  try {
    const channelLink = 'https://t.me/fragmcru';
    
    // Сообщение с HTML форматированием
    const message = 
      '🎁 <b>Промо-акция!</b>\n\n' +
      '• Отправьте скриншот подтверждения доната на Boosty и комментарий к нему.\n\n' +
      '• Формат: Фото + текст (обязательно)\n\n' +
      '• <b>Напишите цитату (90 символов макс, включая пробелы) и укажите ник (опционально). Это попадёт в игру с новым обновлением!</b>\n\n' +
      '❗️Подписка на канал даст +2 дня❗️\n' +
      `&gt; &gt; &gt; <a href="${channelLink}">КАНАЛ</a> &lt; &lt; &lt;`;

    await ctx.reply(
      message,
      { 
        // Используем 'HTML' для форматирования
        parse_mode: 'HTML',
        // Оставляем force_reply для ответа пользователя
        reply_markup: {
          force_reply: true,
        }
      }
    );
    ctx.session.awaitingPromoProof = true;
  } catch (error) {
    console.error('Error in promo handler:', error);
    await ctx.reply('❌ Произошла ошибка');
  }
};

export const handlePromoProof = async (ctx: any) => {
  try {
    const userId = BigInt(ctx.from!.id);
    const username = ctx.from!.username;

    if (!ctx.session.awaitingPromoProof || !ctx.message) {
      return;
    }

    // Проверяем наличие фото
    if (!('photo' in ctx.message) || !ctx.message.photo) {
      await ctx.reply('❌ Необходимо отправить фото со скриншотом доната');
      return;
    }

    const photos = ctx.message.photo;
    const photoId = photos[photos.length - 1].file_id;
    const caption = ctx.message.caption || '';

    // Инициализируем буфер, если его нет
    if (!ctx.session.promoPhotoBuffer) {
      ctx.session.promoPhotoBuffer = {
        photos: [],
        caption: ''
      };
    }

    const buffer = ctx.session.promoPhotoBuffer;

    // ВАЖНО: Очищаем старый таймер ПЕРЕД добавлением фото
    if (buffer.timer) {
      clearTimeout(buffer.timer);
      buffer.timer = undefined;
    }

    // Функция отправки заявки (объявляем ДО использования)
    const sendPromoRequest = async () => {
      // Проверяем, что буфер еще существует (не был очищен другим таймером)
      if (!ctx.session.promoPhotoBuffer || ctx.session.promoPhotoBuffer.photos.length === 0) {
        return;
      }

      const currentBuffer = ctx.session.promoPhotoBuffer;
      
      // ВАЖНО: Сразу очищаем буфер, чтобы другие таймеры не сработали
      ctx.session.promoPhotoBuffer = undefined;
      ctx.session.awaitingPromoProof = false;

      // Отправляем заявку с накопленными фото
      const result = await PromoSystem.createPromoRequest(
        userId, 
        username, 
        currentBuffer.caption || '', 
        currentBuffer.photos
      );

      if (result.success) {
        await ctx.reply(`✅ Заявка #${result.requestId} с ${currentBuffer.photos.length} фото отправлена на рассмотрение!`);
      } else {
        await ctx.reply(`❌ ${result.message}`);
        // При ошибке возвращаем возможность отправить заново
        ctx.session.awaitingPromoProof = true;
      }
    };

    // Добавляем фото в буфер (максимум 3)
    if (buffer.photos.length < 3) {
      buffer.photos.push(photoId);
      
      // Обновляем caption, если он есть
      if (caption) {
        buffer.caption = caption;
      }

      await ctx.reply(`📸 Фото ${buffer.photos.length}/3 добавлено. Ожидаю еще фото или отправка через 2 сек...`);
    } else {
      await ctx.reply('⚠️ Максимум 3 фото. Отправляю текущие...');
      // Если уже 3 фото, сразу отправляем без ожидания
      await sendPromoRequest();
      return;
    }

    // Устанавливаем ОДИН новый таймер
    buffer.timer = setTimeout(sendPromoRequest, 2000);

  } catch (error) {
    console.error('Error handling promo proof:', error);
    await ctx.reply('❌ Произошла ошибка');
    // Очищаем буфер при ошибке
    if (ctx.session.promoPhotoBuffer?.timer) {
      clearTimeout(ctx.session.promoPhotoBuffer.timer);
    }
    ctx.session.promoPhotoBuffer = undefined;
  }
};

export const handlePromoGrant = async (ctx: any) => {
  const adminId = BigInt(ctx.from!.id);
  if (!(await isAdmin(adminId))) return ctx.answerCbQuery('❌ Недостаточно прав');
  
  const requestId = parseInt(ctx.match[1]);
  await PromoSystem.showGrantAccessMenu(ctx, requestId);
};

export const handlePromoAccess = async (ctx: any) => {
  const adminId = BigInt(ctx.from!.id);
  if (!(await isAdmin(adminId))) return ctx.answerCbQuery('❌ Недостаточно прав');

  const requestId = parseInt(ctx.match[1]);
  const accessType = ctx.match[2];
  await PromoSystem.selectAccessType(ctx, requestId, accessType);
};

export const handlePromoAddSelection = async (ctx: any) => {
  const adminId = BigInt(ctx.from!.id);
  if (!(await isAdmin(adminId))) return ctx.answerCbQuery('❌ Недостаточно прав');
  
  const requestId = parseInt(ctx.match[1]);
  const accessType = ctx.match[2];
  const days = parseInt(ctx.match[3]);
  await PromoSystem.addToSelection(ctx, requestId, accessType, days);
};

export const handlePromoConfirm = async (ctx: any) => {
  const adminId = BigInt(ctx.from!.id);
  if (!(await isAdmin(adminId))) return ctx.answerCbQuery('❌ Недостаточно прав');

  const requestId = parseInt(ctx.match[1]);
  await PromoSystem.confirmAndGrant(ctx, requestId, adminId);
};

export const handlePromoClearSelection = async (ctx: any) => {
  const adminId = BigInt(ctx.from!.id);
  if (!(await isAdmin(adminId))) return ctx.answerCbQuery('❌ Недостаточно прав');

  const requestId = parseInt(ctx.match[1]);
  await PromoSystem.clearSelection(ctx, requestId);
};

export const handlePromoReject = async (ctx: any) => {
  const adminId = BigInt(ctx.from!.id);
  if (!(await isAdmin(adminId))) return ctx.answerCbQuery('❌ Недостаточно прав');

  const requestId = parseInt(ctx.match[1]);
  const result = await PromoSystem.rejectRequest(requestId, adminId);

  if (result.success) {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
    await ctx.answerCbQuery('❌ Заявка отклонена');
  } else {
    await ctx.answerCbQuery('❌ ' + result.message);
  }
};

export const handlePromoBack = async (ctx: any) => {
  const adminId = BigInt(ctx.from!.id);
  if (!(await isAdmin(adminId))) return ctx.answerCbQuery('❌ Недостаточно прав');

  const requestId = parseInt(ctx.match[1]);
  await PromoSystem.showGrantAccessMenu(ctx, requestId);
};

export const handlePromoRequestCustomDuration = async (ctx: any) => {
  const adminId = BigInt(ctx.from!.id);
  if (!(await isAdmin(adminId))) return ctx.answerCbQuery('❌ Недостаточно прав');

  const match = ctx.match as RegExpExecArray;
  const requestId = parseInt(match[1]);
  const accessType = match[2];

  await PromoSystem.requestCustomDuration(ctx, requestId, accessType);
};

export const handlePromoCustomDurationInput = async (ctx: BotContext) => {
  if (!ctx.message || !('text' in ctx.message) || !ctx.session.awaitingPromoCustomDays) return;

  const { requestId, accessType } = ctx.session.awaitingPromoCustomDays;
  const input = ctx.message.text.trim().toLowerCase();

  // --- ИЗМЕНЕНИЕ ЗДЕСЬ ---
  let days = 0;
  let success = false;

  if (input.endsWith('s')) { // Секунды
    const seconds = parseInt(input.replace('s', ''), 10);
    if (!isNaN(seconds)) {
      days = seconds / (24 * 60 * 60); // Переводим секунды в "дробные" дни
      success = true;
    }
  } else if (input.endsWith('m')) { // Минуты
    const minutes = parseInt(input.replace('m', ''), 10);
    if (!isNaN(minutes)) {
      days = minutes / (24 * 60);
      success = true;
    }
  } else if (input.endsWith('h')) { // Часы
    const hours = parseInt(input.replace('h', ''), 10);
    if (!isNaN(hours)) {
      days = hours / 24;
      success = true;
    }
  } else { // Дни (по умолчанию)
    const parsedDays = parseInt(input, 10);
    if (!isNaN(parsedDays)) {
      days = parsedDays;
      success = true;
    }
  }

  if (!success || days <= 0) {
    await ctx.reply('❌ Ошибка. Неверный формат. \nПример: `45`, `10s`, `5m`, `2h`.');
    return;
  }
  
  ctx.session.awaitingPromoCustomDays = undefined;
  await PromoSystem.addToSelection(ctx, requestId, accessType, days);
};