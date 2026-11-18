import type { IeltsQuestion, ListeningTestPack } from '../types/ielts';

/**
 * Formats a number of seconds into "mm:ss" or "mm:ss.xx".
 */
export function formatSecondsToTime(seconds: number, includeHundredths = true): string {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  const wholeSecs = Math.floor(secs);
  const mm = String(mins).padStart(2, '0');
  const ss = String(wholeSecs).padStart(2, '0');
  if (!includeHundredths) {
    return `${mm}:${ss}`;
  }
  const hundredths = Math.round((secs - wholeSecs) * 100);
  const xx = String(hundredths >= 100 ? 99 : hundredths).padStart(2, '0');
  return `${mm}:${ss}.${xx}`;
}

/**
 * Formats seconds into IELTS timestamp label format e.g. "[00:14.20]".
 */
export function formatTsLabel(seconds: number): string {
  return `[${formatSecondsToTime(seconds, true)}]`;
}

/**
 * Parses user input string (e.g. "01:23.45", "1:23", "83.45", "[00:14.20]") into seconds.
 * Returns null if the string cannot be parsed into a positive finite number.
 */
export function parseTimeToSeconds(val: string | number): number | null {
  if (typeof val === 'number') {
    return Number.isFinite(val) && val >= 0 ? Number(val.toFixed(2)) : null;
  }
  if (!val) return null;
  const clean = val.trim().replace(/^\[|\]$/g, '').trim();
  if (!clean) return null;

  if (clean.includes(':')) {
    const parts = clean.split(':');
    if (parts.length === 2) {
      const mins = parseFloat(parts[0]);
      const secs = parseFloat(parts[1]);
      if (Number.isFinite(mins) && Number.isFinite(secs) && mins >= 0 && secs >= 0) {
        return Number((mins * 60 + secs).toFixed(2));
      }
    } else if (parts.length === 3) {
      const hrs = parseFloat(parts[0]);
      const mins = parseFloat(parts[1]);
      const secs = parseFloat(parts[2]);
      if (
        Number.isFinite(hrs) &&
        Number.isFinite(mins) &&
        Number.isFinite(secs) &&
        hrs >= 0 &&
        mins >= 0 &&
        secs >= 0
      ) {
        return Number((hrs * 3600 + mins * 60 + secs).toFixed(2));
      }
    }
  }

  const num = parseFloat(clean);
  if (Number.isFinite(num) && num >= 0) {
    return Number(num.toFixed(2));
  }
  return null;
}

/**
 * Derives a smart end time (seconds) for a question if `timestampEndSec` is not explicitly set.
 */
export function getQuestionEndSec(
  q: Pick<IeltsQuestion, 'timestampSec'> & Partial<Pick<IeltsQuestion, 'number' | 'timestampEndSec'>>,
  testPack?: Pick<ListeningTestPack, 'segments' | 'questions' | 'durationSec'>
): number {
  if (
    typeof q.timestampEndSec === 'number' &&
    Number.isFinite(q.timestampEndSec) &&
    q.timestampEndSec > q.timestampSec
  ) {
    return Number(q.timestampEndSec.toFixed(2));
  }

  if (testPack) {
    // 1. Check if a segment specifically references this question
    if (q.number && Array.isArray(testPack.segments)) {
      const matchRef = testPack.segments.find((s) => s.questionRef === q.number);
      if (matchRef && matchRef.endSec > q.timestampSec) {
        return Number(matchRef.endSec.toFixed(2));
      }
    }

    // 2. Check if a segment encompasses this timestamp
    if (Array.isArray(testPack.segments)) {
      const matchSpan = testPack.segments.find(
        (s) => s.startSec <= q.timestampSec && s.endSec > q.timestampSec
      );
      if (matchSpan && matchSpan.endSec > q.timestampSec + 1.2) {
        return Number(matchSpan.endSec.toFixed(2));
      }
    }

    // 3. Check the next question's timestamp
    if (Array.isArray(testPack.questions) && testPack.questions.length > 0) {
      const sorted = [...testPack.questions].sort((a, b) => a.timestampSec - b.timestampSec);
      const nextQ = sorted.find((it) => it.timestampSec > q.timestampSec + 1.5);
      if (nextQ) {
        const candidate = Math.min(q.timestampSec + 12, nextQ.timestampSec - 0.4);
        if (candidate > q.timestampSec + 1.2) {
          return Number(candidate.toFixed(2));
        }
      }
    }

    // 4. Default to max duration if audio is short
    if (testPack.durationSec && testPack.durationSec > q.timestampSec + 1.5) {
      return Number(Math.min(testPack.durationSec, q.timestampSec + 8).toFixed(2));
    }
  }

  return Number((q.timestampSec + 8).toFixed(2));
}
