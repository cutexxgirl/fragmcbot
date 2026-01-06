import { prisma } from '../../database/prisma';
import { UserStatus } from '../../config';

export type StatsPeriod = 'day' | 'week' | 'month' | 'all' | 'custom';

interface GeneralStats {
  users: {
    total: number;
    active: number;
    activePercent: number;
    expired: number;
    expiredPercent: number;
    inactive: number;
    inactivePercent: number;
  };
  subscriptions: {
    new: number;
    renewed: number;
    cancelled: number;
    cancelledPercent: number;
    renewalRate: number; // процент продливших в течении 7 дней
  };
  promo: {
    totalRequests: number;
    approved: number;
    approvedPercent: number;
    rejected: number;
    rejectedPercent: number;
    pending: number;
    avgDonation: number | null; // средний чек
    avgAccessDays: number | null; // среднее время доступа
  };
  tickets: {
    total: number;
    open: number;
    inProgress: number;
    closed: number;
  };
  builds: {
    totalVersions: number;
    downloads: number;
  };
}

export class Analytics {
  
  /**
   * Получить общую статистику за период
   */
  static async getGeneralStats(
    period: StatsPeriod,
    startDate?: Date,
    endDate?: Date
  ): Promise<GeneralStats> {
    
    const dateRange = this.getDateRange(period, startDate, endDate);
    
    // === ПОЛЬЗОВАТЕЛИ ===
    const totalUsers = await prisma.user.count();
    
    const activeUsers = await prisma.user.count({
      where: { status: UserStatus.ACTIVE, isFrozen: false },
    });
    
    const expiredUsers = await prisma.user.count({
      where: { status: UserStatus.EXPIRED },
    });
    
    const inactiveUsers = await prisma.user.count({
      where: { status: UserStatus.INACTIVE },
    });

    // === ПОДПИСКИ ===
    const newSubscriptions = await prisma.statisticEvent.count({
      where: {
        eventType: 'new_subscription',
        createdAt: dateRange,
      },
    });

    const renewedSubscriptions = await prisma.statisticEvent.count({
      where: {
        eventType: 'renew_subscription',
        createdAt: dateRange,
      },
    });

    const cancelledSubscriptions = await prisma.statisticEvent.count({
      where: {
        eventType: 'cancel_subscription',
        createdAt: dateRange,
      },
    });

    // Процент продливших в течении 7 дней
    const renewalRate = await this.calculateRenewalRate();

    // === ПРОМО ===
    const totalPromoRequests = await prisma.promoRequest.count({
      where: { createdAt: dateRange },
    });

    const approvedPromo = await prisma.promoRequest.count({
      where: { 
        status: 'approved',
        createdAt: dateRange,
      },
    });

    const rejectedPromo = await prisma.promoRequest.count({
      where: { 
        status: 'rejected',
        createdAt: dateRange,
      },
    });

    const pendingPromo = await prisma.promoRequest.count({
      where: { status: 'pending' },
    });

    // Средний чек и среднее время доступа
    const promoStats = await this.calculatePromoStats(dateRange);

    // === ТИКЕТЫ ===
    const totalTickets = await prisma.supportTicket.count({
      where: { createdAt: dateRange },
    });

    const openTickets = await prisma.supportTicket.count({
      where: { status: 'open' },
    });

    const inProgressTickets = await prisma.supportTicket.count({
      where: { status: 'in_progress' },
    });

    const closedTickets = await prisma.supportTicket.count({
      where: { 
        status: 'closed',
        closedAt: dateRange,
      },
    });

    // === СБОРКИ ===
    const totalVersions = await prisma.buildVersion.count({
      where: { createdAt: dateRange },
    });

    const downloads = await prisma.statisticEvent.count({
      where: {
        eventType: 'download_build',
        createdAt: dateRange,
      },
    });

    return {
      users: {
        total: totalUsers,
        active: activeUsers,
        activePercent: this.percent(activeUsers, totalUsers),
        expired: expiredUsers,
        expiredPercent: this.percent(expiredUsers, totalUsers),
        inactive: inactiveUsers,
        inactivePercent: this.percent(inactiveUsers, totalUsers),
      },
      subscriptions: {
        new: newSubscriptions,
        renewed: renewedSubscriptions,
        cancelled: cancelledSubscriptions,
        cancelledPercent: this.percent(cancelledSubscriptions, newSubscriptions + renewedSubscriptions),
        renewalRate: renewalRate,
      },
      promo: {
        totalRequests: totalPromoRequests,
        approved: approvedPromo,
        approvedPercent: this.percent(approvedPromo, totalPromoRequests),
        rejected: rejectedPromo,
        rejectedPercent: this.percent(rejectedPromo, totalPromoRequests),
        pending: pendingPromo,
        avgDonation: promoStats.avgDonation,
        avgAccessDays: promoStats.avgAccessDays,
      },
      tickets: {
        total: totalTickets,
        open: openTickets,
        inProgress: inProgressTickets,
        closed: closedTickets,
      },
      builds: {
        totalVersions: totalVersions,
        downloads: downloads,
      },
    };
  }

