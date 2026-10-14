import { describe, it, expect } from 'vitest';
import {
  backoffMs,
  classifyReply,
  classifyThrown,
  explain,
  probeVerdict,
  redact,
} from '../../src/lib/nas-diagnostics';

describe('NAS diagnostics', () => {
  it('never shows the token', () => {
    const t = 's3cr3t/token+x';
    const msg = `GET https://nas.example/systema-backup.php?kind=latest&token=${encodeURIComponent(t)} failed; raw ${t}`;
    const safe = redact(msg, t);
    expect(safe).not.toContain(t);
    expect(safe).not.toContain(encodeURIComponent(t));
    expect(safe).toContain('token=•••');
  });

  it('names each failure by its HTTP answer', () => {
    expect(classifyReply(200, { ok: true })).toBeNull();
    expect(classifyReply(403, { ok: false, error: 'bad token' })).toBe('auth');
    expect(classifyReply(404, null)).toBe('not-found');
    expect(classifyReply(413, null)).toBe('too-large');
    // PHP drops a body over post_max_size: the receiver sees an empty one.
    expect(classifyReply(400, { error: 'empty body' }, 9_000_000)).toBe('too-large');
    expect(classifyReply(500, { error: 'write failed' })).toBe('server');
    expect(classifyReply(200, null)).toBe('bad-response');
    expect(classifyThrown(new TypeError('Load failed'))).toBe('unreachable');
    expect(classifyThrown(new TypeError('Load failed'), false)).toBe('offline');
  });

  it('does not call every failure normal', () => {
    expect(explain('auth')).toMatch(/token/);
    expect(explain('too-large', '', 12_300_000)).toMatch(/12\.3 MB.*post_max_size/);
    expect(explain('unreachable')).toMatch(/Test connection/);
  });

  it('backs off a failing photo: 5 min doubling, capped at 6 h', () => {
    expect(backoffMs(1)).toBe(300_000);
    expect(backoffMs(2)).toBe(600_000);
    expect(backoffMs(20)).toBe(6 * 3_600_000);
  });

  it('reads the size probe from the current and the original receiver', () => {
    expect(probeVerdict(200, { ok: true, bytes: 5 }, 5).ok).toBe(true);
    expect(probeVerdict(200, { ok: true, bytes: 3 }, 5).ok).toBe(false);
    expect(probeVerdict(400, { ok: false, error: 'unknown kind' }, 5).ok).toBe(true);
    expect(probeVerdict(400, { ok: false, error: 'empty body' }, 5).detail).toMatch(
      /post_max_size/,
    );
    expect(probeVerdict('threw', null, 5).detail).toMatch(/proxy/);
  });
});
