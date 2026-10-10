import { describe, expect, it } from 'vitest';

describe('config de folga', () => {
  it('tem defaults', async () => {
    const { config } = await import('../src/config.js');
    expect(config.folgaAskWeekday).toBe(0);
    expect(config.folgaAskHour).toBe(9);
    expect(config.folgaRemindHour).toBe(9);
    expect(typeof config.folgaAskEnabled).toBe('boolean');
  });
});
