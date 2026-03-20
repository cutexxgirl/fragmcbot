import { Markup } from 'telegraf';
import { User } from '@prisma/client';

// Ссылка на скачивание лаунчера 
const LAUNCHER_URL = 'https://github.com/cutexxgirl/Fragment-Launcher-Public/releases/download/1.1.0/FragmentLauncher-setup-1.1.0.exe'

export const mainKeyboard = (user: Pick<User, 'status' | 'isFrozen' | 'hasPromoAccess'>, isAdmin: boolean) => {
  const buttons = [['👤 Профиль', '🆘 Поддержка']];

  const showDownload = (user.status === 'active' || user.status === 'shared') && !user.isFrozen;

  if (!showDownload) {
      if (user.hasPromoAccess) {
         // buttons.push(['🎁 Акция']); 
      }
      buttons.push(['📖 Инструкция']);
  }
  
  if (showDownload) {
      buttons.push(['🚀 Скачать лаунчер']);
      buttons.push(['✈️ Канал']);
  }

  if (isAdmin) {
    buttons.push(['⚙️ Админ-панель']);
  }

  return Markup.keyboard(buttons).resize();
};

// Ссылка для скачивания лаунчера (экспорт для использования в обработчике)
export const getLauncherUrl = () => LAUNCHER_URL;