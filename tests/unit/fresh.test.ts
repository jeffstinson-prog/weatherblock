// Open times on a page left open: which ones are still ahead, and whether a pick has started.
import { describe, expect, it } from 'vitest';
import { hasStarted, stillAhead } from '../../src/booking/fresh';

const at = (iso: string) => ({ id: iso, startsAt: iso, endsAt: iso });
const now = Date.parse('2026-11-25T15:00:00.000Z'); // 10 am Eastern

describe('open times on a page left open', () => {
  it('drops the times that have started and keeps the rest in order', () => {
    const list = [at('2026-11-25T13:00:00.000Z'), at('2026-11-25T15:00:00.000Z'), at('2026-11-25T17:00:00.000Z'), at('2026-11-26T13:00:00.000Z')];
    expect(stillAhead(list, now).map((s) => s.startsAt)).toEqual(['2026-11-25T17:00:00.000Z', '2026-11-26T13:00:00.000Z']);
  });

  it('a pick has started from its start time on', () => {
    expect(hasStarted(at('2026-11-25T14:59:59.000Z'), now)).toBe(true);
    expect(hasStarted(at('2026-11-25T15:00:00.000Z'), now)).toBe(true);
    expect(hasStarted(at('2026-11-25T15:00:01.000Z'), now)).toBe(false);
    expect(hasStarted(null, now)).toBe(false);
  });
});
