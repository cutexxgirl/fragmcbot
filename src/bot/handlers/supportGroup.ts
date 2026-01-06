import { BotContext } from '../../types/context';
import { SupportSystem } from '../../modules/support';
import { config } from '../../config';
import { isSupportAgent } from '../../utils/permissions';
import { Message } from 'telegraf/types';

export const handleSupportGroupMessage = async (ctx: BotContext) => {
  try {
    if (ctx.chat?.id !== Number(config.groups.support)) {
      return;
    }

    const userId = BigInt(ctx.from!.id);
    
    const isAgent = await isSupportAgent(userId);
    if (!isAgent) {
      return;
    }

    if (!ctx.message) {
      return;
    }

    const message = ctx.message as Message.TextMessage & { reply_to_message?: Message };
    
    if (!message.reply_to_message) {
      return;
    }

    const replyMessage = message.reply_to_message;
    if (replyMessage.from?.id !== ctx.botInfo.id) {
      return;
    }

    let replyText = '';
    if ('text' in replyMessage) {
      replyText = replyMessage.text || '';
    } else if ('caption' in replyMessage) {
      replyText = replyMessage.caption || '';
    }

    if (!replyText) return;

    const ticketMatch = replyText.match(/[Тт]икет\s*#?(\d+)/i);
    if (!ticketMatch) {
      console.log('Ticket ID not found in message:', replyText.substring(0, 100));
      return;
    }

    const ticketId = parseInt(ticketMatch[1]);

    // Проверяем специальные команды
    const text = ('text' in ctx.message ? ctx.message.text : '').toLowerCase();

    if (text === 'я') {
      const result = await SupportSystem.assignTicket(ticketId, userId);
      
      if (result.success) {
        await ctx.reply('✅ Тикет принят вами!');
      } else {
        await ctx.reply(`❌ ${result.message}`);
      }
      return;
    }

    if (text === 'теперь я') {
      const result = await SupportSystem.reassignTicket(ticketId, userId);
      
      if (result.success) {
        await ctx.reply('✅ Тикет переназначен на вас!');
      } else {
        await ctx.reply(`❌ ${result.message}`);
      }
      return;
    }

    // Передаем полный объект сообщения
    const result = await SupportSystem.sendMessage(
      ticketId,
      userId,
      ctx.message
    );

    if (result.success) {
      await ctx.reply('✅ Отправлено пользователю');
    } else {
      await ctx.reply(`❌ ${result.message}`);
    }

  } catch (error) {
    console.error('Error in support group handler:', error);
  }
};