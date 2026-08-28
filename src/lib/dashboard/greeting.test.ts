import { describe, expect, it } from 'vitest';
import { getDashboardGreeting } from './greeting';

describe('dashboard greeting', () => {
  it('uses the browser-local time for afternoon greetings', () => {
    const result = getDashboardGreeting(new Date(2026, 7, 28, 15, 30));

    expect(result.greeting).toBe('Good afternoon.');
    expect(result.dayLabel).toBe('Friday, your rental at a glance');
  });

  it('uses morning greetings before noon', () => {
    const result = getDashboardGreeting(new Date(2026, 7, 28, 9, 15));

    expect(result.greeting).toBe('Good morning.');
  });
});
