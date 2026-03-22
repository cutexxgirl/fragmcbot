import { MiddlewareFn } from 'telegraf';
import { BotContext } from '../types/context';

type SpamRule = {
  windowMs: number;
  maxHits: number;
  blockMs: number;
  noticeMs: number;
};

type SpamEntry = {
  hits: number[];
  blockedUntil: number;
  lastNoticeAt: number;
};

const SPAM_RULES: Record<string, SpamRule> = {
  callback: { windowMs: 6_000, maxHits: 8, blockMs: 12_000, noticeMs: 4_000 },
  command: { windowMs: 12_000, maxHits: 5, blockMs: 20_000, noticeMs: 6_000 },
  private_message: { windowMs: 10_000, maxHits: 7, blockMs: 15_000, noticeMs: 6_000 },
  group_message: { windowMs: 10_000, maxHits: 10, blockMs: 12_000, noticeMs: 6_000 },
  default: { windowMs: 10_000, maxHits: 10, blockMs: 12_000, noticeMs: 6_000 }
};

const spamStore = new Map<string, SpamEntry>();
const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of spamStore.entries()) {
    if (entry.blockedUntil > now) {
      continue;
    }
    if (entry.hits.length === 0 || now - entry.hits[entry.hits.length - 1] > 5 * 60_000) {
      spamStore.delete(key);
    }
  }
}, 60_000);

cleanupInterval.unref();

const getBucket = (ctx: BotContext) => {
  if (ctx.updateType === 'callback_query') {
    return 'callback';
  }

  if (ctx.updateType === 'message') {
    const messageText = ctx.message && 'text' in ctx.message ? ctx.message.text : '';
    if (typeof messageText === 'string' && messageText.startsWith('/')) {
      return 'command';
    }

    return ctx.chat?.type === 'private' ? 'private_message' : 'group_message';
  }

  return 'default';
};

const getSpamKey = (ctx: BotContext, bucket: string) => {
  const userId = ctx.from?.id;
  const chatId = ctx.chat?.id;
  return `${bucket}:${userId ?? 'nouser'}:${chatId ?? 'nochat'}`;
};

const shouldNotify = (entry: SpamEntry, rule: SpamRule, now: number) =>
  now - entry.lastNoticeAt >= rule.noticeMs;

const notifySpamBlock = async (ctx: BotContext, entry: SpamEntry, rule: SpamRule, now: number) => {
  if (!shouldNotify(entry, rule, now)) {
    return;
  }

  entry.lastNoticeAt = now;

  if (ctx.updateType === 'callback_query') {
    await ctx.answerCbQuery('Слишком часто. Подожди пару секунд.', { show_alert: false }).catch(() => {});
    return;
  }

  if (ctx.chat?.type === 'private') {
    await ctx.reply('Слишком часто. Подожди пару секунд.').catch(() => {});
  }
};

export const antiSpamMiddleware: MiddlewareFn<BotContext> = async (ctx, next) => {
  const bucket = getBucket(ctx);
  const rule = SPAM_RULES[bucket] || SPAM_RULES.default;
  const key = getSpamKey(ctx, bucket);
  const now = Date.now();

  let entry = spamStore.get(key);
  if (!entry) {
    entry = { hits: [], blockedUntil: 0, lastNoticeAt: 0 };
    spamStore.set(key, entry);
  }

  if (entry.blockedUntil > now) {
    await notifySpamBlock(ctx, entry, rule, now);
    return;
  }

  entry.hits = entry.hits.filter((timestamp) => now - timestamp <= rule.windowMs);
  entry.hits.push(now);

  if (entry.hits.length > rule.maxHits) {
    entry.blockedUntil = now + rule.blockMs;
    entry.hits = [];
    await notifySpamBlock(ctx, entry, rule, now);
    return;
  }

  await next();
};
