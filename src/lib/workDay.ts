const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Belgrade', year: 'numeric', month: '2-digit', day: '2-digit' });
export const sameBelgradeDay = (value: string | Date, now = new Date()) => Boolean(value) && day.format(new Date(value)) === day.format(now);
