export function getDashboardGreeting(now = new Date()) {
  const hour = now.getHours();
  const day = now.toLocaleDateString('en-US', { weekday: 'long' });

  return {
    greeting: hour < 12 ? 'Good morning.' : hour < 18 ? 'Good afternoon.' : 'Good evening.',
    dayLabel: `${day}, your rental at a glance`
  };
}
