import { prisma } from '../../database/prisma';
import { bot } from '../../bot';

const REQUIRED_CHANNEL_ID = '-1002464218138';

export async function validateSharedAccess() {
  console.log('🔄 Checking shared access validity...');
  
  const sharedUsers = await prisma.user.findMany({
    where: { status: 'shared' },
    include: { sharedToMe: { include: { owner: true } } } // Получаем запись о том, кто выдал
  });

  for (const user of sharedUsers) {
    try {
      // 1. Проверка срока действия
      if (user.expiresAtExtra && user.expiresAtExtra < new Date()) {
        await revokeAccess(user.telegramId, 'Срок действия подарка истек.');
        continue;
      }

      // 2. Проверка канала
      try {
        const member = await bot.telegram.getChatMember(REQUIRED_CHANNEL_ID, Number(user.telegramId));
        if (['left', 'kicked'].includes(member.status)) {
          await revokeAccess(user.telegramId, 'Вы покинули обязательный канал.');
          continue;
        }
      } catch (e) {
        console.error(`Failed to check channel for ${user.telegramId}`, e);
      }
      
      // 3. Проверка владельца (для Spark логика уже в датах, но на всякий случай)
      // Если владелец вдруг перестал быть активным или его подписка истекла раньше срока шаринга (что странно, но возможно)
      // Пока пропустим, так как при выдаче мы уже установили даты.
      
      // Но если владелец ОТОЗВАЛ доступ (удалил запись SharedAccess), то статус юзера должен был обновиться.
      // Если есть "висячие" статусы SHARED без записи SharedAccess:
      if (user.sharedToMe.length === 0) {
          await revokeAccess(user.telegramId, 'Доступ был отозван владельцем.');
          continue;
      }

    } catch (error) {
      console.error(`Error validating user ${user.telegramId}:`, error);
    }
  }
}

async function revokeAccess(userId: bigint, reason: string) {
  console.log(`❌ Revoking shared access for ${userId}: ${reason}`);
  
  // Удаляем запись SharedAccess
  await prisma.sharedAccess.deleteMany({
      where: { guestId: userId }
  });

  // Обновляем юзера
  await prisma.user.update({
    where: { telegramId: userId },
    data: {
      status: 'inactive',
      giftedById: null,
      expiresAtExtra: null,
      expiresAtFragment: null
    }
  });

  // Уведомляем
  try {
    await bot.telegram.sendMessage(Number(userId), `❌ Ваш подарочный доступ отключен.\nПричина: ${reason}`);
  } catch (e) {}
}
