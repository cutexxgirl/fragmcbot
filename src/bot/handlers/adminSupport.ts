import { BotContext } from '../../types/context';
import { isAdmin } from '../../utils/permissions';
import { SupportAgentManager } from '../../modules/admin/supportAgentManager';

export const adminAddAgentHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    
    if (!(await isAdmin(userId))) {
      return;
    }

    if (!ctx.message || !('text' in ctx.message)) {
      return;
    }

    // Парсим команду: /добавить_агента 123456789
    const match = ctx.message.text.match(/\/добавить_агента\s+(\d+)/);
    
    if (!match) {
      await ctx.reply(
        '❌ **Использование:**\n`/добавить_агента <telegram_id>`\n\n' +
        '**Пример:**\n`/добавить_агента 123456789`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const agentId = BigInt(match[1]);
    const result = await SupportAgentManager.addAgent(agentId);

    await ctx.reply(result.message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin add agent handler:', error);
    await ctx.reply('❌ Ошибка при добавлении агента');
  }
};

export const adminRemoveAgentHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    
    if (!(await isAdmin(userId))) {
      return;
    }

    if (!ctx.message || !('text' in ctx.message)) {
      return;
    }

    // Парсим команду: /удалить_агента 123456789
    const match = ctx.message.text.match(/\/удалить_агента\s+(\d+)/);
    
    if (!match) {
      await ctx.reply(
        '❌ **Использование:**\n`/удалить_агента <telegram_id>`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const agentId = BigInt(match[1]);
    const result = await SupportAgentManager.removeAgent(agentId);

    await ctx.reply(result.message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin remove agent handler:', error);
    await ctx.reply('❌ Ошибка при удалении агента');
  }
};

export const adminListAgentsHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    
    if (!(await isAdmin(userId))) {
      return;
    }

    const message = await SupportAgentManager.listAgents();
    await ctx.reply(message, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin list agents handler:', error);
    await ctx.reply('❌ Ошибка при получении списка агентов');
  }
};

export const adminAgentStatsHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    
    if (!(await isAdmin(userId))) {
      return;
    }

    if (!ctx.message || !('text' in ctx.message)) {
      return;
    }

    // Парсим: /статистика_агента 123456789 день
    const match = ctx.message.text.match(/\/статистика_агента\s+(\d+)\s+(день|неделю|месяц)/i);
    
    if (!match) {
      await ctx.reply(
        '❌ **Использование:**\n`/статистика_агента <telegram_id> <день|неделю|месяц>`\n\n' +
        '**Примеры:**\n' +
        '`/статистика_агента 123456789 день`\n' +
        '`/статистика_агента 123456789 неделю`\n' +
        '`/статистика_агента 123456789 месяц`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const agentId = BigInt(match[1]);
    const periodRu = match[2].toLowerCase();
    
    let period: 'day' | 'week' | 'month';
    if (periodRu === 'день') period = 'day';
    else if (periodRu === 'неделю') period = 'week';
    else period = 'month';

    const stats = await SupportAgentManager.getAgentStats(agentId, period);
    await ctx.reply(stats, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin agent stats handler:', error);
    await ctx.reply('❌ Ошибка при получении статистики');
  }
};

export const adminAllAgentsStatsHandler = async (ctx: BotContext) => {
  try {
    const userId = BigInt(ctx.from!.id);
    
    if (!(await isAdmin(userId))) {
      return;
    }

    if (!ctx.message || !('text' in ctx.message)) {
      return;
    }

    // Парсим: /статистика день
    const match = ctx.message.text.match(/\/статистика\s+(день|неделю|месяц)/i);
    
    if (!match) {
      await ctx.reply(
        '❌ **Использование:**\n`/статистика <день|неделю|месяц>`\n\n' +
        '**Примеры:**\n' +
        '`/статистика день`\n' +
        '`/статистика неделю`\n' +
        '`/статистика месяц`',
        { parse_mode: 'Markdown' }
      );
      return;
    }

    const periodRu = match[1].toLowerCase();
    
    let period: 'day' | 'week' | 'month';
    if (periodRu === 'день') period = 'day';
    else if (periodRu === 'неделю') period = 'week';
    else period = 'month';

    const stats = await SupportAgentManager.getAllAgentsStats(period);
    await ctx.reply(stats, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error('Error in admin all stats handler:', error);
    await ctx.reply('❌ Ошибка при получении статистики');
  }
};