import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import staticFiles from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { Server } from 'socket.io';
import { AuthService } from './auth.js';
import { AdminService } from './admin.js';
import { BankrollService } from './bankroll.js';
import { config } from './config.js';
import { createDatabase } from './db/index.js';
import { PersistenceService } from './persistence.js';
import { PresenceService } from './presence.js';
import { RoomManager, type PokerIo, type RoomTiming } from './room-manager.js';
import { registerRoutes } from './routes.js';
import { registerSocketHandlers } from './socket.js';

export interface BuiltServer {
  app: FastifyInstance;
  io: PokerIo;
  rooms: RoomManager;
  close: () => Promise<void>;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  const header = Array.isArray(value) ? value[0] : value;
  return header?.split(',')[0]?.trim();
}

function isAllowedOrigin(origin: string | undefined, request: FastifyRequest): boolean {
  if (!origin) return true;
  if (origin === config.appOrigin) return true;

  let originUrl: URL;
  try {
    originUrl = new URL(origin);
  } catch {
    return false;
  }

  const forwardedHost = firstHeaderValue(request.headers['x-forwarded-host']);
  const requestHost = forwardedHost ?? firstHeaderValue(request.headers.host);
  if (requestHost && originUrl.host.toLowerCase() === requestHost.toLowerCase()) return true;

  return (
    originUrl.protocol === 'http:' &&
    /^(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.)/.test(originUrl.hostname)
  );
}

export async function buildServer(
  options: { databasePath?: string; avatarDirectory?: string; logger?: boolean; timing?: Partial<RoomTiming> } = {},
): Promise<BuiltServer> {
  const app = Fastify({ logger: options.logger ?? true, trustProxy: true });
  const avatarDirectory = options.avatarDirectory ?? config.avatarDirectory;
  const { db, sqlite } = createDatabase(options.databasePath);
  const bankroll = new BankrollService(db);
  bankroll.recoverActiveStakes();
  const auth = new AuthService(db, bankroll);
  const persistence = new PersistenceService(db);
  persistence.currentSeason();

  await app.register(cookie);
  await app.register(cors, {
    delegator: (request, callback) => {
      const origin = request.headers.origin;
      if (!isAllowedOrigin(origin, request)) {
        callback(new Error('不允许的来源'));
        return;
      }
      callback(null, { credentials: true, origin: origin ?? false });
    },
  });
  await app.register(helmet, { contentSecurityPolicy: false });
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  await app.register(multipart, { limits: { files: 1, fileSize: 2 * 1024 * 1024 } });
  fs.mkdirSync(avatarDirectory, { recursive: true });
  await app.register(staticFiles, {
    root: avatarDirectory,
    prefix: '/media/avatars/',
    decorateReply: false,
    maxAge: '30 days',
    immutable: true,
  });

  const io = new Server(app.server, {
    cors: { origin: true, credentials: true },
    pingInterval: 15_000,
    pingTimeout: 20_000,
  }) as PokerIo;
  const presence = new PresenceService();
  const admin = new AdminService(db, auth, presence, bankroll);
  const rooms = new RoomManager(io, persistence, bankroll, () => admin.getSettings().showdownDurationSeconds, options.timing);
  const disconnectUser = (userId: string) => {
    for (const socketId of presence.socketIdsForUser(userId)) io.sockets.sockets.get(socketId)?.disconnect(true);
  };
  const notifyWallet = (userId: string) => {
    const wallet = bankroll.wallet(userId);
    for (const socketId of presence.socketIdsForUser(userId)) io.sockets.sockets.get(socketId)?.emit('wallet:updated', wallet);
  };
  registerRoutes(app, { auth, rooms, persistence, presence, admin, bankroll, notifyWallet, disconnectUser, avatarDirectory });
  registerSocketHandlers(io, auth, rooms, presence);

  if (fs.existsSync(config.webDistPath)) {
    await app.register(staticFiles, { root: config.webDistPath, wildcard: false });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/') || request.url.startsWith('/socket.io/')) {
        return reply.code(404).send({ error: '接口不存在' });
      }
      return reply.sendFile('index.html');
    });
  }

  const close = async () => {
    rooms.shutdown();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await app.close();
    sqlite.close();
  };
  return { app, io, rooms, close };
}

const entry = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (import.meta.url === entry) {
  const server = await buildServer();
  try {
    await server.app.listen({ port: config.port, host: config.host });
    server.app.log.info(`德州牌室已启动：http://localhost:${config.port}`);
  } catch (error) {
    server.app.log.error(error);
    process.exitCode = 1;
  }
}
