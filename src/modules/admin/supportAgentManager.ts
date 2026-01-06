import { prisma } from '../../database/prisma';
import { bot } from '../../bot';

export class SupportAgentManager {
  
  /**
   * Добавление агента поддержки
   */
  static async addAgent(telegramId: bigint): Promise<{ success: boolean; message: string }> {
    try {
      // Получаем информацию о пользователе из Telegram
      let username: string | undefined;
      
      try {
        const chat = await bot.telegram.getChat(Number(telegramId));
        if ('username' in chat) {
          username = chat.username;
        }
      } catch (error) {
        console.log('Cannot fetch user info from Telegram');
      }

      // Проверяем, существует ли уже
      const existing = await prisma.supportAgent.findUnique({
        where: { telegramId },
      });

      if (existing) {
        // Обновляем
        await prisma.supportAgent.update({
          where: { telegramId },
          data: {
            username,
            isActive: true,
          },
        });
        return { 
          success: true, 
          message: `Агент поддержки обновлён:\n👤 @${username || 'no_username'}\n🆔 ${telegramId}` 
        };
      }

      // Создаём нового
      await prisma.supportAgent.create({
        data: {
          telegramId,
          username,
          isActive: true,
        },
      });

      // Уведомляем агента
      try {
        await bot.telegram.sendMessage(
          Number(telegramId),
          '✅ Вы добавлены в команду технической поддержки!\n\n' +
          'Теперь вы можете принимать тикеты в группе поддержки.'
        );
      } catch (error) {
        console.log('Cannot notify new agent');
      }

      return { 
        success: true, 
        message: `✅ Агент поддержки добавлен:\n👤 @${username || 'no_username'}\n🆔 ${telegramId}` 
      };

    } catch (error) {
      console.error('Error adding support agent:', error);
      return { success: false, message: 'Ошибка при добавлении агента' };
    }
  }

  /**
   * Удаление агента поддержки
   */
  static async removeAgent(telegramId: bigint): Promise<{ success: boolean; message: string }> {
    try {
      const agent = await prisma.supportAgent.findUnique({
        where: { telegramId },
      });

      if (!agent) {
        return { success: false, message: 'Агент не найден' };
      }

      await prisma.supportAgent.update({
        where: { telegramId },
        data: { isActive: false },
      });

      // Уведомляем агента
      try {
        await bot.telegram.sendMessage(
          Number(telegramId),
          '❌ Вы удалены из команды технической поддержки.'
        );
      } catch (error) {
        console.log('Cannot notify removed agent');
      }

      return { 
        success: true, 
        message: `✅ Агент удалён:\n👤 @${agent.username || 'no_username'}\n🆔 ${telegramId}` 
      };

    } catch (error) {
      console.error('Error removing support agent:', error);
      return { success: false, message: 'Ошибка при удалении агента' };
    }
  }

  /**
   * Список всех агентов
   */
  static async listAgents(): Promise<string> {
    try {
      const agents = await prisma.supportAgent.findMany({
        where: { isActive: true },
        orderBy: { createdAt: 'asc' },
      });

      if (agents.length === 0) {
        return '📋 Список агентов поддержки пуст';
      }

      let message = '📋 **Агенты технической поддержки:**\n\n';

      for (const agent of agents) {
        message += `👤 @${agent.username || 'no_username'}\n`;
        message += `🆔 ID: \`${agent.telegramId}\`\n`;
        message += `📅 Добавлен: ${agent.createdAt.toLocaleDateString('ru-RU')}\n\n`;
      }

      return message;

    } catch (error) {
      console.error('Error listing agents:', error);
      return '❌ Ошибка при получении списка агентов';
    }
  }

