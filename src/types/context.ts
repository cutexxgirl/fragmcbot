import { Context } from 'telegraf';
import { Update } from 'telegraf/types';

type AwaitingAdminSetting = 
  | 'renewal_interval'
  | 'security_interval'
  | 'token_lifetime';

export interface SessionData {
  awaitingPromoDonation?: {
    requestId: number;
    adminId: bigint;
  promoPhotoBuffer?: {
    photos: string[];
    caption?: string;
    timer?: NodeJS.Timeout;
  };  
  };
  awaitingCustomStatsPeriod?: boolean; 
  activeTicketId?: number;
  awaitingPromoProof?: boolean;
  awaitingTicketMessage?: boolean;
  awaitingAgentAction?: 'add' | 'remove' | 'stats';
  pendingAgentId?: bigint;
  
  promoSelection?: {
    requestId: number;
    accesses: Array<{
      type: string;
      days: number;
    }>;
  };
  awaitingAdminSetting?: AwaitingAdminSetting;
  awaitingPromoCustomDays?: {
    requestId: number;
    accessType: string;
  };
  awaitingBuildFile?: {
    step: 'version' | 'description' | 'file';
    buildCodeName: string;
    version?: string;
    description?: string;
  };

  awaitingUserSearch?: boolean;
  awaitingAccessDays?: { 
    userId: bigint;
    buildCodeName: string;
  };
  
  lastDiscordRequest?: number;
  awaitingPassword?: boolean;
  isChangingPassword?: boolean;
}

export interface BotContext extends Context {
  session: SessionData;
  match?: RegExpExecArray;
}