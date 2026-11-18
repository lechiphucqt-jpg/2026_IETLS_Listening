import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SAMPLE_TESTS } from './data/sampleTests';
import type {
  AwlVocabItem,
  ClassroomDrillSentence,
  FlashcardItem,
  ListeningTestPack,
  PedagogicalReport,
} from './types/ielts';
import { TopBar, type WorkspaceView } from './components/TopBar';
import { AudioSyncBar } from './components/AudioSyncBar';
import { IdpExamWorkspace } from './components/IdpExamWorkspace';
import { PedagogicalReportView } from './components/PedagogicalReportView';
import {
  AdvancedPracticeStudio,
  type PracticeModeTab,
} from './components/AdvancedPracticeStudio';
import { VocabularyFlashcardView } from './components/VocabularyFlashcardView';
import { IngestModal } from './components/IngestModal';
import { ApiKeyModal } from './components/ApiKeyModal';
import { safeParseJsonResponse } from './utils/safeFetchJson';
import { useDisplaySettings } from './utils/useDisplaySettings';
import { generatePedagogicalReportClientSide } from './utils/clientGemini';
import {
  deleteMediaForTest,
  getOrCreateLiveMediaUrl,
  isAudioUrlPlayable,
  saveMediaBlob,
} from './utils/indexedDBStorage';

const FLASHCARD_STORAGE_KEY = 'lexisync_ielts_flashcards_v1';
const CUSTOM_TESTS_STORAGE_KEY = 'lexisync_ielts_custom_tests_v1';
const TEST_OVERRIDES_STORAGE_KEY = 'lexisync_ielts_test_overrides_v1';
const ACTIVE_TEST_STORAGE_KEY = 'lexisync_ielts_active_test_v1';
const ANSWERS_STORAGE_KEY = 'lexisync_ielts_answers_v1';
const REPORTS_STORAGE_KEY = 'lexisync_ielts_reports_v1';

const SAMPLE_ID_SET = new Set(SAMPLE_TESTS.map((t) => t.id));

function getSamplesWithOverrides(): ListeningTestPack[] {
  try {
    const raw = localStorage.getItem(TEST_OVERRIDES_STORAGE_KEY);
    if (raw) {
      const overrides = JSON.parse(raw) as Record<string, Partial<ListeningTestPack>>;
      if (overrides && typeof overrides === 'object') {
        return SAMPLE_TESTS.map((st) => {
          if (overrides[st.id]) {
            return { ...st, ...overrides[st.id] };
          }
          return st;
        });
      }
    }
  } catch {
    // ignore
  }
  return SAMPLE_TESTS;
}

function mergeTestsWithSamples(customList: ListeningTestPack[]): ListeningTestPack[] {
  const seen = new Set<string>();
  const validCustom: ListeningTestPack[] = [];
  for (const item of customList) {
    if (!item || !item.id || SAMPLE_ID_SET.has(item.id) || seen.has(item.id)) continue;
    seen.add(item.id);
    validCustom.push({ ...item, isCustomUpload: true });
  }
  return [...validCustom, ...getSamplesWithOverrides()];
}

function getAuthHeaders(extra?: Record<string, string>): Record<string, string> {
  const apiKey = localStorage.getItem('GEMINI_API_KEY') || '';
  return {
    Accept: 'application/json',
    ...(apiKey ? { 'x-gemini-api-key': apiKey } : {}),
    ...(extra || {}),
  };
}

function loadInitialTests(): ListeningTestPack[] {
  try {
    const raw = localStorage.getItem(CUSTOM_TESTS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as ListeningTestPack[];
      if (Array.isArray(parsed)) {
        return mergeTestsWithSamples(parsed);
      }
    }
  } catch {
    // ignore storage errors
  }
  return getSamplesWithOverrides();
}

function loadInitialActiveTestId(initialTests: ListeningTestPack[]): string {
  try {
    const savedId = localStorage.getItem(ACTIVE_TEST_STORAGE_KEY);
    if (savedId && initialTests.some((t) => t.id === savedId)) {
      return savedId;
    }
  } catch {
    // ignore
  }
  return initialTests[0]?.id || SAMPLE_TESTS[0].id;
}

function loadJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw) as T;
  } catch {
    // ignore
  }
  return fallback;
}

function formatTsLabel(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  const wholeSecs = Math.floor(secs);
  const hundredths = Math.round((secs - wholeSecs) * 100);
  const mm = String(mins).padStart(2, '0');
  const ss = String(wholeSecs).padStart(2, '0');
  const xx = String(hundredths >= 100 ? 99 : hundredths).padStart(2, '0');
  return `[${mm}:${ss}.${xx}]`;
}

