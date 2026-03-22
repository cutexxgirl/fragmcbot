import { prisma } from '../../database/prisma';

export type EventType = 
  | 'start'
  | 'new_subscription'
  | 'renew_subscription'
  | 'cancel_subscription'
  | 'new_ticket'
  | 'close_ticket'
  | 'support_duplicate_ticket_ban'
  | 'promo_click'
  | 'promo_approved'
  | 'promo_rejected'
  | 'download_build'
  | 'promo_code_activation';

export const logEvent = async (
  eventType: EventType,
  userId?: bigint,
  details?: any
) => {
  try {
    await prisma.statisticEvent.create({
      data: {
        eventType,
        userId,
        details: details || undefined,
      },
    });
  } catch (error) {
    console.error('Failed to log event:', error);
  }
};
