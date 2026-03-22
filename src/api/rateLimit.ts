import { FastifyReply, FastifyRequest } from 'fastify';

type RateLimitRule = {
  windowMs: number;
  maxHits: number;
  blockMs: number;
};

type RateLimitState = {
  hits: number[];
  blockedUntil: number;
};

const requestStore = new Map<string, RateLimitState>();

const cleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [key, state] of requestStore.entries()) {
    if (state.blockedUntil > now) {
      continue;
    }
    if (state.hits.length === 0 || now - state.hits[state.hits.length - 1] > 15 * 60_000) {
      requestStore.delete(key);
    }
  }
}, 60_000);

cleanupInterval.unref();

const RULES = {
  login: { windowMs: 10 * 60_000, maxHits: 15, blockMs: 20 * 60_000 },
  admin: { windowMs: 60_000, maxHits: 120, blockMs: 5 * 60_000 },
  files: { windowMs: 60_000, maxHits: 90, blockMs: 5 * 60_000 },
  default: { windowMs: 60_000, maxHits: 180, blockMs: 2 * 60_000 }
} satisfies Record<string, RateLimitRule>;

const getForwardedIp = (request: FastifyRequest) => {
  const forwardedFor = request.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0].trim();
  }
  if (Array.isArray(forwardedFor) && forwardedFor.length > 0) {
    return forwardedFor[0].split(',')[0].trim();
  }
  return request.ip || request.socket.remoteAddress || 'unknown';
};

const getRuleForRequest = (request: FastifyRequest) => {
  const path = (request.routeOptions.url || request.url || '').split('?')[0];
  if (path === '/auth/login') {
    return { scope: 'login', rule: RULES.login };
  }
  if (path.startsWith('/auth/admin')) {
    return { scope: 'admin', rule: RULES.admin };
  }
  if (path.startsWith('/auth/files')) {
    return { scope: 'files', rule: RULES.files };
  }
  return { scope: 'default', rule: RULES.default };
};

export const enforceApiRateLimit = async (request: FastifyRequest, reply: FastifyReply) => {
  const { scope, rule } = getRuleForRequest(request);
  const ip = getForwardedIp(request);
  const key = `${scope}:${ip}`;
  const now = Date.now();

  let state = requestStore.get(key);
  if (!state) {
    state = { hits: [], blockedUntil: 0 };
    requestStore.set(key, state);
  }

  if (state.blockedUntil > now) {
    return reply.code(429).send({ error: 'Too many requests' });
  }

  state.hits = state.hits.filter((timestamp) => now - timestamp <= rule.windowMs);
  state.hits.push(now);

  if (state.hits.length > rule.maxHits) {
    state.blockedUntil = now + rule.blockMs;
    state.hits = [];
    return reply.code(429).send({ error: 'Too many requests' });
  }

  return undefined;
};
