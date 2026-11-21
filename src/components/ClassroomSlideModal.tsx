import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
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
  Sparkles,
  Star,
  Timer,
  Volume2,
  X,
} from 'lucide-react';
import type { ClassroomDrillSentence, FlashcardItem, ListeningTestPack } from '../types/ielts';
import { exportDictationSlidesPptx } from '../utils/pptxExport';
import {
  cleanWordKey,
  lookupWordDictionary,
  playChoralBeep,
  speakWordPronunciation,
  type DictionaryWordInfo,
} from '../utils/dictionaryService';
import { saveFlashcardsToIndexedDB } from '../utils/indexedDBStorage';

export type SlidePedagogicalMode =
  | 'blind'        // 1. Ẩn chữ (Nghe mù)
  | 'gap_fill'     // 2. Đục lỗ (Điền từ)
  | 'word_by_word' // 3. Hiện từng từ
  | 'full_reveal'  // 4. Hiện đáp án
  | 'choral';      // 5. Đọc đồng thanh

interface WordToken {
  id: string;
  index: number;
  raw: string;
  wordOnly: string;
  trailingPunct: string;
  isKeyword: boolean;
}

interface FocusVocabItem {
  word: string;
  ipa?: string;
  pos?: string;
  meaningVi?: string;
  collocations?: string[];
  example?: string;
}

interface ClassroomSlideModalProps {
  isOpen: boolean;
  onClose: () => void;
  testPack: ListeningTestPack;
  drills?: ClassroomDrillSentence[];
  onPlaySegment: (startSec: number, endSec?: number) => void;
  onTogglePlay?: () => void;
  currentTime?: number;
  isPlaying?: boolean;
  playbackRate?: number;
  onChangeRate?: (rate: number) => void;
}

const COMMON_STOP_WORDS = new Set([
  'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'for', 'with', 'from', 'by', 'of', 'and', 'or',
  'but', 'so', 'it', 'its', 'i', 'my', 'me', 'we', 'our', 'us', 'you', 'your',
  'he', 'his', 'him', 'she', 'her', 'they', 'their', 'them', 'this', 'that',
  'these', 'those', 'as', 'if', 'when', 'than', 'into', 'can', 'could', 'will',
  'would', 'shall', 'should', 'may', 'might', 'must', 'just', 'not', 'have',
  'has', 'had', 'do', 'does', 'did', 'so', 'too', 'very'
]);

