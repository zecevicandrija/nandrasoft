export function workHours(start: string, end: string, breakMinutes: string) {
  if (!start || !end) return 0;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes < 0) minutes += 1440;
  return Math.max(0, minutes - Number(breakMinutes || 0)) / 60;
}

export function earnings(hours: number, hourlyRate: number) {
  return Math.round((hours * hourlyRate + Number.EPSILON) * 100) / 100;
}
