import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrateSqlite } from '../src/db/index.js';

let directory = '';
afterEach(() => {
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = '';
});

describe('SQLite 增量迁移', () => {
  it('为旧账号表补充新字段并保留账号数据', () => {
    directory = mkdtempSync(join(tmpdir(), 'poker-sol-migrate-'));
    const sqlite = new Database(join(directory, 'legacy.db'));
    sqlite.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      INSERT INTO users VALUES ('legacy', 'legacy@example.com', 'hash', '旧玩家', 1234);
      CREATE TABLE reports (
        id TEXT PRIMARY KEY,
        reporter_identity_id TEXT NOT NULL,
        room_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        sender_identity_id TEXT NOT NULL,
        message_text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'open'
      );
      INSERT INTO reports VALUES ('report-1', 'g:1', 'room-1', 'message-1', 'g:2', '旧举报', 1234, 'open');
    `);
    migrateSqlite(sqlite);
    const user = sqlite.prepare('SELECT display_name, avatar_type, account_status, updated_at, chip_balance, last_daily_bonus_date FROM users WHERE id = ?').get('legacy');
    expect(user).toEqual({ display_name: '旧玩家', avatar_type: 'preset', account_status: 'active', updated_at: 1234, chip_balance: 10_000, last_daily_bonus_date: null });
    const setting = sqlite.prepare('SELECT value_json FROM app_settings WHERE key = ?').get('showdownDurationSeconds');
    expect(setting).toEqual({ value_json: '8' });
    expect(sqlite.prepare('SELECT name FROM schema_migrations WHERE version = 2').get()).toEqual({ name: 'accounts_spectators_admin' });
    expect(sqlite.prepare('SELECT name FROM schema_migrations WHERE version = 3').get()).toEqual({ name: 'chip_wallets_ranked_buyins' });
    expect(sqlite.prepare('SELECT type, amount, balance_after FROM chip_transactions WHERE user_id = ?').get('legacy')).toEqual({ type: 'initial', amount: 10_000, balance_after: 10_000 });
    expect(sqlite.prepare('SELECT message_text, resolved_at FROM reports WHERE id = ?').get('report-1')).toEqual({ message_text: '旧举报', resolved_at: null });
    migrateSqlite(sqlite);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM chip_transactions WHERE user_id = ?').get('legacy')).toEqual({ count: 1 });
    sqlite.close();
  });
});
