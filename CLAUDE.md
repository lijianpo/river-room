# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

River Room is a multiplayer No-Limit Texas Hold'em PWA (2–9 seats, cash tables, single-table tournaments, ranked rooms, AI fill-ins). The UI, code comments, error messages and test names are written in Chinese. Keep new user-facing text and comments in Chinese. Chips and points are for entertainment only; there is no real-money flow.

## Commands

pnpm workspace (pnpm 11, Node ≥ 22). Run from the repo root:

```bash
pnpm install
cp .env.example .env          # Vite reads env from the repo root (envDir: '../..')
pnpm db:migrate && pnpm db:seed   # seed: river@example.com / button@example.com, password Poker123!
pnpm dev                      # server :3001 (tsx watch) + web :5174 (Vite proxies /api, /media, /socket.io)
pnpm typecheck                # tsc --noEmit in every package
pnpm test                     # vitest in game-engine, web, server
pnpm check                    # typecheck + test + build
pnpm build && pnpm start      # production: Fastify on :3001 serves the built web app as well
```

Single test file / single test (Vitest, run inside a package):

```bash
pnpm --filter @poker/web exec vitest run src/lib/betting.test.ts
pnpm --filter @poker/server exec vitest run test/socket.test.ts -t "观战"
pnpm --filter @poker/game-engine test:watch
```

E2E (Playwright): `pnpm exec playwright install --with-deps chromium` once, then `pnpm e2e`. The config builds the app and starts it on port 3101 with `data/e2e.db`, a 5 s turn timeout and a 3 s AI-fill delay. Use `--project=desktop-chromium` or `--project=mobile-chromium` to run one project. The server's global rate limit (120 req/min) can make the mobile test fail with "Too Many Requests" when both projects run back to back.

There is no linter configured; `tsc` (strict, via `tsconfig.base.json`) is the static check.

## Architecture

```
apps/web            React 19 + Vite PWA (React Router, TanStack Query, Zustand)
apps/server         Fastify + Socket.IO + SQLite (better-sqlite3 + Drizzle)
packages/contracts  Zod schemas + shared TS types for REST and Socket.IO events
packages/game-engine Pure TS hand state machine, evaluator, side pots, AI
```

The workspace packages export TypeScript source directly (`"exports": { ".": "./src/index.ts" }`), so they have no build step. Changing a type in `@poker/contracts` affects web and server immediately.

### Server-authoritative game flow

- `apps/server/src/index.ts` `buildServer()` wires everything together: DB, `AuthService`, `BankrollService`, `PersistenceService`, `RoomManager`, REST routes (`routes.ts`), Socket handlers (`socket.ts`). Tests call `buildServer({ databasePath, avatarDirectory, logger: false })` with a temp directory and talk to it over real HTTP and socket.io-client.
- `RoomManager` (`room-manager.ts`) holds all live rooms **in memory**. Each room owns a `HoldemEngine` from `@poker/game-engine` for the current hand and drives timers: turn timeout, AI fill countdown, reconnect grace, bot think delay. A restart ends unfinished hands. Accounts, chips, settled points, hand histories and reports are persisted to SQLite.
- After every state change the server broadcasts a **per-viewer** `GameSnapshot` (`room:snapshot`). The snapshot hides other players' hole cards unless revealed at showdown, and includes `legalActions` only for the acting viewer. The client never sees the deck.
- Client actions (`game:action`) carry `handId`, `version` and a unique `actionId`. The server rejects stale or duplicate submissions, so preserve these fields when touching the action path.
- Socket auth comes from the session cookie in the handshake (`socket.ts`). Guests and registered users share the same "identity" model (`identityId`).
- Chips: `BankrollService` moves chips between a user's wallet and table "stakes" (buy-ins), checkpoints after each hand, and recovers open stakes on boot. Ranked cash tables use explicit buy-ins (`BuyInDialog`); casual tables use a fixed starting stack.
- SQLite schema migrations are hand-written SQL in `apps/server/src/db/index.ts` (`migrateSqlite`, tracked in `schema_migrations`). They run on every `createDatabase()` call. Add new migrations there, and keep `db/schema.ts` (Drizzle) in sync.

### Web client

- `src/lib/socket.ts` is a single shared Socket.IO client with `autoConnect: false`. `AuthContext` connects it once a user is logged in, and also tracks latency and connection state.
- `RoomPage` subscribes to a room and stores snapshots, chat and notices in the Zustand store `store/game.ts`. Everything on the table renders from the latest `GameSnapshot`. Seat positions are percentage layouts in `PokerTable.tsx`, rotated so the viewer always sits at the bottom.
- Small pure helpers live in `src/lib/` with colocated `*.test.ts` (for example betting presets and pre-actions in `betting.ts`). Component tests use `renderToStaticMarkup`; there is no DOM testing library.
- Dialogs use `lib/use-dialog.ts` for focus trap, Esc and focus restore. Use `useConfirm()` from `components/ConfirmDialog.tsx` instead of `window.confirm` or `window.prompt`.
- User preferences (`lib/settings.ts`) live in localStorage. `applyDisplaySettings()` mirrors the global ones onto `<html>` attributes (`data-reduced-motion`, `data-four-color`), which the CSS keys off.

### Styling

- Plain CSS, not Tailwind utilities. Tailwind is only loaded for its base layer.
- `src/styles.css` is an index that `@import`s per-area modules in `src/styles/` (base, auth, shell, lobby, dialogs, pages, table, account, admin). Each module puts its base rules first, then its media queries in descending `max-width` order.
- Import order matters for the cascade. The iOS "inputs ≥ 16px" fix must stay last in `styles.css`.
- Design tokens are CSS variables on `:root` in `styles/base.css`. Use `var(--fs-min)` (11px) as the smallest font size.
- Layout breakpoints:
  - 1050 / 900 / 700px widths (900px switches to the mobile nav and the bottom-sheet chat).
  - `(max-height: 600px) and (orientation: landscape)` for phone landscape.

## Configuration notes

- See `.env.example`.
- `VITE_PUBLIC_APP_URL` is baked in at build time and fixes the origin used in invite QR codes. Without it, the browser's current origin is used, so a QR generated from `localhost` won't work on phones.
- `ADMIN_EMAILS` whitelists admin accounts.
- `TURN_TIMEOUT_MS`, `AI_FILL_DELAY_MS` and `RECONNECT_GRACE_MS` control room timing.

## Game rules worth knowing before changing room logic

- Ranked rooms:
  - Public only, no AI, registered accounts only.
  - Fixed 10/20 blinds with buy-ins in BB.
  - Points come from cumulative net big blinds (cash) or finishing place (tournaments). Seasons are monthly, using `APP_TIMEZONE`.
- Tournaments (SNG):
  - 1,500 starting chips, blinds rise every 5 minutes, no rebuys.
  - After the start, newcomers can only spectate, and standing up forfeits.
- Room entry:
  - Everyone joins as a spectator, except the room creator, who is seated automatically.
  - On cash tables a player can take an empty seat mid-game and plays from the next hand.
- Timeouts: a human who times out auto-checks or auto-folds. Disconnected seats are held for `RECONNECT_GRACE_MS`.
