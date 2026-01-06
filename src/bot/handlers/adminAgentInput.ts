import { BotContext } from '../../types/context';
import { isAdmin } from '../../utils/permissions';
import { SupportAgentManager } from '../../modules/admin/supportAgentManager';
import { Markup } from 'telegraf';

export const handleAgentIdInput = async (ctx: BotContext) => {
  const userId = BigInt(ctx.from!.id);
  
  if (!(await isAdmin(userId))) {
    return;
  }
  
  // Проверяем, ждём ли мы ввод для агентов
  if (!ctx.session.awaitingAgentAction && !ctx.session.pendingAgentId) {
    return;
  }

  if (!ctx.message || !('text' in ctx.message)) {
    return;
  }

  const text = ctx.message.text.trim().toLowerCase();

  // Если ждём период для статистики
  if (ctx.session.pendingAgentId) {
    let period: 'day' | 'week' | 'month';
    
    if (text === 'день') period = 'day';
    else if (text === 'неделю') period = 'week';
    else if (text === 'месяц') period = 'month';
    else {
      await ctx.reply('❌ Неверный период. Отправьте: `день`, `неделю` или `месяц`', { parse_mode: 'Markdown' });
      return;
    }

    const stats = await SupportAgentManager.getAgentStats(ctx.session.pendingAgentId, period);
    await ctx.reply(stats, { parse_mode: 'Markdown' });

    // Очищаем состояние
    ctx.session.pendingAgentId = undefined;
    return;
  }

  // Проверяем, что это число
  if (!/^\d+$/.test(ctx.message.text)) {
    await ctx.reply('❌ Неверный формат. Отправьте только число (Telegram ID)');
    return;
  }

  const agentId = BigInt(ctx.message.text);
  const action = ctx.session.awaitingAgentAction;

  let result;

  switch (action) {
    case 'add':
      result = await SupportAgentManager.addAgent(agentId);
      await ctx.reply(result.message, { parse_mode: 'Markdown' });
      ctx.session.awaitingAgentAction = undefined;
      break;
      
    case 'remove':
      result = await SupportAgentManager.removeAgent(agentId);
      await ctx.reply(result.message, { parse_mode: 'Markdown' });
      ctx.session.awaitingAgentAction = undefined;
      break;
      
    case 'stats':
      // Для статистики дополнительно запрашиваем период
      ctx.session.pendingAgentId = agentId;
      ctx.session.awaitingAgentAction = undefined;
      
      const keyboard = Markup.inlineKeyboard([
        [
          Markup.button.callback('📅 День', `agent_stats_${agentId}_day`),
          Markup.button.callback('📅 Неделю', `agent_stats_${agentId}_week`),
        ],
        [Markup.button.callback('📅 Месяц', `agent_stats_${agentId}_month`)],
      ]);
      
      await ctx.reply('Выберите период для статистики:', keyboard);
      break;
  }
};