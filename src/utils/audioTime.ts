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

/**
 * Pinpoints the exact audio start and end timestamps (seconds) for a question's quote
 * by intelligently scanning and cross-matching transcriptQuote, correctAnswer, and segments.
 */
export function findExactQuoteTimeRange(
  q: IeltsQuestion,
  testPack: ListeningTestPack
): { startSec: number; endSec: number; matchedSegmentId?: string } {
  let start = q.timestampSec;
  let end = getQuestionEndSec(q, testPack);
  let matchedSegmentId: string | undefined;

  const segments = testPack?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    return { startSec: start, endSec: end };
  }

  const quote = (q.transcriptQuote || '').trim().toLowerCase();
  const answer = (q.correctAnswer || '').trim().toLowerCase();

  // 1. If explicit question reference exists on a segment
  if (typeof q.number === 'number') {
    const directRef = segments.find((s) => s.questionRef === q.number);
    if (directRef) {
      start = directRef.startSec;
      end = directRef.endSec;
      matchedSegmentId = directRef.id;
    }
  }

  // 2. Exact or substring match on transcriptQuote
  if (quote.length >= 8) {
    const cleanQuote = quote.replace(/^[“"']+|[”"'.?!,;:]+$/g, '').trim();
    const exactMatch = segments.find((s) => {
      const cleanSeg = s.text.toLowerCase();
      return cleanSeg.includes(cleanQuote) || (cleanQuote.length >= 20 && cleanQuote.includes(cleanSeg));
    });

    if (exactMatch) {
      start = exactMatch.startSec;
      end = exactMatch.endSec;
      matchedSegmentId = exactMatch.id;
      return {
        startSec: Number(start.toFixed(2)),
        endSec: Number(end.toFixed(2)),
        matchedSegmentId,
      };
    }
  }

  // 3. Keyword / semantic token scoring
  if (quote.length >= 6) {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
      'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'that',
      'this', 'it', 'as', 'be', 'have', 'has', 'had', 'you', 'i', 'we'
    ]);
    const quoteWords = quote
      .toLowerCase()
      .replace(/[.,/#!$%^&*;:{}=\-_`~()?"']/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 3 && !stopWords.has(w));

    let bestScore = 0;
    let bestSegIdx = -1;

    segments.forEach((seg, idx) => {
      const segText = seg.text.toLowerCase();
      let matchCount = 0;
      for (const qw of quoteWords) {
        if (segText.includes(qw)) {
          matchCount++;
        }
      }

      let score = quoteWords.length > 0 ? (matchCount / quoteWords.length) * 100 : 0;

      // Heavy bonus if the actual correct answer is in this segment
      if (answer.length >= 3 && segText.includes(answer)) {
        score += 35;
      }

      // Proximity bonus to recorded timestamp
      const diffSec = Math.abs(seg.startSec - q.timestampSec);
      if (diffSec < 8) score += 20;
      else if (diffSec < 20) score += 10;

      if (score > bestScore && score >= 35) {
        bestScore = score;
        bestSegIdx = idx;
      }
    });

    if (bestSegIdx >= 0) {
      const seg = segments[bestSegIdx];
      start = seg.startSec;
      end = seg.endSec;
      matchedSegmentId = seg.id;

      // Check if quote might span into the next segment
      if (bestSegIdx + 1 < segments.length) {
        const nextSeg = segments[bestSegIdx + 1];
        let nextMatch = 0;
        for (const qw of quoteWords) {
          if (nextSeg.text.toLowerCase().includes(qw)) nextMatch++;
        }
        if (nextMatch >= 2) {
          end = nextSeg.endSec;
        }
      }
    }
  }

  // Ensure end is strictly after start
  if (end <= start) {
    end = Number((start + 6).toFixed(2));
  }

  return {
    startSec: Number(start.toFixed(2)),
    endSec: Number(end.toFixed(2)),
    matchedSegmentId,
  };
}