  /**
   * Статистика агента за период
   */
  static async getAgentStats(
    telegramId: bigint,
    period: 'day' | 'week' | 'month'
  ): Promise<string> {
    try {
      const agent = await prisma.supportAgent.findUnique({
        where: { telegramId },
      });

      if (!agent) {
        return '❌ Агент не найден';
      }

      const now = new Date();
      let startDate = new Date();

      switch (period) {
        case 'day':
          startDate.setDate(now.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(now.getMonth() - 1);
          break;
      }

      // Тикеты, принятые агентом
      const assignedTickets = await prisma.supportTicket.count({
        where: {
          assignedBy: telegramId,
          createdAt: {
            gte: startDate,
          },
        },
      });

      // Тикеты, перехваченные агентом
      const reassignedToAgent = await prisma.supportTicket.count({
        where: {
          agentId: telegramId,
          assignedBy: {
            not: telegramId,
          },
          createdAt: {
            gte: startDate,
          },
        },
      });

      // Тикеты, перехваченные у агента
      const reassignedFromAgent = await prisma.supportTicket.count({
        where: {
          assignedBy: telegramId,
          agentId: {
            not: telegramId,
          },
          createdAt: {
            gte: startDate,
          },
        },
      });

      // Всего тикетов за период
      const totalTickets = await prisma.supportTicket.count({
        where: {
          createdAt: {
            gte: startDate,
          },
        },
      });

      const percentage = totalTickets > 0 
        ? ((assignedTickets / totalTickets) * 100).toFixed(1)
        : '0';

      const reassignToPercent = assignedTickets > 0
        ? ((reassignedToAgent / assignedTickets) * 100).toFixed(1)
        : '0';

      const reassignFromPercent = assignedTickets > 0
        ? ((reassignedFromAgent / assignedTickets) * 100).toFixed(1)
        : '0';

      const periodName = period === 'day' ? 'день' : period === 'week' ? 'неделю' : 'месяц';

      return `
📊 **Статистика агента за ${periodName}**

👤 @${agent.username || 'no_username'}
🆔 ${telegramId}

📈 **Принято тикетов:** ${assignedTickets} (${percentage}% от всех)
🔄 **Перехватил тикетов:** ${reassignedToAgent} (${reassignToPercent}%)
↩️ **Перехвачено у него:** ${reassignedFromAgent} (${reassignFromPercent}%)

📋 **Всего тикетов за период:** ${totalTickets}
      `.trim();

    } catch (error) {
      console.error('Error getting agent stats:', error);
      return '❌ Ошибка при получении статистики';
    }
  }

  /**
   * Общая статистика по всем агентам
   */
  static async getAllAgentsStats(period: 'day' | 'week' | 'month'): Promise<string> {
    try {
      const agents = await prisma.supportAgent.findMany({
        where: { isActive: true },
      });

      if (agents.length === 0) {
        return '📋 Нет активных агентов';
      }

      const now = new Date();
      let startDate = new Date();

      switch (period) {
        case 'day':
          startDate.setDate(now.getDate() - 1);
          break;
        case 'week':
          startDate.setDate(now.getDate() - 7);
          break;
        case 'month':
          startDate.setMonth(now.getMonth() - 1);
          break;
      }

      const totalTickets = await prisma.supportTicket.count({
        where: {
          createdAt: {
            gte: startDate,
          },
        },
      });

      const periodName = period === 'day' ? 'день' : period === 'week' ? 'неделю' : 'месяц';

      let message = `📊 **Статистика поддержки за ${periodName}**\n\n`;
      message += `📋 Всего тикетов: ${totalTickets}\n\n`;

      for (const agent of agents) {
        const assignedTickets = await prisma.supportTicket.count({
          where: {
            assignedBy: agent.telegramId,
            createdAt: {
              gte: startDate,
            },
          },
        });

        const percentage = totalTickets > 0 
          ? ((assignedTickets / totalTickets) * 100).toFixed(1)
          : '0';

        message += `👤 @${agent.username || 'no_username'}\n`;
        message += `   Принято: ${assignedTickets} (${percentage}%)\n\n`;
      }

      return message;

    } catch (error) {
      console.error('Error getting all agents stats:', error);
      return '❌ Ошибка при получении статистики';
    }
  }
}