  /**
   * Расчёт процента продливших подписку в течении 7 дней
   */
  private static async calculateRenewalRate(): Promise<number> {
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Получаем пользователей у которых истёк срок 7+ дней назад
    const expiredUsers = await prisma.user.findMany({
      where: {
        expiresAtFragment: {
          lte: sevenDaysAgo,
        },
      },
      select: {
        telegramId: true,
      },
    });

    if (expiredUsers.length === 0) return 0;

    // Проверяем сколько из них продлили в течении 7 дней
    let renewedCount = 0;

    for (const user of expiredUsers) {
      const renewed = await prisma.statisticEvent.findFirst({
        where: {
          userId: user.telegramId,
          eventType: 'renew_subscription',
          createdAt: {
            gte: sevenDaysAgo,
          },
        },
      });

      if (renewed) renewedCount++;
    }

    return this.percent(renewedCount, expiredUsers.length);
  }

  /**
   * Расчёт средней суммы доната и среднего времени доступа по промо
   */
  private static async calculatePromoStats(dateRange: any): Promise<{
    avgDonation: number | null;
    avgAccessDays: number | null;
  }> {
    const approvedPromos = await prisma.promoRequest.findMany({
      where: {
        status: 'approved',
        processedAt: dateRange,
      },
      select: {
        donationAmount: true,
      },
    });

    if (approvedPromos.length === 0) {
      return { avgDonation: null, avgAccessDays: null };
    }

    // Средний чек
    const donations = approvedPromos
      .map((p: { donationAmount: any; }) => p.donationAmount)
      .filter((d: null) => d !== null) as number[];
    
    const avgDonation = donations.length > 0
      ? Math.round(donations.reduce((a, b) => a + b, 0) / donations.length)
      : null;

    // Среднее время доступа - получаем из ScheduledTask
    const promoTasks = await prisma.scheduledTask.findMany({
      where: {
        taskType: 'remove_from_group',
        createdAt: dateRange,
      },
      select: {
        createdAt: true,
        scheduledFor: true,
      },
    });

    let avgAccessDays: number | null = null;

    if (promoTasks.length > 0) {
      const accessPeriods = promoTasks.map((task: { scheduledFor: { getTime: () => number; }; createdAt: { getTime: () => number; }; }) => {
        const diff = task.scheduledFor.getTime() - task.createdAt.getTime();
        return diff / (1000 * 60 * 60 * 24); // в днях
      });

      avgAccessDays = Math.round(
        accessPeriods.reduce((a: any, b: any) => a + b, 0) / accessPeriods.length * 10
      ) / 10; // округляем до 1 знака
    }

    return { avgDonation, avgAccessDays };
  }

  /**
   * Вспомогательная: расчёт процента
   */
  private static percent(value: number, total: number): number {
    if (total === 0) return 0;
    return Math.round((value / total) * 100);
  }

  /**
   * Вспомогательная: получение диапазона дат
   */
  private static getDateRange(
    period: StatsPeriod,
    customStart?: Date,
    customEnd?: Date
  ): any {
    if (period === 'custom' && customStart && customEnd) {
      return {
        gte: customStart,
        lte: customEnd,
      };
    }

    if (period === 'all') {
      return undefined; // без фильтра
    }

    const now = new Date();
    const start = new Date();

    switch (period) {
      case 'day':
        start.setHours(start.getHours() - 24);
        break;
      case 'week':
        start.setDate(start.getDate() - 7);
        break;
      case 'month':
        start.setMonth(start.getMonth() - 1);
        break;
    }

    return {
      gte: start,
      lte: now,
    };
  }

  /**
   * Форматирование статистики в читаемый текст
   */
  static formatGeneralStats(stats: GeneralStats, period: string): string {
    return `
📊 **Общая статистика (${period})**

**👥 ПОЛЬЗОВАТЕЛИ**
• Всего: ${stats.users.total}
• ✅ Активных: ${stats.users.active} (${stats.users.activePercent}%)
• ❌ Истекших: ${stats.users.expired} (${stats.users.expiredPercent}%)
• 💤 Неактивных: ${stats.users.inactive} (${stats.users.inactivePercent}%)

**💳 ПОДПИСКИ**
• 🆕 Новых: ${stats.subscriptions.new}
• 🔄 Продлено: ${stats.subscriptions.renewed}
• ❌ Отменено: ${stats.subscriptions.cancelled} (${stats.subscriptions.cancelledPercent}%)
• 📈 Процент продливших (7 дн): ${stats.subscriptions.renewalRate}%

**🎁 ПРОМО-АКЦИЯ**
• 📝 Заявок: ${stats.promo.totalRequests}
• ✅ Одобрено: ${stats.promo.approved} (${stats.promo.approvedPercent}%)
• ❌ Отклонено: ${stats.promo.rejected} (${stats.promo.rejectedPercent}%)
• ⏳ На рассмотрении: ${stats.promo.pending}
• 💰 Средний чек: ${stats.promo.avgDonation ? stats.promo.avgDonation + ' ₽' : 'нет данных'}
• ⏱ Средний срок: ${stats.promo.avgAccessDays ? stats.promo.avgAccessDays + ' дн.' : 'нет данных'}

**🎫 ПОДДЕРЖКА**
• Всего тикетов: ${stats.tickets.total}
• 🟢 Открыто: ${stats.tickets.open}
• 🟡 В работе: ${stats.tickets.inProgress}
• ✅ Закрыто: ${stats.tickets.closed}

**📦 СБОРКИ**
• Загружено версий: ${stats.builds.totalVersions}
• 📥 Скачиваний: ${stats.builds.downloads}
    `.trim();
  }
}