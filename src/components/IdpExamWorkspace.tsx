import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Eye,
  EyeOff,
  FileDown,
  FileText,
  HelpCircle,
  Languages,
  Loader2,
  Maximize,
  Minimize,
  Play,
  Plus,
  Send,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { AwlVocabItem, IeltsQuestion, ListeningTestPack } from '../types/ielts';
import { AudioSegmentTimeAdjuster } from './AudioSegmentTimeAdjuster';
import { getQuestionEndSec } from '../utils/audioTime';
import { exportExamQuestionPaperDocx } from '../utils/docxExport';
import { AiListeningCoachModal } from './AiListeningCoachModal';

interface IdpExamWorkspaceProps {
  testPack: ListeningTestPack;
  userAnswers: Record<number, string>;
  onChangeAnswer: (questionNumber: number, value: string) => void;
  currentTime: number;
  onSeekAndPlay: (sec: number, endLimitSec?: number | null) => void;
  onUpdateQuestionTime?: (questionNumber: number, startSec: number, endSec: number) => void;
  onSubmitExam: () => Promise<void>;
  isAnalyzing: boolean;
  analyzeError: string | null;
  savedWords: Set<string>;
  onSaveFlashcard: (item: AwlVocabItem) => void;
  onTranslateVocab: (
    word: string,
    sentenceContext: string,
    timestampSec?: number,
    timestampLabel?: string
  ) => Promise<AwlVocabItem>;
  onRegenerateQuestions?: () => Promise<void>;
  elapsedSec: number;
  fontScale?: number;
  onIncreaseFont?: () => void;
  onDecreaseFont?: () => void;
  onResetFont?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

function isUserAnswerCorrect(q: IeltsQuestion, rawUser: string): boolean {
  const norm = rawUser.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!norm) return false;
  const accepted = [q.correctAnswer, ...(q.acceptedVariants || [])].map((v) =>
    v.trim().toLowerCase().replace(/\s+/g, ' ')
  );
  return accepted.includes(norm);
}

