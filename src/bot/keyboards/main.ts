import { Markup } from 'telegraf';

const LAUNCHER_URL = 'https://fragmc.ru/downloads/FragmentLauncher-setup.exe';

type KeyboardUser = {
  status: string;
  isFrozen: boolean;
};

export const mainKeyboard = (user: KeyboardUser, isAdmin: boolean) => {
  const buttons = [['👤 Профиль', '🆘 Поддержка']];

  const showDownload = (user.status === 'active' || user.status === 'shared') && !user.isFrozen;

  if (!showDownload) {
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
