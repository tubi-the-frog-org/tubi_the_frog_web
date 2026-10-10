import { randomUUID } from 'node:crypto';

export class SessionLock {
  constructor({ idleTimeoutMs = 60_000, maxDurationMs = 180_000, now = Date.now } = {}) {
    this.idleTimeoutMs = idleTimeoutMs;
    this.maxDurationMs = maxDurationMs;
    this.now = now;
    this.session = null;
  }

  get active() {
    return this.session !== null;
  }

  isOwner(sessionId) {
    this.expireIfNeeded();
    return Boolean(this.session && sessionId && this.session.sessionId === sessionId);
  }

  start() {
    this.expireIfNeeded();
    if (this.active) return null;

    const now = this.now();
    this.session = {
      sessionId: randomUUID(),
      startedAt: now,
      lastHeartbeat: now
    };
    return { ...this.session };
  }

  resume(sessionId) {
    return this.heartbeat(sessionId) ? { ...this.session } : null;
  }

  heartbeat(sessionId) {
    this.expireIfNeeded();
    if (!this.session || !sessionId || sessionId !== this.session.sessionId) return false;

    this.session.lastHeartbeat = this.now();
    return true;
  }

  end(sessionId) {
    this.expireIfNeeded();
    if (!this.session || !sessionId || sessionId !== this.session.sessionId) return false;

    this.session = null;
    return true;
  }

  forceEnd() {
    const wasActive = this.active;
    this.session = null;
    return wasActive;
  }

  expireIfNeeded() {
    if (!this.session) return false;

    const now = this.now();
    const idleExpired = now - this.session.lastHeartbeat >= this.idleTimeoutMs;
    const durationExpired = now - this.session.startedAt >= this.maxDurationMs;
    if (!idleExpired && !durationExpired) return false;

    this.session = null;
    return true;
  }

  snapshot() {
    return {
      state: this.active ? 'active' : 'idle',
      startedAt: this.session?.startedAt ?? null
    };
  }
}