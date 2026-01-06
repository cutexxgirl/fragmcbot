import cron from 'node-cron';
import { prisma } from '../../database/prisma';
import { UserStatus } from '../../config';
import { syncUserStatus } from '../../modules/lifecycle';

export const startCronJobs = () => {
  console.log('🕐 Initializing CRON jobs...');

  // Единая cron-задача каждые 5 минут
  cron.schedule('*/5 * * * *', async () => {
    console.log(`[Cron] Running lifecycle sync at ${new Date().toISOString()}`);
    
    try {
      // 1. Находим всех активных пользователей
      const activeUsers = await prisma.user.findMany({
        where: {
          status: UserStatus.ACTIVE
        },
        select: {
          telegramId: true
        }
      });

      console.log(`[Cron] Found ${activeUsers.length} active users to sync`);

      // 2. Синхронизируем каждого
      for (const user of activeUsers) {
        try {
          await syncUserStatus(user.telegramId);
        } catch (error) {
          console.error(`[Cron] Error syncing user ${user.telegramId}:`, error);
        }
      }

      // 3. Находим все невыполненные задачи с прошедшим временем
      const now = new Date();
      const pendingTasks = await prisma.scheduledTask.findMany({
        where: {
          executed: false,
          scheduledFor: { lte: now }
        }
      });

      console.log(`[Cron] Found ${pendingTasks.length} pending tasks`);

      // 4. Обрабатываем каждую задачу
      for (const task of pendingTasks) {
        try {
          // Синхронизируем пользователя из задачи
          await syncUserStatus(task.userId);
          
          // Помечаем задачу как выполненную
          await prisma.scheduledTask.update({
            where: { id: task.id },
            data: {
              executed: true,
              executedAt: new Date()
            }
          });
        } catch (error) {
          console.error(`[Cron] Error processing task ${task.id}:`, error);
        }
      }

      console.log('[Cron] ✅ Lifecycle sync completed');
    } catch (error) {
      console.error('[Cron] ❌ Fatal error in lifecycle sync:', error);
    }
  });

  console.log('✅ CRON jobs started successfully');
  console.log('   - Lifecycle sync: every 5 minutes');
};

/**
 * Ручная проверка всех подписок (для вызова из админки)
 */
export async function checkAllSubscriptions() {
  console.log('🔄 Manual subscription check triggered from admin panel');
  
  const activeUsers = await prisma.user.findMany({
    where: {
      status: UserStatus.ACTIVE
    }
  });

  console.log(`[Manual] Checking ${activeUsers.length} active users`);

  let processed = 0;
  let errors = 0;

  for (const user of activeUsers) {
    try {
      await syncUserStatus(user.telegramId);
      processed++;
    } catch (error) {
      console.error(`[Manual] Error syncing user ${user.telegramId}:`, error);
      errors++;
    }
  }

  console.log(`[Manual] ✅ Check completed: ${processed} processed, ${errors} errors`);
  
  return {
    total: activeUsers.length,
    processed,
    errors
  };
}