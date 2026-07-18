import type { AuthUser } from '@poker/contracts';

interface PresenceEntry {
  auth: AuthUser;
  socketIds: Set<string>;
}

export class PresenceService {
  private readonly identities = new Map<string, PresenceEntry>();

  connect(auth: AuthUser, socketId: string): void {
    const entry = this.identities.get(auth.identityId) ?? { auth, socketIds: new Set<string>() };
    entry.auth = auth;
    entry.socketIds.add(socketId);
    this.identities.set(auth.identityId, entry);
  }

  disconnect(identityId: string, socketId: string): { wentOffline: boolean; userId: string | null } {
    const entry = this.identities.get(identityId);
    if (!entry) return { wentOffline: false, userId: null };
    entry.socketIds.delete(socketId);
    if (entry.socketIds.size > 0) return { wentOffline: false, userId: entry.auth.userId };
    this.identities.delete(identityId);
    return { wentOffline: true, userId: entry.auth.userId };
  }

  counts(): { onlineCount: number; onlineGuests: number } {
    let onlineGuests = 0;
    for (const entry of this.identities.values()) if (entry.auth.isGuest) onlineGuests += 1;
    return { onlineCount: this.identities.size, onlineGuests };
  }

  isUserOnline(userId: string): boolean {
    return [...this.identities.values()].some((entry) => entry.auth.userId === userId);
  }

  socketIdsForUser(userId: string): string[] {
    const ids: string[] = [];
    for (const entry of this.identities.values()) {
      if (entry.auth.userId === userId) ids.push(...entry.socketIds);
    }
    return ids;
  }
}
