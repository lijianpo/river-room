import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { config } from '../config.js';
import { schema } from './schema.js';

export type PokerDatabase = BetterSQLite3Database<typeof schema>;

function hasColumn(sqlite: Database.Database, table: string, column: string): boolean {
  return (sqlite.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some((item) => item.name === column);
}

function ensureColumn(sqlite: Database.Database, table: string, column: string, definition: string): void {
  if (!hasColumn(sqlite, table, column)) sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

export function migrateSqlite(sqlite: Database.Database): void {
  sqlite.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL COLLATE NOCASE UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL,
      avatar_type TEXT NOT NULL DEFAULT 'preset',
      avatar_value TEXT NOT NULL DEFAULT 'spade',
      account_status TEXT NOT NULL DEFAULT 'active',
      password_must_change INTEGER NOT NULL DEFAULT 0,
      disabled_reason TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0,
      last_seen_at INTEGER,
      chip_balance INTEGER NOT NULL DEFAULT 10000,
      last_daily_bonus_date TEXT
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY,
      identity_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      display_name TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_identity_index ON sessions(identity_id);
    CREATE INDEX IF NOT EXISTS sessions_expiry_index ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS seasons (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      starts_at INTEGER NOT NULL,
      ends_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS game_sessions (
      id TEXT PRIMARY KEY,
      room_id TEXT NOT NULL,
      room_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      ranked INTEGER NOT NULL,
      config_json TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      status TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS hands (
      id TEXT PRIMARY KEY,
      game_session_id TEXT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
      room_id TEXT NOT NULL,
      room_name TEXT NOT NULL,
      mode TEXT NOT NULL,
      ranked INTEGER NOT NULL,
      hand_number INTEGER NOT NULL,
      board_json TEXT NOT NULL,
      pot INTEGER NOT NULL,
      small_blind INTEGER NOT NULL,
      big_blind INTEGER NOT NULL,
      result_text TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      completed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS hands_completed_index ON hands(completed_at);
    CREATE INDEX IF NOT EXISTS hands_session_index ON hands(game_session_id);
    CREATE TABLE IF NOT EXISTS hand_actions (
      id TEXT PRIMARY KEY,
      hand_id TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL,
      player_id TEXT NOT NULL,
      player_name TEXT NOT NULL,
      street TEXT NOT NULL,
      action TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS hand_actions_hand_index ON hand_actions(hand_id);
    CREATE TABLE IF NOT EXISTS hand_participants (
      id TEXT PRIMARY KEY,
      hand_id TEXT NOT NULL REFERENCES hands(id) ON DELETE CASCADE,
      identity_id TEXT NOT NULL,
      user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      name TEXT NOT NULL,
      seat INTEGER NOT NULL,
      hole_cards_json TEXT NOT NULL,
      shown INTEGER NOT NULL,
      starting_stack INTEGER NOT NULL,
      ending_stack INTEGER NOT NULL,
      net_chips INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS participants_identity_index ON hand_participants(identity_id);
    CREATE INDEX IF NOT EXISTS participants_hand_index ON hand_participants(hand_id);
    CREATE TABLE IF NOT EXISTS leaderboard_entries (
      id TEXT PRIMARY KEY,
      season_id TEXT NOT NULL REFERENCES seasons(id) ON DELETE CASCADE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      cash_points REAL NOT NULL DEFAULT 0,
      tournament_points REAL NOT NULL DEFAULT 0,
      cash_hands INTEGER NOT NULL DEFAULT 0,
      tournaments INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      UNIQUE(season_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS leaderboard_season_index ON leaderboard_entries(season_id);
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_identity_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      sender_identity_id TEXT NOT NULL,
      message_text TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      resolved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      resolved_at INTEGER,
      resolution_note TEXT
    );
    CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id TEXT PRIMARY KEY,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      target_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      metadata_json TEXT NOT NULL,
      ip_address TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS admin_audit_created_index ON admin_audit_logs(created_at);
    CREATE TABLE IF NOT EXISTS chip_transactions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      balance_after INTEGER NOT NULL,
      room_id TEXT,
      stake_id TEXT,
      actor_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
      note TEXT,
      idempotency_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS chip_transactions_idempotency_unique ON chip_transactions(idempotency_key);
    CREATE INDEX IF NOT EXISTS chip_transactions_user_index ON chip_transactions(user_id);
    CREATE TABLE IF NOT EXISTS table_stakes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      identity_id TEXT NOT NULL,
      room_id TEXT NOT NULL,
      buy_in_chips INTEGER NOT NULL,
      current_chips INTEGER NOT NULL,
      status TEXT NOT NULL,
      opened_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      settled_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS table_stakes_user_index ON table_stakes(user_id);
    CREATE INDEX IF NOT EXISTS table_stakes_room_index ON table_stakes(room_id);
    CREATE UNIQUE INDEX IF NOT EXISTS table_stakes_active_user_unique ON table_stakes(user_id) WHERE status = 'active';
  `);

  ensureColumn(sqlite, 'users', 'avatar_type', "TEXT NOT NULL DEFAULT 'preset'");
  ensureColumn(sqlite, 'users', 'avatar_value', "TEXT NOT NULL DEFAULT 'spade'");
  ensureColumn(sqlite, 'users', 'account_status', "TEXT NOT NULL DEFAULT 'active'");
  ensureColumn(sqlite, 'users', 'password_must_change', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(sqlite, 'users', 'disabled_reason', 'TEXT');
  ensureColumn(sqlite, 'users', 'updated_at', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumn(sqlite, 'users', 'last_seen_at', 'INTEGER');
  ensureColumn(sqlite, 'users', 'chip_balance', 'INTEGER NOT NULL DEFAULT 10000');
  ensureColumn(sqlite, 'users', 'last_daily_bonus_date', 'TEXT');
  ensureColumn(sqlite, 'reports', 'resolved_by', 'TEXT REFERENCES users(id) ON DELETE SET NULL');
  ensureColumn(sqlite, 'reports', 'resolved_at', 'INTEGER');
  ensureColumn(sqlite, 'reports', 'resolution_note', 'TEXT');
  sqlite.exec('UPDATE users SET updated_at = created_at WHERE updated_at = 0');
  sqlite.exec(`
    INSERT OR IGNORE INTO chip_transactions (
      id, user_id, type, amount, balance_after, room_id, stake_id,
      actor_user_id, note, idempotency_key, created_at
    )
    SELECT
      'initial:' || id, id, 'initial', 10000, chip_balance, NULL, NULL,
      NULL, '初始筹码', 'initial:' || id, created_at
    FROM users
  `);
  sqlite
    .prepare('INSERT OR IGNORE INTO app_settings (key, value_json, updated_by, updated_at) VALUES (?, ?, NULL, ?)')
    .run('showdownDurationSeconds', JSON.stringify(8), Date.now());
  sqlite
    .prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    .run(2, 'accounts_spectators_admin', Date.now());
  sqlite
    .prepare('INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
    .run(3, 'chip_wallets_ranked_buyins', Date.now());
}

export function createDatabase(databasePath = config.databasePath): {
  db: PokerDatabase;
  sqlite: Database.Database;
} {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const sqlite = new Database(databasePath);
  migrateSqlite(sqlite);
  return { db: drizzle(sqlite, { schema }), sqlite };
}
