import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionLock } from './session-lock.js';

const createLock = () => {
  let now = 1_000;
  const lock = new SessionLock({
    idleTimeoutMs: 60_000,
    maxDurationMs: 180_000,
    now: () => now
  });
  return {
    lock,
    advance: (milliseconds) => { now += milliseconds; }
  };
};

test('only one session can own the lock at a time', () => {
  const { lock } = createLock();
  const session = lock.start();

  assert.ok(session?.sessionId);
  assert.equal(lock.start(), null);
  assert.equal(lock.snapshot().state, 'active');
});

test('only the session owner can heartbeat, resume, or end', () => {
  const { lock } = createLock();
  const session = lock.start();

  assert.equal(lock.heartbeat('wrong-session'), false);
  assert.equal(lock.isOwner('wrong-session'), false);
  assert.equal(lock.resume('wrong-session'), null);
  assert.equal(lock.end('wrong-session'), false);
  assert.equal(lock.snapshot().state, 'active');

  assert.equal(lock.heartbeat(session.sessionId), true);
  assert.equal(lock.isOwner(session.sessionId), true);
  assert.ok(lock.resume(session.sessionId));
  assert.equal(lock.end(session.sessionId), true);
  assert.equal(lock.snapshot().state, 'idle');
});

test('idle sessions expire unless their owner heartbeats', () => {
  const { lock, advance } = createLock();
  const session = lock.start();

  advance(50_000);
  assert.equal(lock.heartbeat(session.sessionId), true);
  advance(59_999);
  assert.equal(lock.expireIfNeeded(), false);
  advance(1);
  assert.equal(lock.expireIfNeeded(), true);
  assert.equal(lock.snapshot().state, 'idle');
});

test('sessions expire at the hard duration even with regular heartbeats', () => {
  const { lock, advance } = createLock();
  const session = lock.start();

  advance(50_000);
  assert.equal(lock.heartbeat(session.sessionId), true);
  advance(50_000);
  assert.equal(lock.heartbeat(session.sessionId), true);
  advance(50_000);
  assert.equal(lock.heartbeat(session.sessionId), true);
  advance(30_000);
  assert.equal(lock.heartbeat(session.sessionId), false);
  assert.equal(lock.snapshot().state, 'idle');
});