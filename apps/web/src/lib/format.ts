import type { CvStatus, JobStage } from '@cvb/shared';

export function relativeTime(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (diff < 60) return 'just now';
  if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
  if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
  return rtf.format(-Math.round(diff / 86400), 'day');
}

export const STATUS_LABEL: Record<CvStatus, string> = {
  generating: 'Generating…',
  ready: 'Ready',
  failed: 'Needs attention',
};

export const STAGES: { key: JobStage; label: string }[] = [
  { key: 'queued', label: 'Waiting in line' },
  { key: 'reading_source', label: 'Reading your information' },
  { key: 'drafting', label: 'Drafting your CV' },
  { key: 'verifying', label: 'Fact-checking against your input' },
  { key: 'saving', label: 'Saving' },
];
