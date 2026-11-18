import { useEffect, useState } from 'react';

const srDateFormatter = new Intl.DateTimeFormat('sr-RS');
const srTimeFormatter = new Intl.DateTimeFormat('sr-RS', {
  hour: '2-digit',
  minute: '2-digit',
});

export function formatSrDate(value?: string | Date | null): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : srDateFormatter.format(d);
}

export function formatSrTime(value?: string | Date | null): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : srTimeFormatter.format(d);
}

export function formatSrDateTime(value?: string | Date | null): string {
  if (!value) return '—';
  const datePart = formatSrDate(value);
  const timePart = formatSrTime(value);
  return timePart ? `${datePart} u ${timePart}` : datePart;
}

export function isValidPhotoUrl(url?: string | null): url is string {
  if (!url) return false;
  try {
    return ['https:', 'http:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export function getAssignmentHoursDiff(a: any): number | null {
  const hasEndHours = a?.endHours !== null && a?.endHours !== undefined && a?.endHours !== '';
  const hasStartHours = a?.startHours !== null && a?.startHours !== undefined && a?.startHours !== '';
  if (!hasEndHours || !hasStartHours) return null;
  return Math.round((Number(a.endHours) - Number(a.startHours)) * 10) / 10;
}

export function getAssignmentStatusMeta(a: any): {
  label: string;
  badgeType: 'active' | 'returned' | 'broken';
} {
  if (a?.voidedAt) {
    return { label: 'Poništeno (pogrešan izbor)', badgeType: 'broken' };
  }
  if (a?.status === 'ZADUZENA') {
    return { label: 'Zadužena', badgeType: 'active' };
  }
  if (a?.status === 'RAZDUZENA') {
    return { label: 'Razdužena', badgeType: 'returned' };
  }
  return { label: 'Pokvarena', badgeType: 'broken' };
}

export function useIsMobile(query = '(max-width: 768px)'): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, [query]);

  return matches;
}
