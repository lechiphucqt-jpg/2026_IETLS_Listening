import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Eye,
  EyeOff,
  FileDown,
  HelpCircle,
  Loader2,
  Mic,
  MonitorPlay,
  Play,
  Presentation,
  Repeat,
  RotateCcw,
  Sparkles,
  Square,
  Volume2,
  XCircle,
} from 'lucide-react';
import type { ClassroomDrillSentence, ListeningTestPack } from '../types/ielts';
import { AudioSegmentTimeAdjuster } from './AudioSegmentTimeAdjuster';
import { exportDictationWorksheetDocx } from '../utils/docxExport';
import { exportDictationSlidesPptx } from '../utils/pptxExport';
import { ClassroomSlideModal } from './ClassroomSlideModal';

export type PracticeModeTab = 'classroom' | 'intensive' | 'shadowing';

interface AdvancedPracticeStudioProps {
  testPack: ListeningTestPack;
  initialTab: PracticeModeTab;
  focusTimestampSec: number | null;
  currentTime?: number;
  onPlaySegment: (startSec: number, endSec?: number) => void;
  isPlaying: boolean;
  playbackRate: number;
  onChangeRate: (rate: number) => void;
  onExtractClassroomDrills: (count: number) => Promise<ClassroomDrillSentence[]>;
  onUpdateClassroomDrillTime?: (drillId: string, startSec: number, endSec: number) => void;
  onUpdateSegmentTime?: (segmentId: string, startSec: number, endSec: number) => void;
}

interface WordDiffToken {
  expected: string;
  actual?: string;
  matched: boolean;
}

function normalizeToken(w: string): string {
  return w
    .toLowerCase()
    .replace(/[.,!?;:"“”()—–-]/g, '')
    .replace(/’/g, "'")
    .trim();
}

function evaluateDictation(
  expectedSentence: string,
  userInput: string
): { tokens: WordDiffToken[]; correctCount: number; totalCount: number; percent: number } {
  const expectedWords = expectedSentence
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);
  const actualWords = userInput
    .split(/\s+/)
    .map((w) => w.trim())
    .filter(Boolean);

  // Use simple aligned/LCS-friendly matching with a small lookahead window
  const tokens: WordDiffToken[] = [];
  let j = 0;
  let correctCount = 0;

  for (let i = 0; i < expectedWords.length; i++) {
    const expRaw = expectedWords[i];
    const expNorm = normalizeToken(expRaw);
    let matchedIdx = -1;

    for (let look = j; look < Math.min(actualWords.length, j + 3); look++) {
      if (normalizeToken(actualWords[look]) === expNorm && expNorm.length > 0) {
        matchedIdx = look;
        break;
      }
    }

    if (matchedIdx !== -1) {
      tokens.push({ expected: expRaw, actual: actualWords[matchedIdx], matched: true });
      correctCount++;
      j = matchedIdx + 1;
    } else {
      const actualFallback = j < actualWords.length ? actualWords[j] : undefined;
      tokens.push({ expected: expRaw, actual: actualFallback, matched: false });
      if (j < actualWords.length) j++;
    }
  }

  const totalCount = expectedWords.length;
  const percent = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  return { tokens, correctCount, totalCount, percent };
}

function buildLetterMask(sentence: string): string {
  return sentence
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s+$/.test(part)) return part;
      const chars = Array.from(part);
      let seenFirstAlpha = false;
      return chars
        .map((ch) => {
          if (/[A-Za-z0-9]/.test(ch)) {
            if (!seenFirstAlpha) {
              seenFirstAlpha = true;
              return ch;
            }
            return '_';
          }
          return ch;
        })
        .join('');
    })
    .join('');
}

