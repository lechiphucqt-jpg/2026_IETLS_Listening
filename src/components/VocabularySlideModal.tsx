import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock,
  Eye,
  EyeOff,
  FileDown,
  Layers,
  Loader2,
  Maximize,
  Mic,
  Minimize,
  PenLine,
  Play,
  Pause,
  Repeat,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Star,
  Timer,
  Volume2,
  X,
} from 'lucide-react';
import type { FlashcardItem, ListeningTestPack } from '../types/ielts';
import { exportVocabularySlidesPptx } from '../utils/pptxExport';
import { formatSecondsToTime, formatTsLabel, parseTimeToSeconds } from '../utils/audioTime';
import {
  cleanWordKey,
  lookupWordDictionary,
  playChoralBeep,
  speakWordPronunciation,
  speakSentencePronunciation,
  type DictionaryWordInfo,
} from '../utils/dictionaryService';
import { saveFlashcardsToIndexedDB } from '../utils/indexedDBStorage';

export type VocabSlideTeachingMode =
  | 'blind_meaning' // 1. Ẩn nghĩa (Đoán nghĩa tiếng Việt)
  | 'blind_word'    // 2. Ẩn từ (Điền từ tiếng Anh)
  | 'full_teach'    // 3. Giảng trọn vẹn (Full Insight)
  | 'choral';       // 4. Đọc đồng thanh & Luyện âm

export interface VocabularySlideModalProps {
  isOpen: boolean;
  onClose: () => void;
  testPack: ListeningTestPack;
  cards: any[];
  initialIndex?: number;
  onPlaySegment?: (startSec: number, endSec?: number) => void;
  onTogglePlay?: () => void;
  isPlaying?: boolean;
  playbackRate?: number;
  onChangeRate?: (rate: number) => void;
  onUpdateCardAudioTime?: (word: string, startSec: number, endSec: number) => void;
}