function tokenizeSentence(
  sentence: string,
  keyWords: string[] = [],
  vocabList: { word: string }[] = []
): WordToken[] {
  const rawTokens = sentence.trim().split(/\s+/).filter(Boolean);

  const targetWordsSet = new Set<string>();
  keyWords.forEach((kw) => {
    kw.toLowerCase()
      .split(/\s+/)
      .forEach((w) => {
        const cleaned = w.replace(/[^a-zA-Z0-9]/g, '');
        if (cleaned.length > 2) targetWordsSet.add(cleaned);
      });
  });

  vocabList.forEach((v) => {
    v.word.toLowerCase()
      .split(/\s+/)
      .forEach((w) => {
        const cleaned = w.replace(/[^a-zA-Z0-9]/g, '');
        if (cleaned.length > 2) targetWordsSet.add(cleaned);
      });
  });

  const tokens: WordToken[] = rawTokens.map((raw, index) => {
    const cleanWord = raw.replace(/^[“"'(]+/, '').replace(/[”"')!?,.:;]+$/, '');
    const trailingPunct = raw.slice(cleanWord.length);
    const lower = cleanWord.toLowerCase();

    let isKeyword = false;
    if (targetWordsSet.has(lower)) {
      isKeyword = true;
    } else if (cleanWord.length >= 5 && !COMMON_STOP_WORDS.has(lower)) {
      isKeyword = true;
    }

    return {
      id: `${index}-${cleanWord}`,
      index,
      raw,
      wordOnly: cleanWord || raw,
      trailingPunct,
      isKeyword,
    };
  });

  // Ensure at least 1-2 keywords if sentence has content words
  const kwCount = tokens.filter((t) => t.isKeyword).length;
  if (kwCount === 0 && tokens.length > 0) {
    const candidate = [...tokens]
      .filter((t) => !COMMON_STOP_WORDS.has(t.wordOnly.toLowerCase()) && t.wordOnly.length >= 4)
      .sort((a, b) => b.wordOnly.length - a.wordOnly.length)[0];
    if (candidate) {
      candidate.isKeyword = true;
    }
  }

  return tokens;
}

function speakWord(text: string) {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = 'en-US';
    utterance.rate = 0.9;
    window.speechSynthesis.speak(utterance);
  }
}

export const ClassroomSlideModal: React.FC<ClassroomSlideModalProps> = ({
  isOpen,
  onClose,
  testPack,
  drills: propDrills,
  onPlaySegment,
  onTogglePlay,
  currentTime,
  isPlaying = false,
  playbackRate = 1.0,
  onChangeRate,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const drills: ClassroomDrillSentence[] = useMemo(() => {
    if (propDrills && propDrills.length > 0) return propDrills;
    if (testPack.classroomDrills && testPack.classroomDrills.length > 0) {
      return testPack.classroomDrills;
    }
    return testPack.segments.slice(0, 12).map((seg, i) => ({
      id: seg.id,
      order: i + 1,
      speaker: seg.speaker,
      sentence: seg.text,
      translationVi: '',
      startSec: seg.startSec,
      endSec: seg.endSec,
      timestampLabel: seg.timestampLabel,
      selectionReasonVi: 'Trích đoạn câu tiêu biểu từ audio',
      stressPattern: seg.stressPattern || '',
      connectedSpeechNote: seg.intonationNote || '',
      keyWords: [],
    }));
  }, [propDrills, testPack]);

  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);
  const [activeMode, setActiveMode] = useState<SlidePedagogicalMode>('blind');
  const [revealedIndices, setRevealedIndices] = useState<Set<number>>(new Set());
  const [wordByWordStep, setWordByWordStep] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [loopCount, setLoopCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showVocabSheet, setShowVocabSheet] = useState(false);

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

  const wasPlayingRef = useRef(false);
  const loopTimerRef = useRef<number | null>(null);

  const currentDrill = drills[currentSlideIdx] || drills[0];

  // Tokenize current sentence
  const tokens = useMemo(() => {
    if (!currentDrill?.sentence) return [];
    return tokenizeSentence(
      currentDrill.sentence,
      currentDrill.keyWords || [],
      testPack.vocabulary || []
    );
  }, [currentDrill, testPack.vocabulary]);

  // Find focus vocabulary for the current sentence
  const focusVocabList: FocusVocabItem[] = useMemo(() => {
    if (!currentDrill) return [];
    const list: FocusVocabItem[] = [];
    const seenWords = new Set<string>();

    // 1. Match from testPack.vocabulary
    if (testPack.vocabulary) {
      for (const v of testPack.vocabulary) {
        const regex = new RegExp(`\\b${v.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
        if (regex.test(currentDrill.sentence) && !seenWords.has(v.word.toLowerCase())) {
          seenWords.add(v.word.toLowerCase());
          list.push({
            word: v.word,
            ipa: v.ipa,
            pos: v.pos,
            meaningVi: v.meaningVi,
            collocations: v.collocations,
            example: v.contextSentence,
          });
        }
      }
    }

    // 2. Match from drill.keyWords
    if (currentDrill.keyWords && currentDrill.keyWords.length > 0) {
      for (const kw of currentDrill.keyWords) {
        if (!seenWords.has(kw.toLowerCase())) {
          seenWords.add(kw.toLowerCase());
          list.push({
            word: kw,
            pos: 'key phrase',
            meaningVi: 'Cụm từ then chốt xuất hiện trong bài thi',
          });
        }
      }
    }

    // 3. Fallback to longest keyword token if empty
    if (list.length === 0 && tokens.length > 0) {
      const topKw = [...tokens]
        .filter((t) => t.isKeyword)
        .sort((a, b) => b.wordOnly.length - a.wordOnly.length)[0];
      if (topKw) {
        list.push({
          word: topKw.wordOnly,
          pos: 'focus word',
          meaningVi: 'Từ vựng quan trọng giúp nắm bắt ý chính đoạn nghe',
        });
      }
    }

    return list;
  }, [currentDrill, testPack.vocabulary, tokens]);

  // Reset revealed state when slide changes or mode changes
  useEffect(() => {
    setShowVocabSheet(false);
    if (activeMode === 'blind') {
      setRevealedIndices(new Set());
    } else if (activeMode === 'gap_fill') {
      // In gap_fill: non-keywords are already revealed, keywords are unrevealed
      const initialRevealed = new Set<number>();
      tokens.forEach((t) => {
        if (!t.isKeyword) initialRevealed.add(t.index);
      });
      setRevealedIndices(initialRevealed);
    } else if (activeMode === 'word_by_word') {
      setWordByWordStep(0);
      setRevealedIndices(new Set());
    } else if (activeMode === 'full_reveal' || activeMode === 'choral') {
      setRevealedIndices(new Set(tokens.map((t) => t.index)));
    }
  }, [currentSlideIdx, activeMode, tokens]);

  // Keyboard navigation & Shortcuts
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if user is typing in an input
      if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setCurrentSlideIdx((prev) => (prev < drills.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setCurrentSlideIdx((prev) => (prev > 0 ? prev - 1 : drills.length - 1));
      } else if (e.key === 'Escape') {
        if (showVocabSheet) {
          setShowVocabSheet(false);
        } else {
          onClose();
        }
      } else if (e.key === '1') {
        setActiveMode('blind');
      } else if (e.key === '2') {
        setActiveMode('gap_fill');
      } else if (e.key === '3') {
        setActiveMode('word_by_word');
      } else if (e.key === '4') {
        setActiveMode('full_reveal');
      } else if (e.key === '5') {
        setActiveMode('choral');
      } else if (e.code === 'Space') {
        e.preventDefault();
        if (activeMode === 'word_by_word') {
          setWordByWordStep((prev) => Math.min(tokens.length, prev + 1));
        } else if (isPlaying) {
          if (onTogglePlay) {
            onTogglePlay();
          } else if (currentDrill) {
            onPlaySegment(currentDrill.startSec, currentDrill.endSec);
          }
        } else if (currentDrill) {
          onPlaySegment(currentDrill.startSec, currentDrill.endSec);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, drills.length, onClose, showVocabSheet, activeMode, tokens.length, currentDrill, onPlaySegment, onTogglePlay, isPlaying]);

  // Fullscreen tracking
  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', handleFsChange);
    return () => document.removeEventListener('fullscreenchange', handleFsChange);
  }, []);

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
    if (!isOpen || !isLooping || !currentDrill) {
      wasPlayingRef.current = isPlaying;
      if (loopTimerRef.current) {
        window.clearTimeout(loopTimerRef.current);
        loopTimerRef.current = null;
      }
      clear321Timers();
      return;
    }

    // Detect segment end transition (isPlaying: true -> false)
    if (wasPlayingRef.current && !isPlaying) {
      if (loopTimerRef.current) {
        window.clearTimeout(loopTimerRef.current);
      }
      clear321Timers();

      // In Mode 5 (Đọc đồng thanh) with 3-2-1 countdown enabled
      if (activeMode === 'choral' && enable321LeadIn) {
        start321LeadIn(() => {
          if (isOpen && isLooping && currentDrill) {
            setLoopCount((prev) => prev + 1);
            onPlaySegment(currentDrill.startSec, currentDrill.endSec);
          }
        });
      } else {
        loopTimerRef.current = window.setTimeout(() => {
          if (isOpen && isLooping && currentDrill) {
            setLoopCount((prev) => prev + 1);
            onPlaySegment(currentDrill.startSec, currentDrill.endSec);
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
  }, [isPlaying, isLooping, isOpen, currentDrill, activeMode, enable321LeadIn, onPlaySegment]);

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

  // When changing slides, reset timers & clear states
  useEffect(() => {
    if (loopTimerRef.current) {
      window.clearTimeout(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    clear321Timers();
    setLoopCount(0);
    setCountdownRemaining(countdownDuration);
    setIsCountdownRunning(false);
    setHasFinishedCountdown(false);
    setSelectedDictWord(null);

    if (isOpen && isLooping && currentDrill) {
      if (activeMode === 'choral' && enable321LeadIn) {
        start321LeadIn(() => {
          onPlaySegment(currentDrill.startSec, currentDrill.endSec);
        });
      } else {
        onPlaySegment(currentDrill.startSec, currentDrill.endSec);
      }
    }
  }, [currentSlideIdx, countdownDuration]);

  // Reset on modal close
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

  // Dictionary word lookup
  const handleLookupWord = async (rawWord: string) => {
    const clean = cleanWordKey(rawWord);
    if (!clean) return;

    setIsLookingUpWord(true);
    setFlashcardSavedSuccess(false);

    try {
      const result = await lookupWordDictionary(clean, currentDrill.sentence, testPack.vocabulary);
      setSelectedDictWord(result);
    } catch {
      // fallback
    } finally {
      setIsLookingUpWord(false);
    }
  };

  // Add word to flashcards permanently
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
        exampleInAudio: currentDrill.sentence,
        timestampLabel: currentDrill.timestampLabel,
        sourceTitle: `${testPack.title} • ${currentDrill.speaker || 'Classroom Slide'}`,
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

  if (!isOpen || drills.length === 0 || !currentDrill) return null;

  const handlePlayCurrent = () => {
    if (isPlaying) {
      if (onTogglePlay) {
        onTogglePlay();
      } else if (currentDrill) {
        onPlaySegment(currentDrill.startSec, currentDrill.endSec);
      }
    } else if (currentDrill) {
      onPlaySegment(currentDrill.startSec, currentDrill.endSec);
    }
  };

  const handleToggleLoop = () => {
    const next = !isLooping;
    setIsLooping(next);
    setLoopCount(0);
    if (next) {
      if (!isPlaying && currentDrill) {
        onPlaySegment(currentDrill.startSec, currentDrill.endSec);
      }
    } else {
      if (loopTimerRef.current) {
        window.clearTimeout(loopTimerRef.current);
        loopTimerRef.current = null;
      }
    }
  };

  const toggleFullscreen = async () => {
    try {
      if (!document.fullscreenElement) {
        await containerRef.current?.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // Fallback if browser blocks fullscreen
    }
  };

  const toggleTokenReveal = (index: number) => {
    setRevealedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  };

  const revealAllTokens = () => {
    setRevealedIndices(new Set(tokens.map((t) => t.index)));
  };

  const hideAllTokens = () => {
    setRevealedIndices(new Set());
  };

  const stepNextWord = () => {
    setWordByWordStep((prev) => Math.min(tokens.length, prev + 1));
  };

  const stepPrevWord = () => {
    setWordByWordStep((prev) => Math.max(0, prev - 1));
  };

  // Choral chunks (split sentence by commas, periods, or natural phrases)
  const choralChunks = currentDrill.sentence
    .split(/([,.;:!?]|\band\b|\bbut\b|\bbecause\b|\bwhich\b)/gi)
    .reduce<string[]>((acc, part) => {
      const trimmed = part.trim();
      if (!trimmed) return acc;
      if (trimmed.length <= 2 && acc.length > 0) {
        acc[acc.length - 1] += ` ${trimmed}`;
      } else {
        acc.push(trimmed);
      }
      return acc;
    }, [])
    .filter((chunk) => chunk.trim().length > 0);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="classroom-slide-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-slate-950/95 backdrop-blur-md animate-fadeIn select-none"
    >
      <div
        ref={containerRef}
        className={`relative w-full ${
          isFullscreen
            ? 'h-full max-w-none rounded-none'
            : 'max-w-6xl aspect-[16/9] max-h-[94vh] rounded-3xl'
        } bg-[#0A0D1A] border border-slate-800/90 overflow-hidden shadow-2xl flex flex-col text-white transition-all`}
      >
        {/* Top Control Bar: Title + Fullscreen + Close */}
        <header className="px-5 py-3 sm:py-3.5 bg-[#0D1224]/90 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 sm:gap-3">
            <span className="px-3 py-1 bg-purple-600 font-extrabold text-xs rounded-full uppercase tracking-wider text-white shadow-xs">
              Slide {currentSlideIdx + 1}/{drills.length}
            </span>
            <span id="classroom-slide-title" className="text-xs sm:text-sm font-semibold text-slate-300 truncate max-w-[260px] sm:max-w-md">
              {testPack.title} • {currentDrill.speaker}
            </span>
            <span className="hidden md:inline-flex items-center font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-800 text-purple-300 border border-slate-700">
              {currentDrill.timestampLabel}
            </span>
          </div>

          <div className="flex items-center gap-2">
            {/* Audio Play Button */}
            <button
              type="button"
              onClick={handlePlayCurrent}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-xs active:scale-95 cursor-pointer ${
                isPlaying
                  ? 'bg-purple-700 hover:bg-purple-600 text-white ring-2 ring-purple-400/50'
                  : 'bg-purple-600 hover:bg-purple-500 text-white'
              }`}
              title={isPlaying ? 'Tạm dừng hoặc phát lại câu (Space)' : 'Phát đoạn Audio câu này (Space)'}
            >
              {isPlaying ? (
                <Pause className="w-3.5 h-3.5 fill-current" />
              ) : (
                <Play className="w-3.5 h-3.5 fill-current" />
              )}
              <span className="hidden sm:inline">{isPlaying ? 'Đang phát' : 'Phát câu'}</span>
            </button>

            {/* Repeat Audio Toggle */}
            <button
              type="button"
              onClick={handleToggleLoop}
              className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg border text-xs font-semibold flex items-center gap-1.5 transition-colors cursor-pointer ${
                isLooping
                  ? 'bg-amber-600 border-amber-400 text-white shadow-md shadow-amber-600/30 ring-2 ring-amber-400/50'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
              title={
                isLooping
                  ? `Đang lặp lại câu${loopCount > 0 ? ` (Đã lặp ${loopCount} lần)` : ''} - Nhấp để tắt`
                  : 'Bật chế độ lặp lại câu này liên tục'
              }
              aria-pressed={isLooping}
            >
              <Repeat className="w-3.5 h-3.5" />
              {isLooping && (
                <span className="hidden sm:inline text-[11px] font-bold">
                  {loopCount > 0 ? `Lần ${loopCount + 1}` : 'Lặp'}
                </span>
              )}
            </button>

            {/* Export PPTX button */}
            <button
              type="button"
              onClick={() => exportDictationSlidesPptx(testPack)}
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg border border-slate-700 transition-colors cursor-pointer"
              title="Tải slide PowerPoint (.pptx)"
            >
              <FileDown className="w-3.5 h-3.5 text-emerald-400" />
              <span>PPTX</span>
            </button>

            {/* Fullscreen Toggle */}
            <button
              type="button"
              onClick={toggleFullscreen}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              title={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình 16:9'}
            >
              {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
            </button>

            {/* Close Modal */}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              aria-label="Đóng slide"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* 5 Pedagogical Modes Bar - Exactly matching user screenshot */}
        <div className="pt-3 pb-2 px-4 flex justify-center shrink-0">
          <nav
            aria-label="Chế độ trình chiếu"
            className="inline-flex items-center gap-1 p-1 bg-[#12162A]/90 border border-slate-800 rounded-full shadow-xl overflow-x-auto max-w-full no-scrollbar"
          >
            {/* Mode 1: Ẩn chữ (Nghe mù) */}
            <button
              type="button"
              onClick={() => setActiveMode('blind')}
              className={`inline-flex items-center gap-2 px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap transition-all cursor-pointer ${
                activeMode === 'blind'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md border border-purple-400/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <EyeOff className="w-4 h-4" />
              <span>1. Ẩn chữ (Nghe mù)</span>
            </button>

            {/* Mode 2: Đục lỗ (Điền từ) */}
            <button
              type="button"
              onClick={() => setActiveMode('gap_fill')}
              className={`inline-flex items-center gap-2 px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap transition-all cursor-pointer ${
                activeMode === 'gap_fill'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md border border-purple-400/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <PenLine className="w-4 h-4" />
              <span>2. Đục lỗ (Điền từ)</span>
            </button>

            {/* Mode 3: Hiện từng từ */}
            <button
              type="button"
              onClick={() => setActiveMode('word_by_word')}
              className={`inline-flex items-center gap-2 px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap transition-all cursor-pointer ${
                activeMode === 'word_by_word'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md border border-purple-400/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Layers className="w-4 h-4" />
              <span>3. Hiện từng từ</span>
            </button>

            {/* Mode 4: Hiện đáp án */}
            <button
              type="button"
              onClick={() => setActiveMode('full_reveal')}
              className={`inline-flex items-center gap-2 px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap transition-all cursor-pointer ${
                activeMode === 'full_reveal'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md border border-purple-400/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Eye className="w-4 h-4" />
              <span>4. Hiện đáp án</span>
            </button>

            {/* Mode 5: Đọc đồng thanh */}
            <button
              type="button"
              onClick={() => setActiveMode('choral')}
              className={`inline-flex items-center gap-2 px-3.5 sm:px-4 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-bold whitespace-nowrap transition-all cursor-pointer ${
                activeMode === 'choral'
                  ? 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-md border border-purple-400/50'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              <Mic className="w-4 h-4" />
              <span>5. Đọc đồng thanh</span>
            </button>
          </nav>
        </div>

        {/* Main 16:9 Slide Presentation Canvas */}
        <div className="flex-1 px-6 sm:px-12 py-4 flex flex-col justify-between overflow-y-auto min-h-0">
          <div className="my-auto flex flex-col items-center justify-center w-full">
            {/* MODE 1: Ẩn chữ (Nghe mù) */}
            {activeMode === 'blind' && (
              <div className="w-full flex flex-col items-center">
                <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3.5 max-w-4xl mx-auto py-4">
                  {tokens.map((token) => {
                    const isRevealed = revealedIndices.has(token.index);
                    return (
                      <button
                        key={token.id}
                        type="button"
                        onClick={() => toggleTokenReveal(token.index)}
                        className={`relative min-w-[52px] sm:min-w-[68px] md:min-w-[76px] h-12 sm:h-15 px-3.5 sm:px-5 rounded-2xl flex items-center justify-center transition-all cursor-pointer shadow-md select-none group ${
                          isRevealed
                            ? 'bg-purple-900/40 border-2 border-purple-400 text-white font-extrabold text-lg sm:text-2xl shadow-purple-500/20'
                            : 'bg-[#12162B] border-2 border-dashed border-slate-700/80 hover:border-purple-400 hover:bg-purple-950/30 text-slate-500 font-bold text-lg sm:text-2xl'
                        }`}
                        title={isRevealed ? 'Nhấp để ẩn lại' : 'Nhấp để lật mở từ này'}
                      >
                        <span className={isRevealed ? 'scale-100' : 'group-hover:scale-110 transition-transform text-slate-400'}>
                          {isRevealed ? token.wordOnly : '?'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Subtitle Hint */}
                <p className="text-center text-xs sm:text-sm text-slate-400 font-medium flex items-center justify-center gap-2 mt-4 select-none">
                  <span>🎧</span>
                  <span>Học sinh tập trung lắng nghe và ghi chép vào vở • Bấm vào ô bất kỳ để lật mở từng từ</span>
                </p>

                {/* Quick actions for teacher */}
                <div className="flex items-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={revealAllTokens}
                    className="px-3 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Lật mở tất cả ô
                  </button>
                  <button
                    type="button"
                    onClick={hideAllTokens}
                    className="px-3 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Ẩn lại toàn bộ
                  </button>
                </div>
              </div>
            )}

            {/* MODE 2: Đục lỗ (Điền từ) */}
            {activeMode === 'gap_fill' && (
              <div className="w-full flex flex-col items-center">
                <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3.5 max-w-4xl mx-auto py-4 leading-relaxed">
                  {tokens.map((token) => {
                    if (!token.isKeyword) {
                      return (
                        <span
                          key={token.id}
                          className="text-lg sm:text-2xl font-bold text-slate-200 px-1 py-1 tracking-wide"
                        >
                          {token.raw}
                        </span>
                      );
                    }
                    const isRevealed = revealedIndices.has(token.index);
                    return (
                      <div key={token.id} className="inline-flex items-center">
                        <button
                          type="button"
                          onClick={() => toggleTokenReveal(token.index)}
                          className={`min-w-[64px] sm:min-w-[84px] h-12 sm:h-14 px-3 sm:px-4 rounded-xl border-2 flex items-center justify-center transition-all cursor-pointer shadow-md select-none ${
                            isRevealed
                              ? 'border-emerald-400 bg-emerald-950/50 text-emerald-300 font-extrabold text-lg sm:text-xl shadow-emerald-500/20'
                              : 'border-dashed border-amber-500/80 bg-amber-950/30 text-amber-400 hover:border-amber-400 hover:bg-amber-900/40 font-bold text-lg sm:text-xl'
                          }`}
                          title={isRevealed ? 'Đáp án đã hiện (nhấp để ẩn)' : 'Ô đục lỗ: Nhấp để hiện đáp án từ này'}
                        >
                          {isRevealed ? token.wordOnly : '?'}
                        </button>
                        {token.trailingPunct && (
                          <span className="text-lg sm:text-2xl font-bold text-slate-300 ml-1">
                            {token.trailingPunct}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p className="text-center text-xs sm:text-sm text-slate-400 font-medium flex items-center justify-center gap-2 mt-4 select-none">
                  <span>📝</span>
                  <span>Học sinh nghe và điền các từ còn thiếu vào ô trống • Bấm vào ô bất kỳ để lật mở đáp án</span>
                </p>

                <div className="flex items-center gap-3 mt-3">
                  <button
                    type="button"
                    onClick={revealAllTokens}
                    className="px-3 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Hiện tất cả đáp án điền từ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const initialRevealed = new Set<number>();
                      tokens.forEach((t) => {
                        if (!t.isKeyword) initialRevealed.add(t.index);
                      });
                      setRevealedIndices(initialRevealed);
                    }}
                    className="px-3 py-1 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Đục lỗ lại
                  </button>
                </div>
              </div>
            )}

            {/* MODE 3: Hiện từng từ */}
            {activeMode === 'word_by_word' && (
              <div className="w-full flex flex-col items-center">
                <div className="flex flex-wrap items-center justify-center gap-2.5 sm:gap-3 max-w-4xl mx-auto py-4">
                  {tokens.map((token) => {
                    const isRevealed = token.index < wordByWordStep;
                    const isCurrent = token.index === wordByWordStep - 1;
                    return (
                      <div key={token.id} className="inline-flex items-center">
                        <div
                          className={`min-w-[50px] sm:min-w-[68px] h-12 sm:h-14 px-3 sm:px-4 rounded-xl flex items-center justify-center transition-all select-none ${
                            isRevealed
                              ? isCurrent
                                ? 'bg-purple-600 text-white font-extrabold text-lg sm:text-xl ring-4 ring-purple-400/50 shadow-xl scale-105'
                                : 'bg-indigo-950/60 border border-indigo-400/40 text-slate-100 font-bold text-base sm:text-lg shadow-md'
                              : 'bg-[#12162B] border-2 border-dashed border-slate-700/60 text-slate-600 font-bold text-base'
                          }`}
                        >
                          {isRevealed ? token.wordOnly : '?'}
                        </div>
                        {isRevealed && token.trailingPunct && (
                          <span className="text-lg font-bold text-slate-300 ml-0.5">
                            {token.trailingPunct}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Stepper controls */}
                <div className="flex flex-wrap items-center justify-center gap-2.5 mt-4">
                  <button
                    type="button"
                    onClick={stepPrevWord}
                    disabled={wordByWordStep <= 0}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-30 disabled:cursor-not-allowed text-xs font-semibold cursor-pointer"
                  >
                    ◀ Lùi 1 từ
                  </button>
                  <button
                    type="button"
                    onClick={stepNextWord}
                    disabled={wordByWordStep >= tokens.length}
                    className="px-4 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs sm:text-sm font-bold shadow-lg shadow-purple-600/30 flex items-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                  >
                    <span>Hiện từ tiếp theo ▶</span>
                    <kbd className="px-1.5 py-0.5 bg-purple-800 rounded text-[10px] font-mono">Space</kbd>
                  </button>
                  <button
                    type="button"
                    onClick={() => setWordByWordStep(tokens.length)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Hiện tất cả
                  </button>
                  <button
                    type="button"
                    onClick={() => setWordByWordStep(0)}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>

                <p className="text-center text-xs sm:text-sm text-slate-400 font-medium flex items-center justify-center gap-2 mt-4 select-none">
                  <span>👉</span>
                  <span>Bấm "Hiện từ tiếp theo" (hoặc nhấn phím Space) để lật mở từng từ theo nhịp đọc của giáo viên</span>
                </p>
              </div>
            )}

            {/* MODE 4: Hiện đáp án */}
            {activeMode === 'full_reveal' && (
              <div className="w-full max-w-4xl mx-auto py-2">
                <div className="bg-[#101426]/90 border-l-8 border-purple-500 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md">
                  <p className="text-xl sm:text-2xl md:text-3xl font-extrabold leading-snug tracking-tight text-white mb-3">
                    “
                    {tokens.map((token) => (
                      <button
                        key={token.id}
                        type="button"
                        onClick={() => handleLookupWord(token.wordOnly)}
                        title={`Bấm để tra IPA & nghĩa: ${token.wordOnly}`}
                        className={
                          token.isKeyword
                            ? 'inline-block bg-purple-900/70 text-purple-200 border border-purple-400/50 px-2 py-0.5 mx-1 rounded-lg font-bold shadow-xs hover:bg-purple-800 hover:text-white cursor-pointer transition-all'
                            : 'inline hover:text-purple-300 hover:underline cursor-pointer transition-colors'
                        }
                      >
                        {token.raw}{' '}
                      </button>
                    ))}
                    ”
                  </p>
                  <p className="text-[11px] text-purple-300/80 italic mb-4 flex items-center gap-1 select-none">
                    <span>💡</span>
                    <span>Bấm vào bất kỳ từ nào để tra phát âm chuẩn IPA và nghĩa tiếng Việt</span>
                  </p>

                  {currentDrill.translationVi && (
                    <div className="pt-4 border-t border-slate-800/80 flex items-start gap-2 text-sm sm:text-base text-slate-300 font-medium leading-relaxed">
                      <span className="text-purple-400 font-bold shrink-0">Bản dịch:</span>
                      <p className="italic">{currentDrill.translationVi}</p>
                    </div>
                  )}
                </div>

                {/* 2-column Linguistic insights */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4 mt-5">
                  <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 sm:p-4">
                    <span className="text-xs font-bold text-purple-400 uppercase tracking-wider block mb-1">
                      Trọng âm chính (Word Stress)
                    </span>
                    <p className="text-xs sm:text-sm font-mono font-bold text-slate-200">
                      {currentDrill.stressPattern || 'Nhấn mạnh các từ khóa mang thông tin chính'}
                    </p>
                  </div>

                  <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-3.5 sm:p-4">
                    <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider block mb-1">
                      Hiện tượng nối âm & Ngữ điệu (Connected Speech)
                    </span>
                    <p className="text-xs sm:text-sm text-slate-200">
                      {currentDrill.connectedSpeechNote || 'Lên giọng nhẹ ở mệnh đề phụ, hạ giọng ở cuối câu trần thuật.'}
                    </p>
                  </div>
                </div>

                <p className="text-center text-xs sm:text-sm text-slate-400 font-medium flex items-center justify-center gap-2 mt-4 select-none">
                  <span>✅</span>
                  <span>Đáp án trọn vẹn của câu • Đã làm nổi bật từ vựng học thuật & bản dịch tiếng Việt</span>
                </p>
              </div>
            )}

            {/* MODE 5: Đọc đồng thanh */}
            {activeMode === 'choral' && (
              <div className="relative w-full max-w-4xl mx-auto py-2 text-center">
                {/* 3-2-1 Lead-in Overlay when Looping */}
                {countdown321Step !== null && (
                  <div className="absolute inset-0 z-30 flex flex-col items-center justify-center bg-black/85 backdrop-blur-xs rounded-3xl animate-in fade-in zoom-in duration-200">
                    {countdown321Step > 0 ? (
                      <div className="text-center">
                        <div className="w-28 h-28 rounded-full bg-gradient-to-tr from-amber-500 to-purple-600 flex items-center justify-center shadow-2xl ring-8 ring-amber-400/30 mx-auto animate-pulse">
                          <span className="text-6xl font-black text-white font-mono">{countdown321Step}</span>
                        </div>
                        <p className="mt-4 text-base font-extrabold text-amber-300 uppercase tracking-widest">
                          Chuẩn bị đọc...
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

                <div className="bg-[#101426]/90 border-2 border-indigo-500/40 rounded-3xl p-6 sm:p-8 shadow-2xl">
                  {/* Choral Chunks with Interactive Word Click */}
                  <div className="text-xl sm:text-2xl md:text-3xl font-extrabold leading-relaxed tracking-tight text-white mb-2">
                    {choralChunks.map((chunk, cIdx) => {
                      const words = chunk.split(/(\s+)/);
                      return (
                        <span key={cIdx} className="inline-block mx-1.5 my-1">
                          <span className="text-purple-300 font-black px-3 py-1.5 bg-purple-950/60 rounded-xl border border-purple-500/30 inline-block shadow-xs">
                            {words.map((part, pIdx) => {
                              const clean = cleanWordKey(part);
                              if (!clean || /^\s+$/.test(part)) {
                                return <span key={pIdx}>{part}</span>;
                              }
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

                  <p className="text-[11px] text-purple-300/80 italic mb-5 select-none">
                    💡 Bấm trực tiếp vào từng từ trên câu để nghe phát âm IPA và tra nghĩa tiếng Việt
                  </p>

                  {/* Audio shadow controller */}
                  <div className="flex flex-wrap items-center justify-center gap-3 pt-5 border-t border-slate-800">
                    <button
                      type="button"
                      onClick={handlePlayCurrent}
                      className={`px-5 py-2.5 rounded-xl font-extrabold text-sm flex items-center gap-2 shadow-lg active:scale-95 transition-all cursor-pointer ${
                        isPlaying
                          ? 'bg-purple-700 hover:bg-purple-600 text-white ring-2 ring-purple-400/50 shadow-purple-700/30'
                          : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-600/30'
                      }`}
                    >
                      {isPlaying ? (
                        <Pause className="w-4 h-4 fill-current" />
                      ) : (
                        <Play className="w-4 h-4 fill-current" />
                      )}
                      <span>{isPlaying ? 'Tạm dừng / Đang phát' : 'Phát âm thanh câu này'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleLoop}
                      className={`px-4 py-2.5 rounded-xl border font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                        isLooping
                          ? 'bg-amber-600 border-amber-400 text-white shadow-md ring-2 ring-amber-400/50'
                          : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      <Repeat className="w-4 h-4" />
                      <span>
                        Lặp lại tự động {isLooping ? (loopCount > 0 ? `(Lần ${loopCount + 1})` : '(Bật)') : ''}
                      </span>
                    </button>

                    {/* 3-2-1 Lead-in Toggle */}
                    <button
                      type="button"
                      onClick={() => setEnable321LeadIn((prev) => !prev)}
                      className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                        enable321LeadIn
                          ? 'bg-purple-900/80 border-purple-500 text-purple-200 ring-1 ring-purple-400/40'
                          : 'bg-slate-800 border-slate-700 text-slate-400'
                      }`}
                      title="Bật/Tắt đếm nhịp 3-2-1 trước mỗi lần lặp lại"
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>Nhịp 3-2-1: {enable321LeadIn ? 'BẬT' : 'TẮT'}</span>
                    </button>

                    {/* Manual 3-2-1 Trigger */}
                    <button
                      type="button"
                      onClick={() => {
                        start321LeadIn(() => {
                          if (currentDrill) onPlaySegment(currentDrill.startSec, currentDrill.endSec);
                        });
                      }}
                      className="px-3 py-2 rounded-xl bg-indigo-900/60 hover:bg-indigo-800 border border-indigo-700/60 text-indigo-200 text-xs font-semibold cursor-pointer transition-colors"
                      title="Kích hoạt nhịp 3-2-1 ngay bây giờ"
                    >
                      ⚡ Đếm nhịp 3-2-1 vào câu
                    </button>

                    {/* Speed selector */}
                    {onChangeRate && (
                      <div className="inline-flex items-center bg-slate-800 p-0.5 rounded-lg border border-slate-700">
                        {[0.75, 0.85, 1.0].map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => onChangeRate(rate)}
                            className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all cursor-pointer ${
                              playbackRate === rate
                                ? 'bg-purple-600 text-white shadow-xs'
                                : 'text-slate-400 hover:text-white'
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Countdown Timer Widget for Choral Reading */}
                  <div className="mt-6 pt-5 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 bg-[#0B0F1C]/80 px-4 py-3 rounded-2xl border border-indigo-900/40">
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
                                  ? 'bg-purple-600 text-white'
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

                <p className="text-center text-xs sm:text-sm text-slate-400 font-medium flex items-center justify-center gap-2 mt-4 select-none">
                  <span>🗣️</span>
                  <span>Cả lớp cùng nhìn câu, nghe nhịp điệu audio và đọc to đồng thanh 2–3 lần</span>
                </p>
              </div>
            )}
          </div>

          {/* Bottom Row: Xem từ vựng trọng tâm câu này - Exactly matching user screenshot */}
          {focusVocabList.length > 0 && (
            <div className="flex justify-center mt-auto pt-3 shrink-0">
              <button
                type="button"
                onClick={() => setShowVocabSheet((prev) => !prev)}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-full bg-[#14122E] hover:bg-[#1E1A48] border border-purple-500/50 text-purple-200 text-xs sm:text-sm font-semibold transition-all shadow-xl hover:shadow-purple-500/25 active:scale-95 cursor-pointer"
              >
                <Bookmark className="w-4 h-4 text-purple-400 fill-purple-400/20" />
                <span>
                  Xem {focusVocabList.length} từ vựng trọng tâm câu này ({focusVocabList.map((v) => v.word).join(', ')})
                </span>
              </button>
            </div>
          )}
        </div>

        {/* Slide Bottom Bar Navigation: Prev / Next / Shortcuts */}
        <footer className="px-5 py-3 bg-[#0D1224] border-t border-slate-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-400 flex items-center gap-2 hidden sm:flex">
            <span>Phím tắt:</span>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">←</kbd>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">→</kbd>
            <span>đổi slide</span>
            <span className="text-slate-600">·</span>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">1-5</kbd>
            <span>đổi chế độ</span>
            <span className="text-slate-600">·</span>
            <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300 font-mono text-[10px]">Space</kbd>
            <span>phát câu</span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => setCurrentSlideIdx((prev) => (prev > 0 ? prev - 1 : drills.length - 1))}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              aria-label="Câu trước"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Câu trước</span>
            </button>

            <span className="text-xs font-mono font-bold px-3 py-1 bg-slate-800/80 rounded-lg text-slate-300 tabular-nums">
              {currentSlideIdx + 1} / {drills.length}
            </span>

            <button
              type="button"
              onClick={() => setCurrentSlideIdx((prev) => (prev < drills.length - 1 ? prev + 1 : 0))}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold rounded-lg transition-colors cursor-pointer"
              aria-label="Câu tiếp theo"
            >
              <span>Câu sau</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </footer>

        {/* Vocabulary Detail Popover Sheet */}
        {showVocabSheet && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="vocab-sheet-title"
            className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-fadeIn"
          >
            <div className="relative w-full max-w-lg bg-[#0F1426] border border-purple-500/40 rounded-3xl p-6 sm:p-7 shadow-2xl text-white">
              {/* Header */}
              <div className="flex items-center justify-between pb-3.5 border-b border-slate-800">
                <div className="flex items-center gap-2">
                  <Bookmark className="w-5 h-5 text-purple-400 fill-purple-400/20" />
                  <h3 id="vocab-sheet-title" className="text-base font-extrabold text-white">
                    Từ vựng trọng tâm trong câu
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setShowVocabSheet(false)}
                  className="p-1 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg cursor-pointer"
                  aria-label="Đóng bảng từ vựng"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Vocab Items List */}
              <div className="mt-4 space-y-3.5 max-h-[55vh] overflow-y-auto pr-1">
                {focusVocabList.map((vocab, vIdx) => (
                  <div
                    key={vIdx}
                    className="bg-[#14192E] border border-slate-800/90 rounded-2xl p-4 shadow-md"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex flex-wrap items-baseline gap-2">
                        <span className="text-xl sm:text-2xl font-black text-purple-300 tracking-tight">
                          {vocab.word}
                        </span>
                        {vocab.ipa && (
                          <span className="font-mono text-xs sm:text-sm text-slate-400 font-medium">
                            {vocab.ipa}
                          </span>
                        )}
                        {vocab.pos && (
                          <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-purple-950/90 border border-purple-800 text-purple-300">
                            {vocab.pos}
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => speakWord(vocab.word)}
                        className="p-2 rounded-xl bg-purple-900/60 hover:bg-purple-800 text-purple-200 border border-purple-700/60 transition-colors cursor-pointer"
                        title="Nghe phát âm từ này"
                      >
                        <Volume2 className="w-4 h-4" />
                      </button>
                    </div>

                    {vocab.meaningVi && (
                      <div className="mt-2.5 text-xs sm:text-sm text-slate-200 font-medium leading-relaxed bg-slate-900/70 p-2.5 rounded-xl border border-slate-800">
                        <span className="text-purple-400 font-bold">Nghĩa tiếng Việt: </span>
                        {vocab.meaningVi}
                      </div>
                    )}

                    {vocab.collocations && vocab.collocations.length > 0 && (
                      <div className="mt-2.5 text-xs text-slate-300">
                        <span className="text-slate-400 font-bold block mb-1">Cụm kết hợp hay (Collocations):</span>
                        <div className="flex flex-wrap gap-1.5">
                          {vocab.collocations.map((c, cIdx) => (
                            <span
                              key={cIdx}
                              className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]"
                            >
                              {c}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {vocab.example && (
                      <div className="mt-2.5 text-[11px] italic text-slate-400">
                        "{vocab.example}"
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Close Button */}
              <div className="mt-5 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowVocabSheet(false)}
                  className="px-5 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors cursor-pointer"
                >
                  Đã hiểu
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Interactive Dictionary & IPA Modal Popover */}
        {(selectedDictWord || isLookingUpWord) && (
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="dict-modal-title"
            className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xs animate-fadeIn"
            onClick={() => {
              if (!isLookingUpWord) setSelectedDictWord(null);
            }}
          >
            <div
              className="relative w-full max-w-md bg-[#0F1426] border-2 border-purple-500/50 rounded-3xl p-6 shadow-2xl text-white animate-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {isLookingUpWord ? (
                <div className="py-12 flex flex-col items-center justify-center gap-3 text-center">
                  <Loader2 className="w-8 h-8 text-purple-400 animate-spin" />
                  <p className="text-sm font-semibold text-purple-200">Đang tra từ điển & phiên âm IPA...</p>
                </div>
              ) : selectedDictWord ? (
                <>
                  {/* Header */}
                  <div className="flex items-start justify-between pb-3.5 border-b border-slate-800">
                    <div className="flex items-center gap-2">
                      <BookOpen className="w-5 h-5 text-purple-400" />
                      <span className="text-xs font-bold uppercase tracking-wider text-purple-300">
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

                  {/* Word title & IPA pronunciation */}
                  <div className="mt-4">
                    <div className="flex flex-wrap items-baseline gap-2.5">
                      <h3 id="dict-modal-title" className="text-2xl sm:text-3xl font-black text-white tracking-tight">
                        {selectedDictWord.word}
                      </h3>
                      {selectedDictWord.pos && (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-extrabold uppercase bg-purple-950 text-purple-300 border border-purple-800">
                          {selectedDictWord.pos}
                        </span>
                      )}
                    </div>

                    {/* Pronunciation buttons: UK & US */}
                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {selectedDictWord.ipaUk && (
                        <button
                          type="button"
                          onClick={() => speakWordPronunciation(selectedDictWord.word, 'en-GB')}
                          className="px-3 py-1.5 rounded-xl bg-purple-950/80 hover:bg-purple-900 border border-purple-700/60 text-purple-200 text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                          title="Nghe phát âm chuẩn Anh - Anh (UK)"
                        >
                          <Volume2 className="w-3.5 h-3.5 text-purple-400" />
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

                  {/* Contextual Vietnamese Meaning */}
                  <div className="mt-4 p-3.5 rounded-2xl bg-[#151B33] border border-slate-800">
                    <div className="text-xs font-bold text-amber-400 uppercase tracking-wide mb-1 flex items-center gap-1.5">
                      <span>🇻🇳 Nghĩa tiếng Việt sát ngữ cảnh:</span>
                    </div>
                    <p className="text-sm font-semibold text-slate-100 leading-snug">
                      {selectedDictWord.contextualMeaningVi || selectedDictWord.meaningVi}
                    </p>
                  </div>

                  {/* English definition if available */}
                  {selectedDictWord.definitionEn && (
                    <div className="mt-2.5 p-3 rounded-xl bg-slate-900/60 border border-slate-800/80 text-xs text-slate-300">
                      <span className="text-purple-400 font-bold block mb-0.5">English Definition:</span>
                      <p className="italic">{selectedDictWord.definitionEn}</p>
                    </div>
                  )}

                  {/* Actions: Save to Flashcards / Close */}
                  <div className="mt-5 pt-3.5 border-t border-slate-800 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => handleSaveToFlashcards(selectedDictWord)}
                      className={`px-4 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                        flashcardSavedSuccess
                          ? 'bg-emerald-700 text-emerald-100 border border-emerald-500'
                          : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white shadow-md'
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