export const AdvancedPracticeStudio: React.FC<AdvancedPracticeStudioProps> = ({
  testPack,
  initialTab,
  focusTimestampSec,
  currentTime,
  onPlaySegment,
  isPlaying,
  playbackRate,
  onChangeRate,
  onExtractClassroomDrills,
  onUpdateClassroomDrillTime,
  onUpdateSegmentTime,
}) => {
  const [activeTab, setActiveTab] = useState<PracticeModeTab>(initialTab);
  const [editingSheetDrillId, setEditingSheetDrillId] = useState<string | null>(null);

  // Classroom Dictation & Shadowing (10-15 best sentences) state
  const classroomDrills = useMemo(
    () => testPack.classroomDrills || [],
    [testPack.classroomDrills]
  );
  const [selectedClassroomIdx, setSelectedClassroomIdx] = useState(0);
  const [classroomLayout, setClassroomLayout] = useState<'interactive' | 'sheet'>('interactive');
  const [extractCount, setExtractCount] = useState<number>(12);
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractError, setExtractError] = useState<string | null>(null);
  const [dictationById, setDictationById] = useState<Record<string, string>>({});
  const [checkedById, setCheckedById] = useState<Record<string, boolean>>({});
  const [hintMode, setHintMode] = useState<'blind' | 'mask' | 'reveal'>('blind');
  const [loopSentence, setLoopSentence] = useState(false);
  const [copiedSheet, setCopiedSheet] = useState(false);
  const [isSlideModalOpen, setIsSlideModalOpen] = useState(false);

  // Sync tab or segment focus when launched from Part 5 Action Plan
  const [selectedDrillIdx, setSelectedDrillIdx] = useState(0);
  const [selectedSegIdx, setSelectedSegIdx] = useState(0);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (focusTimestampSec === null) return;
    if (testPack.intensiveDrills.length > 0) {
      let bestDrillIdx = 0;
      let minDist = Infinity;
      testPack.intensiveDrills.forEach((d, idx) => {
        const dist = Math.abs(d.startSec - focusTimestampSec);
        if (dist < minDist) {
          minDist = dist;
          bestDrillIdx = idx;
        }
      });
      setSelectedDrillIdx(bestDrillIdx);
    }

    if (testPack.segments.length > 0) {
      let bestSegIdx = 0;
      let minDist = Infinity;
      testPack.segments.forEach((s, idx) => {
        const dist = Math.abs(s.startSec - focusTimestampSec);
        if (dist < minDist) {
          minDist = dist;
          bestSegIdx = idx;
        }
      });
      setSelectedSegIdx(bestSegIdx);
    }
  }, [focusTimestampSec, testPack]);

  // Reset state when switching testPack
  useEffect(() => {
    setSelectedClassroomIdx(0);
    setSelectedDrillIdx(0);
    setSelectedSegIdx(0);
    setDrillInputs({});
    setShowHints({});
    setDrillChecked(false);
    setRevealFullScript(false);
    setDictationById({});
    setCheckedById({});
    setHintMode('blind');
    setLoopSentence(false);
    setExtractError(null);
  }, [testPack.id]);

  // Intensive Listening State
  const [drillInputs, setDrillInputs] = useState<Record<number, string>>({});
  const [showHints, setShowHints] = useState<Record<number, 'context' | 'mask' | null>>({});
  const [drillChecked, setDrillChecked] = useState(false);
  const [revealFullScript, setRevealFullScript] = useState(false);

  const currentClassroom =
    classroomDrills[selectedClassroomIdx] || classroomDrills[0];
  const currentDrill = testPack.intensiveDrills[selectedDrillIdx];
  const currentSegment = testPack.segments[selectedSegIdx] || testPack.segments[0];

  // Auto-loop playback for active classroom sentence
  const wasPlayingRef = useRef(false);
  useEffect(() => {
    if (activeTab !== 'classroom' || !loopSentence || !currentClassroom) {
      wasPlayingRef.current = isPlaying;
      return;
    }
    if (wasPlayingRef.current && !isPlaying) {
      const timer = window.setTimeout(() => {
        onPlaySegment(currentClassroom.startSec, currentClassroom.endSec);
      }, 750);
      wasPlayingRef.current = isPlaying;
      return () => window.clearTimeout(timer);
    }
    wasPlayingRef.current = isPlaying;
  }, [isPlaying, loopSentence, activeTab, currentClassroom, onPlaySegment]);

  // Shadowing Mic Recording & Waveform State (shared across Classroom & Shadowing Studio)
  const [isRecording, setIsRecording] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [recordedAudioUrl, setRecordedAudioUrl] = useState<string | null>(null);
  const [userPeaks, setUserPeaks] = useState<number[]>([]);

  const refCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const userCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const liveSamplesRef = useRef<number[]>([]);

  const activeWaveformText =
    activeTab === 'classroom'
      ? currentClassroom?.sentence || ''
      : currentSegment?.text || '';

  // Draw Reference Waveform
  useEffect(() => {
    const canvas = refCanvasRef.current;
    if (!canvas || !activeWaveformText) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    const bars = 64;
    const slot = w / bars;
    const words = activeWaveformText.split(' ');
    for (let i = 0; i < bars; i++) {
      const word = words[Math.floor((i / bars) * words.length)] || '';
      const energy = Math.min(
        1,
        0.25 + ((word.length % 7) / 10) + Math.abs(Math.sin(i * 0.85)) * 0.45
      );
      const bh = Math.max(6, energy * (h - 14));
      const y = (h - bh) / 2;
      ctx.fillStyle = '#0F2744';
      ctx.beginPath();
      ctx.roundRect(i * slot, y, Math.max(2, slot * 0.6), bh, 2);
      ctx.fill();
    }
  }, [activeWaveformText, activeTab, classroomLayout]);

  // Draw User Recorded Waveform
  useEffect(() => {
    const canvas = userCanvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);

    if (userPeaks.length === 0) return;
    const slot = w / userPeaks.length;
    userPeaks.forEach((amp, i) => {
      const bh = Math.max(4, amp * (h - 14));
      const y = (h - bh) / 2;
      ctx.fillStyle = '#059669';
      ctx.beginPath();
      ctx.roundRect(i * slot, y, Math.max(2, slot * 0.6), bh, 2);
      ctx.fill();
    });
  }, [userPeaks, activeTab, classroomLayout]);

  const stopRecording = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setIsRecording(false);
  };

  useEffect(() => {
    return () => {
      stopRecording();
    };
  }, []);

  const startRecording = async () => {
    setMicError(null);
    if (recordedAudioUrl) {
      URL.revokeObjectURL(recordedAudioUrl);
      setRecordedAudioUrl(null);
    }
    liveSamplesRef.current = [];
    setUserPeaks([]);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      const source = audioCtx.createMediaStreamSource(stream);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      const dataArray = new Uint8Array(analyser.frequencyBinCount);
      const sampleLoop = () => {
        analyser.getByteTimeDomainData(dataArray);
        let peak = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const val = Math.abs(dataArray[i] - 128) / 128;
          if (val > peak) peak = val;
        }
        const normalized = Math.max(0.08, Math.min(1, peak * 2.4));
        liveSamplesRef.current.push(normalized);
        if (liveSamplesRef.current.length > 64) {
          liveSamplesRef.current = liveSamplesRef.current.slice(-64);
        }
        setUserPeaks([...liveSamplesRef.current]);
        rafRef.current = requestAnimationFrame(sampleLoop);
      };
      rafRef.current = requestAnimationFrame(sampleLoop);

      const chunks: Blob[] = [];
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (ev) => {
        if (ev.data.size > 0) chunks.push(ev.data);
      };
      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const url = URL.createObjectURL(blob);
        setRecordedAudioUrl(url);
        audioCtx.close().catch(() => {});
      };

      recorder.start();
      setIsRecording(true);
    } catch {
      setMicError(
        'Không thể truy cập micro. Vui lòng cấp quyền Microphone trong trình duyệt để thu âm đối chiếu sóng âm.'
      );
      setIsRecording(false);
    }
  };

  const autoExtractedIdsRef = useRef<Set<string>>(new Set());

  const handleTriggerExtract = async () => {
    setIsExtracting(true);
    setExtractError(null);
    try {
      await onExtractClassroomDrills(extractCount);
      setSelectedClassroomIdx(0);
      setDictationById({});
      setCheckedById({});
      setHintMode('blind');
    } catch (err: unknown) {
      setExtractError(
        err instanceof Error ? err.message : 'Không thể trích xuất bộ câu luyện tập từ bài.'
      );
    } finally {
      setIsExtracting(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'classroom' || testPack.segments.length === 0 || isExtracting) return;
    const hasCollapsedDrills =
      classroomDrills.length > 1 &&
      classroomDrills.filter((d) => d.startSec <= 0.05).length >
        Math.max(1, Math.floor(classroomDrills.length * 0.5));
    const needsAutoExtract = classroomDrills.length === 0 || hasCollapsedDrills;
    if (!needsAutoExtract) return;

    const guardKey = `${testPack.id}:${hasCollapsedDrills ? 'resync' : 'init'}`;
    if (autoExtractedIdsRef.current.has(guardKey)) return;
    autoExtractedIdsRef.current.add(guardKey);

    void handleTriggerExtract();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, testPack.id, testPack.segments.length, classroomDrills.length]);

  const handleCopyClassroomSheet = async () => {
    const lines = classroomDrills.map(
      (d) =>
        `${d.order}. ${d.timestampLabel} [${d.speaker}]\nEN: ${d.sentence}\nVI: ${d.translationVi}\nTrọng âm: ${d.stressPattern}\nNối âm: ${d.connectedSpeechNote}\n`
    );
    const payload = `BỘ ${classroomDrills.length} CÂU DICTATION & SHADOWING — ${testPack.title} (${testPack.partLabel})\n\n${lines.join('\n')}`;
    try {
      await navigator.clipboard.writeText(payload);
      setCopiedSheet(true);
      window.setTimeout(() => setCopiedSheet(false), 2200);
    } catch {
      // ignore clipboard errors
    }
  };

  const classroomEval = useMemo(() => {
    if (!currentClassroom) return null;
    const isChecked = Boolean(checkedById[currentClassroom.id]);
    if (!isChecked) return null;
    return evaluateDictation(
      currentClassroom.sentence,
      dictationById[currentClassroom.id] || ''
    );
  }, [currentClassroom, checkedById, dictationById]);

  const completedCount = useMemo(() => {
    return classroomDrills.filter((d) => Boolean(checkedById[d.id])).length;
  }, [classroomDrills, checkedById]);

  const renderBlankSentence = () => {
    if (!currentDrill) return null;
    const parts = currentDrill.sentenceWithBlanks.split('___');
    return (
      <div className="text-base text-slate-900 leading-loose">
        {parts.map((part, idx) => {
          const phrase = currentDrill.missingPhrases[idx];
          const userVal = drillInputs[idx] || '';
          const isCorrect =
            drillChecked &&
            phrase &&
            userVal.trim().toLowerCase() === phrase.answer.trim().toLowerCase();

          return (
            <React.Fragment key={idx}>
              <span>{part}</span>
              {idx < parts.length - 1 && phrase && (
                <span className="inline-flex flex-col align-middle mx-1.5 my-1">
                  <input
                    type="text"
                    value={userVal}
                    onChange={(e) => {
                      setDrillChecked(false);
                      setDrillInputs((prev) => ({ ...prev, [idx]: e.target.value }));
                    }}
                    placeholder={`Chỗ trống ${idx + 1}`}
                    aria-label={`Ô điền từ ${idx + 1}`}
                    className={`w-44 px-3 py-1 text-sm font-medium rounded-md border outline-none transition-colors ${
                      !drillChecked
                        ? 'bg-white border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20'
                        : isCorrect
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                          : 'bg-red-50 border-red-400 text-red-900'
                    }`}
                  />
                  {drillChecked && !isCorrect && (
                    <span className="text-[11px] font-semibold text-emerald-700 mt-0.5">
                      Đáp án: {phrase.answer}
                    </span>
                  )}
                </span>
              )}
            </React.Fragment>
          );
        })}
      </div>
    );
  };

  return (
    <div className="max-w-[1280px] mx-auto px-6 py-8 space-y-6">
      {/* Studio Header & Mode Segmented Switch */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs font-bold text-[#0F2744]">
            Luyện tập Chuyên sâu · {testPack.partLabel} · {testPack.title}
          </p>
          <h1 className="text-2xl font-bold text-[#0F2744] mt-1 text-balance">
            {activeTab === 'classroom'
              ? 'Dictation & Shadowing Lớp học (10–15 câu đắt giá nhất)'
              : activeTab === 'intensive'
                ? 'Intensive Listening (Nghe chép & Nối âm)'
                : 'Shadowing Studio (Ngữ điệu & Đối chiếu sóng âm)'}
          </h1>
        </div>

        <div
          role="tablist"
          aria-label="Chế độ luyện tập chuyên sâu"
          className="flex items-center gap-1 p-1 bg-slate-100 border border-slate-200 rounded-xl overflow-x-auto shadow-xs"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'classroom'}
            onClick={() => setActiveTab('classroom')}
            className={`px-3.5 py-2 text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'classroom'
                ? 'bg-[#0F2744] text-white font-bold shadow-xs'
                : 'text-slate-700 hover:text-slate-900 font-medium'
            }`}
          >
            Dictation & Shadowing ({classroomDrills.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'intensive'}
            onClick={() => setActiveTab('intensive')}
            className={`px-3.5 py-2 text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'intensive'
                ? 'bg-[#0F2744] text-white font-bold shadow-xs'
                : 'text-slate-700 hover:text-slate-900 font-medium'
            }`}
          >
            Intensive Listening
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'shadowing'}
            onClick={() => setActiveTab('shadowing')}
            className={`px-3.5 py-2 text-xs rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              activeTab === 'shadowing'
                ? 'bg-[#0F2744] text-white font-bold shadow-xs'
                : 'text-slate-700 hover:text-slate-900 font-medium'
            }`}
          >
            Shadowing Studio
          </button>
        </div>
      </div>

      {activeTab === 'classroom' && (
        <div className="space-y-6">
          {/* Classroom Control Strip */}
          <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <div
                role="group"
                aria-label="Chế độ hiển thị lớp học"
                className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
              >
                <button
                  type="button"
                  onClick={() => setClassroomLayout('interactive')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                    classroomLayout === 'interactive'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Luyện từng câu
                </button>
                <button
                  type="button"
                  onClick={() => setClassroomLayout('sheet')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
                    classroomLayout === 'sheet'
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Bảng 10–15 câu cho lớp
                </button>
              </div>

              <span className="text-xs text-slate-500 tabular-nums">
                Đã kiểm tra {completedCount}/{classroomDrills.length} câu
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <label htmlFor="classroom-count-select" className="text-xs text-slate-600 font-medium">
                Số câu trích:
              </label>
              <select
                id="classroom-count-select"
                value={extractCount}
                onChange={(e) => setExtractCount(Number(e.target.value))}
                className="text-xs font-medium text-slate-800 bg-slate-50 border border-slate-300 rounded-lg px-2.5 py-1.5 outline-none"
              >
                <option value={10}>10 câu</option>
                <option value={12}>12 câu</option>
                <option value={15}>15 câu</option>
                <option value={30}>Tất cả câu trong bài</option>
              </select>

              <button
                type="button"
                onClick={handleTriggerExtract}
                disabled={isExtracting}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 shadow-xs"
              >
                {isExtracting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    {extractCount >= 25
                      ? 'Đang tách tất cả câu từ Audio...'
                      : `Đang tách ${extractCount} câu chuẩn xác...`}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    {extractCount >= 25
                      ? 'Tách toàn bộ câu (AI)'
                      : classroomDrills.length > 0
                        ? `Trích lại ${extractCount} câu hay nhất (AI)`
                        : `Trích ${extractCount} câu hay nhất (AI)`}
                  </>
                )}
              </button>

              {classroomDrills.length > 0 && (
                <>
                  <button
                    type="button"
                    onClick={() => setIsSlideModalOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 hover:bg-indigo-100 rounded-lg whitespace-nowrap shrink-0 cursor-pointer shadow-xs"
                    title="Mở chế độ trình chiếu Slide 16:9 cho lớp học với âm thanh và phím tắt"
                  >
                    <MonitorPlay className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
                    Trình chiếu Slide (16:9)
                  </button>

                  <button
                    type="button"
                    onClick={() => exportDictationWorksheetDocx(testPack, classroomDrills)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                    title="Xuất phiếu bài tập đục lỗ cho học sinh & đáp án ra Word (.doc / .docx)"
                  >
                    <FileDown className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                    Xuất bài tập Word (.docx)
                  </button>

                  <button
                    type="button"
                    onClick={() => exportDictationSlidesPptx(testPack, classroomDrills)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                    title="Xuất Slide bài giảng PowerPoint 16:9 (.pptx)"
                  >
                    <Presentation className="w-3.5 h-3.5 text-amber-600" aria-hidden="true" />
                    Xuất Slide (.pptx)
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyClassroomSheet}
                    className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {copiedSheet ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                        Đã sao chép
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        Sao chép giáo án
                      </>
                    )}
                  </button>
                </>
              )}
            </div>
          </div>

          {extractError && (
            <div
              role="alert"
              className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm"
            >
              {extractError}
            </div>
          )}

          {classroomDrills.length === 0 ? (
            <div className="bg-white border border-slate-200 rounded-xl p-10 text-center space-y-3">
              <p className="text-base font-bold text-slate-900">
                Bài nghe này chưa có danh sách 10–15 câu Dictation & Shadowing
              </p>
              <p className="text-sm text-slate-600 max-w-lg mx-auto leading-relaxed">
                Nhấn nút <strong>Trích {extractCount} câu hay nhất (AI)</strong> phía trên để hệ thống tự động chọn lọc 10–15 câu giàu cấu trúc IELTS, bẫy thông tin và hiện tượng nối âm phục vụ luyện tại lớp.
              </p>
            </div>
          ) : classroomLayout === 'sheet' ? (
            /* Classroom Overview Table (All 10-15 sentences for teacher / class projection) */
            <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="text-base font-bold text-slate-900">
                    Bộ {classroomDrills.length} câu Dictation & Shadowing chọn lọc — {testPack.title}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Giáo viên có thể phát từng câu tại lớp, cho học sinh chép chính tả hoặc đọc nhại theo trọng âm & nối âm
                  </p>
                </div>
              </div>

              <div className="divide-y divide-slate-200">
                {classroomDrills.map((item, idx) => (
                  <div key={item.id} className="divide-y divide-slate-100">
                    <div
                      className="p-5 hover:bg-slate-50/60 flex flex-col md:flex-row md:items-start justify-between gap-4"
                    >
                      <div className="space-y-1.5 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                          <span className="font-mono font-bold text-slate-900 tabular-nums">
                            Câu {String(item.order).padStart(2, '0')}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="font-semibold text-slate-700">{item.speaker}</span>
                          <span aria-hidden="true">·</span>
                          <span className="font-mono text-blue-700">{item.timestampLabel}</span>
                          {item.keyWords.length > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Từ khóa: {item.keyWords.join(', ')}</span>
                            </>
                          )}
                        </div>
                        <p className="text-[15px] font-semibold text-slate-900 leading-relaxed">
                          {item.sentence}
                        </p>
                        <p className="text-xs text-slate-600">{item.translationVi}</p>
                        <div className="text-xs text-slate-600 pt-1 flex flex-wrap gap-x-5 gap-y-1">
                          <span>
                            <strong className="text-slate-700">Lý do chọn:</strong> {item.selectionReasonVi}
                          </span>
                          {item.stressPattern && (
                            <span className="font-mono">
                              <strong className="font-sans text-slate-700">Trọng âm:</strong> {item.stressPattern}
                            </span>
                          )}
                          {item.connectedSpeechNote && (
                            <span>
                              <strong className="text-slate-700">Nối âm:</strong> {item.connectedSpeechNote}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => onPlaySegment(item.startSec, item.endSec)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-md whitespace-nowrap cursor-pointer shadow-xs transition-colors"
                        >
                          <Play className="w-3 h-3" aria-hidden="true" />
                          Nghe
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingSheetDrillId((prev) => (prev === item.id ? null : item.id));
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer border ${
                            editingSheetDrillId === item.id
                              ? 'bg-slate-900 text-white border-slate-900'
                              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                          }`}
                        >
                          {editingSheetDrillId === item.id ? 'Đóng mốc' : 'Chỉnh mốc'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedClassroomIdx(idx);
                            setClassroomLayout('interactive');
                          }}
                          className="px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md whitespace-nowrap cursor-pointer"
                        >
                          Luyện câu này
                        </button>
                      </div>
                    </div>

                    {editingSheetDrillId === item.id && (
                      <div className="p-4 bg-slate-50/90 border-t border-slate-200">
                        <AudioSegmentTimeAdjuster
                          label={`Chỉnh mốc Câu ${String(item.order).padStart(2, '0')}`}
                          startSec={item.startSec}
                          endSec={item.endSec}
                          currentTime={currentTime}
                          maxDuration={testPack.durationSec}
                          isPlaying={isPlaying}
                          defaultExpanded={true}
                          onChangeTime={(newStart, newEnd) => {
                            onUpdateClassroomDrillTime?.(item.id, newStart, newEnd);
                          }}
                          onPlaySegment={(start, end) => {
                            onPlaySegment(start, end ?? undefined);
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ) : (
            /* Two-Zone Interactive Sandbox: Left List (10-15 sentences) + Right Dictation & Shadowing Stage */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Sidebar: 10-15 Sentences Selector */}
              <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
                <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between">
                  <h2 className="text-sm font-bold text-slate-900">
                    Danh sách {classroomDrills.length} câu chọn lọc
                  </h2>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {selectedClassroomIdx + 1}/{classroomDrills.length}
                  </span>
                </div>

                <div className="max-h-[680px] overflow-y-auto divide-y divide-slate-200">
                  {classroomDrills.map((item, idx) => {
                    const isSelected = idx === selectedClassroomIdx;
                    const isDone = Boolean(checkedById[item.id]);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSelectedClassroomIdx(idx);
                          setLoopSentence(false);
                        }}
                        className={`w-full text-left p-4 transition-colors cursor-pointer ${
                          isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between text-xs mb-1">
                          <span className="font-semibold text-slate-900 flex items-center gap-1.5 tabular-nums">
                            {isDone && (
                              <CheckCircle2
                                className="w-3.5 h-3.5 text-emerald-600 shrink-0"
                                aria-hidden="true"
                              />
                            )}
                            Câu {String(item.order).padStart(2, '0')} · {item.speaker}
                          </span>
                          <span className="font-mono text-blue-700 font-semibold tabular-nums">
                            {item.timestampLabel}
                          </span>
                        </div>
                        <p className="text-xs text-slate-600 line-clamp-2 leading-relaxed">
                          {hintMode === 'reveal' || isDone
                            ? item.sentence
                            : item.selectionReasonVi}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Right Interactive Dictation + Shadowing Stage */}
              {currentClassroom && (
                <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
                  {/* Audio Playback, Loop & Speed Controls */}
                  <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        onClick={() =>
                          onPlaySegment(currentClassroom.startSec, currentClassroom.endSec)
                        }
                        className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-lg whitespace-nowrap shrink-0 cursor-pointer shadow-xs transition-colors"
                      >
                        <Play className="w-3.5 h-3.5" aria-hidden="true" />
                        Nghe câu {String(currentClassroom.order).padStart(2, '0')} ({currentClassroom.timestampLabel})
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const next = !loopSentence;
                          setLoopSentence(next);
                          if (next && !isPlaying) {
                            onPlaySegment(currentClassroom.startSec, currentClassroom.endSec);
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border whitespace-nowrap shrink-0 cursor-pointer ${
                          loopSentence
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <Repeat className="w-3.5 h-3.5" aria-hidden="true" />
                        {loopSentence ? 'Đang lặp lại câu' : 'Lặp lại câu'}
                      </button>

                      <div
                        role="group"
                        aria-label="Tốc độ nghe"
                        className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
                      >
                        {[0.75, 0.8, 1.0, 1.2].map((rate) => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => onChangeRate(rate)}
                            className={`px-2 py-1 text-xs font-mono font-medium rounded whitespace-nowrap cursor-pointer tabular-nums ${
                              Math.abs(playbackRate - rate) < 0.03
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            {rate}x
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          setLoopSentence(false);
                          setSelectedClassroomIdx((prev) =>
                            prev > 0 ? prev - 1 : classroomDrills.length - 1
                          );
                        }}
                        aria-label="Câu trước"
                        className="p-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setLoopSentence(false);
                          setSelectedClassroomIdx(
                            (prev) => (prev + 1) % classroomDrills.length
                          );
                        }}
                        aria-label="Câu tiếp theo"
                        className="p-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Điều chỉnh thời gian bắt đầu và kết thúc cho câu Dictation & Shadowing này */}
                  <AudioSegmentTimeAdjuster
                    label={`Mốc nghe Câu ${String(currentClassroom.order).padStart(2, '0')}`}
                    startSec={currentClassroom.startSec}
                    endSec={currentClassroom.endSec}
                    currentTime={currentTime}
                    maxDuration={testPack.durationSec}
                    isPlaying={isPlaying}
                    onChangeTime={(newStart, newEnd) => {
                      onUpdateClassroomDrillTime?.(currentClassroom.id, newStart, newEnd);
                    }}
                    onPlaySegment={(start, end) => {
                      onPlaySegment(start, end ?? undefined);
                    }}
                  />

                  {/* Step 1: Dictation Practice */}
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-slate-900">
                          Bước 1: Dictation — Nghe và chép lại nguyên văn câu
                        </h3>
                        <p className="text-xs text-slate-500 mt-0.5">
                          Lý do chọn: {currentClassroom.selectionReasonVi}
                        </p>
                      </div>

                      <div
                        role="group"
                        aria-label="Mức độ gợi ý Dictation"
                        className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
                      >
                        <button
                          type="button"
                          onClick={() => setHintMode('blind')}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                            hintMode === 'blind'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Ẩn chữ
                        </button>
                        <button
                          type="button"
                          onClick={() => setHintMode('mask')}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                            hintMode === 'mask'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Chữ cái đầu
                        </button>
                        <button
                          type="button"
                          onClick={() => setHintMode('reveal')}
                          className={`px-2.5 py-1 text-xs font-medium rounded-md whitespace-nowrap cursor-pointer ${
                            hintMode === 'reveal'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Hiện câu gốc
                        </button>
                      </div>
                    </div>

                    {hintMode === 'mask' && (
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg font-mono text-xs text-slate-700 leading-relaxed tracking-wide">
                        {buildLetterMask(currentClassroom.sentence)}
                      </div>
                    )}

                    {hintMode === 'reveal' && (
                      <div className="p-4 bg-blue-50/60 border border-blue-200 rounded-lg space-y-1">
                        <p className="text-sm font-semibold text-slate-900 leading-relaxed">
                          “{currentClassroom.sentence}”
                        </p>
                        <p className="text-xs text-slate-600">
                          {currentClassroom.translationVi}
                        </p>
                      </div>
                    )}

                    <textarea
                      rows={3}
                      value={dictationById[currentClassroom.id] || ''}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDictationById((prev) => ({
                          ...prev,
                          [currentClassroom.id]: val,
                        }));
                        setCheckedById((prev) => ({
                          ...prev,
                          [currentClassroom.id]: false,
                        }));
                      }}
                      placeholder="Gõ chính xác từng từ bạn nghe được trong câu này..."
                      className="w-full text-sm text-slate-900 bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-lg p-3.5 outline-none"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <button
                          type="button"
                          onClick={() =>
                            setCheckedById((prev) => ({
                              ...prev,
                              [currentClassroom.id]: true,
                            }))
                          }
                          className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg whitespace-nowrap cursor-pointer"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                          Kiểm tra Dictation
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setDictationById((prev) => ({
                              ...prev,
                              [currentClassroom.id]: '',
                            }));
                            setCheckedById((prev) => ({
                              ...prev,
                              [currentClassroom.id]: false,
                            }));
                          }}
                          className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                        >
                          <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                          Xóa & Nghe lại
                        </button>
                      </div>

                      {classroomEval && (
                        <span
                          className={`inline-flex items-center gap-1.5 text-xs font-bold tabular-nums ${
                            classroomEval.percent >= 80
                              ? 'text-emerald-700'
                              : 'text-amber-800'
                          }`}
                        >
                          {classroomEval.percent >= 80 ? (
                            <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                          ) : (
                            <XCircle className="w-4 h-4" aria-hidden="true" />
                          )}
                          Độ chính xác: {classroomEval.percent}% ({classroomEval.correctCount}/
                          {classroomEval.totalCount} từ)
                        </span>
                      )}
                    </div>

                    {classroomEval && (
                      <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5">
                        <div className="text-xs font-bold text-slate-700">
                          Đối chiếu từng từ với đáp án chuẩn:
                        </div>
                        <div className="flex flex-wrap gap-1.5 text-sm leading-relaxed">
                          {classroomEval.tokens.map((tk, i) => (
                            <span
                              key={i}
                              className={`px-1.5 py-0.5 rounded font-medium ${
                                tk.matched
                                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                                  : 'bg-red-50 text-red-800 border border-red-200 underline decoration-red-400'
                              }`}
                            >
                              {tk.expected}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-slate-600 pt-1">
                          <strong>Nghĩa tiếng Việt:</strong> {currentClassroom.translationVi}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Step 2: Shadowing Practice on the Exact Same Sentence */}
                  <div className="pt-6 border-t border-slate-200 space-y-4">
                    <div>
                      <h3 className="text-sm font-bold text-slate-900">
                        Bước 2: Shadowing — Đọc nhại theo ngữ điệu, trọng âm & nối âm
                      </h3>
                      <p className="text-sm font-medium text-slate-900 mt-1.5 leading-relaxed">
                        “{currentClassroom.sentence}”
                      </p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <div className="text-xs font-bold text-slate-600 mb-1">
                          Trọng âm chính (Word Stress)
                        </div>
                        <div className="text-xs font-mono text-slate-900">
                          {currentClassroom.stressPattern}
                        </div>
                      </div>
                      <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-lg">
                        <div className="text-xs font-bold text-slate-600 mb-1">
                          Âm nối & Nuốt âm (Connected Speech)
                        </div>
                        <div className="text-xs text-slate-700 leading-relaxed">
                          {currentClassroom.connectedSpeechNote}
                        </div>
                      </div>
                    </div>

                    {currentClassroom.keyWords.length > 0 && (
                      <div className="text-xs text-slate-600">
                        <span className="font-semibold text-slate-700">Từ khóa đắt giá: </span>
                        {currentClassroom.keyWords.join(' · ')}
                      </div>
                    )}

                    {/* Dual Waveform Comparison */}
                    <div className="space-y-4">
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                            <Volume2 className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                            Sóng âm mẫu (Native Reference)
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              onPlaySegment(currentClassroom.startSec, currentClassroom.endSec)
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-md cursor-pointer shadow-xs transition-colors"
                          >
                            <Play className="w-3 h-3" aria-hidden="true" />
                            Nghe mẫu ({playbackRate}x)
                          </button>
                        </div>
                        <canvas
                          ref={refCanvasRef}
                          className="w-full h-16 bg-slate-50 border border-slate-200 rounded-lg"
                        />
                      </div>

                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                            <Mic className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                            Sóng âm giọng đọc của bạn (Shadowing Capture)
                          </span>
                          <div className="flex items-center gap-2">
                            {!isRecording ? (
                              <button
                                type="button"
                                onClick={startRecording}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer"
                              >
                                <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                                Bắt đầu thu âm nhại theo
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={stopRecording}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                              >
                                <Square className="w-3 h-3" aria-hidden="true" />
                                Dừng thu âm
                              </button>
                            )}
                          </div>
                        </div>

                        <div className="relative">
                          <canvas
                            ref={userCanvasRef}
                            className="w-full h-16 bg-slate-50 border border-slate-200 rounded-lg"
                          />
                          {userPeaks.length === 0 && !isRecording && (
                            <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 pointer-events-none">
                              Nhấn “Bắt đầu thu âm nhại theo” để đối chiếu trực tiếp giọng của bạn
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {micError && (
                      <div
                        role="alert"
                        className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                      >
                        <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                        {micError}
                      </div>
                    )}

                    {recordedAudioUrl && (
                      <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
                        <span className="text-xs font-semibold text-emerald-900">
                          Bản thu âm của bạn sẵn sàng đối chiếu:
                        </span>
                        <audio controls src={recordedAudioUrl} className="h-9 max-w-full" />
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'intensive' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Drill Selector Sidebar */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
              <h2 className="text-sm font-bold text-slate-900">
                Đoạn luyện nghe chép ({testPack.intensiveDrills.length})
              </h2>
            </div>
            <div className="divide-y divide-slate-200">
              {testPack.intensiveDrills.map((drill, idx) => (
                <button
                  key={drill.id}
                  type="button"
                  onClick={() => {
                    setSelectedDrillIdx(idx);
                    setDrillInputs({});
                    setShowHints({});
                    setDrillChecked(false);
                    setRevealFullScript(false);
                  }}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    idx === selectedDrillIdx ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-900">
                      Bài tập #{idx + 1}
                    </span>
                    <span className="font-mono text-blue-700 font-semibold">
                      {drill.timestampLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">
                    {drill.missingPhrases.length} cụm từ ẩn · Tốc độ khuyên dùng 0.8x
                  </p>
                </button>
              ))}
            </div>
          </div>

          {/* Intensive Listening Stage */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            {currentDrill ? (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        onPlaySegment(currentDrill.startSec, currentDrill.endSec)
                      }
                      className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-lg cursor-pointer shadow-xs transition-colors"
                    >
                      <Play className="w-3.5 h-3.5" aria-hidden="true" />
                      Nghe đoạn {currentDrill.timestampLabel}
                    </button>

                    <button
                      type="button"
                      onClick={() => onChangeRate(playbackRate === 0.8 ? 1.0 : 0.8)}
                      className={`px-3 py-2 text-xs font-medium rounded-lg border cursor-pointer ${
                        Math.abs(playbackRate - 0.8) < 0.05
                          ? 'bg-slate-900 text-white border-slate-900'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {Math.abs(playbackRate - 0.8) < 0.05
                        ? 'Đang bật 0.8x (Phân tích nối âm)'
                        : 'Chuyển sang 0.8x'}
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setRevealFullScript((prev) => !prev)}
                    className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    {revealFullScript ? 'Ẩn gợi ý nối âm' : 'Xem ghi chú nối âm'}
                  </button>
                </div>

                {/* Blank Exercise */}
                <div className="p-5 bg-slate-50 border border-slate-200 rounded-xl">
                  {renderBlankSentence()}
                </div>

                {/* Progressive Hints per Blank */}
                <div className="space-y-2.5">
                  <h3 className="text-xs font-bold text-slate-600">
                    Gợi ý từng bước (Không lộ toàn bộ Script)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {currentDrill.missingPhrases.map((phrase, idx) => {
                      const activeHint = showHints[idx] || null;
                      return (
                        <div
                          key={idx}
                          className="p-3 bg-white border border-slate-200 rounded-lg space-y-2"
                        >
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-slate-800">
                              Chỗ trống #{idx + 1}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() =>
                                  setShowHints((prev) => ({
                                    ...prev,
                                    [idx]: activeHint === 'context' ? null : 'context',
                                  }))
                                }
                                className="px-2 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded cursor-pointer"
                              >
                                Ngữ cảnh
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  setShowHints((prev) => ({
                                    ...prev,
                                    [idx]: activeHint === 'mask' ? null : 'mask',
                                  }))
                                }
                                className="px-2 py-1 text-[11px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-700 rounded cursor-pointer"
                              >
                                Số chữ cái
                              </button>
                            </div>
                          </div>
                          {activeHint === 'context' && (
                            <p className="text-xs text-blue-800 flex items-start gap-1.5">
                              <HelpCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                              {phrase.hintContext}
                            </p>
                          )}
                          {activeHint === 'mask' && (
                            <p className="text-xs font-mono text-slate-800 bg-slate-50 px-2 py-1 rounded">
                              {phrase.letterMask}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {revealFullScript && (
                  <div className="p-4 bg-blue-50/70 border border-blue-200 rounded-lg text-xs text-slate-800 leading-relaxed">
                    <strong>Phân tích Connected Speech (Âm nối):</strong>{' '}
                    {currentDrill.connectedSpeechNote}
                  </div>
                )}

                {/* Check / Reset Bar */}
                <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-200">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setDrillChecked(true)}
                      className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-lg cursor-pointer"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                      Kiểm tra chính tả & đuôi từ
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setDrillInputs({});
                        setDrillChecked(false);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                      Làm lại
                    </button>
                  </div>

                  {drillChecked && (
                    <span className="text-xs font-semibold text-slate-700 tabular-nums">
                      Đúng{' '}
                      {
                        currentDrill.missingPhrases.filter(
                          (p, i) =>
                            (drillInputs[i] || '').trim().toLowerCase() ===
                            p.answer.trim().toLowerCase()
                        ).length
                      }
                      /{currentDrill.missingPhrases.length} cụm từ
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                Chưa có bài tập Intensive Listening cho bộ đề này.
              </p>
            )}
          </div>
        </div>
      )}

      {activeTab === 'shadowing' && (
        /* Shadowing Studio */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Segment Selector */}
          <div className="lg:col-span-4 bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70">
              <h2 className="text-sm font-bold text-slate-900">
                Chọn đoạn luyện Shadowing ({testPack.segments.length})
              </h2>
            </div>
            <div className="max-h-[520px] overflow-y-auto divide-y divide-slate-200">
              {testPack.segments.map((seg, idx) => (
                <button
                  key={seg.id}
                  type="button"
                  onClick={() => setSelectedSegIdx(idx)}
                  className={`w-full text-left p-4 transition-colors cursor-pointer ${
                    idx === selectedSegIdx ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between text-xs mb-1">
                    <span className="font-semibold text-slate-900">{seg.speaker}</span>
                    <span className="font-mono text-blue-700 font-semibold">
                      {seg.timestampLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 line-clamp-2">{seg.text}</p>
                </button>
              ))}
            </div>
          </div>

          {/* Shadowing Comparison Stage */}
          <div className="lg:col-span-8 bg-white border border-slate-200 rounded-xl p-6 space-y-6">
            {currentSegment && (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200">
                  <div>
                    <span className="text-xs font-mono text-blue-700 font-semibold">
                      {currentSegment.timestampLabel} · {currentSegment.speaker}
                    </span>
                    <p className="text-base font-medium text-slate-900 mt-1.5 leading-relaxed">
                      “{currentSegment.text}”
                    </p>
                  </div>
                </div>

                {/* Điều chỉnh thời gian bắt đầu và kết thúc đoạn Shadowing */}
                <AudioSegmentTimeAdjuster
                  label={`Mốc nghe Shadowing (${currentSegment.speaker})`}
                  startSec={currentSegment.startSec}
                  endSec={currentSegment.endSec}
                  currentTime={currentTime}
                  maxDuration={testPack.durationSec}
                  isPlaying={isPlaying}
                  onChangeTime={(newStart, newEnd) => {
                    onUpdateSegmentTime?.(currentSegment.id, newStart, newEnd);
                  }}
                  onPlaySegment={(start, end) => {
                    onPlaySegment(start, end ?? undefined);
                  }}
                />

                {/* Stress & Intonation Guide */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                    <div className="text-xs font-bold text-slate-600 mb-1">
                      Trọng âm chính (Word Stress)
                    </div>
                    <div className="text-xs font-mono text-slate-900">
                      {currentSegment.stressPattern || 'Nhấn vào các từ mang nội dung chính'}
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg">
                    <div className="text-xs font-bold text-slate-600 mb-1">
                      Ngữ điệu (Intonation Contour)
                    </div>
                    <div className="text-xs text-slate-700">
                      {currentSegment.intonationNote ||
                        'Lên giọng nhẹ ở mệnh đề phụ, hạ giọng dứt khoát ở cuối câu trần thuật.'}
                    </div>
                  </div>
                </div>

                {/* Dual Waveform Comparison */}
                <div className="space-y-4">
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        <Volume2 className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                        Sóng âm mẫu (Native Reference)
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          onPlaySegment(currentSegment.startSec, currentSegment.endSec)
                        }
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-md cursor-pointer shadow-xs transition-colors"
                      >
                        <Play className="w-3 h-3" aria-hidden="true" />
                        Nghe mẫu ({playbackRate}x)
                      </button>
                    </div>
                    <canvas
                      ref={refCanvasRef}
                      className="w-full h-16 bg-slate-50 border border-slate-200 rounded-lg"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                        <Mic className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                        Sóng âm giọng đọc của bạn (Shadowing Capture)
                      </span>
                      <div className="flex items-center gap-2">
                        {!isRecording ? (
                          <button
                            type="button"
                            onClick={startRecording}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer"
                          >
                            <Mic className="w-3.5 h-3.5" aria-hidden="true" />
                            Bắt đầu thu âm nhại theo
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={stopRecording}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-700 rounded-md cursor-pointer"
                          >
                            <Square className="w-3 h-3" aria-hidden="true" />
                            Dừng thu âm
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="relative">
                      <canvas
                        ref={userCanvasRef}
                        className="w-full h-16 bg-slate-50 border border-slate-200 rounded-lg"
                      />
                      {userPeaks.length === 0 && !isRecording && (
                        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-400 pointer-events-none">
                          Nhấn “Bắt đầu thu âm nhại theo” để đối chiếu sóng âm trực tiếp
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {micError && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2"
                  >
                    <XCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
                    {micError}
                  </div>
                )}

                {recordedAudioUrl && (
                  <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-lg flex flex-wrap items-center justify-between gap-3">
                    <span className="text-xs font-semibold text-emerald-900">
                      Bản thu âm của bạn sẵn sàng đối chiếu:
                    </span>
                    <audio controls src={recordedAudioUrl} className="h-9 max-w-full" />
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      {/* 16:9 Classroom Slide Modal */}
      <ClassroomSlideModal
        isOpen={isSlideModalOpen}
        onClose={() => setIsSlideModalOpen(false)}
        testPack={testPack}
        drills={classroomDrills}
        onPlaySegment={onPlaySegment}
      />
    </div>
  );
};