function calibrateTimelineItems<T extends { startSec: number; endSec: number; timestampLabel: string }>(
  items: T[],
  realDuration: number,
  textAccessor: (item: T) => string
): T[] {
  if (items.length <= 1 || !Number.isFinite(realDuration) || realDuration <= 2) return items;
  const zeroStarts = items.filter((it) => it.startSec <= 0.05).length;
  const maxEnd = Math.max(...items.map((it) => it.endSec));
  const needsScale =
    zeroStarts > 1 || (realDuration > 15 && maxEnd > 0 && maxEnd < realDuration * 0.45);
  if (!needsScale) return items;

  if (zeroStarts <= 1 && maxEnd > 5) {
    const ratio = realDuration / maxEnd;
    return items.map((it) => {
      const startSec = Number((it.startSec * ratio).toFixed(2));
      const endSec = Number(Math.max(startSec + 1.5, it.endSec * ratio).toFixed(2));
      return { ...it, startSec, endSec, timestampLabel: formatTsLabel(startSec) };
    });
  }

  const totalWeight = Math.max(
    1,
    items.reduce((acc, it) => acc + Math.max(10, textAccessor(it).length), 0)
  );
  let cursor = 0;
  return items.map((it) => {
    const span = Math.max(1.8, (Math.max(10, textAccessor(it).length) / totalWeight) * realDuration);
    const startSec = Number(cursor.toFixed(2));
    const endSec = Number(Math.min(realDuration, cursor + span).toFixed(2));
    cursor += span;
    return {
      ...it,
      startSec,
      endSec: Math.max(startSec + 1.5, endSec),
      timestampLabel: formatTsLabel(startSec),
    };
  });
}