function parseTimestampToSec(label?: string): number | null {
  if (!label) return null;
  const match = label.match(/\[?(\d+):(\d+(?:\.\d+)?)\]?/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

/**
 * Normalizes sentence strings by stripping speaker prefixes, quotes, and punctuation
 */
export function normalizeSentence(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/^[a-z0-9_\s]{1,20}:\s*/i, '') // strip speaker prefixes e.g. "Officer: "
    .replace(/[“”"''`]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates string similarity score (0.0 to 1.0) between two sentences for exact audio segment matching
 */
export function getSentenceMatchScore(s1: string, s2: string): number {
  if (!s1 || !s2) return 0;
  const c1 = normalizeSentence(s1);
  const c2 = normalizeSentence(s2);
  if (!c1 || !c2) return 0;
  if (c1 === c2) return 1.0;
  if (c1.includes(c2) || c2.includes(c1)) {
    const lenRatio = Math.min(c1.length, c2.length) / Math.max(c1.length, c2.length);
    return Number((0.6 + lenRatio * 0.4).toFixed(3));
  }
  const w1 = c1.split(/\s+/).filter((w) => w.length > 2);
  const w2 = c2.split(/\s+/).filter((w) => w.length > 2);
  if (w1.length === 0 || w2.length === 0) return 0;
  const set2 = new Set(w2);
  let common = 0;
  for (const w of w1) {
    if (set2.has(w)) common++;
  }
  const r1 = common / w1.length;
  const r2 = common / w2.length;
  return Number(((r1 + r2) / 2).toFixed(3));
}

export const VocabularySlideModal: React.FC<VocabularySlideModalProps> = ({
  isOpen,
  onClose,
  testPack,
  cards,
  initialIndex = 0,
  onPlaySegment,
  onTogglePlay,
  isPlaying = false,
  playbackRate = 1.0,
  onChangeRate,
  onUpdateCardAudioTime,
}) => {
  const [currentSlideIdx, setCurrentSlideIdx] = useState(initialIndex);
  const [activeMode, setActiveMode] = useState<VocabSlideTeachingMode>('blind_meaning');
  const [isMeaningRevealed, setIsMeaningRevealed] = useState(false);
  const [isWordRevealed, setIsWordRevealed] = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [loopCount, setLoopCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 1. Choral countdown timer state
  const [countdownDuration, setCountdownDuration] = useState<number>(15);
  const [countdownRemaining, setCountdownRemaining] = useState<number>(15);
  const [isCountdownRunning, setIsCountdownRunning] = useState<boolean>(false);
  const [hasFinishedCountdown, setHasFinishedCountdown] = useState<boolean>(false);

  // 2. Choral 3-2-1 lead-in state when looping
  const [enable321LeadIn, setEnable321LeadIn] = useState<boolean>(true);
  const [countdown321Step, setCountdown321Step] = useState<number | null>(null);
  const countdown321TimersRef = useRef<number[]>([]);

  // 3. Interactive Word Dictionary & IPA state
  const [selectedDictWord, setSelectedDictWord] = useState<DictionaryWordInfo | null>(null);
  const [isLookingUpWord, setIsLookingUpWord] = useState<boolean>(false);
  const [flashcardSavedSuccess, setFlashcardSavedSuccess] = useState<boolean>(false);

  // 4. Custom card audio time tuning state
  const [customCardTimings, setCustomCardTimings] = useState<
    Record<string, { startSec: number; endSec: number; label: string }>
  >({});
  const [isEditingAudioTime, setIsEditingAudioTime] = useState(false);
  const [editStartSec, setEditStartSec] = useState<number>(0);
  const [editEndSec, setEditEndSec] = useState<number>(0);
  const [saveTimeSuccess, setSaveTimeSuccess] = useState(false);

  const wasPlayingRef = useRef(false);
  const loopTimerRef = useRef<number | null>(null);
  const modalContainerRef = useRef<HTMLDivElement | null>(null);

  // Sync initialIndex when modal opens
  useEffect(() => {
    if (isOpen) {
      setCurrentSlideIdx(Math.min(initialIndex, Math.max(0, cards.length - 1)));
      setIsMeaningRevealed(false);
      setIsWordRevealed(false);
    }
  }, [isOpen, initialIndex, cards.length]);

  useEffect(() => {
    setIsEditingAudioTime(false);
    setSaveTimeSuccess(false);
  }, [currentSlideIdx]);

  const currentCard = cards[currentSlideIdx] || cards[0];

  // Precise audio timing for the current vocabulary card's example sentence
  const cardAudioTiming = useMemo(() => {
    if (!currentCard) return { startSec: 0, endSec: 5, label: '[00:00.00]', source: 'none', matchedText: '' };

    const wordKey = (currentCard.word || '').trim().toLowerCase();
    if (customCardTimings[wordKey]) {
      return {
        startSec: customCardTimings[wordKey].startSec,
        endSec: customCardTimings[wordKey].endSec,
        label: customCardTimings[wordKey].label,
        source: 'user_custom',
        matchedText: currentCard.exampleInAudio || currentCard.contextSentence || '',
      };
    }

    // 1. Get explicit timestamp if present
    const explicitSec =
      typeof currentCard.timestampSec === 'number' && !isNaN(currentCard.timestampSec) && currentCard.timestampSec >= 0
        ? currentCard.timestampSec
        : parseTimestampToSec(currentCard.timestampLabel);

    const explicitEndSec =
      typeof currentCard.timestampEndSec === 'number' && !isNaN(currentCard.timestampEndSec) && currentCard.timestampEndSec > (explicitSec ?? 0)
        ? currentCard.timestampEndSec
        : null;

    const sentenceToMatch = (currentCard.exampleInAudio || currentCard.contextSentence || '').trim();
    const cleanWord = cleanWordKey(currentCard.word || '');

    // 2. High-precision textual search across classroomDrills and segments
    if (sentenceToMatch) {
      type Candidate = {
        startSec: number;
        endSec: number;
        label: string;
        source: 'drill' | 'segment_text';
        text: string;
        score: number;
      };
      let bestCandidate: Candidate | null = null;

      // Scan classroomDrills
      if (testPack.classroomDrills && testPack.classroomDrills.length > 0) {
        for (const drill of testPack.classroomDrills) {
          const baseScore = getSentenceMatchScore(drill.sentence, sentenceToMatch);
          if (baseScore >= 0.35) {
            let score = baseScore;
            if (cleanWord && drill.sentence.toLowerCase().includes(cleanWord)) {
              score += 0.05;
            }
            if (explicitSec !== null && Math.abs(drill.startSec - explicitSec) < 8.0) {
              score += 0.1;
            }
            if (!bestCandidate || score > bestCandidate.score) {
              bestCandidate = {
                startSec: drill.startSec,
                endSec: drill.endSec,
                label: drill.timestampLabel || currentCard.timestampLabel || '[00:00.00]',
                source: 'drill',
                text: drill.sentence,
                score,
              };
            }
          }
        }
      }

      // Scan testPack.segments
      if (testPack.segments && testPack.segments.length > 0) {
        for (const seg of testPack.segments) {
          const baseScore = getSentenceMatchScore(seg.text, sentenceToMatch);
          if (baseScore >= 0.35) {
            let score = baseScore;
            if (cleanWord && seg.text.toLowerCase().includes(cleanWord)) {
              score += 0.05;
            }
            if (explicitSec !== null && Math.abs(seg.startSec - explicitSec) < 8.0) {
              score += 0.1;
            }
            if (!bestCandidate || score > bestCandidate.score) {
              bestCandidate = {
                startSec: seg.startSec,
                endSec: seg.endSec,
                label: seg.timestampLabel || currentCard.timestampLabel || '[00:00.00]',
                source: 'segment_text',
                text: seg.text,
                score,
              };
            }
          }
        }
      }

      // If best candidate meets similarity threshold
      if (bestCandidate && bestCandidate.score >= 0.45) {
        return {
          startSec: bestCandidate.startSec,
          endSec: explicitEndSec && explicitEndSec > bestCandidate.startSec ? explicitEndSec : bestCandidate.endSec,
          label: bestCandidate.label,
          source: bestCandidate.source,
          matchedText: bestCandidate.text,
        };
      }
    }

    // 3. Fallback: match by explicitSec & target word in transcript segments
    if (testPack.segments && testPack.segments.length > 0 && explicitSec !== null && explicitSec >= 0) {
      // 3A. Segment covering explicitSec that also contains target word
      if (cleanWord) {
        const segWithWord = testPack.segments.find((s) => {
          const coversTime = s.startSec - 1.0 <= explicitSec && explicitSec <= s.endSec + 1.0;
          return coversTime && s.text.toLowerCase().includes(cleanWord);
        });
        if (segWithWord) {
          return {
            startSec: segWithWord.startSec,
            endSec: explicitEndSec || segWithWord.endSec,
            label: segWithWord.timestampLabel || currentCard.timestampLabel || '[00:00.00]',
            source: 'segment_word_time',
            matchedText: segWithWord.text,
          };
        }

        // 3B. Nearby segment within 6s containing target word
        const nearbyWithWord = testPack.segments.find((s) => {
          const isNearby = Math.abs(s.startSec - explicitSec) < 6.0;
          return isNearby && s.text.toLowerCase().includes(cleanWord);
        });
        if (nearbyWithWord) {
          return {
            startSec: nearbyWithWord.startSec,
            endSec: explicitEndSec || nearbyWithWord.endSec,
            label: nearbyWithWord.timestampLabel || currentCard.timestampLabel || '[00:00.00]',
            source: 'segment_nearby_word',
            matchedText: nearbyWithWord.text,
          };
        }
      }

      // 3C. Segment strictly containing explicitSec: s.startSec <= explicitSec && explicitSec < s.endSec
      const strictlyCoveringSeg = testPack.segments.find(
        (s) => s.startSec <= explicitSec && explicitSec < s.endSec
      );
      if (strictlyCoveringSeg) {
        return {
          startSec: strictlyCoveringSeg.startSec,
          endSec: explicitEndSec || strictlyCoveringSeg.endSec,
          label: strictlyCoveringSeg.timestampLabel || currentCard.timestampLabel || '[00:00.00]',
          source: 'segment_covering',
          matchedText: strictlyCoveringSeg.text,
        };
      }

      // 3D. Direct explicitSec seek
      const directEnd = explicitEndSec || (explicitSec + 6.0);
      return {
        startSec: explicitSec,
        endSec: directEnd,
        label: currentCard.timestampLabel || '[00:00.00]',
        source: 'explicit_sec',
        matchedText: sentenceToMatch,
      };
    }

    // 4. Fallback if no timestamp: any segment containing cleanWord
    if (testPack.segments && testPack.segments.length > 0 && cleanWord) {
      const segWithWord = testPack.segments.find((s) => s.text.toLowerCase().includes(cleanWord));
      if (segWithWord) {
        return {
          startSec: segWithWord.startSec,
          endSec: segWithWord.endSec,
          label: segWithWord.timestampLabel || currentCard.timestampLabel || '[00:00.00]',
          source: 'segment_word_only',
          matchedText: segWithWord.text,
        };
      }
    }

    // 5. Ultimate fallback
    const firstSeg = testPack.segments?.[0];
    return {
      startSec: firstSeg?.startSec ?? 0,
      endSec: firstSeg?.endSec ?? 5,
      label: firstSeg?.timestampLabel ?? '[00:00.00]',
      source: 'fallback',
      matchedText: firstSeg?.text ?? '',
    };
  }, [currentCard, testPack.segments, testPack.classroomDrills]);

  // Context sentence text for current card - GUARANTEED to match the target vocabulary
  const exampleSentence = useMemo(() => {
    if (currentCard?.exampleInAudio && currentCard.exampleInAudio.trim().length > 0) {
      return currentCard.exampleInAudio.trim();
    }
    if (currentCard?.contextSentence && currentCard.contextSentence.trim().length > 0) {
      return currentCard.contextSentence.trim();
    }
    if (cardAudioTiming.matchedText && cardAudioTiming.matchedText.trim().length > 0) {
      return cardAudioTiming.matchedText.trim();
    }
    if (testPack.segments && testPack.segments.length > 0) {
      const seg = testPack.segments.find(
        (s) => Math.abs(s.startSec - cardAudioTiming.startSec) < 0.2
      );
      if (seg?.text && seg.text.trim().length > 0) {
        return seg.text.trim();
      }
    }
    return `This example contains the target vocabulary: ${currentCard?.word || ''}.`;
  }, [currentCard, cardAudioTiming, testPack.segments]);

  // Sentence with blank gap for Mode 2
  const gappedSentenceParts = useMemo(() => {
    if (!currentCard?.word || !exampleSentence) {
      return { before: '', gapWord: currentCard?.word || '', after: '' };
    }
    const wordRegex = new RegExp(`\\b${currentCard.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
    const match = exampleSentence.match(wordRegex);
    if (!match || match.index === undefined) {
      return { before: exampleSentence, gapWord: currentCard.word, after: '' };
    }
    const idx = match.index;
    return {
      before: exampleSentence.slice(0, idx),
      gapWord: match[0],
      after: exampleSentence.slice(idx + match[0].length),
    };
  }, [currentCard, exampleSentence]);

  // Choral chunks for Mode 4
  const choralChunks = useMemo(() => {
    if (!exampleSentence) return [];
    return exampleSentence
      .split(/([,.;:!?—]+\s*)/)
      .filter((s) => s.trim().length > 0)
      .reduce((acc: string[], cur: string) => {
        if (/^[,.;:!?—]/.test(cur) && acc.length > 0) {
          acc[acc.length - 1] += cur;
        } else {
          acc.push(cur);
        }
        return acc;
      }, []);
  }, [exampleSentence]);

  // Play audio segment for the current word's example sentence
  const handlePlayCardAudio = () => {
    if (!onPlaySegment) return;
    onPlaySegment(cardAudioTiming.startSec, cardAudioTiming.endSec);
  };

  // Clear 3-2-1 rhythmic timers
  const clear321Timers = () => {
    countdown321TimersRef.current.forEach((t) => window.clearTimeout(t));
    countdown321TimersRef.current = [];
    setCountdown321Step(null);
  };

  // Start 3-2-1 lead-in countdown before audio repeat
  const start321LeadIn = (onPlay: () => void) => {
    clear321Timers();
    setCountdown321Step(3);
    playChoralBeep('beat');

    const t1 = window.setTimeout(() => {
      setCountdown321Step(2);
      playChoralBeep('beat');
    }, 1000);

    const t2 = window.setTimeout(() => {
      setCountdown321Step(1);
      playChoralBeep('beat');
    }, 2000);

    const t3 = window.setTimeout(() => {
      setCountdown321Step(0);
      playChoralBeep('start');
      onPlay();
    }, 3000);

    const t4 = window.setTimeout(() => {
      setCountdown321Step(null);
    }, 4000);

    countdown321TimersRef.current = [t1, t2, t3, t4];
  };

  // Auto-loop playback for current drill sentence
  useEffect(() => {
    if (!isOpen || !isLooping || !currentCard || !onPlaySegment) {
      wasPlayingRef.current = isPlaying;
      if (loopTimerRef.current) {
        window.clearTimeout(loopTimerRef.current);
        loopTimerRef.current = null;
      }
      clear321Timers();
      return;
    }

    if (wasPlayingRef.current && !isPlaying) {
      if (loopTimerRef.current) {
        window.clearTimeout(loopTimerRef.current);
      }
      clear321Timers();

      if (activeMode === 'choral' && enable321LeadIn) {
        start321LeadIn(() => {
          if (isOpen && isLooping && currentCard) {
            setLoopCount((prev) => prev + 1);
            handlePlayCardAudio();
          }
        });
      } else {
        loopTimerRef.current = window.setTimeout(() => {
          if (isOpen && isLooping && currentCard) {
            setLoopCount((prev) => prev + 1);
            handlePlayCardAudio();
          }
        }, 500);
      }
    }

    wasPlayingRef.current = isPlaying;

    return () => {
      if (loopTimerRef.current) {
        window.clearTimeout(loopTimerRef.current);
      }
      clear321Timers();
    };
  }, [isPlaying, isLooping, isOpen, currentCard, activeMode, enable321LeadIn]);

  // Choral countdown timer interval effect
  useEffect(() => {
    if (activeMode !== 'choral') {
      setIsCountdownRunning(false);
      return;
    }

    if (isCountdownRunning) {
      const timer = window.setInterval(() => {
        setCountdownRemaining((prev) => {
          if (prev <= 1) {
            setIsCountdownRunning(false);
            setHasFinishedCountdown(true);
            playChoralBeep('start');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => window.clearInterval(timer);
    }
  }, [isCountdownRunning, activeMode]);

  // Reset states when changing cards or closing
  useEffect(() => {
    if (loopTimerRef.current) {
      window.clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    setIsMeaningRevealed(false);
    setIsWordRevealed(false);
    clear321Timers();
    setLoopCount(0);
    setCountdownRemaining(countdownDuration);
    setIsCountdownRunning(false);
    setHasFinishedCountdown(false);
    setSelectedDictWord(null);

    if (isOpen && isLooping && currentCard && onPlaySegment) {
      if (activeMode === 'choral' && enable321LeadIn) {
        start321LeadIn(() => {
          handlePlayCardAudio();
        });
      } else {
        handlePlayCardAudio();
      }
    }
  }, [currentSlideIdx, countdownDuration]);

  useEffect(() => {
    if (!isOpen) {
      setIsLooping(false);
      setLoopCount(0);
      setIsCountdownRunning(false);
      setSelectedDictWord(null);
      clear321Timers();
      if (loopTimerRef.current) {
        window.clearTimeout(loopTimerRef.current);
        loopTimerRef.current = null;
      }
    }
  }, [isOpen]);

  // Keyboard navigation & Shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setCurrentSlideIdx((prev) => (prev < cards.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setCurrentSlideIdx((prev) => (prev > 0 ? prev - 1 : cards.length - 1));
      } else if (e.key === 'Escape') {
        if (selectedDictWord) {
          setSelectedDictWord(null);
        } else {
          onClose();
        }
      } else if (e.key === '1') {
        setActiveMode('blind_meaning');
      } else if (e.key === '2') {
        setActiveMode('blind_word');
      } else if (e.key === '3') {
        setActiveMode('full_teach');
      } else if (e.key === '4') {
        setActiveMode('choral');
      } else if (e.key === 'f' || e.key === 'F') {
        toggleFullscreen();
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (activeMode === 'blind_meaning') {
          setIsMeaningRevealed((prev) => !prev);
        } else if (activeMode === 'blind_word') {
          setIsWordRevealed((prev) => !prev);
        } else {
          handlePlayCardAudio();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, cards.length, onClose, selectedDictWord, activeMode, currentCard]);

  // Fullscreen tracking
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      modalContainerRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  };

  const handleLookupWord = async (rawWord: string) => {
    const clean = cleanWordKey(rawWord);
    if (!clean) return;

    setIsLookingUpWord(true);
    setFlashcardSavedSuccess(false);

    try {
      const result = await lookupWordDictionary(clean, exampleSentence, testPack.vocabulary);
      setSelectedDictWord(result);
    } catch {
      // fallback
    } finally {
      setIsLookingUpWord(false);
    }
  };

  const handleSaveToFlashcards = async (info: DictionaryWordInfo) => {
    const rawCards = localStorage.getItem('lexisync_ielts_flashcards_v1');
    let currentCards: FlashcardItem[] = [];
    if (rawCards) {
      try {
        currentCards = JSON.parse(rawCards);
      } catch {
        currentCards = [];
      }
    }

    const clean = cleanWordKey(info.word);
    const exists = currentCards.some((c) => cleanWordKey(c.word) === clean);
    if (!exists) {
      const newCard: FlashcardItem = {
        id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        testId: testPack.id,
        word: info.word,
        ipa: info.ipaUk || '/.../',
        pos: info.pos || 'word',
        definitionVi: info.contextualMeaningVi || info.meaningVi,
        contextualMeaningVi: info.contextualMeaningVi || info.meaningVi,
        definitionEn: info.definitionEn,
        exampleInAudio: exampleSentence,
        timestampLabel: currentCard?.timestampLabel || '[00:00.00]',
        sourceTitle: `${testPack.title} • Vocabulary Slide`,
        status: 'new',
        addedAt: new Date().toISOString(),
      };

      const updated = [newCard, ...currentCards];
      try {
        localStorage.setItem('lexisync_ielts_flashcards_v1', JSON.stringify(updated));
        await saveFlashcardsToIndexedDB(updated);
        window.dispatchEvent(new CustomEvent('lexisync-flashcard-added', { detail: newCard }));
      } catch {
        // ignore
      }
    }
    setFlashcardSavedSuccess(true);
  };

  const formatTimer = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (!isOpen || cards.length === 0 || !currentCard) return null;

  return (
    <div
      ref={modalContainerRef}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/95 backdrop-blur-md p-2 sm:p-4 select-none animate-fadeIn overflow-hidden"
    >
      <div className="relative w-full max-w-6xl aspect-[16/9] max-h-[96vh] bg-[#0A0E1A] border border-emerald-500/40 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-white">
        {/* Top Bar: Title, Slide Index, Controls */}
        <header className="px-5 py-3 bg-[#0D1322] border-b border-slate-800/90 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 rounded-full text-xs font-black bg-[#15803D] text-white tracking-wide shadow-xs">
              SLIDE {currentSlideIdx + 1}/{cards.length}
            </span>
            <span className="text-xs sm:text-sm font-bold text-slate-300 truncate max-w-[200px] sm:max-w-xs">
              {testPack.title}
            </span>
            <span className="text-xs font-mono font-bold text-emerald-300 bg-emerald-950/80 px-2.5 py-0.5 rounded-md border border-emerald-700/60 hidden sm:inline-block">
              {cardAudioTiming.label || currentCard.timestampLabel}
            </span>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2">
            {onPlaySegment && (
              <button
                type="button"
                onClick={handlePlayCardAudio}
                className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold text-xs transition-all cursor-pointer shadow-md ${
                  isPlaying
                    ? 'bg-emerald-600 hover:bg-emerald-500 text-white ring-2 ring-emerald-400/50'
                    : 'bg-[#15803D] hover:bg-[#166534] text-white'
                }`}
                title={`Phát câu ví dụ theo đúng từ vựng này [${cardAudioTiming.label || currentCard.timestampLabel}]`}
              >
                {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                <span className="hidden sm:inline">Phát câu ví dụ</span>
              </button>
            )}

            <button
              type="button"
              onClick={() => {
                const next = !isLooping;
                setIsLooping(next);
                setLoopCount(0);
                if (next && !isPlaying) handlePlayCardAudio();
              }}
              className={`p-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                isLooping
                  ? 'bg-amber-600 border-amber-400 text-white shadow-md ring-2 ring-amber-400/50'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title="Lặp lại âm thanh câu ví dụ"
            >
              <Repeat className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={() => exportVocabularySlidesPptx(testPack, cards)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
              title="Xuất Slide PowerPoint 16:9 (.pptx / .html)"
            >
              <FileDown className="w-3.5 h-3.5 text-emerald-400" />
              <span className="hidden md:inline">PPTX</span>
            </button>

            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl transition-colors cursor-pointer"
              title="Toàn màn hình (F)"
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-rose-900/80 hover:text-rose-200 text-slate-400 rounded-xl transition-colors cursor-pointer ml-1"
              title="Đóng trình chiếu (Esc)"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Mode Selector Pill Strip */}
        <div className="flex justify-center pt-3 pb-1 px-4 shrink-0">
          <nav
            aria-label="Chế độ trình chiếu từ vựng"
            className="inline-flex items-center gap-1 p-1 bg-[#12182B]/90 border border-slate-800 rounded-full shadow-xl overflow-x-auto max-w-full no-scrollbar"
          >
            {(
              [
                { id: 'blind_meaning', label: '1. Ẩn nghĩa (Đoán nghĩa)', icon: EyeOff },
                { id: 'blind_word', label: '2. Ẩn từ (Điền từ)', icon: PenLine },
                { id: 'full_teach', label: '3. Giảng trọn vẹn', icon: Eye },
                { id: 'choral', label: '4. Đọc đồng thanh', icon: Mic },
              ] as const
            ).map((mode) => {
              const Icon = mode.icon;
              const isActive = activeMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setActiveMode(mode.id)}
                  className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-1.5 rounded-full text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-gradient-to-r from-emerald-600 to-teal-600 text-white shadow-md shadow-emerald-900/40'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span>{mode.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Main Canvas Slide Stage (16:9 Content) */}
        <div className="flex-1 flex flex-col justify-center px-4 sm:px-8 py-3 overflow-y-auto no-scrollbar relative">
          {/* MODE 1: Ẩn nghĩa (Flashcard đoán nghĩa) */}
          {activeMode === 'blind_meaning' && (
            <div className="w-full max-w-3xl mx-auto text-center space-y-6">
              {/* Word & IPA Card */}
              <div className="bg-[#121A2E]/90 border-4 border-emerald-500/60 rounded-3xl p-8 sm:p-12 shadow-2xl backdrop-blur-md">
                {currentCard.pos && (
                  <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-emerald-200 bg-emerald-900/80 px-4 py-1 rounded-full border border-emerald-700/60 inline-block mb-3">
                    {currentCard.pos}
                  </span>
                )}

                <h1 className="text-[38pt] sm:text-[48pt] font-black text-white tracking-tight leading-none drop-shadow-md my-4">
                  {currentCard.word}
                </h1>

                {currentCard.ipa && (
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-xl sm:text-2xl font-mono text-emerald-300 font-bold bg-emerald-950/80 px-4 py-1.5 rounded-full border border-emerald-700/60">
                      {currentCard.ipa}
                    </span>
                    <button
                      type="button"
                      onClick={() => speakWordPronunciation(currentCard.word, 'en-GB')}
                      className="p-2 rounded-full bg-emerald-700/80 hover:bg-emerald-600 text-white transition-colors cursor-pointer"
                      title="Phát âm chuẩn UK"
                    >
                      <Volume2 className="w-4 h-4 fill-current" />
                    </button>
                    <button
                      type="button"
                      onClick={() => speakWordPronunciation(currentCard.word, 'en-US')}
                      className="p-2 rounded-full bg-indigo-700/80 hover:bg-indigo-600 text-white transition-colors cursor-pointer"
                      title="Phát âm chuẩn US"
                    >
                      <Volume2 className="w-4 h-4 fill-current" />
                    </button>
                  </div>
                )}

                {/* Meaning Reveal Container */}
                <div className="mt-8">
                  {!isMeaningRevealed ? (
                    <button
                      type="button"
                      onClick={() => setIsMeaningRevealed(true)}
                      className="inline-flex items-center gap-2.5 px-8 py-3.5 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white font-extrabold text-sm sm:text-base shadow-xl hover:shadow-emerald-600/30 active:scale-95 transition-all cursor-pointer"
                    >
                      <Eye className="w-5 h-5" />
                      <span>Nhấn để xem nghĩa tiếng Việt theo ngữ cảnh (hoặc phím Space)</span>
                    </button>
                  ) : (
                    <div className="p-5 rounded-2xl bg-[#092E1B] border-2 border-emerald-400 text-white animate-in zoom-in-95 duration-200">
                      <div className="text-xs font-extrabold uppercase tracking-wider text-amber-300 mb-1">
                        🇻🇳 Nghĩa tiếng Việt theo ngữ cảnh bài nghe:
                      </div>
                      <div className="text-2xl sm:text-3xl font-black text-white">
                        {currentCard.contextualMeaningVi || currentCard.definitionVi}
                      </div>
                      {currentCard.definitionEn && (
                        <p className="mt-2 text-xs sm:text-sm text-emerald-200 italic">
                          "{currentCard.definitionEn}"
                        </p>
                      )}
                      <button
                        type="button"
                        onClick={() => setIsMeaningRevealed(false)}
                        className="mt-3 text-xs text-emerald-300 hover:text-white underline cursor-pointer"
                      >
                        Ẩn lại nghĩa
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <p className="text-center text-xs sm:text-sm text-slate-400 font-medium select-none">
                💡 Học sinh tập trung quan sát từ vựng, nghe phát âm và đoán nghĩa tiếng Việt trước khi lật mở
              </p>
            </div>
          )}

          {/* MODE 2: Ẩn từ (Điền từ vào ngữ cảnh bài) */}
          {activeMode === 'blind_word' && (
            <div className="w-full max-w-4xl mx-auto space-y-6">
              <div className="bg-[#121A2E]/90 border-l-8 border-emerald-500 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
                <div className="text-xs font-bold text-amber-300 uppercase tracking-wider mb-2">
                  🇻🇳 Gợi ý nghĩa tiếng Việt:
                </div>
                <div className="text-xl sm:text-2xl font-black text-white mb-6">
                  {currentCard.contextualMeaningVi || currentCard.definitionVi}
                </div>

                <div className="pt-4 border-t border-slate-800">
                  <span className="text-xs font-bold text-purple-400 uppercase tracking-wider block mb-2">
                    Điền từ còn thiếu vào câu ví dụ thực tế trong bài nghe:
                  </span>
                  <p className="text-xl sm:text-2xl font-extrabold leading-relaxed text-white">
                    “{gappedSentenceParts.before}
                    {!isWordRevealed ? (
                      <button
                        type="button"
                        onClick={() => setIsWordRevealed(true)}
                        className="inline-block px-4 py-1 mx-2 bg-emerald-950 border-2 border-dashed border-emerald-400 rounded-xl text-emerald-300 font-mono text-lg font-black hover:bg-emerald-900 transition-all cursor-pointer"
                        title="Bấm để hiện từ tiếng Anh"
                      >
                        [ {Array.from(gappedSentenceParts.gapWord || currentCard.word || 'word').map(() => '?').join(' ')} ]
                      </button>
                    ) : (
                      <span className="inline-block px-3 py-1 mx-2 bg-emerald-600 text-white rounded-xl font-black text-xl border border-emerald-300 shadow-md animate-in zoom-in-95 duration-150">
                        {gappedSentenceParts.gapWord}
                      </span>
                    )}
                    {gappedSentenceParts.after}”
                  </p>
                </div>

                <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsWordRevealed((prev) => !prev)}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all cursor-pointer shadow-md"
                    >
                      {isWordRevealed ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      <span>{isWordRevealed ? 'Ẩn lại đáp án' : 'Hiện đáp án từ vựng (Space)'}</span>
                    </button>

                    {onPlaySegment && (
                      <button
                        type="button"
                        onClick={handlePlayCardAudio}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs font-bold transition-all cursor-pointer shadow-md"
                        title={`Phát audio câu ví dụ này [${cardAudioTiming.label || currentCard.timestampLabel}]`}
                      >
                        {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                        <span>Phát audio câu ví dụ</span>
                      </button>
                    )}

                    {onPlaySegment && (
                      <button
                        type="button"
                        onClick={() => {
                          if (!isEditingAudioTime) {
                            setEditStartSec(cardAudioTiming.startSec);
                            setEditEndSec(cardAudioTiming.endSec);
                          }
                          setIsEditingAudioTime((prev) => !prev);
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold transition-all cursor-pointer shadow-md ${
                          isEditingAudioTime
                            ? 'bg-amber-600 border-amber-400 text-white'
                            : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-amber-300'
                        }`}
                        title="Chỉnh mốc thời gian bắt đầu và kết thúc của Audio bài cho từ vựng này"
                      >
                        <SlidersHorizontal className="w-3.5 h-3.5" />
                        <span>{isEditingAudioTime ? 'Đóng chỉnh' : 'Chỉnh Audio'}</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => speakSentencePronunciation(exampleSentence, 'en-GB')}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition-all cursor-pointer border border-slate-700"
                      title="Nghe giọng đọc bản xứ (UK TTS)"
                    >
                      <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Đọc câu mẫu (UK)</span>
                    </button>
                  </div>

                  {currentCard.exampleTranslationVi && isWordRevealed && (
                    <span className="text-xs sm:text-sm text-slate-300 italic">
                      Dịch: {currentCard.exampleTranslationVi}
                    </span>
                  )}
                </div>
              </div>

              <p className="text-center text-xs sm:text-sm text-slate-400 font-medium select-none">
                💡 Cho học sinh nghe audio câu ví dụ và nhớ lại cách viết, cách phát âm của từ tiếng Anh
              </p>
            </div>
          )}

          {/* MODE 3: Giảng dạy trọn vẹn (Full Teaching) */}
          {activeMode === 'full_teach' && (
            <div className="w-full max-w-4xl mx-auto space-y-4">
              <div className="bg-[#121A2E]/90 border-2 border-emerald-500/50 rounded-3xl p-6 sm:p-8 shadow-2xl">
                {/* Header row: Word, IPA, POS, Audio */}
                <div className="flex flex-wrap items-baseline justify-between gap-4 pb-4 border-b border-slate-800">
                  <div className="flex flex-wrap items-baseline gap-3">
                    <h1 className="text-3xl sm:text-4xl md:text-5xl font-black text-white tracking-tight">
                      {currentCard.word}
                    </h1>
                    {currentCard.ipa && (
                      <span className="text-base sm:text-xl font-mono text-emerald-300 font-bold bg-emerald-950/80 px-3 py-1 rounded-xl border border-emerald-700/60">
                        {currentCard.ipa}
                      </span>
                    )}
                    {currentCard.pos && (
                      <span className="text-xs font-extrabold uppercase px-3 py-1 rounded-full bg-emerald-800 text-emerald-100">
                        {currentCard.pos}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => speakWordPronunciation(currentCard.word, 'en-GB')}
                      className="px-3 py-1.5 rounded-xl bg-emerald-800/80 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>UK</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => speakWordPronunciation(currentCard.word, 'en-US')}
                      className="px-3 py-1.5 rounded-xl bg-indigo-800/80 hover:bg-indigo-700 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>US</span>
                    </button>
                  </div>
                </div>

                {/* Contextual Meaning */}
                <div className="mt-4 p-4 rounded-2xl bg-[#0B2E1D] border border-emerald-500/60">
                  <span className="text-xs font-extrabold uppercase tracking-wider text-amber-300 block mb-1">
                    🇻🇳 Nghĩa tiếng Việt sát ngữ cảnh bài thi:
                  </span>
                  <p className="text-xl sm:text-2xl font-black text-white">
                    {currentCard.contextualMeaningVi || currentCard.definitionVi}
                  </p>
                </div>

                {/* Real context sentence in Audio with interactive click */}
                <div className="mt-4 p-4 rounded-2xl bg-slate-900/80 border border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <span className="text-xs font-bold text-purple-400 uppercase tracking-wider">
                      Câu ví dụ thực tế trong bài nghe IELTS (Bấm vào từng từ để tra):
                    </span>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {onPlaySegment && (
                        <button
                          type="button"
                          onClick={handlePlayCardAudio}
                          className="px-2.5 py-1 rounded-lg bg-emerald-800 hover:bg-emerald-700 text-emerald-100 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-xs"
                          title={`Phát audio bài nghe câu này [${cardAudioTiming.label || currentCard.timestampLabel}]`}
                        >
                          {isPlaying ? <Pause className="w-3 h-3 fill-current" /> : <Play className="w-3 h-3 fill-current" />}
                          <span>Audio bài</span>
                        </button>
                      )}

                      {/* Nút Chỉnh Audio bài */}
                      {onPlaySegment && (
                        <button
                          type="button"
                          onClick={() => {
                            if (!isEditingAudioTime) {
                              setEditStartSec(cardAudioTiming.startSec);
                              setEditEndSec(cardAudioTiming.endSec);
                            }
                            setIsEditingAudioTime((prev) => !prev);
                          }}
                          className={`px-2.5 py-1 rounded-lg text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors border ${
                            isEditingAudioTime
                              ? 'bg-amber-600 border-amber-400 text-white shadow-xs'
                              : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-amber-300'
                          }`}
                          title="Chỉnh mốc thời gian bắt đầu và kết thúc của Audio bài cho từ vựng này"
                        >
                          <SlidersHorizontal className="w-3 h-3" />
                          <span>{isEditingAudioTime ? 'Đóng chỉnh' : 'Chỉnh Audio bài'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => speakSentencePronunciation(exampleSentence, 'en-GB')}
                        className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold flex items-center gap-1 cursor-pointer transition-colors border border-slate-700"
                        title="Nghe đọc chuẩn câu này (UK TTS)"
                      >
                        <Volume2 className="w-3 h-3 text-emerald-400" />
                        <span>Đọc câu (UK)</span>
                      </button>
                    </div>
                  </div>

                  {/* Panel Chỉnh mốc Audio bài */}
                  {isEditingAudioTime && (
                    <div className="mb-3 p-3.5 rounded-xl bg-slate-950/90 border border-amber-500/50 shadow-lg space-y-3 animate-in fade-in zoom-in-95 duration-150">
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-slate-800 text-xs">
                        <div className="flex items-center gap-1.5 font-bold text-amber-300">
                          <SlidersHorizontal className="w-3.5 h-3.5 text-amber-400" />
                          <span>Chỉnh mốc Audio bài: “{currentCard.word}”</span>
                        </div>
                        <div className="text-[11px] font-mono text-slate-400 flex items-center gap-2">
                          <span>
                            Thời lượng:{' '}
                            <strong className="text-white">
                              {Math.max(0, editEndSec - editStartSec).toFixed(2)}s
                            </strong>
                          </span>
                          <span className="text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800/60">
                            [{formatSecondsToTime(editStartSec)} → {formatSecondsToTime(editEndSec)}]
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {/* Start Time Tuning */}
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-emerald-300 flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-emerald-400" />
                              Bắt đầu (Start)
                            </span>
                            <span className="font-mono text-slate-400 text-[11px]">
                              {editStartSec.toFixed(2)}s
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={formatSecondsToTime(editStartSec)}
                              onChange={(e) => {
                                const parsed = parseTimeToSeconds(e.target.value);
                                if (parsed !== null) setEditStartSec(parsed);
                              }}
                              className="w-24 bg-slate-950 border border-slate-700 focus:border-emerald-500 rounded px-2 py-1 text-xs font-mono font-bold text-white text-center outline-none"
                            />
                            <div className="flex items-center gap-1 flex-wrap">
                              {[-1.0, -0.5, -0.1, +0.1, +0.5, +1.0].map((step) => (
                                <button
                                  key={step}
                                  type="button"
                                  onClick={() =>
                                    setEditStartSec((prev) =>
                                      Number(Math.max(0, prev + step).toFixed(2))
                                    )
                                  }
                                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-300 hover:text-white transition-colors cursor-pointer"
                                >
                                  {step > 0 ? `+${step}` : step}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* End Time Tuning */}
                        <div className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="font-bold text-amber-300 flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-amber-400" />
                              Kết thúc (End)
                            </span>
                            <span className="font-mono text-slate-400 text-[11px]">
                              {editEndSec.toFixed(2)}s
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={formatSecondsToTime(editEndSec)}
                              onChange={(e) => {
                                const parsed = parseTimeToSeconds(e.target.value);
                                if (parsed !== null) setEditEndSec(parsed);
                              }}
                              className="w-24 bg-slate-950 border border-slate-700 focus:border-amber-500 rounded px-2 py-1 text-xs font-mono font-bold text-white text-center outline-none"
                            />
                            <div className="flex items-center gap-1 flex-wrap">
                              {[-1.0, -0.5, -0.1, +0.1, +0.5, +1.0].map((step) => (
                                <button
                                  key={step}
                                  type="button"
                                  onClick={() =>
                                    setEditEndSec((prev) =>
                                      Number(Math.max(editStartSec + 0.2, prev + step).toFixed(2))
                                    )
                                  }
                                  className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-mono text-slate-300 hover:text-white transition-colors cursor-pointer"
                                >
                                  {step > 0 ? `+${step}` : step}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Action buttons inside adjuster */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800">
                        <button
                          type="button"
                          onClick={() => {
                            if (onPlaySegment) {
                              onPlaySegment(editStartSec, editEndSec);
                            }
                          }}
                          className="px-3 py-1.5 rounded-lg bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Nghe thử ({(editEndSec - editStartSec).toFixed(1)}s)</span>
                        </button>

                        <div className="flex items-center gap-2">
                          {saveTimeSuccess && (
                            <span className="text-xs text-emerald-400 font-bold flex items-center gap-1 animate-in fade-in duration-200">
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              Đã lưu mốc mới!
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              const wordKey = (currentCard.word || '').trim().toLowerCase();
                              const newLabel = formatTsLabel(editStartSec);
                              setCustomCardTimings((prev) => ({
                                ...prev,
                                [wordKey]: {
                                  startSec: editStartSec,
                                  endSec: editEndSec,
                                  label: newLabel,
                                },
                              }));
                              onUpdateCardAudioTime?.(currentCard.word, editStartSec, editEndSec);
                              setSaveTimeSuccess(true);
                              setTimeout(() => setSaveTimeSuccess(false), 2000);
                            }}
                            className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer shadow-xs"
                          >
                            <Check className="w-3.5 h-3.5" />
                            <span>Lưu mốc này</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsEditingAudioTime(false)}
                            className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors cursor-pointer"
                          >
                            Đóng
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <p className="text-base sm:text-lg font-bold leading-relaxed text-white">
                    “
                    {exampleSentence.split(/(\s+)/).map((part, pIdx) => {
                      const clean = cleanWordKey(part);
                      if (!clean || /^\s+$/.test(part)) return <span key={pIdx}>{part}</span>;
                      const isMainWord = clean.toLowerCase() === currentCard.word.toLowerCase();
                      return (
                        <button
                          key={pIdx}
                          type="button"
                          onClick={() => handleLookupWord(clean)}
                          title={`Tra từ & IPA: ${clean}`}
                          className={
                            isMainWord
                              ? 'inline-block bg-emerald-700/80 text-emerald-100 px-2 py-0.5 mx-0.5 rounded-lg font-black underline cursor-pointer'
                              : 'hover:text-emerald-300 hover:underline cursor-pointer transition-colors inline'
                          }
                        >
                          {part}
                        </button>
                      );
                    })}
                    ”
                  </p>

                  {currentCard.exampleTranslationVi && (
                    <div className="mt-2 pt-2 border-t border-slate-800 text-xs sm:text-sm text-emerald-300 font-medium italic">
                      Bản dịch: {currentCard.exampleTranslationVi}
                    </div>
                  )}
                </div>

                {/* Collocations & English Definition */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
                  {currentCard.collocations && currentCard.collocations.length > 0 && (
                    <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-xs font-bold text-amber-400 block mb-1">
                        Cụm từ kết hợp hay (Collocations):
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {currentCard.collocations.map((c: string, cIdx: number) => (
                          <button
                            key={cIdx}
                            type="button"
                            onClick={() => handleLookupWord(c)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-emerald-200 text-xs font-semibold cursor-pointer"
                          >
                            {c}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {currentCard.definitionEn && (
                    <div className="p-3.5 rounded-xl bg-slate-900/60 border border-slate-800">
                      <span className="text-xs font-bold text-slate-400 block mb-1">
                        English Definition:
                      </span>
                      <p className="text-xs sm:text-sm text-slate-200 italic">
                        {currentCard.definitionEn}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* MODE 4: Đọc đồng thanh & Luyện âm */}
          {activeMode === 'choral' && (
            <div className="relative w-full max-w-4xl mx-auto py-2 text-center space-y-4">
              {/* 3-2-1 Lead-in Overlay when Looping */}
              {countdown321Step !== null && (
                <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 backdrop-blur-xs rounded-3xl animate-in fade-in zoom-in duration-200">
                  {countdown321Step > 0 ? (
                    <div className="text-center">
                      <div className="w-28 h-28 rounded-full bg-gradient-to-tr from-amber-500 to-emerald-600 flex items-center justify-center shadow-2xl ring-8 ring-amber-400/30 mx-auto animate-pulse">
                        <span className="text-6xl font-black text-white font-mono">{countdown321Step}</span>
                      </div>
                      <p className="mt-4 text-base font-extrabold text-amber-300 uppercase tracking-widest">
                        Chuẩn bị đọc từ vựng & câu...
                      </p>
                      <p className="text-xs text-slate-300 mt-1">Đếm nhịp chuẩn bị vào câu lặp</p>
                    </div>
                  ) : (
                    <div className="text-center animate-bounce">
                      <div className="px-8 py-4 rounded-2xl bg-gradient-to-r from-emerald-600 to-teal-500 shadow-2xl ring-4 ring-emerald-400/40">
                        <span className="text-2xl sm:text-3xl font-black text-white tracking-wide">
                          🗣️ CẢ LỚP ĐỌC ĐỒNG THANH!
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="bg-[#121A2E]/90 border-2 border-emerald-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl">
                {/* Target word badge */}
                <div className="mb-4">
                  <span className="inline-block px-5 py-2 rounded-2xl bg-[#09351E] border-2 border-emerald-400 text-white text-2xl sm:text-3xl font-black tracking-wide shadow-md">
                    {currentCard.word} {currentCard.ipa && <span className="text-emerald-300 font-mono text-lg font-bold">({currentCard.ipa})</span>}
                  </span>
                </div>

                {/* Choral Chunks with Interactive Word Click */}
                <div className="text-lg sm:text-xl md:text-2xl font-extrabold leading-relaxed tracking-tight text-white mb-2">
                  {choralChunks.map((chunk, cIdx) => {
                    const words = chunk.split(/(\s+)/);
                    return (
                      <span key={cIdx} className="inline-block mx-1.5 my-1">
                        <span className="text-emerald-200 font-black px-3 py-1.5 bg-emerald-950/70 rounded-xl border border-emerald-500/30 inline-block shadow-xs">
                          {words.map((part, pIdx) => {
                            const clean = cleanWordKey(part);
                            if (!clean || /^\s+$/.test(part)) return <span key={pIdx}>{part}</span>;
                            return (
                              <button
                                key={pIdx}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleLookupWord(clean);
                                }}
                                title={`Bấm để tra IPA & nghĩa: ${clean}`}
                                className="hover:text-amber-300 hover:underline cursor-pointer transition-colors inline-block"
                              >
                                {part}
                              </button>
                            );
                          })}
                        </span>
                        {cIdx < choralChunks.length - 1 && (
                          <span className="text-slate-600 font-light mx-2">/</span>
                        )}
                      </span>
                    );
                  })}
                </div>

                <p className="text-[11px] text-emerald-300/80 italic mb-4 select-none">
                  💡 Bấm trực tiếp vào từng từ trên câu để nghe phát âm IPA và tra nghĩa tiếng Việt
                </p>

                {/* Audio controls */}
                <div className="flex flex-wrap items-center justify-center gap-3 pt-4 border-t border-slate-800">
                  {onPlaySegment && (
                    <button
                      type="button"
                      onClick={handlePlayCardAudio}
                      className={`px-5 py-2.5 rounded-xl font-extrabold text-sm flex items-center gap-2 shadow-lg active:scale-95 transition-all cursor-pointer ${
                        isPlaying
                          ? 'bg-emerald-700 hover:bg-emerald-600 text-white ring-2 ring-emerald-400/50 shadow-emerald-700/30'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
                      }`}
                    >
                      {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
                      <span>{isPlaying ? 'Tạm dừng' : 'Phát âm thanh câu này'}</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      const next = !isLooping;
                      setIsLooping(next);
                      setLoopCount(0);
                      if (next && !isPlaying) handlePlayCardAudio();
                    }}
                    className={`px-4 py-2.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                      isLooping
                        ? 'bg-amber-600 border-amber-400 text-white shadow-md ring-2 ring-amber-400/50'
                        : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    <Repeat className="w-4 h-4" />
                    <span>Lặp lại tự động {isLooping ? (loopCount > 0 ? `(Lần ${loopCount + 1})` : '(Bật)') : ''}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEnable321LeadIn((prev) => !prev)}
                    className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                      enable321LeadIn
                        ? 'bg-emerald-900/80 border-emerald-500 text-emerald-200 ring-1 ring-emerald-400/40'
                        : 'bg-slate-800 border-slate-700 text-slate-400'
                    }`}
                    title="Bật/Tắt đếm nhịp 3-2-1 trước mỗi lần lặp lại"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Nhịp 3-2-1: {enable321LeadIn ? 'BẬT' : 'TẮT'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      start321LeadIn(() => {
                        handlePlayCardAudio();
                      });
                    }}
                    className="px-3 py-2 rounded-xl bg-teal-900/60 hover:bg-teal-800 border border-teal-700/60 text-teal-200 text-xs font-semibold cursor-pointer transition-colors"
                    title="Kích hoạt nhịp 3-2-1 ngay bây giờ"
                  >
                    ⚡ Đếm nhịp 3-2-1
                  </button>

                  <button
                    type="button"
                    onClick={() => speakSentencePronunciation(exampleSentence, 'en-GB')}
                    className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 text-xs font-semibold cursor-pointer transition-colors flex items-center gap-1.5"
                    title="Nghe giọng đọc bản xứ (UK TTS)"
                  >
                    <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                    <span>Đọc mẫu câu (UK)</span>
                  </button>

                  {onChangeRate && (
                    <div className="inline-flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                      {[0.75, 0.85, 1.0].map((rate) => (
                        <button
                          key={rate}
                          type="button"
                          onClick={() => onChangeRate(rate)}
                          className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                            playbackRate === rate ? 'bg-emerald-600 text-white shadow-xs' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {rate}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Countdown Timer Widget for Choral Reading */}
                <div className="mt-5 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3 bg-[#0B101E]/80 px-4 py-3 rounded-2xl border border-emerald-900/40">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`p-2 rounded-xl ${
                        isCountdownRunning
                          ? 'bg-amber-500/20 text-amber-400 animate-pulse'
                          : 'bg-slate-800 text-slate-400'
                      }`}
                    >
                      <Timer className="w-5 h-5" />
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-slate-300">Đồng hồ đếm ngược luyện đọc</span>
                        {hasFinishedCountdown && (
                          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-900/80 text-emerald-300 border border-emerald-700">
                            Hết giờ!
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        {[10, 15, 20, 30, 45, 60].map((sec) => (
                          <button
                            key={sec}
                            type="button"
                            onClick={() => {
                              setCountdownDuration(sec);
                              setCountdownRemaining(sec);
                              setIsCountdownRunning(false);
                              setHasFinishedCountdown(false);
                            }}
                            className={`px-2 py-0.5 rounded text-[11px] font-mono font-bold transition-all cursor-pointer ${
                              countdownDuration === sec
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-800/80 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {sec}s
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 ml-auto">
                    <div className="text-center font-mono">
                      <span
                        className={`text-2xl font-black tabular-nums ${
                          countdownRemaining <= 5 && isCountdownRunning
                            ? 'text-rose-400 animate-pulse'
                            : countdownRemaining <= 10 && isCountdownRunning
                            ? 'text-amber-400'
                            : 'text-white'
                        }`}
                      >
                        {formatTimer(countdownRemaining)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (countdownRemaining === 0) {
                          setCountdownRemaining(countdownDuration);
                          setHasFinishedCountdown(false);
                        }
                        setIsCountdownRunning((prev) => !prev);
                      }}
                      className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all shadow cursor-pointer ${
                        isCountdownRunning
                          ? 'bg-amber-600 hover:bg-amber-500 text-white'
                          : 'bg-emerald-600 hover:bg-emerald-500 text-white'
                      }`}
                    >
                      {isCountdownRunning ? (
                        <Pause className="w-3.5 h-3.5 fill-current" />
                      ) : (
                        <Play className="w-3.5 h-3.5 fill-current" />
                      )}
                      <span>{isCountdownRunning ? 'Dừng' : 'Bắt đầu'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setIsCountdownRunning(false);
                        setCountdownRemaining(countdownDuration);
                        setHasFinishedCountdown(false);
                      }}
                      className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors cursor-pointer"
                      title="Đặt lại đồng hồ"
                    >
                      <RotateCcw className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>

              <p className="text-center text-xs sm:text-sm text-slate-400 font-medium select-none">
                🗣️ Cả lớp cùng nhìn câu ví dụ, nghe nhịp điệu audio và đọc to đồng thanh 2–3 lần
              </p>
            </div>
          )}
        </div>

        {/* Slide Bottom Bar Navigation */}
        <footer className="px-5 py-3 bg-[#0D1322] border-t border-slate-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-400 flex items-center gap-2 hidden sm:flex">
            <span>Phím tắt:</span>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">←</kbd>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">→</kbd>
            <span>đổi từ</span>
            <span className="text-slate-600">·</span>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">1-4</kbd>
            <span>đổi chế độ</span>
            <span className="text-slate-600">·</span>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">Space</kbd>
            <span>lật/phát</span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => setCurrentSlideIdx((prev) => (prev > 0 ? prev - 1 : cards.length - 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              aria-label="Từ trước"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Từ trước</span>
            </button>

            <span className="text-xs font-mono font-bold px-3 py-1 bg-slate-800/80 rounded-lg text-slate-300 tabular-nums">
              {currentSlideIdx + 1} / {cards.length}
            </span>

            <button
              type="button"
              onClick={() => setCurrentSlideIdx((prev) => (prev < cards.length - 1 ? prev + 1 : 0))}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
              aria-label="Từ tiếp theo"
            >
              <span>Từ sau</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </footer>

        {/* Interactive Dictionary & IPA Modal Popover */}
        {(selectedDictWord || isLookingUpWord) && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="vocab-dict-title"
            className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fadeIn"
            onClick={() => {
              if (!isLookingUpWord) setSelectedDictWord(null);
            }}
          >
            <div
              className="relative w-full max-w-md bg-[#0F1426] border-2 border-emerald-500/50 rounded-3xl p-6 shadow-2xl text-white animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {isLookingUpWord ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="w-8 h-8 text-emerald-400 animate-spin" />
                  <p className="text-sm font-semibold text-emerald-200">Đang tra từ điển & phiên âm IPA...</p>
                </div>
              ) : selectedDictWord ? (
                <>
                  <div className="flex items-start justify-between pb-3.5 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-emerald-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                        Tra từ điển ngữ cảnh
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedDictWord(null)}
                      className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer"
                      aria-label="Đóng tra từ"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <div className="mt-4">
                    <div className="flex flex-wrap items-baseline gap-2.5">
                      <h3 id="vocab-dict-title" className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                        {selectedDictWord.word}
                      </h3>
                      {selectedDictWord.pos && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold uppercase bg-emerald-950 text-emerald-300 border border-emerald-800">
                          {selectedDictWord.pos}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {selectedDictWord.ipaUk && (
                        <button
                          type="button"
                          onClick={() => speakWordPronunciation(selectedDictWord.word, 'en-GB')}
                          className="px-3 py-1.5 rounded-xl bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/60 text-emerald-200 text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Nghe phát âm chuẩn Anh - Anh (UK)"
                        >
                          <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                          <span>UK: {selectedDictWord.ipaUk}</span>
                        </button>
                      )}
                      {selectedDictWord.ipaUs && (
                        <button
                          type="button"
                          onClick={() => speakWordPronunciation(selectedDictWord.word, 'en-US')}
                          className="px-3 py-1.5 rounded-xl bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-200 text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Nghe phát âm chuẩn Anh - Mỹ (US)"
                        >
                          <Volume2 className="w-3.5 h-3.5 text-indigo-400" />
                          <span>US: {selectedDictWord.ipaUs}</span>
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 p-3.5 rounded-2xl bg-[#151B33] border border-slate-800">
                    <div className="text-xs font-bold text-amber-400 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                      <span>🇻🇳 Nghĩa tiếng Việt sát ngữ cảnh:</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-100 leading-snug">
                      {selectedDictWord.contextualMeaningVi || selectedDictWord.meaningVi}
                    </p>
                  </div>

                  {selectedDictWord.definitionEn && (
                    <div className="mt-2.5 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-300">
                      <span className="text-emerald-400 font-bold block mb-0.5">English Definition:</span>
                      <p className="italic">{selectedDictWord.definitionEn}</p>
                    </div>
                  )}

                  <div className="mt-5 pt-3.5 border-t border-slate-800 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => handleSaveToFlashcards(selectedDictWord)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                        flashcardSavedSuccess
                          ? 'bg-emerald-700 text-emerald-100 border border-emerald-500'
                          : 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white shadow-md'
                      }`}
                    >
                      {flashcardSavedSuccess ? (
                        <>
                          <Check className="w-4 h-4" />
                          <span>Đã lưu vào Flashcards!</span>
                        </>
                      ) : (
                        <>
                          <Star className="w-4 h-4 fill-current" />
                          <span>Lưu vào thẻ Flashcards</span>
                        </>
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setSelectedDictWord(null)}
                      className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                    >
                      Đóng
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
