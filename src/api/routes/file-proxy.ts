import { FastifyPluginAsync } from 'fastify';
import { prisma } from '../../database/prisma';
import { Readable } from 'stream';

const FILE_API_BASE = (process.env.FILE_API_URL || 'http://127.0.0.1:3001/api').replace(/\/+$/, '');
const PROXY_PREFIX = '/auth/files';

const isStream = (value: unknown): value is NodeJS.ReadableStream =>
  !!value && typeof (value as NodeJS.ReadableStream).pipe === 'function';

export const fileProxyRoutes: FastifyPluginAsync = async (app) => {
  const server = app;

  // Allow multipart passthrough for file uploads.
  server.addContentTypeParser(
    'multipart/form-data',
    (_req, payload, done) => done(null, payload)
  );

  // Require admin bearer token (same as /admin routes).
  server.addHook('preHandler', async (request, reply) => {
    // EXEMPT LOGIN from token check (it checks password body instead)
    if (request.url.includes('/login')) return;

    const authHeader = request.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'Missing token' });
    }

    const token = authHeader.split(' ')[1];
    const user = await prisma.user.findUnique({ where: { accessToken: token } });
    if (!user) return reply.status(401).send({ error: 'Invalid token' });

    const admin = await prisma.admin.findUnique({ where: { telegramId: user.telegramId } });
    if (!admin || !admin.isActive) {
      return reply.status(403).send({ error: 'Access denied: Admin rights required' });
    }
  });

  server.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    url: '/*',
    bodyLimit: 1024 * 1024 * 1024,
    handler: async (request, reply) => {
      const rawUrl = request.raw.url || '';
      const suffix = rawUrl.startsWith(PROXY_PREFIX)
        ? rawUrl.slice(PROXY_PREFIX.length)
        : rawUrl;
      const normalizedSuffix = suffix === '' ? '/' : suffix;
      const targetUrl = `${FILE_API_BASE}${normalizedSuffix.startsWith('/') ? '' : '/'}${normalizedSuffix}`;

      const headers: Record<string, string> = {};
      for (const [key, value] of Object.entries(request.headers)) {
        if (!value) continue;
        if (key === 'host' || key === 'content-length') continue;
        headers[key] = Array.isArray(value) ? value.join(',') : String(value);
      }

      const method = request.method.toUpperCase();
      let body: unknown = undefined;
      if (method !== 'GET' && method !== 'HEAD') {
        if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body) && !isStream(request.body)) {
          body = JSON.stringify(request.body);
          if (!headers['content-type']) headers['content-type'] = 'application/json';
        } else {
          body = request.body as unknown;
        }
      }

      try {
        const init: any = {
          method,
          headers,
          body,
          redirect: 'manual'
        };

        if (body && isStream(body)) {
          init.duplex = 'half';
        }

        const res = await fetch(targetUrl, init);

        reply.code(res.status);
        res.headers.forEach((value, key) => {
          if (key === 'transfer-encoding') return;
          reply.header(key, value);
        });

        if (res.body) {
          const nodeStream = Readable.fromWeb(res.body as any);
          return reply.send(nodeStream);
        }
        return reply.send();
      } catch (err) {
        request.log.error({ err }, 'File proxy error');
        return reply.status(502).send({ error: 'File API proxy failed' });
      }
    }
  });
};
