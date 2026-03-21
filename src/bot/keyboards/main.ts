import { Markup } from 'telegraf';

const LAUNCHER_URL =
  'https://github.com/cutexxgirl/Fragment-Launcher-Public/releases/download/1.1.0/FragmentLauncher-setup-1.1.0.exe';

type KeyboardUser = {
  status: string;
  isFrozen: boolean;
  hasPromoAccess: boolean;
};

export const mainKeyboard = (user: KeyboardUser, isAdmin: boolean) => {
  const buttons = [['👤 Профиль', '🆘 Поддержка']];

  const showDownload = (user.status === 'active' || user.status === 'shared') && !user.isFrozen;

  if (!showDownload) {
    if (user.hasPromoAccess) {
      // buttons.push(['🎃 Акция']);
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

export const getLauncherUrl = () => LAUNCHER_URL;
