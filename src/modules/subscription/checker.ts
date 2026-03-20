import { BotContext } from '../../types/context';
import { config, SubscriptionLevel } from '../../config';

interface MembershipInfo {
  level: SubscriptionLevel | null;
}

const isInChat = (status: string) =>
  status === 'member' || status === 'administrator' || status === 'creator' || status === 'restricted';

/**
 * Проверяет членство пользователя в ПЛАТНЫХ группах Boosty.
 * ВАЖНО: Промо-группа НЕ проверяется здесь! 
 * Промо-доступ определяется наличием ScheduledTask в lifecycle/syncUserStatus.
 */
export const checkUserGroups = async (
  ctx: BotContext,
  userId: bigint
): Promise<MembershipInfo> => {
  const membershipInfo: MembershipInfo = { level: null };
  const userIdNum = Number(userId);

  try {
    // 0. SPARK (самый-самый высокий приоритет)
    try {
      const member = await ctx.telegram.getChatMember(String(config.groups.spark), userIdNum);
      if (isInChat(member.status)) {
        membershipInfo.level = SubscriptionLevel.SPARK;
        return membershipInfo;
      }
    } catch {}

    // 1. LEGEND (высокий приоритет)
    try {
      const member = await ctx.telegram.getChatMember(String(config.groups.legend), userIdNum);
      if (isInChat(member.status)) {
        membershipInfo.level = SubscriptionLevel.LEGEND;
        return membershipInfo;
      }
    } catch {}

    // 2. ADEPT
    try {
      const member = await ctx.telegram.getChatMember(String(config.groups.adept), userIdNum);
      if (isInChat(member.status)) {
        membershipInfo.level = SubscriptionLevel.ADEPT;
        return membershipInfo;
      }
    } catch {}

    // 3. NOVICE
    try {
      const member = await ctx.telegram.getChatMember(String(config.groups.novice), userIdNum);
      if (isInChat(member.status)) {
        membershipInfo.level = SubscriptionLevel.NOVICE;
        return membershipInfo;
      }
    } catch {}

    // ПРОМО-ГРУППА БОЛЬШЕ НЕ ПРОВЕРЯЕТСЯ!
    // Промо-доступ определяется только наличием ScheduledTask
    
  } catch (error) {
    console.error(`Error checking user groups for ${userId.toString()}:`, error);
  }

  return membershipInfo;
};

export const checkSingleGroup = async (
  ctx: BotContext,
  userId: bigint,
  groupId: bigint
): Promise<boolean> => {
  try {
    const member = await ctx.telegram.getChatMember(String(groupId), Number(userId));
    return isInChat(member.status);
  } catch {
    return false;
  }
};