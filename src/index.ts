import { prisma } from './database/prisma';
import { startBot } from './bot';
import { startCronJobs } from './services/cron/index';
import { startAPI } from './api';
import { config } from './config';
import { BuildManager } from './modules/builds/manager';

async function initializeAdmin() {
  try {
    const admin = await prisma.admin.findUnique({
      where: { telegramId: config.bot.adminId },
    });

    if (!admin) {
      await prisma.admin.create({
        data: {
          telegramId: config.bot.adminId,
          role: 'admin',
          isActive: true,
        },
      });
      console.log('✅ Main admin initialized');
    }
  } catch (error) {
    console.error('Failed to initialize admin:', error);
  }
}

async function main() {
  try {
    // Проверяем подключение к БД
    await prisma.$connect();
    console.log('✅ Database connected');

    // Инициализируем админа
    await initializeAdmin();

    // Инициализируем сборки
    // await BuildManager.initialize();

    // Запускаем API
    await startAPI();

    // Запускаем бота
    await startBot();

  } catch (error) {
    console.error('❌ Failed to start application:', error);
    process.exit(1);
  }
}

main();