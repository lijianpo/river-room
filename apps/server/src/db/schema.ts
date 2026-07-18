import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    displayName: text('display_name').notNull(),
    avatarType: text('avatar_type').notNull().default('preset'),
    avatarValue: text('avatar_value').notNull().default('spade'),
    accountStatus: text('account_status').notNull().default('active'),
    passwordMustChange: integer('password_must_change', { mode: 'boolean' }).notNull().default(false),
    disabledReason: text('disabled_reason'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull().default(0),
    lastSeenAt: integer('last_seen_at'),
    chipBalance: integer('chip_balance').notNull().default(10_000),
    lastDailyBonusDate: text('last_daily_bonus_date'),
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export const sessions = sqliteTable(
  'sessions',
  {
    tokenHash: text('token_hash').primaryKey(),
    identityId: text('identity_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    createdAt: integer('created_at').notNull(),
    expiresAt: integer('expires_at').notNull(),
  },
  (table) => [index('sessions_identity_index').on(table.identityId), index('sessions_expiry_index').on(table.expiresAt)],
);

export const seasons = sqliteTable('seasons', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  startsAt: integer('starts_at').notNull(),
  endsAt: integer('ends_at').notNull(),
});

export const gameSessions = sqliteTable('game_sessions', {
  id: text('id').primaryKey(),
  roomId: text('room_id').notNull(),
  roomName: text('room_name').notNull(),
  mode: text('mode').notNull(),
  ranked: integer('ranked', { mode: 'boolean' }).notNull(),
  configJson: text('config_json').notNull(),
  startedAt: integer('started_at').notNull(),
  endedAt: integer('ended_at'),
  status: text('status').notNull(),
});

export const hands = sqliteTable(
  'hands',
  {
    id: text('id').primaryKey(),
    gameSessionId: text('game_session_id')
      .notNull()
      .references(() => gameSessions.id, { onDelete: 'cascade' }),
    roomId: text('room_id').notNull(),
    roomName: text('room_name').notNull(),
    mode: text('mode').notNull(),
    ranked: integer('ranked', { mode: 'boolean' }).notNull(),
    handNumber: integer('hand_number').notNull(),
    boardJson: text('board_json').notNull(),
    pot: integer('pot').notNull(),
    smallBlind: integer('small_blind').notNull(),
    bigBlind: integer('big_blind').notNull(),
    resultText: text('result_text').notNull(),
    startedAt: integer('started_at').notNull(),
    completedAt: integer('completed_at').notNull(),
  },
  (table) => [index('hands_completed_index').on(table.completedAt), index('hands_session_index').on(table.gameSessionId)],
);

export const handActions = sqliteTable(
  'hand_actions',
  {
    id: text('id').primaryKey(),
    handId: text('hand_id')
      .notNull()
      .references(() => hands.id, { onDelete: 'cascade' }),
    sequence: integer('sequence').notNull(),
    playerId: text('player_id').notNull(),
    playerName: text('player_name').notNull(),
    street: text('street').notNull(),
    action: text('action').notNull(),
    amount: integer('amount').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('hand_actions_hand_index').on(table.handId)],
);

export const handParticipants = sqliteTable(
  'hand_participants',
  {
    id: text('id').primaryKey(),
    handId: text('hand_id')
      .notNull()
      .references(() => hands.id, { onDelete: 'cascade' }),
    identityId: text('identity_id').notNull(),
    userId: text('user_id').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    seat: integer('seat').notNull(),
    holeCardsJson: text('hole_cards_json').notNull(),
    shown: integer('shown', { mode: 'boolean' }).notNull(),
    startingStack: integer('starting_stack').notNull(),
    endingStack: integer('ending_stack').notNull(),
    netChips: integer('net_chips').notNull(),
  },
  (table) => [index('participants_identity_index').on(table.identityId), index('participants_hand_index').on(table.handId)],
);

export const leaderboardEntries = sqliteTable(
  'leaderboard_entries',
  {
    id: text('id').primaryKey(),
    seasonId: text('season_id')
      .notNull()
      .references(() => seasons.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cashPoints: real('cash_points').notNull().default(0),
    tournamentPoints: real('tournament_points').notNull().default(0),
    cashHands: integer('cash_hands').notNull().default(0),
    tournaments: integer('tournaments').notNull().default(0),
    wins: integer('wins').notNull().default(0),
    updatedAt: integer('updated_at').notNull(),
  },
  (table) => [
    uniqueIndex('leaderboard_season_user_unique').on(table.seasonId, table.userId),
    index('leaderboard_season_index').on(table.seasonId),
  ],
);

export const reports = sqliteTable('reports', {
  id: text('id').primaryKey(),
  reporterIdentityId: text('reporter_identity_id').notNull(),
  roomId: text('room_id').notNull(),
  messageId: text('message_id').notNull(),
  senderIdentityId: text('sender_identity_id').notNull(),
  messageText: text('message_text').notNull(),
  createdAt: integer('created_at').notNull(),
  status: text('status').notNull().default('open'),
  resolvedBy: text('resolved_by').references(() => users.id, { onDelete: 'set null' }),
  resolvedAt: integer('resolved_at'),
  resolutionNote: text('resolution_note'),
});

export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  updatedBy: text('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: integer('updated_at').notNull(),
});

export const adminAuditLogs = sqliteTable(
  'admin_audit_logs',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    targetUserId: text('target_user_id').references(() => users.id, { onDelete: 'set null' }),
    action: text('action').notNull(),
    metadataJson: text('metadata_json').notNull(),
    ipAddress: text('ip_address'),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [index('admin_audit_created_index').on(table.createdAt)],
);

export const chipTransactions = sqliteTable(
  'chip_transactions',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    roomId: text('room_id'),
    stakeId: text('stake_id'),
    actorUserId: text('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    note: text('note'),
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (table) => [
    uniqueIndex('chip_transactions_idempotency_unique').on(table.idempotencyKey),
    index('chip_transactions_user_index').on(table.userId),
  ],
);

export const tableStakes = sqliteTable(
  'table_stakes',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    identityId: text('identity_id').notNull(),
    roomId: text('room_id').notNull(),
    buyInChips: integer('buy_in_chips').notNull(),
    currentChips: integer('current_chips').notNull(),
    status: text('status').notNull(),
    openedAt: integer('opened_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    settledAt: integer('settled_at'),
  },
  (table) => [index('table_stakes_user_index').on(table.userId), index('table_stakes_room_index').on(table.roomId)],
);

export const schema = {
  users,
  sessions,
  seasons,
  gameSessions,
  hands,
  handActions,
  handParticipants,
  leaderboardEntries,
  reports,
  appSettings,
  adminAuditLogs,
  chipTransactions,
  tableStakes,
};
