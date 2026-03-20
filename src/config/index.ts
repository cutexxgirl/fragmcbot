import dotenv from 'dotenv';
dotenv.config();

export const config = {
  bot: {
    token: process.env.BOT_TOKEN!,
    adminId: BigInt(process.env.ADMIN_ID!),
  },
  database: {
    url: process.env.DATABASE_URL!,
  },
  api: {
    port: parseInt(process.env.API_PORT || '3000'),
    host: process.env.API_HOST || '0.0.0.0',
  },
  groups: {
    novice: BigInt(process.env.GROUP_NOVICE_ID!),
    adept: BigInt(process.env.GROUP_ADEPT_ID!),
    legend: BigInt(process.env.GROUP_LEGEND_ID!),
    spark: BigInt(process.env.GROUP_SPARK_ID!),
    support: BigInt(process.env.SUPPORT_GROUP_ID!),
    promo: BigInt(process.env.GROUP_PROMO_ID!),
  },
  channel: {
    main: BigInt(process.env.CHANNEL!), // @fragmcru
    closed: BigInt(process.env.CLOSED_CHANNEL_ID || '0'),
  },
  environment: process.env.NODE_ENV || 'development',
};

export enum SubscriptionLevel {
  NOVICE = 'novice',
  ADEPT = 'adept',
  LEGEND = 'legend',
  SPARK = 'spark',
}

export const SUBSCRIPTION_NAMES: Record<SubscriptionLevel, string> = {
  [SubscriptionLevel.NOVICE]: 'Новичок',
  [SubscriptionLevel.ADEPT]: 'Адепт',
  [SubscriptionLevel.LEGEND]: 'Легенда',
  [SubscriptionLevel.SPARK]: 'Искра',
};

export enum UserStatus {
  ACTIVE = 'active',
  EXPIRED = 'expired',
  INACTIVE = 'inactive',
  SHARED = 'shared',
}

export enum TicketStatus {
  OPEN = 'open',
  IN_PROGRESS = 'in_progress',
  CLOSED = 'closed',
}

export enum AdminRole {
  ADMIN = 'admin',
  SUPPORT = 'support',
}