function loadInitialFlashcards(): FlashcardItem[] {
  try {
    const raw = localStorage.getItem(FLASHCARD_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as FlashcardItem[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch {
    // ignore storage errors
  }

  return SAMPLE_TESTS[0].vocabulary.slice(0, 3).map((v) => ({
    id: `fc-${SAMPLE_TESTS[0].id}-${v.word.toLowerCase()}`,
    testId: SAMPLE_TESTS[0].id,
    word: v.word,
    ipa: v.ipa,
    pos: v.pos,
    definitionVi: v.definitionVi,
    contextualMeaningVi: v.contextualMeaningVi || v.definitionVi,
    definitionEn: v.definitionEn,
    exampleInAudio: v.exampleInAudio,
    exampleTranslationVi: v.exampleTranslationVi || '',
    timestampLabel: v.timestampLabel,
    sourceTitle: SAMPLE_TESTS[0].title,
    status: 'new',
    addedAt: new Date().toISOString(),
  }));
}

export default function App() {
  const [tests, setTests] = useState<ListeningTestPack[]>(loadInitialTests);
  const [activeTestId, setActiveTestId] = useState<string>(() =>
    loadInitialActiveTestId(loadInitialTests())
  );
  const [activeView, setActiveView] = useState<WorkspaceView>('exam');
  const [practiceTab, setPracticeTab] = useState<PracticeModeTab>('classroom');
  const [focusTimestampSec, setFocusTimestampSec] = useState<number | null>(null);
  const [isIngestOpen, setIsIngestOpen] = useState(false);
  const [isApiKeyOpen, setIsApiKeyOpen] = useState(false);

  // Answers & Exam Timer
  const [answersByTest, setAnswersByTest] = useState<Record<string, Record<number, string>>>(() =>
    loadJsonStorage(ANSWERS_STORAGE_KEY, {})
  );
  const [elapsedSec, setElapsedSec] = useState(0);
  const [reportsByTest, setReportsByTest] = useState<Record<string, PedagogicalReport>>(() =>
    loadJsonStorage(REPORTS_STORAGE_KEY, {})
  );
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  // Flashcards
  const [flashcards, setFlashcards] = useState<FlashcardItem[]>(loadInitialFlashcards);

  // Global Page Display Controls: Font Scaling & Fullscreen
  const {
    fontScale,
    increaseFont,
    decreaseFont,
    resetFont,
    isFullscreen,
    toggleFullscreen,
  } = useDisplaySettings();

  // Sync saved custom tests from server disk on mount (preserves uploaded files across devices/reloads)
  useEffect(() => {
    let cancelled = false;
    fetch('/api/ielts/tests', { credentials: 'same-origin', headers: { Accept: 'application/json' } })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { tests?: ListeningTestPack[] } | null) => {
        if (cancelled || !data || !Array.isArray(data.tests)) return;
        const serverCustom = data.tests;
        setTests((prev) => {
          const localCustom = prev.filter((t) => !SAMPLE_ID_SET.has(t.id));
          const mergedMap = new Map<string, ListeningTestPack>();
          for (const item of serverCustom) {
            if (item && item.id) mergedMap.set(item.id, item);
          }
          for (const item of localCustom) {
            if (item && item.id && !mergedMap.has(item.id)) {
              mergedMap.set(item.id, item);
            }
          }
          return mergeTestsWithSamples(Array.from(mergedMap.values()));
        });
      })
      .catch(() => {
        // ignore offline/initial sync error
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Rehydrate persistent Audio & PDF blobs from IndexedDB across page reloads/sessions
  useEffect(() => {
    let cancelled = false;

    async function rehydrateMedia() {
      const customPacks = tests.filter((t) => t.isCustomUpload || !SAMPLE_ID_SET.has(t.id));
      if (customPacks.length === 0) return;

      let changed = false;
      const updatedTests = await Promise.all(
        tests.map(async (t) => {
          if (!t.isCustomUpload && SAMPLE_ID_SET.has(t.id)) return t;

          let nextAudioUrl = t.audioUrl;
          let nextAudioName = t.audioFileName;
          let nextPdfUrl = t.pdfUrl;
          let nextPdfName = t.pdfFileName;

          try {
            const liveAudio = await getOrCreateLiveMediaUrl(t.id, 'audio');
            if (liveAudio && liveAudio.url) {
              if (liveAudio.url !== t.audioUrl) {
                nextAudioUrl = liveAudio.url;
                if (liveAudio.fileName) nextAudioName = liveAudio.fileName;
                changed = true;
              }
            } else if (t.audioUrl && t.audioUrl.startsWith('blob:')) {
              // Dead blob URL from an old session, check if playable
              const playable = await isAudioUrlPlayable(t.audioUrl);
              if (!playable) {
                nextAudioUrl = undefined;
                changed = true;
              }
            }
          } catch {
            // ignore
          }

          try {
            const livePdf = await getOrCreateLiveMediaUrl(t.id, 'pdf');
            if (livePdf && livePdf.url) {
              if (livePdf.url !== t.pdfUrl) {
                nextPdfUrl = livePdf.url;
                if (livePdf.fileName) nextPdfName = livePdf.fileName;
                changed = true;
              }
            } else if (t.pdfUrl && t.pdfUrl.startsWith('blob:')) {
              const playable = await isAudioUrlPlayable(t.pdfUrl);
              if (!playable) {
                nextPdfUrl = undefined;
                changed = true;
              }
            }
          } catch {
            // ignore
          }

          if (
            nextAudioUrl !== t.audioUrl ||
            nextAudioName !== t.audioFileName ||
            nextPdfUrl !== t.pdfUrl ||
            nextPdfName !== t.pdfFileName
          ) {
            return {
              ...t,
              audioUrl: nextAudioUrl,
              audioFileName: nextAudioName,
              pdfUrl: nextPdfUrl,
              pdfFileName: nextPdfName,
            };
          }
          return t;
        })
      );

      if (!cancelled && changed) {
        setTests(updatedTests);
      }
    }

    rehydrateMedia();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      const customOnly = tests.filter((t) => !SAMPLE_ID_SET.has(t.id));
      localStorage.setItem(CUSTOM_TESTS_STORAGE_KEY, JSON.stringify(customOnly));

      const sampleOverrides: Record<string, Partial<ListeningTestPack>> = {};
      tests.forEach((t) => {
        if (SAMPLE_ID_SET.has(t.id)) {
          sampleOverrides[t.id] = {
            questions: t.questions,
            classroomDrills: t.classroomDrills,
            segments: t.segments,
            durationSec: t.durationSec,
          };
        }
      });
      localStorage.setItem(TEST_OVERRIDES_STORAGE_KEY, JSON.stringify(sampleOverrides));
    } catch {
      // ignore quota errors
    }
  }, [tests]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_TEST_STORAGE_KEY, activeTestId);
    } catch {
      // ignore
    }
  }, [activeTestId]);

  useEffect(() => {
    try {
      localStorage.setItem(ANSWERS_STORAGE_KEY, JSON.stringify(answersByTest));
    } catch {
      // ignore
    }
  }, [answersByTest]);

  useEffect(() => {
    try {
      localStorage.setItem(REPORTS_STORAGE_KEY, JSON.stringify(reportsByTest));
    } catch {
      // ignore
    }
  }, [reportsByTest]);

  useEffect(() => {
    try {
      localStorage.setItem(FLASHCARD_STORAGE_KEY, JSON.stringify(flashcards));
    } catch {
      // ignore
    }
  }, [flashcards]);

  const activeTest = useMemo(() => {
    return tests.find((t) => t.id === activeTestId) || tests[0];
  }, [tests, activeTestId]);

  const userAnswers = useMemo(() => {
    return answersByTest[activeTest.id] || {};
  }, [answersByTest, activeTest.id]);

  const activeReport = reportsByTest[activeTest.id] || null;

  // Exam timer tick while in exam view
  useEffect(() => {
    if (activeView !== 'exam') return;
    const timer = window.setInterval(() => {
      setElapsedSec((prev) => prev + 1);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [activeView]);

  // Audio playback state (supports both HTML5 <audio> for WAV/MP3 & Web Speech fallback)
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(activeTest.durationSec);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1.0);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [ttsNotice, setTtsNotice] = useState<string | null>(null);
  const [audioHasError, setAudioHasError] = useState(false);

  const segmentEndLimitRef = useRef<number | null>(null);
  const speechTickerRef = useRef<number | null>(null);
  const speechStartWallRef = useRef<number>(0);
  const speechStartAudioRef = useRef<number>(0);

  const stopSpeechFallback = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (speechTickerRef.current) {
      window.clearInterval(speechTickerRef.current);
      speechTickerRef.current = null;
    }
  }, []);

  // Reset audio position when switching tests
  useEffect(() => {
    stopSpeechFallback();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
    segmentEndLimitRef.current = null;
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(activeTest.durationSec);
    setAudioHasError(false);
    setTtsNotice(null);
    setElapsedSec(0);
    setAnalyzeError(null);

    // Verify if active test audio URL is playable
    if (activeTest.audioUrl) {
      isAudioUrlPlayable(activeTest.audioUrl).then((playable) => {
        if (!playable) {
          getOrCreateLiveMediaUrl(activeTest.id, 'audio').then((recovered) => {
            if (recovered && recovered.url && recovered.url !== activeTest.audioUrl) {
              setTests((prev) =>
                prev.map((t) => (t.id === activeTest.id ? { ...t, audioUrl: recovered.url } : t))
              );
              setAudioHasError(false);
            } else {
              setAudioHasError(true);
            }
          });
        }
      });
    }
  }, [activeTest.id, activeTest.audioUrl, activeTest.durationSec, stopSpeechFallback]);

  // Sync HTML5 audio playback rate
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  // Real HTML5 audio listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !activeTest.audioUrl) return;

    const handleTime = () => {
      const t = audio.currentTime;
      setCurrentTime(t);
      if (
        segmentEndLimitRef.current !== null &&
        t >= segmentEndLimitRef.current
      ) {
        audio.pause();
        segmentEndLimitRef.current = null;
        setIsPlaying(false);
      }
    };

    const handleLoaded = () => {
      setAudioHasError(false);
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        const realDur = Number(audio.duration.toFixed(2));
        setDuration(realDur);
        setTests((prev) =>
          prev.map((t) => {
            if (t.id !== activeTest.id) return t;
            const nextSegments = calibrateTimelineItems(t.segments, realDur, (s) => s.text);
            const nextDrills = t.classroomDrills
              ? calibrateTimelineItems(t.classroomDrills, realDur, (d) => d.sentence)
              : t.classroomDrills;
            if (
              Math.abs(t.durationSec - realDur) <= 1.5 &&
              nextSegments === t.segments &&
              nextDrills === t.classroomDrills
            ) {
              return t;
            }
            return {
              ...t,
              durationSec: realDur,
              segments: nextSegments,
              classroomDrills: nextDrills,
            };
          })
        );
      }
    };

    const handleEnded = () => {
      setIsPlaying(false);
      segmentEndLimitRef.current = null;
    };

    const handleError = async () => {
      console.warn('[Audio] HTML5 audio error encountered for', activeTest.id);
      setAudioHasError(true);
      setIsPlaying(false);

      if (activeTest.id && !SAMPLE_ID_SET.has(activeTest.id)) {
        try {
          const liveMedia = await getOrCreateLiveMediaUrl(activeTest.id, 'audio');
          if (liveMedia && liveMedia.url && liveMedia.url !== activeTest.audioUrl) {
            setTests((prev) =>
              prev.map((t) => (t.id === activeTest.id ? { ...t, audioUrl: liveMedia.url } : t))
            );
            setAudioHasError(false);
            return;
          }
        } catch {
          // ignore
        }
      }

      setTtsNotice(
        'Tệp audio không thể phát hoặc đã hết hạn phiên làm việc. Hệ thống đã tự động chuyển sang giọng đọc mô phỏng. Bạn có thể bấm "Gắn lại Audio từ máy" để tiếp tục nghe file âm thanh gốc.'
      );
    };

    audio.addEventListener('timeupdate', handleTime);
    audio.addEventListener('loadedmetadata', handleLoaded);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);
    return () => {
      audio.removeEventListener('timeupdate', handleTime);
      audio.removeEventListener('loadedmetadata', handleLoaded);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, [activeTest.audioUrl, activeTest.id]);

  const startSpeechFromTime = useCallback(
    (startSec: number, endLimitSec: number | null) => {
      stopSpeechFallback();
      segmentEndLimitRef.current = endLimitSec;

      if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
        setTtsNotice(
          'Trình duyệt không hỗ trợ phát giọng nói trực tiếp. Vui lòng nhấn "Tạo Audio chuẩn IELTS (AI TTS)".'
        );
        return;
      }

      const remainingSegs = activeTest.segments.filter(
        (seg) => seg.endSec > startSec && (endLimitSec === null || seg.startSec < endLimitSec)
      );

      if (remainingSegs.length === 0) {
        setIsPlaying(false);
        return;
      }

      setCurrentTime(startSec);
      setIsPlaying(true);
      speechStartWallRef.current = performance.now();
      speechStartAudioRef.current = startSec;

      const maxDuration = endLimitSec ?? activeTest.durationSec;

      speechTickerRef.current = window.setInterval(() => {
        const elapsedWall = (performance.now() - speechStartWallRef.current) / 1000;
        const projected = speechStartAudioRef.current + elapsedWall * playbackRate;
        if (projected >= maxDuration) {
          setCurrentTime(maxDuration);
          stopSpeechFallback();
          setIsPlaying(false);
          segmentEndLimitRef.current = null;
        } else {
          setCurrentTime(projected);
        }
      }, 60);

      remainingSegs.forEach((seg, idx) => {
        const utter = new SpeechSynthesisUtterance(seg.text);
        utter.lang = 'en-GB';
        utter.rate = playbackRate;
        // Differentiate speakers subtly by pitch
        const speakerIndex = activeTest.speakers.findIndex(
          (sp) => sp.name.toLowerCase() === seg.speaker.toLowerCase()
        );
        utter.pitch = speakerIndex === 1 ? 0.92 : 1.05;

        if (idx === remainingSegs.length - 1) {
          utter.onend = () => {
            stopSpeechFallback();
            setIsPlaying(false);
            segmentEndLimitRef.current = null;
          };
        }
        window.speechSynthesis.speak(utter);
      });
    },
    [activeTest, playbackRate, stopSpeechFallback]
  );

  const seekAndPlay = useCallback(
    (targetSec: number, endLimitSec: number | null = null) => {
      const clamped = Math.max(0, Math.min(duration, targetSec));
      segmentEndLimitRef.current = endLimitSec;

      if (activeTest.audioUrl && audioRef.current && !audioHasError) {
        stopSpeechFallback();
        audioRef.current.currentTime = clamped;
        audioRef.current.playbackRate = playbackRate;
        audioRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn('[Audio] play() failed, falling back to speech synthesis:', err);
            setIsPlaying(false);
            setAudioHasError(true);
            startSpeechFromTime(clamped, endLimitSec);
          });
        setCurrentTime(clamped);
      } else {
        startSpeechFromTime(clamped, endLimitSec);
      }
    },
    [activeTest.audioUrl, audioHasError, duration, playbackRate, startSpeechFromTime, stopSpeechFallback]
  );

  const handleSeek = useCallback(
    (targetSec: number) => {
      const clamped = Math.max(0, Math.min(duration, targetSec));
      setCurrentTime(clamped);
      if (activeTest.audioUrl && audioRef.current && !audioHasError) {
        audioRef.current.currentTime = clamped;
      } else if (isPlaying) {
        startSpeechFromTime(clamped, null);
      }
    },
    [activeTest.audioUrl, audioHasError, duration, isPlaying, startSpeechFromTime]
  );

  const handleTogglePlay = useCallback(() => {
    if (activeTest.audioUrl && audioRef.current && !audioHasError) {
      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        audioRef.current.playbackRate = playbackRate;
        audioRef.current
          .play()
          .then(() => setIsPlaying(true))
          .catch((err) => {
            console.warn('[Audio] handleTogglePlay play() failed:', err);
            setIsPlaying(false);
            setAudioHasError(true);
            const startPos = currentTime >= activeTest.durationSec - 0.5 ? 0 : currentTime;
            startSpeechFromTime(startPos, null);
          });
      }
    } else {
      if (isPlaying) {
        stopSpeechFallback();
        setIsPlaying(false);
      } else {
        const startPos = currentTime >= activeTest.durationSec - 0.5 ? 0 : currentTime;
        startSpeechFromTime(startPos, null);
      }
    }
  }, [
    activeTest.audioUrl,
    activeTest.durationSec,
    audioHasError,
    currentTime,
    isPlaying,
    playbackRate,
    startSpeechFromTime,
    stopSpeechFallback,
  ]);

  const handleSynthesizeAudio = async () => {
    setIsSynthesizing(true);
    setTtsNotice(null);
    try {
      const res = await fetch('/api/ielts/synthesize-audio', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          testId: activeTest.id,
          segments: activeTest.segments,
          speakers: activeTest.speakers,
        }),
      });
      const data = await safeParseJsonResponse<{
        audioUrl?: string;
        durationSec?: number;
        alignedSegments?: ListeningTestPack['segments'];
        error?: string;
      }>(res, 'Không thể tạo Audio WAV từ Gemini TTS.');
      if (!data.audioUrl) {
        throw new Error(data.error || 'Không thể tạo Audio WAV từ Gemini TTS.');
      }

      stopSpeechFallback();
      setIsPlaying(false);
      setTests((prev) =>
        prev.map((t) =>
          t.id === activeTest.id
            ? {
                ...t,
                audioUrl: data.audioUrl,
                durationSec: data.durationSec || t.durationSec,
                segments: data.alignedSegments || t.segments,
              }
            : t
        )
      );
      setDuration(data.durationSec || activeTest.durationSec);
      setTtsNotice(
        'Đã tạo Audio WAV chuẩn IELTS đa giọng đọc (Gemini 3.8 TTS) và tự động căn chỉnh lại timestamp.'
      );
    } catch (err: unknown) {
      setTtsNotice(
        err instanceof Error
          ? err.message
          : 'Không thể khởi tạo audio từ máy chủ.'
      );
    } finally {
      setIsSynthesizing(false);
    }
  };

  const handleSubmitExam = async () => {
    setIsAnalyzing(true);
    setAnalyzeError(null);
    try {
      let report: PedagogicalReport | undefined;
      const apiKey = localStorage.getItem('GEMINI_API_KEY') || '';
      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1' ||
          window.location.port === '3000');

      if (isLocalhost) {
        try {
          const res = await fetch('/api/ielts/analyze', {
            method: 'POST',
            credentials: 'same-origin',
            headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({
              testPack: activeTest,
              userAnswers,
              timeSpentSec: elapsedSec,
            }),
          });

          if (res.ok) {
            const data = await safeParseJsonResponse<{
              report?: PedagogicalReport;
              error?: string;
            }>(res, 'Không thể tạo báo cáo phân tích AI.');
            if (data.report) {
              report = data.report;
            }
          }
        } catch {
          // Fallback to client-side
        }
      }

      if (!report) {
        report = await generatePedagogicalReportClientSide(
          apiKey,
          activeTest,
          userAnswers,
          elapsedSec
        );
      }

      setReportsByTest((prev) => ({
        ...prev,
        [activeTest.id]: report!,
      }));
      setActiveView('analysis');
    } catch (err: unknown) {
      setAnalyzeError(
        err instanceof Error ? err.message : 'Lỗi kết nối khi chấm điểm AI.'
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleSaveFlashcard = useCallback(
    (item: AwlVocabItem, initialStatus: FlashcardItem['status'] = 'new') => {
      setFlashcards((prev) => {
        const exists = prev.some(
          (c) =>
            c.word.toLowerCase() === item.word.toLowerCase() &&
            (!c.testId || c.testId === activeTest.id)
        );
        if (exists) return prev;
        return [
          {
            id: `fc-${activeTest.id}-${item.word.toLowerCase()}-${Date.now()}`,
            testId: activeTest.id,
            word: item.word,
            ipa: item.ipa,
            pos: item.pos,
            definitionVi: item.definitionVi,
            contextualMeaningVi: item.contextualMeaningVi || item.definitionVi,
            definitionEn: item.definitionEn,
            exampleInAudio: item.exampleInAudio,
            exampleTranslationVi: item.exampleTranslationVi || '',
            timestampLabel: item.timestampLabel,
            sourceTitle: activeTest.title,
            status: initialStatus,
            addedAt: new Date().toISOString(),
          },
          ...prev,
        ];
      });
    },
    [activeTest.id, activeTest.title]
  );

  const handleTranslateVocab = useCallback(
    async (
      word: string,
      sentenceContext: string,
      timestampSec = 0,
      timestampLabel = '[00:00.00]'
    ): Promise<AwlVocabItem> => {
      const res = await fetch('/api/ielts/translate-vocab', {
        method: 'POST',
        credentials: 'same-origin',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          word,
          sentenceContext,
          testTitle: activeTest.title,
          topic: activeTest.topic,
        }),
      });
      const data = await safeParseJsonResponse<{
        vocabItem?: Omit<AwlVocabItem, 'timestampSec' | 'timestampLabel' | 'isAwl'>;
        error?: string;
      }>(res, 'Máy chủ trả về phản hồi không hợp lệ khi dịch từ vựng.');
      if (!data.vocabItem) {
        throw new Error(data.error || 'Không thể dịch từ vựng theo ngữ cảnh.');
      }

      const newItem: AwlVocabItem = {
        ...data.vocabItem,
        timestampSec,
        timestampLabel,
        isAwl: true,
      };

      setTests((prev) =>
        prev.map((t) => {
          if (t.id !== activeTest.id) return t;
          const idx = t.vocabulary.findIndex(
            (v) => v.word.toLowerCase() === newItem.word.toLowerCase()
          );
          const nextVocab =
            idx >= 0
              ? t.vocabulary.map((v, i) => (i === idx ? newItem : v))
              : [newItem, ...t.vocabulary];
          return { ...t, vocabulary: nextVocab };
        })
      );

      handleSaveFlashcard(newItem, 'new');
      return newItem;
    },
    [activeTest.id, activeTest.title, activeTest.topic, handleSaveFlashcard]
  );

  const handleExtractClassroomDrills = useCallback(
    async (count: number): Promise<ClassroomDrillSentence[]> => {
      const effectiveDuration = Math.max(activeTest.durationSec || 0, duration || 0);
      const res = await fetch('/api/ielts/extract-classroom-drills', {
        method: 'POST',
        credentials: 'same-origin',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          testPack: {
            ...activeTest,
            durationSec: effectiveDuration,
          },
          count,
        }),
      });
      const data = await safeParseJsonResponse<{
        classroomDrills?: ClassroomDrillSentence[];
        updatedSegments?: ListeningTestPack['segments'];
        error?: string;
      }>(res, 'Máy chủ trả về phản hồi không hợp lệ khi trích xuất câu.');
      if (!Array.isArray(data.classroomDrills)) {
        throw new Error(data.error || 'Không thể trích xuất 10–15 câu hay nhất từ bài.');
      }

      const drills = data.classroomDrills;
      const updatedSegments =
        Array.isArray(data.updatedSegments) && data.updatedSegments.length > 0
          ? data.updatedSegments
          : undefined;

      setTests((prev) =>
        prev.map((t) =>
          t.id === activeTest.id
            ? {
                ...t,
                classroomDrills: drills,
                segments: updatedSegments || t.segments,
              }
            : t
        )
      );
      return drills;
    },
    [activeTest, duration]
  );

  const handleRegenerateQuestions = useCallback(async () => {
    const res = await fetch('/api/ielts/generate-questions', {
      method: 'POST',
      credentials: 'same-origin',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ testPack: activeTest }),
    });
    const data = await safeParseJsonResponse<{
      questions?: ListeningTestPack['questions'];
      error?: string;
    }>(res, 'Không thể tạo bộ câu hỏi từ bài nghe.');
    if (!Array.isArray(data.questions) || data.questions.length === 0) {
      throw new Error(data.error || 'Chưa trích xuất được câu hỏi từ tệp hiện tại.');
    }
    setTests((prev) =>
      prev.map((t) => (t.id === activeTest.id ? { ...t, questions: data.questions! } : t))
    );
  }, [activeTest]);

  const handleDeleteCustomTest = useCallback(
    async (testId: string) => {
      if (SAMPLE_ID_SET.has(testId)) return;
      try {
        await fetch(`/api/ielts/tests/${encodeURIComponent(testId)}`, {
          method: 'DELETE',
          credentials: 'same-origin',
        });
      } catch {
        // ignore network error; still remove locally
      }
      try {
        await deleteMediaForTest(testId);
      } catch {
        // ignore
      }
      setTests((prev) => {
        const next = prev.filter((t) => t.id !== testId);
        if (activeTestId === testId && next[0]) {
          setActiveTestId(next[0].id);
        }
        return next;
      });
    },
    [activeTestId]
  );

  const handleReattachAudio = useCallback(
    async (testId: string, file: File) => {
      try {
        const freshUrl = await saveMediaBlob(testId, 'audio', file, file.name);
        setAudioHasError(false);
        setTtsNotice(null);
        setTests((prev) =>
          prev.map((t) => {
            if (t.id !== testId) return t;
            return {
              ...t,
              audioUrl: freshUrl,
              audioFileName: file.name,
            };
          })
        );
      } catch (err) {
        console.error('[Audio] Failed to reattach audio:', err);
        alert('Không thể lưu tệp âm thanh vào bộ nhớ trình duyệt: ' + String(err));
      }
    },
    []
  );

  const savedWordsSet = useMemo(() => {
    return new Set(
      flashcards
        .filter((c) => !c.testId || c.testId === activeTest.id)
        .map((c) => c.word.toLowerCase())
    );
  }, [flashcards, activeTest.id]);

  const handleUpdateQuestionTime = useCallback(
    (questionNumber: number, startSec: number, endSec: number) => {
      const roundedStart = Number(Math.max(0, startSec).toFixed(2));
      const roundedEnd = Number(Math.max(roundedStart + 0.3, endSec).toFixed(2));
      const newLabel = formatTsLabel(roundedStart);

      setTests((prev) =>
        prev.map((t) => {
          if (t.id !== activeTest.id) return t;
          const nextQuestions = t.questions.map((q) => {
            if (q.number !== questionNumber) return q;
            return {
              ...q,
              timestampSec: roundedStart,
              timestampEndSec: roundedEnd,
              timestampLabel: newLabel,
            };
          });
          const updatedPack = { ...t, questions: nextQuestions };
          if (updatedPack.isCustomUpload) {
            fetch(`/api/ielts/tests/${encodeURIComponent(updatedPack.id)}`, {
              method: 'PUT',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ testPack: updatedPack }),
            }).catch(() => {});
          }
          return updatedPack;
        })
      );

      setReportsByTest((prev) => {
        const currentReport = prev[activeTest.id];
        if (!currentReport) return prev;
        const nextPart1 = currentReport.part1AnswerKey.map((row) => {
          if (row.questionNumber !== questionNumber) return row;
          return {
            ...row,
            timestampSec: roundedStart,
            timestampEndSec: roundedEnd,
            timestampLabel: newLabel,
          };
        });
        const nextPart2 = currentReport.part2Explanations.map((item) => {
          if (item.questionNumber !== questionNumber) return item;
          return {
            ...item,
            timestampSec: roundedStart,
            timestampEndSec: roundedEnd,
            timestampLabel: newLabel,
          };
        });
        return {
          ...prev,
          [activeTest.id]: {
            ...currentReport,
            part1AnswerKey: nextPart1,
            part2Explanations: nextPart2,
          },
        };
      });
    },
    [activeTest.id]
  );

  const handleUpdateClassroomDrillTime = useCallback(
    (drillId: string, startSec: number, endSec: number) => {
      const roundedStart = Number(Math.max(0, startSec).toFixed(2));
      const roundedEnd = Number(Math.max(roundedStart + 0.3, endSec).toFixed(2));
      const newLabel = formatTsLabel(roundedStart);

      setTests((prev) =>
        prev.map((t) => {
          if (t.id !== activeTest.id) return t;
          const nextDrills = (t.classroomDrills || []).map((d) => {
            if (d.id !== drillId) return d;
            return {
              ...d,
              startSec: roundedStart,
              endSec: roundedEnd,
              timestampLabel: newLabel,
            };
          });
          const updatedPack = { ...t, classroomDrills: nextDrills };
          if (updatedPack.isCustomUpload) {
            fetch(`/api/ielts/tests/${encodeURIComponent(updatedPack.id)}`, {
              method: 'PUT',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ testPack: updatedPack }),
            }).catch(() => {});
          }
          return updatedPack;
        })
      );
    },
    [activeTest.id]
  );

  const handleUpdateSegmentTime = useCallback(
    (segmentId: string, startSec: number, endSec: number) => {
      const roundedStart = Number(Math.max(0, startSec).toFixed(2));
      const roundedEnd = Number(Math.max(roundedStart + 0.3, endSec).toFixed(2));
      const newLabel = formatTsLabel(roundedStart);

      setTests((prev) =>
        prev.map((t) => {
          if (t.id !== activeTest.id) return t;
          const nextSegs = t.segments.map((s) => {
            if (s.id !== segmentId) return s;
            return {
              ...s,
              startSec: roundedStart,
              endSec: roundedEnd,
              timestampLabel: newLabel,
            };
          });
          const updatedPack = { ...t, segments: nextSegs };
          if (updatedPack.isCustomUpload) {
            fetch(`/api/ielts/tests/${encodeURIComponent(updatedPack.id)}`, {
              method: 'PUT',
              credentials: 'same-origin',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ testPack: updatedPack }),
            }).catch(() => {});
          }
          return updatedPack;
        })
      );
    },
    [activeTest.id]
  );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900 flex flex-col">
      {/* Hidden native audio element for real WAV/MP3 playback */}
      {activeTest.audioUrl && (
        <audio ref={audioRef} src={activeTest.audioUrl} preload="auto" />
      )}

      <TopBar
        activeView={activeView}
        onChangeView={setActiveView}
        onOpenIngest={() => setIsIngestOpen(true)}
        onOpenApiKey={() => setIsApiKeyOpen(true)}
        fontScale={fontScale}
        onIncreaseFont={increaseFont}
        onDecreaseFont={decreaseFont}
        onResetFont={resetFont}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      <AudioSyncBar
        testPack={activeTest}
        allTests={tests}
        onSelectTest={(id) => setActiveTestId(id)}
        onDeleteTest={handleDeleteCustomTest}
        audioRef={audioRef}
        currentTime={currentTime}
        duration={duration}
        isPlaying={isPlaying}
        playbackRate={playbackRate}
        onTogglePlay={handleTogglePlay}
        onSeek={handleSeek}
        onChangeRate={setPlaybackRate}
        onSynthesizeAudio={handleSynthesizeAudio}
        isSynthesizing={isSynthesizing}
        ttsNotice={ttsNotice}
        onReattachAudio={handleReattachAudio}
        audioHasError={audioHasError}
      />

      <main className="flex-1">
        {activeView === 'exam' && (
          <IdpExamWorkspace
            testPack={activeTest}
            userAnswers={userAnswers}
            onChangeAnswer={(qNum, val) =>
              setAnswersByTest((prev) => ({
                ...prev,
                [activeTest.id]: {
                  ...(prev[activeTest.id] || {}),
                  [qNum]: val,
                },
              }))
            }
            currentTime={currentTime}
            onSeekAndPlay={(sec, endLimit) => seekAndPlay(sec, endLimit ?? null)}
            onUpdateQuestionTime={handleUpdateQuestionTime}
            onSubmitExam={handleSubmitExam}
            isAnalyzing={isAnalyzing}
            analyzeError={analyzeError}
            savedWords={savedWordsSet}
            onSaveFlashcard={handleSaveFlashcard}
            onTranslateVocab={handleTranslateVocab}
            onRegenerateQuestions={handleRegenerateQuestions}
            elapsedSec={elapsedSec}
            fontScale={fontScale}
            onIncreaseFont={increaseFont}
            onDecreaseFont={decreaseFont}
            onResetFont={resetFont}
            isFullscreen={isFullscreen}
            onToggleFullscreen={toggleFullscreen}
          />
        )}

        {activeView === 'analysis' && (
          <PedagogicalReportView
            report={activeReport}
            currentTime={currentTime}
            maxDuration={duration}
            onSeekAndPlay={(sec, endLimit) => seekAndPlay(sec, endLimit ?? null)}
            onUpdateQuestionTime={handleUpdateQuestionTime}
            onLaunchShadowing={(sec) => {
              setPracticeTab('shadowing');
              setFocusTimestampSec(sec);
              setActiveView('practice');
            }}
            onLaunchIntensive={(sec) => {
              setPracticeTab('intensive');
              setFocusTimestampSec(sec);
              setActiveView('practice');
            }}
            onSaveFlashcard={handleSaveFlashcard}
            savedWords={savedWordsSet}
            onGoToExam={() => setActiveView('exam')}
          />
        )}

        {activeView === 'practice' && (
          <AdvancedPracticeStudio
            testPack={activeTest}
            initialTab={practiceTab}
            focusTimestampSec={focusTimestampSec}
            currentTime={currentTime}
            onPlaySegment={(start, end) => seekAndPlay(start, end ?? null)}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            onChangeRate={setPlaybackRate}
            onExtractClassroomDrills={handleExtractClassroomDrills}
            onUpdateClassroomDrillTime={handleUpdateClassroomDrillTime}
            onUpdateSegmentTime={handleUpdateSegmentTime}
          />
        )}

        {activeView === 'vocabulary' && (
          <VocabularyFlashcardView
            testPack={activeTest}
            allTests={tests}
            onSelectTest={(id) => setActiveTestId(id)}
            flashcards={flashcards}
            onSaveFlashcard={handleSaveFlashcard}
            onUpdateStatus={(id, status) =>
              setFlashcards((prev) =>
                prev.map((c) => (c.id === id ? { ...c, status } : c))
              )
            }
            onDeleteFlashcard={(id) =>
              setFlashcards((prev) => prev.filter((c) => c.id !== id))
            }
            onSeekAndPlay={(sec) => seekAndPlay(sec, null)}
            onTranslateVocab={handleTranslateVocab}
          />
        )}
      </main>

      <IngestModal
        isOpen={isIngestOpen}
        onClose={() => setIsIngestOpen(false)}
        onOpenApiKey={() => setIsApiKeyOpen(true)}
        onIngestSuccess={(newPack) => {
          setTests((prev) => [newPack, ...prev]);
          setActiveTestId(newPack.id);
          setActiveView('exam');
        }}
      />

      <ApiKeyModal
        isOpen={isApiKeyOpen}
        onClose={() => setIsApiKeyOpen(false)}
      />
    </div>
  );
}
