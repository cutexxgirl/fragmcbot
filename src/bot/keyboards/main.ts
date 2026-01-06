import { Markup } from 'telegraf';
import { User } from '@prisma/client';

// Ссылка на скачивание лаунчера 
const LAUNCHER_URL = 'https://github.com/cutexxgirl/';

export const mainKeyboard = (user: Pick<User, 'status' | 'isFrozen' | 'hasPromoAccess'>, isAdmin: boolean) => {
  const buttons = [['👤 Профиль', '🆘 Поддержка']];

  const showDownload = user.status === 'active' && !user.isFrozen;

  if (!showDownload && user.hasPromoAccess) { 
    buttons.push(['🎁 Акция']);
  }
  
  if (showDownload) {
      buttons.push(['🚀 Скачать лаунчер']);
      buttons.push(['✈️ Канал', '💬 Discord']);
  }

  if (isAdmin) {
    buttons.push(['⚙️ Админ-панель']);
  }

  return Markup.keyboard(buttons).resize();
};

// Ссылка для скачивания лаунчера (экспорт для использования в обработчике)
export const getLauncherUrl = () => LAUNCHER_URL;