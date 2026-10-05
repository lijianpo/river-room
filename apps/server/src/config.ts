import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
dotenv.config({ path: path.join(repositoryRoot, '.env') });
dotenv.config();

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

/** 允许 0 的整数配置，例如 TIME_BANK_MS=0 表示关闭时间银行。 */
function nonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : fallback;
}

const databaseValue = process.env.DATABASE_PATH;
const avatarDirectoryValue = process.env.AVATAR_DIR;

function emailList(value: string | undefined): Set<string> {
  return new Set((value ?? '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean));
}

export const config = {
  port: positiveInteger(process.env.PORT, 3001),
  host: process.env.HOST || '0.0.0.0',
  appOrigin: process.env.APP_ORIGIN || 'http://localhost:5174',
  appTimezone: process.env.APP_TIMEZONE || 'Asia/Shanghai',
  databasePath: databaseValue
    ? path.resolve(repositoryRoot, databaseValue)
    : path.join(repositoryRoot, 'data', 'poker.db'),
  avatarDirectory: avatarDirectoryValue
    ? path.resolve(repositoryRoot, avatarDirectoryValue)
    : path.join(repositoryRoot, 'data', 'avatars'),
  adminEmails: emailList(process.env.ADMIN_EMAILS),
  maxSpectatorsPerRoom: positiveInteger(process.env.MAX_SPECTATORS_PER_ROOM, 50),
  sessionDays: positiveInteger(process.env.SESSION_DAYS, 30),
  turnTimeoutMs: positiveInteger(process.env.TURN_TIMEOUT_MS, 20_000),
  timeBankMs: nonNegativeInteger(process.env.TIME_BANK_MS, 30_000),
  aiFillDelayMs: positiveInteger(process.env.AI_FILL_DELAY_MS, 30_000),
  reconnectGraceMs: positiveInteger(process.env.RECONNECT_GRACE_MS, 90_000),
  webDistPath: path.join(repositoryRoot, 'apps', 'web', 'dist'),
};