export const IdpExamWorkspace: React.FC<IdpExamWorkspaceProps> = ({
  testPack,
  userAnswers,
  onChangeAnswer,
  currentTime,
  onSeekAndPlay,
  onUpdateQuestionTime,
  onSubmitExam,
  isAnalyzing,
  analyzeError,
  savedWords,
  onSaveFlashcard,
  onTranslateVocab,
  onRegenerateQuestions,
  elapsedSec,
  fontScale = 100,
  onIncreaseFont,
  onDecreaseFont,
  onResetFont,
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  const [showTranscript, setShowTranscript] = useState(true);
  const [showScratchpad, setShowScratchpad] = useState(false);
  const [scratchpad, setScratchpad] = useState('');
  const [selectedVocab, setSelectedVocab] = useState<AwlVocabItem | null>(null);
  const [showAllAnswers, setShowAllAnswers] = useState(false);
  const [revealedQuestions, setRevealedQuestions] = useState<Record<number, boolean>>({});
  const [lookupWord, setLookupWord] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [isRegeneratingQs, setIsRegeneratingQs] = useState(false);
  const [regenError, setRegenError] = useState<string | null>(null);
  const [activeQuestionNum, setActiveQuestionNum] = useState<number>(
    testPack.questions[0]?.number ?? 1
  );
  const [coachQuestion, setCoachQuestion] = useState<IeltsQuestion | null>(null);
  const [isCoachOpen, setIsCoachOpen] = useState(false);

  useEffect(() => {
    setActiveQuestionNum(testPack.questions[0]?.number ?? 1);
    setSelectedVocab(null);
    setShowAllAnswers(false);
    setRevealedQuestions({});
    setLookupWord('');
    setTranslateError(null);
  }, [testPack.id, testPack.questions]);

  const answeredCount = useMemo(() => {
    return testPack.questions.filter(
      (q) => (userAnswers[q.number] ?? '').trim().length > 0
    ).length;
  }, [testPack.questions, userAnswers]);

  const vocabMap = useMemo(() => {
    const map = new Map<string, AwlVocabItem>();
    for (const v of testPack.vocabulary) {
      map.set(v.word.toLowerCase(), v);
    }
    return map;
  }, [testPack.vocabulary]);

  const activeSegment = useMemo(() => {
    return (
      testPack.segments.find(
        (seg) => currentTime >= seg.startSec && currentTime < seg.endSec
      ) || testPack.segments[0]
    );
  }, [testPack.segments, currentTime]);

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  const handleToggleQuestionReveal = (qNum: number) => {
    setRevealedQuestions((prev) => ({
      ...prev,
      [qNum]: !(showAllAnswers || prev[qNum]),
    }));
    if (showAllAnswers) {
      setShowAllAnswers(false);
    }
  };

  const handleQuickTranslate = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = lookupWord.trim();
    if (!cleaned) return;
    setIsTranslating(true);
    setTranslateError(null);
    try {
      const matchedSeg =
        testPack.segments.find((s) =>
          s.text.toLowerCase().includes(cleaned.toLowerCase())
        ) || activeSegment;
      const item = await onTranslateVocab(
        cleaned,
        matchedSeg?.text || '',
        matchedSeg?.startSec ?? 0,
        matchedSeg?.timestampLabel ?? '[00:00.00]'
      );
      setSelectedVocab(item);
      setLookupWord('');
    } catch (err: unknown) {
      setTranslateError(
        err instanceof Error ? err.message : 'Không thể dịch từ theo ngữ cảnh.'
      );
    } finally {
      setIsTranslating(false);
    }
  };

  // Highlight AWL terms inside transcript text with interactive buttons
  const renderInteractiveText = (text: string, segStartSec: number) => {
    if (vocabMap.size === 0) return text;
    const tokens = text.split(/(\b[A-Za-z]+\b)/g);
    return tokens.map((token, idx) => {
      const lower = token.toLowerCase();
      const matched =
        vocabMap.get(lower) ||
        (lower.endsWith('s') ? vocabMap.get(lower.slice(0, -1)) : undefined) ||
        (lower.endsWith('ed') ? vocabMap.get(lower.slice(0, -2)) : undefined);
      if (!matched) {
        return <React.Fragment key={idx}>{token}</React.Fragment>;
      }
      return (
        <button
          key={idx}
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setSelectedVocab(matched);
            onSeekAndPlay(segStartSec);
          }}
          title={`Từ vựng AWL: ${matched.word} (${matched.ipa}) — Nhấn để xem nghĩa theo ngữ cảnh & nghe lại`}
          className="inline font-semibold text-blue-800 underline decoration-blue-500/60 decoration-2 underline-offset-4 hover:bg-blue-50 rounded px-0.5 cursor-pointer"
        >
          {token}
        </button>
      );
    });
  };

  return (
    <div className="max-w-[1400px] mx-auto px-6 py-6">
      {/* Exam Header Strip (IDP / BC Authentic Simulation) */}
      <div className="bg-white border border-slate-200 rounded-xl px-5 py-4 mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs font-medium text-slate-500 flex items-center gap-2">
            <span>Mô phỏng phòng thi máy tính IDP / BC</span>
            <span aria-hidden="true">·</span>
            <span>{testPack.partLabel}</span>
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              Đã trả lời {answeredCount}/{testPack.questions.length}
            </span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1 text-balance">
            {testPack.title}
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg text-sm font-mono text-slate-700 tabular-nums">
            <Clock className="w-4 h-4 text-slate-500" aria-hidden="true" />
            <span>{formatTimer(elapsedSec)}</span>
          </div>

          <button
            type="button"
            onClick={() => setShowAllAnswers((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${
              showAllAnswers
                ? 'bg-emerald-700 text-white border-emerald-700'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {showAllAnswers ? (
              <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
            ) : (
              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {showAllAnswers ? 'Ẩn tất cả đáp án' : 'Hiện đáp án & Giải thích'}
          </button>

          <button
            type="button"
            onClick={() => setShowScratchpad((prev) => !prev)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${
              showScratchpad
                ? 'bg-slate-900 text-white border-slate-900'
                : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
            }`}
          >
            <FileText className="w-3.5 h-3.5" aria-hidden="true" />
            Ghi chú nhanh
          </button>

          <button
            type="button"
            onClick={() => exportExamQuestionPaperDocx(testPack)}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            title="Xuất đề thi và phiếu làm bài chuẩn A4 ra Microsoft Word (.doc / .docx)"
          >
            <FileDown className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
            Xuất đề Word (.docx)
          </button>

          {/* Cỡ chữ toàn trang */}
          {onIncreaseFont && onDecreaseFont && (
            <div
              role="group"
              aria-label="Điều chỉnh cỡ chữ thi"
              className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200"
            >
              <button
                type="button"
                onClick={onDecreaseFont}
                disabled={fontScale <= 90}
                className="px-2 py-1 text-slate-700 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
                title="Giảm cỡ chữ (A-)"
                aria-label="Giảm cỡ chữ"
              >
                <span className="text-xs font-bold leading-none">A-</span>
              </button>

              <button
                type="button"
                onClick={onResetFont}
                className="px-2 py-1 text-xs font-mono font-semibold text-slate-800 hover:bg-white rounded transition-colors cursor-pointer select-none tabular-nums"
                title="Nhấp để đặt lại cỡ chữ 100%"
              >
                {fontScale}%
              </button>

              <button
                type="button"
                onClick={onIncreaseFont}
                disabled={fontScale >= 150}
                className="px-2 py-1 text-slate-700 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
                title="Tăng cỡ chữ (A+)"
                aria-label="Tăng cỡ chữ"
              >
                <span className="text-xs font-bold leading-none">A+</span>
              </button>
            </div>
          )}

          {/* Nút Toàn màn hình phòng thi */}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                isFullscreen
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
              }`}
              title={isFullscreen ? 'Thoát toàn màn hình (F11 hoặc Esc)' : 'Bật toàn màn hình phòng thi (F11)'}
              aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
            >
              {isFullscreen ? (
                <Minimize className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Maximize className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onSubmitExam}
            disabled={isAnalyzing}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            <Send className="w-3.5 h-3.5" aria-hidden="true" />
            {isAnalyzing ? 'Đang chấm & Phân tích AI...' : 'Nộp bài & Phân tích AI'}
          </button>
        </div>
      </div>

      {analyzeError && (
        <div
          role="alert"
          className="mb-6 bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-3 text-sm"
        >
          {analyzeError}
        </div>
      )}

      {/* Optional IDP Scratchpad */}
      {showScratchpad && (
        <div className="mb-6 bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="idp-scratchpad"
              className="text-xs font-semibold text-slate-700"
            >
              Bảng nháp từ khóa (Notes trong lúc nghe)
            </label>
            <button
              type="button"
              onClick={() => setScratchpad('')}
              className="text-xs text-slate-500 hover:text-slate-900 cursor-pointer"
            >
              Xóa nháp
            </button>
          </div>
          <textarea
            id="idp-scratchpad"
            rows={3}
            value={scratchpad}
            onChange={(e) => setScratchpad(e.target.value)}
            placeholder="Ghi chú nhanh từ khóa nghe được, số liệu gây nhiễu hoặc bẫy tự sửa lỗi..."
            className="w-full text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-lg p-3 focus:outline-none focus:ring-2 focus:ring-blue-700"
          />
        </div>
      )}

      {/* Two-Zone Sandbox Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Zone: Interactive IDP Question Paper */}
        <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Phiếu câu hỏi ({testPack.questions.length} câu)
              </h2>
              <span className="text-xs text-slate-500">
                Nhập đáp án hoặc bấm “Đáp án & Giải thích” ở từng câu để xem lời giải chi tiết
              </span>
            </div>

            {testPack.pdfUrl && (
              <a
                href={testPack.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                {testPack.pdfFileName ? `Xem PDF: ${testPack.pdfFileName}` : 'Xem đề PDF đã lưu'}
              </a>
            )}
          </div>

          <div className="divide-y divide-slate-200">
            {testPack.questions.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm font-semibold text-slate-900">
                  Chưa có câu hỏi nào được trích xuất cho bài nghe này
                </p>
                <p className="text-xs text-slate-500 max-w-md mx-auto leading-relaxed">
                  Bạn có thể bấm nút bên dưới để AI đọc lại đề PDF/Transcript và tạo ngay phiếu câu hỏi IELTS Listening chuẩn IDP.
                </p>
                {regenError && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 max-w-md mx-auto">
                    {regenError}
                  </p>
                )}
                {onRegenerateQuestions && (
                  <button
                    type="button"
                    disabled={isRegeneratingQs}
                    onClick={async () => {
                      setIsRegeneratingQs(true);
                      setRegenError(null);
                      try {
                        await onRegenerateQuestions();
                      } catch (err: unknown) {
                        setRegenError(
                          err instanceof Error ? err.message : 'Không thể tạo câu hỏi.'
                        );
                      } finally {
                        setIsRegeneratingQs(false);
                      }
                    }}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer disabled:opacity-60"
                  >
                    {isRegeneratingQs && (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    )}
                    {isRegeneratingQs
                      ? 'Đang tạo Phiếu câu hỏi (AI)...'
                      : 'Trích xuất / Tạo Phiếu câu hỏi (AI)'}
                  </button>
                )}
              </div>
            ) : (
              testPack.questions.map((q) => {
              const userVal = userAnswers[q.number] ?? '';
              const isSelected = activeQuestionNum === q.number;
              const isRevealed = showAllAnswers || Boolean(revealedQuestions[q.number]);
              const hasUserInput = userVal.trim().length > 0;
              const isCorrect = hasUserInput && isUserAnswerCorrect(q, userVal);

              return (
                <div
                  key={q.number}
                  id={`question-${q.number}`}
                  onClick={() => setActiveQuestionNum(q.number)}
                  className={`p-6 transition-colors ${
                    isSelected ? 'bg-blue-50/30' : 'bg-white hover:bg-slate-50/40'
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-md bg-slate-900 text-white text-xs font-mono font-semibold tabular-nums">
                        {q.number}
                      </span>
                      <span className="text-xs font-medium text-slate-500">
                        {q.wordLimitInstruction || (q.type === 'mcq' ? 'Multiple Choice' : 'Completion')}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      {q.timestampLabel && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const endSec = getQuestionEndSec(q, testPack);
                            onSeekAndPlay(q.timestampSec, endSec);
                          }}
                          className="inline-flex items-center gap-1 text-xs font-mono text-blue-700 hover:text-blue-900 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                          title={`Nghe đoạn audio câu ${q.number}`}
                        >
                          <Play className="w-3 h-3" aria-hidden="true" />
                          Nghe {q.timestampLabel}
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleQuestionReveal(q.number);
                        }}
                        className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                          isRevealed
                            ? 'bg-slate-900 text-white border-slate-900'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        <HelpCircle className="w-3.5 h-3.5" aria-hidden="true" />
                        {isRevealed ? 'Ẩn giải thích' : 'Đáp án & Giải thích'}
                        {isRevealed ? (
                          <ChevronUp className="w-3 h-3" aria-hidden="true" />
                        ) : (
                          <ChevronDown className="w-3 h-3" aria-hidden="true" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setCoachQuestion(q);
                          setIsCoachOpen(true);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                        title="Hỏi Gia sư AI 1-on-1 giải thích chi tiết câu này"
                      >
                        <Sparkles className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
                        Gia sư AI
                      </button>
                    </div>
                  </div>

                  <p className="text-[15px] font-medium text-slate-900 leading-relaxed mb-3">
                    {q.prompt}
                  </p>

                  {!q.options || q.options.length === 0 ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3">
                      {q.contextBefore && <span>{q.contextBefore}</span>}
                      <input
                        type="text"
                        aria-label={`Đáp án câu ${q.number}`}
                        value={userVal}
                        onChange={(e) => onChangeAnswer(q.number, e.target.value)}
                        placeholder={`Câu ${q.number}...`}
                        className="min-w-[160px] flex-1 max-w-[260px] bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md px-3 py-1.5 text-sm font-medium text-slate-900 outline-none"
                      />
                      {q.contextAfter && <span>{q.contextAfter}</span>}
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {q.options.map((opt) => {
                        const checked = userVal.toUpperCase() === opt.key.toUpperCase();
                        const isRightOpt =
                          isRevealed &&
                          q.correctAnswer.trim().toUpperCase() === opt.key.toUpperCase();
                        return (
                          <label
                            key={opt.key}
                            className={`flex items-start gap-3 px-4 py-2.5 rounded-lg border text-sm cursor-pointer transition-colors ${
                              isRightOpt
                                ? 'bg-emerald-50 border-emerald-500 text-slate-900 font-medium'
                                : checked
                                  ? 'bg-blue-50 border-blue-600 text-slate-900 font-medium'
                                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                            }`}
                          >
                            <input
                              type="radio"
                              name={`q-${q.number}`}
                              value={opt.key}
                              checked={checked}
                              onChange={() => onChangeAnswer(q.number, opt.key)}
                              className="mt-0.5 accent-blue-700"
                            />
                            <span className="flex-1">
                              <strong className="font-mono mr-1.5">{opt.key}.</strong>
                              {opt.text}
                            </span>
                            {isRightOpt && (
                              <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 shrink-0">
                                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                Đáp án đúng
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  {/* Per-Question Answer & Detailed Vietnamese Explanation Panel */}
                  {isRevealed && (
                    <div
                      onClick={(e) => e.stopPropagation()}
                      className="mt-4 p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2.5 text-sm"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2 pb-2.5 border-b border-slate-200">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-semibold text-slate-500">
                            Đáp án chuẩn:
                          </span>
                          <span className="font-mono font-bold text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded">
                            {q.correctAnswer || '(Chưa xác định)'}
                          </span>
                          {q.acceptedVariants && q.acceptedVariants.length > 0 && (
                            <span className="text-xs text-slate-500">
                              (Chấp nhận: {q.acceptedVariants.join(', ')})
                            </span>
                          )}
                        </div>

                        {hasUserInput && (
                          <span
                            className={`inline-flex items-center gap-1 text-xs font-semibold ${
                              isCorrect ? 'text-emerald-700' : 'text-red-700'
                            }`}
                          >
                            {isCorrect ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                Khớp đáp án
                              </>
                            ) : (
                              <>
                                <XCircle className="w-3.5 h-3.5" aria-hidden="true" />
                                Bạn đang điền: “{userVal}”
                              </>
                            )}
                          </span>
                        )}
                      </div>

                      <div>
                        <span className="text-xs font-bold text-slate-700 block mb-0.5">
                          Vì sao đáp án này đúng:
                        </span>
                        <p className="text-slate-800 leading-relaxed">
                          {q.explanationVi ||
                            'Đáp án khớp trực tiếp với thông tin xác nhận cuối cùng trong đoạn audio tương ứng.'}
                        </p>
                      </div>

                      {(q.distractorDetail || (q.distractorType && q.distractorType !== 'None')) && (
                        <div>
                          <span className="text-xs font-bold text-amber-800 block mb-0.5">
                            Bẫy thông tin ({q.distractorType}):
                          </span>
                          <p className="text-slate-700 text-xs leading-relaxed">
                            {q.distractorDetail}
                          </p>
                        </div>
                      )}

                      {(q.paraphraseQuestion || q.paraphraseTranscript) && (
                        <div className="text-xs text-slate-600">
                          <span className="font-semibold text-slate-700">Biến đổi từ khóa (Paraphrasing): </span>
                          {q.paraphraseQuestion} → {q.paraphraseTranscript}
                        </div>
                      )}

                      {/* Trích đoạn audio và chỉnh mốc thời gian bắt đầu / kết thúc ở từng câu trong phần đáp án */}
                      <div className="pt-2 space-y-2 border-t border-slate-200">
                        {q.transcriptQuote && (
                          <div className="p-3 bg-white border border-slate-200 rounded-md">
                            <span className="text-xs text-slate-500 font-medium block mb-1">
                              Trích đoạn Audio chứa đáp án:
                            </span>
                            <strong className="text-xs text-slate-900 leading-relaxed block">
                              “{q.transcriptQuote}”
                            </strong>
                          </div>
                        )}

                        <AudioSegmentTimeAdjuster
                          label={`Mốc nghe đáp án câu ${q.number}`}
                          startSec={q.timestampSec}
                          endSec={getQuestionEndSec(q, testPack)}
                          currentTime={currentTime}
                          maxDuration={testPack.durationSec}
                          onChangeTime={(newStart, newEnd) => {
                            onUpdateQuestionTime?.(q.number, newStart, newEnd);
                          }}
                          onPlaySegment={(start, end) => {
                            onSeekAndPlay(start, end ?? null);
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
            )}
          </div>

          {/* Bottom Question Palette (IDP style) */}
          <div className="px-6 py-4 bg-slate-50 border-t border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {testPack.questions.map((q) => {
                const isDone = (userAnswers[q.number] ?? '').trim().length > 0;
                const isCurrent = activeQuestionNum === q.number;
                return (
                  <button
                    key={q.number}
                    type="button"
                    onClick={() => {
                      setActiveQuestionNum(q.number);
                      document
                        .getElementById(`question-${q.number}`)
                        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    }}
                    className={`w-8 h-8 rounded-md text-xs font-mono font-semibold tabular-nums transition-colors cursor-pointer ${
                      isCurrent
                        ? 'bg-blue-700 text-white'
                        : isDone
                          ? 'bg-slate-800 text-white'
                          : 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {q.number}
                  </button>
                );
              })}
            </div>
            <span className="text-xs text-slate-500">
              Ô đen: đã điền · Ô xanh: đang chọn
            </span>
          </div>
        </div>

        {/* Right Zone: Click-to-Hear Synchronized Transcript & Contextual Translator */}
        <aside className="lg:col-span-5 bg-white border border-slate-200 rounded-xl overflow-hidden lg:sticky lg:top-20">
          <div className="px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Transcript Đồng bộ (Click-to-Hear)
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Nhấp vào đoạn thoại để nghe · Nhấp từ gạch chân để xem nghĩa theo bài
              </p>
            </div>
            <button
              type="button"
              onClick={() => setShowTranscript((prev) => !prev)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {showTranscript ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                  Ẩn Script
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  Hiện Script
                </>
              )}
            </button>
          </div>

          {!showTranscript ? (
            <div className="p-8 text-center">
              <BookOpen className="w-8 h-8 text-slate-400 mx-auto mb-3" aria-hidden="true" />
              <p className="text-sm font-semibold text-slate-800">
                Chế độ thi thật đang ẩn Transcript
              </p>
              <p className="text-xs text-slate-500 mt-1 max-w-xs mx-auto leading-relaxed">
                Tập trung nghe audio và điền đáp án ở bên trái. Bạn có thể bật lại Transcript để đối chiếu Click-to-Hear bất kỳ lúc nào.
              </p>
            </div>
          ) : (
            <>
              {/* Quick Contextual Translator per listening passage */}
              <form
                onSubmit={handleQuickTranslate}
                className="px-4 py-3 border-b border-slate-200 bg-slate-50/40 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={lookupWord}
                    onChange={(e) => setLookupWord(e.target.value)}
                    placeholder="Gõ từ/cụm từ trong bài để dịch theo ngữ cảnh..."
                    className="flex-1 min-w-0 text-xs bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-md px-3 py-1.5 outline-none"
                  />
                  <button
                    type="submit"
                    disabled={isTranslating || !lookupWord.trim()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
                  >
                    {isTranslating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                    ) : (
                      <Languages className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    Dịch theo bài
                  </button>
                </div>
                {translateError && (
                  <p className="text-xs text-red-700">{translateError}</p>
                )}
              </form>

              {/* AWL Lexicon Popover Card */}
              {selectedVocab && (
                <div className="m-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-base font-bold text-slate-900">
                          {selectedVocab.word}
                        </span>
                        <span className="text-xs font-mono text-slate-600">
                          {selectedVocab.ipa}
                        </span>
                        <span className="text-xs text-slate-500">
                          ({selectedVocab.pos})
                        </span>
                      </div>
                      <p className="text-sm font-semibold text-blue-900 mt-1.5">
                        Nghĩa theo ngữ cảnh bài: {selectedVocab.contextualMeaningVi || selectedVocab.definitionVi}
                      </p>
                      {selectedVocab.contextualMeaningVi &&
                        selectedVocab.definitionVi !== selectedVocab.contextualMeaningVi && (
                          <p className="text-xs text-slate-600 mt-0.5">
                            Nghĩa phổ thông: {selectedVocab.definitionVi}
                          </p>
                        )}
                      {selectedVocab.exampleTranslationVi && (
                        <p className="text-xs text-slate-600 mt-1.5 italic">
                          “{selectedVocab.exampleTranslationVi}”
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedVocab(null)}
                      className="text-xs text-slate-400 hover:text-slate-700 cursor-pointer"
                    >
                      Đóng
                    </button>
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => onSeekAndPlay(selectedVocab.timestampSec)}
                      className="text-xs font-mono text-blue-700 hover:underline cursor-pointer"
                    >
                      Nghe ngữ cảnh {selectedVocab.timestampLabel}
                    </button>
                    {savedWords.has(selectedVocab.word.toLowerCase()) ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        Đã lưu Flashcard
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onSaveFlashcard(selectedVocab)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
                      >
                        <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                        Lưu Flashcard
                      </button>
                    )}
                  </div>
                </div>
              )}

              <div className="max-h-[540px] overflow-y-auto divide-y divide-slate-100">
                {testPack.segments.map((seg) => {
                  const isActive =
                    currentTime >= seg.startSec && currentTime < seg.endSec;

                  return (
                    <div
                      key={seg.id}
                      onClick={() => onSeekAndPlay(seg.startSec, seg.endSec)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          onSeekAndPlay(seg.startSec, seg.endSec);
                        }
                      }}
                      className={`p-4 transition-colors cursor-pointer ${
                        isActive ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-1">
                        <span className="text-xs font-semibold text-slate-900">
                          {seg.speaker}
                          {seg.questionRef ? (
                            <span className="ml-2 font-normal text-slate-500">
                              · Liên quan Câu {seg.questionRef}
                            </span>
                          ) : null}
                        </span>
                        <span
                          className={`text-xs font-mono tabular-nums ${
                            isActive ? 'text-blue-700 font-semibold' : 'text-slate-500'
                          }`}
                        >
                          {seg.timestampLabel}
                        </span>
                      </div>
                      <p className="text-sm text-slate-700 leading-relaxed">
                        {renderInteractiveText(seg.text, seg.startSec)}
                      </p>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </aside>
      </div>
      {/* Gia sư AI 1-on-1 Modal */}
      <AiListeningCoachModal
        isOpen={isCoachOpen}
        onClose={() => setIsCoachOpen(false)}
        question={coachQuestion}
        userAnswer={coachQuestion ? userAnswers[coachQuestion.number] : undefined}
        testTitle={testPack.title}
        partLabel={testPack.partLabel}
        onSeekAndPlay={onSeekAndPlay}
      />
    </div>
  );
};
