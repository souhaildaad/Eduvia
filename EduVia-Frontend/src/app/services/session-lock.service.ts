import { Injectable, OnDestroy } from '@angular/core';

type SessionLockPayload = {
  tabId: string;
  timestamp: number;
};

@Injectable({
  providedIn: 'root',
})
export class SessionLockService implements OnDestroy {
  private readonly lockKey = 'eduvia_active_session_lock';
  private readonly tabIdKey = 'eduvia_tab_id';
  private readonly blockedKey = 'eduvia_session_blocked';
  private readonly heartbeatMs = 2000;
  private readonly staleMs = 8000;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private unloadBound = false;

  constructor() {
    this.ensureTabId();
    this.bindUnloadListeners();
  }

  ngOnDestroy() {
    this.stopHeartbeat();
  }

  hasActiveForeignSession(): boolean {
    const lock = this.readLock();
    if (!lock || !this.isFresh(lock)) {
      return false;
    }

    return lock.tabId !== this.getTabId();
  }

  tryAcquire(): boolean {
    this.ensureTabId();

    if (this.hasActiveForeignSession()) {
      this.markBlocked();
      this.stopHeartbeat();
      return false;
    }

    this.clearBlocked();
    this.writeLock();
    this.startHeartbeat();
    return true;
  }

  release(): void {
    const lock = this.readLock();
    if (lock?.tabId === this.getTabId()) {
      localStorage.removeItem(this.lockKey);
    }
    this.clearBlocked();
    this.stopHeartbeat();
  }

  canUseAuthenticatedSession(): boolean {
    if (this.isBlocked()) {
      return false;
    }

    const lock = this.readLock();
    if (!lock) {
      return true;
    }

    if (!this.isFresh(lock)) {
      return true;
    }

    return lock.tabId === this.getTabId();
  }

  isBlocked(): boolean {
    if (typeof window === 'undefined') {
      return false;
    }

    return sessionStorage.getItem(this.blockedKey) === '1';
  }

  private ensureTabId(): string {
    if (typeof window === 'undefined') {
      return 'server';
    }

    let tabId = sessionStorage.getItem(this.tabIdKey);
    if (!tabId) {
      tabId = `tab-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      sessionStorage.setItem(this.tabIdKey, tabId);
    }

    return tabId;
  }

  private getTabId(): string {
    return this.ensureTabId();
  }

  private bindUnloadListeners() {
    if (typeof window === 'undefined' || this.unloadBound) {
      return;
    }

    const release = () => this.release();
    window.addEventListener('beforeunload', release);
    window.addEventListener('pagehide', release);
    this.unloadBound = true;
  }

  private startHeartbeat() {
    if (this.heartbeatTimer || typeof window === 'undefined') {
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      const lock = this.readLock();
      if (!lock || !this.isFresh(lock) || lock.tabId === this.getTabId()) {
        this.writeLock();
      }
    }, this.heartbeatMs);
  }

  private stopHeartbeat() {
    if (!this.heartbeatTimer) {
      return;
    }

    clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private writeLock() {
    if (typeof window === 'undefined') {
      return;
    }

    const payload: SessionLockPayload = {
      tabId: this.getTabId(),
      timestamp: Date.now(),
    };

    localStorage.setItem(this.lockKey, JSON.stringify(payload));
  }

  private readLock(): SessionLockPayload | null {
    if (typeof window === 'undefined') {
      return null;
    }

    const raw = localStorage.getItem(this.lockKey);
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as Partial<SessionLockPayload>;
      if (!parsed.tabId || typeof parsed.timestamp !== 'number') {
        return null;
      }

      return {
        tabId: parsed.tabId,
        timestamp: parsed.timestamp,
      };
    } catch {
      return null;
    }
  }

  private isFresh(lock: SessionLockPayload): boolean {
    return Date.now() - lock.timestamp < this.staleMs;
  }

  private markBlocked() {
    if (typeof window === 'undefined') {
      return;
    }

    sessionStorage.setItem(this.blockedKey, '1');
  }

  private clearBlocked() {
    if (typeof window === 'undefined') {
      return;
    }

    sessionStorage.removeItem(this.blockedKey);
  }
}
