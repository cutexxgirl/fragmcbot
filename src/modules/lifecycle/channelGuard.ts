import { BotContext } from '../../types/context';
import { prisma } from '../../database/prisma';
import { config } from '../../config';

export const setupChannelGuard = (bot: any) => {
    bot.on('chat_member', async (ctx: BotContext) => {
        const chatId = ctx.chat?.id.toString();
        const configId = config.channel.closed.toString();

        // Проверяем, что это наш закрытый канал
        if (chatId !== configId) {
            // Log only relevant updates to avoid spam, or temporary debug:
            console.log(`[ChannelGuard] Ignoring update from chat ${chatId} (Expected: ${configId})`);
            return;
        }

        const update = ctx.update as any;
        if (!update.chat_member) return;

        const memberUpdate = update.chat_member;
        
        // Нас интересуют только новые вступления (join)
        // status: 'member' (был 'left'/'kicked')
        const oldStatus = memberUpdate.old_chat_member.status;
        const newStatus = memberUpdate.new_chat_member.status;
        
        // Если пользователь не зашел, игнорируем
        // (member, administrator, creator - считаем вступлением, если был left/kicked/restricted)
        const isJoin = (oldStatus === 'left' || oldStatus === 'kicked' || oldStatus === 'restricted') &&
                       (newStatus === 'member' || newStatus === 'administrator' || newStatus === 'creator');

        if (!isJoin) return;
        
        const userId = ctx.from?.id;
        if (!userId) return;

        // console.log(`[ChannelGuard] Processing JOIN for user ${userId} in chat ${chatId}`);

        // Получаем ссылку приглашения (может быть undefined)
        const inviteLink = memberUpdate.invite_link;
        const linkUrl = inviteLink?.invite_link;

        if (linkUrl) {
            // console.log(`[ChannelGuard] Join via link: ${linkUrl}`);
            const dbInvite = await prisma.invite.findUnique({
                where: { inviteLink: linkUrl }
            });
            // console.log(`[ChannelGuard] DB Invite found: ${dbInvite ? 'YES' : 'NO'}`);

            if (dbInvite) {
                // ... tracked logic ...
                 if (BigInt(userId) !== dbInvite.userId) {
                    console.warn(`[ChannelGuard] 🚨 UNAUTHORIZED USE of link owner ${dbInvite.userId} by ${userId}. KICKING.`);
                    try {
                        await ctx.banChatMember(userId);
                        console.log(`[ChannelGuard] 👢 Kicked user ${userId}`);
                    } catch (e) {
                         console.error('[ChannelGuard] ❌ Failed to ban intruder:', e);
                    }
                } else {
                     // 3. Проверяем валидность подписки
                     // console.log(`[ChannelGuard] Link owner matches. Verify subscription...`);
                     const user = await prisma.user.findUnique({ where: { telegramId: BigInt(userId) } });
                     // ...
                     const canStay = user && 
                                     (user.subscriptionLevel === 'legend' || user.subscriptionLevel === 'spark') &&
                                     (user.status === 'active' || user.status === 'shared' || user.status === 'promo_active') &&
                                     (!user.isFrozen) &&
                                     (user.expiresAtFragment && user.expiresAtFragment > new Date());

                     if (canStay) {
                         console.log(`[ChannelGuard] ✅ Access GRANTED (Valid Sub).`);
                     } else {
                         console.warn(`[ChannelGuard] 🚨 Link valid but SUB EXPIRED. KICKING.`);
                         await ctx.banChatMember(userId);
                     }
                }
                // Revoke
                try {
                    await ctx.telegram.revokeChatInviteLink(config.channel.closed.toString(), linkUrl);
                    console.log(`[ChannelGuard] Link ${linkUrl} revoked.`);
                } catch (e) {
                     console.error('[ChannelGuard] Failed to revoke link:', e);
                }

                // Delete from DB
                await prisma.invite.delete({ where: { inviteLink: linkUrl } });

                return;
            }
        } else {
            // console.log(`[ChannelGuard] Join via UNKNOWN/DIRECT method.`);
        }
        
        // ФОЛЛБЕК
        // console.log(`[ChannelGuard] Performing Fallback Rights Check for ${userId}...`);
        const user = await prisma.user.findUnique({
             where: { telegramId: BigInt(userId) }
        });
        // console.log(`[ChannelGuard] User in DB: ${user ? 'YES' : 'NO'}. Level: ${user?.subscriptionLevel}. Status: ${user?.status}`);
        
        // ... rest of fallback logic with logs ...

        const canStay = user && 
                       (user.subscriptionLevel === 'legend' || user.subscriptionLevel === 'spark') &&
                       (user.status === 'active' || user.status === 'shared' || user.status === 'promo_active') &&
                       (!user.isFrozen) &&
                       (user.expiresAtFragment && user.expiresAtFragment > new Date());

        if (canStay) {
            // console.log(`[ChannelGuard] User ${userId} is LEGIT (Subscription valid). Allowing stay despite untracked entry.`);
        } else {
             console.warn(`[ChannelGuard] Security Alert: User ${userId} joined via untracked method AND matches no subscription. KICKING.`);
             try {
                 await ctx.banChatMember(userId);
                 await ctx.unbanChatMember(userId);
             } catch (e) {
                 console.error('[ChannelGuard] Failed to ban intruder:', e);
             }
        }
    });

    console.log('[ChannelGuard] Initialized');
};
