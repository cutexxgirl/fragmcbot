import { prisma } from '../../database/prisma';
import { TicketStatus } from '../../config';

export const cleanupExpiredTickets = async () => {
  try {
    // Автоматически закрываем тикеты, открытые более 7 дней
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const result = await prisma.supportTicket.updateMany({
      where: {
        status: {
          in: [TicketStatus.OPEN, TicketStatus.IN_PROGRESS],
        },
        createdAt: {
          lte: sevenDaysAgo,
        },
      },
      data: {
        status: TicketStatus.CLOSED,
        closedAt: new Date(),
      },
    });

    if (result.count > 0) {
      console.log(`✅ Auto-closed ${result.count} old tickets`);
    }
  } catch (error) {
    console.error('Error in cleanupExpiredTickets:', error);
  }
};