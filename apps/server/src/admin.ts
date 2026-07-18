import { randomBytes, randomUUID } from 'node:crypto';
import type { AccountStatus, AdminReportView, AdminUserView } from '@poker/contracts';
import { desc, eq } from 'drizzle-orm';
import { avatarUrl } from './avatar.js';
import type { BankrollService } from './bankroll.js';
import type { AuthService, SessionRecord } from './auth.js';
import type { PokerDatabase } from './db/index.js';
import { adminAuditLogs, appSettings, reports, users } from './db/schema.js';
import type { PresenceService } from './presence.js';

export interface PageResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export class AdminService {
  constructor(
    private readonly db: PokerDatabase,
    private readonly auth: AuthService,
    private readonly presence: PresenceService,
    private readonly bankroll: BankrollService,
  ) {}

  listUsers(input: { page: number; pageSize: number; search?: string; status?: string }): PageResult<AdminUserView> {
    const search = input.search?.trim().toLowerCase() ?? '';
    let rows = this.db.select().from(users).orderBy(desc(users.createdAt)).all().map((user) => {
      const wallet = this.bankroll.wallet(user.id);
      return {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: avatarUrl(user.avatarType, user.avatarValue),
        status: user.accountStatus as AccountStatus,
        online: this.presence.isUserOnline(user.id),
        mustChangePassword: user.passwordMustChange,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
        lastSeenAt: user.lastSeenAt,
        availableChips: wallet.availableChips,
        tableChips: wallet.tableChips,
        totalChips: wallet.totalChips,
      };
    });
    if (search) rows = rows.filter((user) => user.email.toLowerCase().includes(search) || user.displayName.toLowerCase().includes(search));
    if (input.status === 'online') rows = rows.filter((user) => user.online);
    if (input.status === 'offline') rows = rows.filter((user) => !user.online);
    if (input.status === 'disabled') rows = rows.filter((user) => user.status === 'disabled');
    if (input.status === 'active') rows = rows.filter((user) => user.status === 'active');
    return this.page(rows, input.page, input.pageSize);
  }

  setUserStatus(actor: SessionRecord, targetUserId: string, status: AccountStatus, reason: string | undefined, ipAddress?: string): void {
    this.assertNotSelf(actor, targetUserId);
    const target = this.requireUser(targetUserId);
    this.db.update(users).set({
      accountStatus: status,
      disabledReason: status === 'disabled' ? reason?.trim() || '运营后台封禁' : null,
      updatedAt: Date.now(),
    }).where(eq(users.id, targetUserId)).run();
    if (status === 'disabled') this.auth.revokeUserSessions(targetUserId);
    this.audit(actor.userId!, targetUserId, status === 'disabled' ? 'user.disable' : 'user.enable', { reason: reason ?? null, email: target.email }, ipAddress);
  }

  forceLogout(actor: SessionRecord, targetUserId: string, ipAddress?: string): void {
    this.assertNotSelf(actor, targetUserId);
    this.requireUser(targetUserId);
    this.auth.revokeUserSessions(targetUserId);
    this.audit(actor.userId!, targetUserId, 'user.force_logout', {}, ipAddress);
  }

  async resetPassword(actor: SessionRecord, targetUserId: string, ipAddress?: string): Promise<string> {
    this.assertNotSelf(actor, targetUserId);
    this.requireUser(targetUserId);
    const temporaryPassword = randomBytes(15).toString('base64url');
    this.db.update(users).set({
      passwordHash: await this.auth.createPasswordHash(temporaryPassword),
      passwordMustChange: true,
      updatedAt: Date.now(),
    }).where(eq(users.id, targetUserId)).run();
    this.auth.revokeUserSessions(targetUserId);
    this.audit(actor.userId!, targetUserId, 'user.reset_password', {}, ipAddress);
    return temporaryPassword;
  }

  getSettings(): { showdownDurationSeconds: number } {
    const row = this.db.select().from(appSettings).where(eq(appSettings.key, 'showdownDurationSeconds')).get();
    const parsed = row ? Number(JSON.parse(row.valueJson)) : 8;
    return { showdownDurationSeconds: Number.isInteger(parsed) && parsed >= 3 && parsed <= 30 ? parsed : 8 };
  }

  updateSettings(actor: SessionRecord, showdownDurationSeconds: number, ipAddress?: string): { showdownDurationSeconds: number } {
    const now = Date.now();
    this.db.insert(appSettings).values({
      key: 'showdownDurationSeconds',
      valueJson: JSON.stringify(showdownDurationSeconds),
      updatedBy: actor.userId,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: appSettings.key,
      set: { valueJson: JSON.stringify(showdownDurationSeconds), updatedBy: actor.userId, updatedAt: now },
    }).run();
    this.audit(actor.userId!, null, 'settings.showdown_duration', { showdownDurationSeconds }, ipAddress);
    return { showdownDurationSeconds };
  }

  listReports(input: { page: number; pageSize: number; status?: string }): PageResult<AdminReportView> {
    let rows = this.db.select().from(reports).orderBy(desc(reports.createdAt)).all().map((report) => ({
      ...report,
      status: report.status as AdminReportView['status'],
    }));
    if (input.status && input.status !== 'all') rows = rows.filter((report) => report.status === input.status);
    return this.page(rows, input.page, input.pageSize);
  }

  updateReport(
    actor: SessionRecord,
    reportId: string,
    status: 'resolved' | 'dismissed',
    note: string | undefined,
    ipAddress?: string,
  ): void {
    const report = this.db.select().from(reports).where(eq(reports.id, reportId)).get();
    if (!report) throw new Error('举报不存在');
    this.db.update(reports).set({
      status,
      resolvedBy: actor.userId,
      resolvedAt: Date.now(),
      resolutionNote: note?.trim() || null,
    }).where(eq(reports.id, reportId)).run();
    this.audit(actor.userId!, null, `report.${status}`, { reportId }, ipAddress);
  }

  audit(actorUserId: string, targetUserId: string | null, action: string, metadata: unknown, ipAddress?: string): void {
    this.db.insert(adminAuditLogs).values({
      id: randomUUID(),
      actorUserId,
      targetUserId,
      action,
      metadataJson: JSON.stringify(metadata),
      ipAddress: ipAddress ?? null,
      createdAt: Date.now(),
    }).run();
  }

  private requireUser(userId: string): typeof users.$inferSelect {
    const user = this.db.select().from(users).where(eq(users.id, userId)).get();
    if (!user) throw new Error('用户不存在');
    return user;
  }

  private assertNotSelf(actor: SessionRecord, targetUserId: string): void {
    if (!actor.userId || actor.userId === targetUserId) throw new Error('不能在后台对当前管理员执行此操作');
  }

  private page<T>(items: T[], page: number, pageSize: number): PageResult<T> {
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(Math.max(1, page), totalPages);
    return {
      items: items.slice((safePage - 1) * pageSize, safePage * pageSize),
      page: safePage,
      pageSize,
      total,
      totalPages,
    };
  }
}
