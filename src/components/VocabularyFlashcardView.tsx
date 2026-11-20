import React, { useEffect, useMemo, useState } from 'react';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Languages,
  Loader2,
  Play,
  Plus,
  RotateCw,
  Trash2,
  Volume2,
} from 'lucide-react';
import type { AwlVocabItem, FlashcardItem, ListeningTestPack } from '../types/ielts';

interface VocabularyFlashcardViewProps {
  testPack: ListeningTestPack;
  allTests: ListeningTestPack[];
  onSelectTest: (testId: string) => void;
  flashcards: FlashcardItem[];
  onSaveFlashcard: (item: AwlVocabItem, status?: FlashcardItem['status']) => void;
  onUpdateStatus: (id: string, status: FlashcardItem['status']) => void;
  onDeleteFlashcard: (id: string) => void;
  onSeekAndPlay: (sec: number) => void;
  onTranslateVocab: (
    word: string,
    sentenceContext: string,
    timestampSec?: number,
    timestampLabel?: string
  ) => Promise<AwlVocabItem>;
}

interface LessonDeckCard extends FlashcardItem {
  isSaved: boolean;
  sourceVocab?: AwlVocabItem;
}

function parseTimestampToSec(label?: string): number | null {
  if (!label) return null;
  const match = label.match(/\[?(\d+):(\d+(?:\.\d+)?)\]?/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

export const VocabularyFlashcardView: React.FC<VocabularyFlashcardViewProps> = ({
  testPack,
  allTests,
  onSelectTest,
  flashcards,
  onSaveFlashcard,
  onUpdateStatus,
  onDeleteFlashcard,
  onSeekAndPlay,
  onTranslateVocab,
}) => {
  const [scope, setScope] = useState<'lesson' | 'all'>('lesson');
  const [filter, setFilter] = useState<'all' | FlashcardItem['status']>('all');
  const [cardIndex, setCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  // Contextual AI word translator form state
  const [customWord, setCustomWord] = useState('');
  const [selectedSegmentId, setSelectedSegmentId] = useState<string>(
    testPack.segments[0]?.id || ''
  );
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateError, setTranslateError] = useState<string | null>(null);
  const [addMode, setAddMode] = useState<'ai' | 'manual'>('ai');
  const [manualDef, setManualDef] = useState('');
  const [manualIpa, setManualIpa] = useState('');

  useEffect(() => {
    setCardIndex(0);
    setIsFlipped(false);
    setSelectedSegmentId(testPack.segments[0]?.id || '');
    setTranslateError(null);
  }, [testPack.id, testPack.segments]);

  const savedByKey = useMemo(() => {
    const map = new Map<string, FlashcardItem>();
    for (const fc of flashcards) {
      map.set(`${fc.testId || 'global'}::${fc.word.toLowerCase()}`, fc);
      if (!map.has(`word::${fc.word.toLowerCase()}`)) {
        map.set(`word::${fc.word.toLowerCase()}`, fc);
      }
    }
    return map;
  }, [flashcards]);

  // Build deck scoped to current listening lesson by default, or full personal deck
  const baseCards: LessonDeckCard[] = useMemo(() => {
    if (scope === 'lesson') {
      return testPack.vocabulary.map((v) => {
        const saved =
          savedByKey.get(`${testPack.id}::${v.word.toLowerCase()}`) ||
          savedByKey.get(`word::${v.word.toLowerCase()}`);
        if (saved) {
          return {
            ...saved,
            contextualMeaningVi: v.contextualMeaningVi || saved.contextualMeaningVi,
            exampleTranslationVi: v.exampleTranslationVi || saved.exampleTranslationVi,
            isSaved: true,
            sourceVocab: v,
          };
        }
        return {
          id: `lesson-${testPack.id}-${v.word.toLowerCase()}`,
          testId: testPack.id,
          word: v.word,
          ipa: v.ipa,
          pos: v.pos,
          definitionVi: v.definitionVi,
          contextualMeaningVi: v.contextualMeaningVi || v.definitionVi,
          definitionEn: v.definitionEn,
          exampleInAudio: v.exampleInAudio,
          exampleTranslationVi: v.exampleTranslationVi || '',
          timestampLabel: v.timestampLabel,
          sourceTitle: testPack.title,
          status: 'new',
          addedAt: '',
          isSaved: false,
          sourceVocab: v,
        };
      });
    }

    return flashcards.map((fc) => ({
      ...fc,
      isSaved: true,
    }));
  }, [scope, testPack, flashcards, savedByKey]);

  const filteredCards = useMemo(() => {
    if (filter === 'all') return baseCards;
    return baseCards.filter((c) => c.status === filter);
  }, [baseCards, filter]);

  const safeIndex =
    filteredCards.length > 0 ? Math.min(cardIndex, filteredCards.length - 1) : 0;
  const currentCard = filteredCards[safeIndex];

  const savedSetForTest = useMemo(() => {
    return new Set(
      flashcards
        .filter((f) => !f.testId || f.testId === testPack.id)
        .map((f) => f.word.toLowerCase())
    );
  }, [flashcards, testPack.id]);

  const speakWord = (word: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = 'en-GB';
    utter.rate = 0.92;
    window.speechSynthesis.speak(utter);
  };

  const handleSetCardStatus = (card: LessonDeckCard, nextStatus: FlashcardItem['status']) => {
    if (card.isSaved) {
      onUpdateStatus(card.id, nextStatus);
    } else if (card.sourceVocab) {
      onSaveFlashcard(card.sourceVocab, nextStatus);
    }
  };

  const handleTranslateAndAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = customWord.trim();
    if (!cleaned) return;
    setIsTranslating(true);
    setTranslateError(null);
    try {
      const seg =
        testPack.segments.find((s) => s.id === selectedSegmentId) ||
        testPack.segments.find((s) =>
          s.text.toLowerCase().includes(cleaned.toLowerCase())
        ) ||
        testPack.segments[0];
      await onTranslateVocab(
        cleaned,
        seg?.text || '',
        seg?.startSec ?? 0,
        seg?.timestampLabel ?? '[00:00.00]'
      );
      setCustomWord('');
      setScope('lesson');
      setFilter('all');
    } catch (err: unknown) {
      setTranslateError(
        err instanceof Error ? err.message : 'Không thể dịch từ theo ngữ cảnh bài.'
      );
    } finally {
      setIsTranslating(false);
    }
  };

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = customWord.trim();
    if (!cleaned) return;
    setIsTranslating(true);
    setTranslateError(null);
    try {
      const seg =
        testPack.segments.find((s) => s.id === selectedSegmentId) ||
        testPack.segments[0];
      const newVocab: AwlVocabItem = {
        id: `manual-${Date.now()}`,
        word: cleaned,
        ipa: manualIpa.trim() || '/.../',
        pos: 'academic',
        definitionVi: manualDef.trim() || cleaned,
        contextualMeaningVi: manualDef.trim() || cleaned,
        definitionEn: '',
        exampleInAudio: seg?.text || '',
        exampleTranslationVi: '',
        timestampSec: seg?.startSec ?? 0,
        timestampLabel: seg?.timestampLabel ?? '[00:00.00]',
        collocations: [],
      };
      onSaveFlashcard(newVocab, 'new');
      setCustomWord('');
      setManualDef('');
      setManualIpa('');
      setScope('lesson');
      setFilter('all');
    } catch (err: unknown) {
      setTranslateError(
        err instanceof Error ? err.message : 'Không thể lưu từ vựng thủ công.'
      );
    } finally {
      setIsTranslating(false);
    }
  };

  return (
    <div className="max-w-[1240px] mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 sm:space-y-8">
      {/* Top Emerald Banner (Tiếng Anh Thầy Phúc - Vocabulary Bank style) */}
      <div className="bg-[#15803D] text-white rounded-2xl p-5 md:p-6 shadow-md flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="inline-block text-[11px] font-black uppercase tracking-wider text-emerald-200 bg-emerald-800/80 px-3 py-1 rounded-full border border-emerald-600/50 mb-2">
            VOCABULARY BANK • {testPack.partLabel}
          </span>
          <h1 className="text-2xl md:text-3xl font-black text-white tracking-tight">
            {testPack.title}
          </h1>
          <p className="text-xs sm:text-sm text-emerald-100 font-medium mt-1">
            Chủ đề: <strong className="text-white">{testPack.topic}</strong> · Mục tiêu: <strong className="text-white">{testPack.bandTarget}</strong> · Kho <strong className="text-white">{testPack.vocabulary.length}</strong> từ vựng sát ngữ cảnh bài
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <label htmlFor="vocab-lesson-select" className="text-xs font-bold text-emerald-100">
            Chọn bài:
          </label>
          <select
            id="vocab-lesson-select"
            value={testPack.id}
            onChange={(e) => onSelectTest(e.target.value)}
            className="text-xs font-black text-[#15803D] bg-white border border-emerald-300 rounded-xl px-3.5 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 shadow-sm cursor-pointer"
          >
            {allTests.map((t) => (
              <option key={t.id} value={t.id}>
                {t.partLabel} — {t.title} ({t.vocabulary.length} từ)
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Dictionary Quick Strip from Image 3 */}
      {currentCard && (
        <div className="bg-[#0F172A] border border-slate-800 rounded-2xl p-3.5 sm:px-5 flex flex-wrap items-center justify-between gap-3 text-white shadow-xl">
          <div className="flex flex-wrap items-center gap-2.5 sm:gap-3">
            <span className="bg-orange-500 text-white font-black text-[11px] px-2.5 py-1 rounded-md uppercase tracking-wider shadow-xs">
              TRA TỪ & IPA (EN-GB)
            </span>
            <span className="text-amber-400 font-black text-xl md:text-2xl tracking-tight">
              {currentCard.word}
            </span>
            <button
              type="button"
              onClick={() => speakWord(currentCard.word)}
              className="p-1.5 rounded-full bg-slate-800 hover:bg-slate-700 text-amber-400 transition-colors cursor-pointer"
              title="Phát âm từ này"
            >
              <Volume2 className="w-4 h-4 fill-current" />
            </button>
            {currentCard.ipa && (
              <span className="text-cyan-300 font-mono text-xs sm:text-sm font-bold bg-slate-800/90 px-2.5 py-1 rounded-md border border-slate-700">
                {currentCard.ipa}
              </span>
            )}
            {currentCard.pos && (
              <span className="bg-emerald-600 text-white font-extrabold text-[10px] sm:text-[11px] px-2.5 py-0.5 rounded-md uppercase">
                {currentCard.pos}
              </span>
            )}
            <span className="text-white font-bold text-sm md:text-base">
              {currentCard.contextualMeaningVi || currentCard.definitionVi}
            </span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={() => speakWord(currentCard.word)}
              className="px-4 py-1.5 rounded-full bg-amber-400 hover:bg-amber-300 text-amber-950 font-black text-xs transition-transform hover:scale-105 active:scale-95 shadow-md cursor-pointer"
            >
              Phát âm từ
            </button>
            {currentCard.timestampLabel && (
              <button
                type="button"
                onClick={() => {
                  const sec = parseTimestampToSec(currentCard.timestampLabel);
                  if (sec !== null) onSeekAndPlay(sec);
                }}
                className="px-4 py-1.5 rounded-full bg-indigo-900/90 hover:bg-indigo-800 text-indigo-100 font-bold text-xs transition-colors cursor-pointer border border-indigo-700/60"
              >
                Nghe câu ví dụ {currentCard.timestampLabel}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Filter Tabs Strip */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-emerald-100 p-3 rounded-2xl shadow-2xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Scope Switcher: Current Lesson vs All Saved Cards */}
          <div
            role="group"
            aria-label="Phạm vi từ vựng"
            className="flex items-center gap-1 p-1 bg-emerald-50/80 rounded-xl border border-emerald-200"
          >
            <button
              type="button"
              onClick={() => {
                setScope('lesson');
                setCardIndex(0);
                setIsFlipped(false);
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                scope === 'lesson'
                  ? 'bg-[#15803D] text-white shadow-xs font-black'
                  : 'text-emerald-900 hover:text-emerald-950 hover:bg-white/80'
              }`}
            >
              Theo bài này ({testPack.vocabulary.length})
            </button>
            <button
              type="button"
              onClick={() => {
                setScope('all');
                setCardIndex(0);
                setIsFlipped(false);
              }}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                scope === 'all'
                  ? 'bg-[#15803D] text-white shadow-xs font-black'
                  : 'text-emerald-900 hover:text-emerald-950 hover:bg-white/80'
              }`}
            >
              Tất cả thẻ đã lưu ({flashcards.length})
            </button>
          </div>

          <div
            role="group"
            aria-label="Lọc trạng thái thẻ"
            className="flex items-center gap-1 p-1 bg-emerald-50/80 rounded-xl border border-emerald-200"
          >
            {(
              [
                { id: 'all', label: `Tất cả (${baseCards.length})` },
                { id: 'new', label: 'Từ mới' },
                { id: 'reviewing', label: 'Đang ôn' },
                { id: 'mastered', label: 'Đã thuộc' },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  setFilter(tab.id);
                  setCardIndex(0);
                  setIsFlipped(false);
                }}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === tab.id
                    ? 'bg-[#15803D] text-white shadow-xs font-black'
                    : 'text-emerald-900 hover:text-emerald-950 hover:bg-white/80'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs font-semibold text-emerald-800">
          Tổng cộng: <strong className="text-emerald-950 font-black">{filteredCards.length}</strong> thẻ từ vựng
        </div>
      </div>

      {/* Interactive Flashcard Deck Stage */}
      <section aria-label="Ôn tập thẻ ghi nhớ" className="bg-white border border-emerald-100 rounded-3xl p-6 md:p-8 shadow-sm">
        {currentCard ? (
          <div className="max-w-3xl mx-auto space-y-6">
            <div className="flex items-center justify-between text-xs font-bold text-emerald-900">
              <span className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse"></span>
                <span>Bài: {currentCard.sourceTitle} · {currentCard.timestampLabel}</span>
              </span>
              <span className="font-mono tabular-nums bg-emerald-50 text-emerald-900 border border-emerald-200 px-3 py-1 rounded-full text-xs font-extrabold shadow-2xs">
                Thẻ {safeIndex + 1} / {filteredCards.length}
              </span>
            </div>

            {/* THE GREEN FLASHCARD WITH 40PT WHITE FONT */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setIsFlipped((prev) => !prev)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setIsFlipped((prev) => !prev);
                }
              }}
              className="min-h-[290px] md:min-h-[330px] p-8 md:p-12 bg-[#15803D] hover:bg-[#166534] border-4 border-emerald-500/80 rounded-3xl shadow-xl hover:shadow-2xl flex flex-col items-center justify-center text-center cursor-pointer transition-all text-white select-none group"
            >
              {!isFlipped ? (
                <>
                  <span className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-emerald-100 mb-3 px-3.5 py-1 rounded-full bg-emerald-800/90 border border-emerald-600/60 shadow-xs">
                    {currentCard.pos || 'vocabulary'} · Nhấn để lật xem nghĩa tiếng Việt theo ngữ cảnh bài
                  </span>
                  <h2 className="text-[34pt] sm:text-[40pt] font-black text-white tracking-tight leading-none drop-shadow-md my-4">
                    {currentCard.word}
                  </h2>
                  {currentCard.ipa && (
                    <p className="text-base sm:text-xl font-mono text-emerald-200 font-bold bg-emerald-900/80 px-4 py-1.5 rounded-full border border-emerald-600/60 shadow-inner">
                      {currentCard.ipa}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      speakWord(currentCard.word);
                    }}
                    className="mt-6 inline-flex items-center gap-2 px-6 py-2.5 text-xs sm:text-sm font-black text-amber-950 bg-amber-400 hover:bg-amber-300 rounded-full shadow-lg transition-transform hover:scale-105 active:scale-95 cursor-pointer"
                  >
                    <Volume2 className="w-4 h-4 fill-current" aria-hidden="true" />
                    <span>Phát âm</span>
                  </button>
                </>
              ) : (
                <div className="space-y-4 max-w-xl">
                  <div className="text-xs sm:text-sm font-extrabold uppercase tracking-wider text-amber-300 bg-emerald-900/90 px-4 py-1 rounded-full border border-emerald-600/60 inline-block shadow-xs">
                    Nghĩa tiếng Việt theo ngữ cảnh bài
                  </div>
                  <div className="text-2xl sm:text-3xl md:text-4xl font-black text-white leading-snug">
                    {currentCard.contextualMeaningVi || currentCard.definitionVi}
                  </div>
                  {currentCard.contextualMeaningVi &&
                    currentCard.definitionVi !== currentCard.contextualMeaningVi && (
                      <div className="text-xs sm:text-sm text-emerald-100">
                        Nghĩa phổ thông: {currentCard.definitionVi}
                      </div>
                    )}
                  <div className="pt-4 border-t border-emerald-600/80 space-y-1.5">
                    <div className="text-base sm:text-lg text-emerald-100 italic">
                      “{currentCard.exampleInAudio}”
                    </div>
                    {currentCard.exampleTranslationVi && (
                      <div className="text-sm font-semibold text-white">
                        → {currentCard.exampleTranslationVi}
                      </div>
                    )}
                  </div>
                  <span className="text-[11px] text-emerald-200/90 block mt-2">
                    Nhấp vào thẻ để lật lại mặt trước
                  </span>
                </div>
              )}
            </div>

            {/* Navigation & Status controls below card */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCardIndex((prev) =>
                      prev > 0 ? prev - 1 : filteredCards.length - 1
                    );
                    setIsFlipped(false);
                  }}
                  aria-label="Thẻ trước"
                  className="p-2.5 border border-emerald-300 bg-emerald-50/70 rounded-xl text-emerald-900 hover:bg-emerald-100 cursor-pointer transition-colors shadow-2xs font-bold"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsFlipped((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-extrabold border border-emerald-300 bg-white rounded-xl text-emerald-900 hover:bg-emerald-50 cursor-pointer transition-colors shadow-2xs"
                >
                  <RotateCw className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
                  <span>Lật thẻ</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCardIndex((prev) => (prev + 1) % filteredCards.length);
                    setIsFlipped(false);
                  }}
                  aria-label="Thẻ tiếp theo"
                  className="p-2.5 border border-emerald-300 bg-emerald-50/70 rounded-xl text-emerald-900 hover:bg-emerald-100 cursor-pointer transition-colors shadow-2xs font-bold"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSetCardStatus(currentCard, 'reviewing')}
                  className={`px-4 py-2.5 text-xs font-bold rounded-xl border transition-colors cursor-pointer shadow-2xs ${
                    currentCard.status === 'reviewing'
                      ? 'bg-amber-100 border-amber-400 text-amber-950 font-black'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-amber-50 hover:text-amber-900'
                  }`}
                >
                  Cần ôn lại
                </button>
                <button
                  type="button"
                  onClick={() => handleSetCardStatus(currentCard, 'mastered')}
                  className={`inline-flex items-center gap-1 px-4 py-2.5 text-xs font-bold rounded-xl border transition-colors cursor-pointer shadow-2xs ${
                    currentCard.status === 'mastered'
                      ? 'bg-emerald-700 border-emerald-700 text-white font-black'
                      : 'bg-white border-emerald-300 text-emerald-800 hover:bg-emerald-50'
                  }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Đã thuộc</span>
                </button>
                {currentCard.isSaved && (
                  <button
                    type="button"
                    onClick={() => onDeleteFlashcard(currentCard.id)}
                    aria-label="Xóa thẻ này"
                    className="p-2 text-slate-400 hover:text-red-700 cursor-pointer"
                    title="Xóa khỏi kho thẻ cá nhân"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-sm text-slate-600">
              Chưa có thẻ ghi nhớ nào trong bộ lọc này. Hãy chuyển bộ lọc hoặc thêm từ vựng ở bảng bên dưới!
            </p>
          </div>
        )}
      </section>

      {/* Contextual AI Vocabulary Translator for the Current Passage */}
      <section className="bg-white border border-emerald-100 rounded-3xl p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h2 className="text-base font-extrabold text-[#15803D]">
              Tự dịch từ vựng sang tiếng Việt theo ngữ cảnh bài: {testPack.title}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Nhập bất kỳ từ/cụm từ nào nghe được trong bài; AI sẽ phiên âm IPA và dịch sát nghĩa theo đúng ngữ cảnh đoạn thoại đã chọn
            </p>
          </div>
          <div className="flex items-center gap-1.5 p-1 bg-emerald-50/80 rounded-xl border border-emerald-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setAddMode('ai')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                addMode === 'ai'
                  ? 'bg-[#15803D] text-white shadow-2xs font-extrabold'
                  : 'text-emerald-900 hover:text-[#15803D]'
              }`}
            >
              ✨ Dịch AI theo ngữ cảnh
            </button>
            <button
              type="button"
              onClick={() => setAddMode('manual')}
              className={`px-3 py-1.5 rounded-lg transition-colors cursor-pointer ${
                addMode === 'manual'
                  ? 'bg-[#15803D] text-white shadow-2xs font-extrabold'
                  : 'text-emerald-900 hover:text-[#15803D]'
              }`}
            >
              ✍️ Tự nhập thủ công
            </button>
          </div>
        </div>

        {addMode === 'ai' ? (
          <form onSubmit={handleTranslateAndAdd} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="text"
                value={customWord}
                onChange={(e) => setCustomWord(e.target.value)}
                placeholder="Nhập từ hoặc cụm từ (ví dụ: fortress, counter-illumination, induction...)"
                className="flex-1 text-sm bg-white border border-emerald-300 focus:border-[#15803D] focus:ring-2 focus:ring-[#15803D]/20 rounded-xl px-4 py-2.5 outline-none font-bold text-slate-900 shadow-2xs"
              />
              <select
                value={selectedSegmentId}
                onChange={(e) => setSelectedSegmentId(e.target.value)}
                className="text-xs font-semibold bg-emerald-50/50 border border-emerald-300 rounded-xl px-3 py-2.5 text-emerald-900 max-w-full sm:max-w-xs truncate cursor-pointer shadow-2xs"
              >
                {testPack.segments.map((seg) => (
                  <option key={seg.id} value={seg.id}>
                    {seg.timestampLabel} ({seg.speaker}): {seg.text}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                disabled={isTranslating || !customWord.trim()}
                className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-xs font-black text-white bg-[#15803D] hover:bg-[#166534] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 shadow-sm"
              >
                {isTranslating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>AI đang dịch sát bài...</span>
                  </>
                ) : (
                  <>
                    <Languages className="w-3.5 h-3.5" />
                    <span>Dịch & Thêm vào bài</span>
                  </>
                )}
              </button>
            </div>
            {translateError && (
              <p role="alert" className="text-xs text-red-700">
                {translateError}
              </p>
            )}
          </form>
        ) : (
          <form onSubmit={handleManualAdd} className="space-y-3">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <input
                type="text"
                value={customWord}
                onChange={(e) => setCustomWord(e.target.value)}
                placeholder="Từ vựng (vd: fortress)..."
                className="md:col-span-3 text-sm bg-white border border-emerald-300 focus:border-[#15803D] focus:ring-2 focus:ring-[#15803D]/20 rounded-xl px-3.5 py-2.5 outline-none font-bold text-slate-900 shadow-2xs"
              />
              <input
                type="text"
                value={manualDef}
                onChange={(e) => setManualDef(e.target.value)}
                placeholder="Nghĩa tiếng Việt theo bài (vd: pháo đài phòng thủ)..."
                className="md:col-span-4 text-sm bg-white border border-emerald-300 focus:border-[#15803D] focus:ring-2 focus:ring-[#15803D]/20 rounded-xl px-3.5 py-2.5 outline-none font-medium shadow-2xs"
              />
              <input
                type="text"
                value={manualIpa}
                onChange={(e) => setManualIpa(e.target.value)}
                placeholder="Phiên âm IPA (tùy chọn, vd: /ˈfɔːtrəs/)..."
                className="md:col-span-2 text-xs bg-white border border-emerald-300 focus:border-[#15803D] focus:ring-2 focus:ring-[#15803D]/20 rounded-xl px-3 py-2.5 outline-none font-mono shadow-2xs"
              />
              <button
                type="submit"
                disabled={isTranslating || !customWord.trim()}
                className="md:col-span-3 inline-flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-black text-white bg-[#15803D] hover:bg-[#166534] rounded-xl transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50 shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Lưu từ vựng thủ công</span>
              </button>
            </div>
            {translateError && (
              <p role="alert" className="text-xs text-red-700">
                {translateError}
              </p>
            )}
          </form>
        )}
      </section>

      {/* Lesson Vocabulary Table */}
      <section className="bg-white border border-emerald-100 rounded-3xl overflow-hidden shadow-sm">
        <div className="px-6 py-4 border-b border-emerald-100 bg-emerald-50/60 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-extrabold text-[#15803D]">
              Danh sách từ vựng của bài: {testPack.title}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tự động hiển thị theo bài đang chọn kèm nghĩa tiếng Việt sát ngữ cảnh và bản dịch câu mẫu trong Audio
            </p>
          </div>
          <span className="px-3 py-1 rounded-full bg-emerald-100 text-emerald-900 font-extrabold text-xs border border-emerald-300">
            {testPack.vocabulary.length} từ vựng
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-emerald-100 text-xs font-extrabold text-emerald-900 bg-emerald-50/40">
                <th className="py-3 px-4">Từ vựng</th>
                <th className="py-3 px-4">IPA</th>
                <th className="py-3 px-4">Nghĩa tiếng Việt theo ngữ cảnh bài</th>
                <th className="py-3 px-4">Ngữ cảnh Audio & Bản dịch</th>
                <th className="py-3 px-4 text-right">Flashcard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-emerald-100 text-sm">
              {testPack.vocabulary.map((item) => {
                const isSaved = savedSetForTest.has(item.word.toLowerCase());
                return (
                  <tr key={item.word} className="hover:bg-emerald-50/40 align-top transition-colors">
                    <td className="py-3.5 px-4 font-black text-slate-900">
                      {item.word}
                      <span className="block text-xs font-normal text-emerald-700 font-semibold">
                        {item.pos}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-emerald-800 font-bold whitespace-nowrap">
                      {item.ipa}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 max-w-xs">
                      <div className="font-bold text-slate-900">
                        {item.contextualMeaningVi || item.definitionVi}
                      </div>
                      {item.contextualMeaningVi &&
                        item.definitionVi !== item.contextualMeaningVi && (
                          <div className="text-xs text-slate-500 mt-0.5">
                            Nghĩa chung: {item.definitionVi}
                          </div>
                        )}
                    </td>
                    <td className="py-3.5 px-4 text-xs text-slate-600 max-w-sm space-y-1">
                      <div>
                        “{item.exampleInAudio}”
                        <button
                          type="button"
                          onClick={() => onSeekAndPlay(item.timestampSec)}
                          className="ml-2 inline-flex items-center gap-0.5 font-mono text-emerald-700 hover:text-emerald-900 font-bold hover:underline cursor-pointer"
                        >
                          <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                          {item.timestampLabel}
                        </button>
                      </div>
                      {item.exampleTranslationVi && (
                        <div className="text-slate-500 italic">
                          → {item.exampleTranslationVi}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {isSaved ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          Đã lưu
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSaveFlashcard(item)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-white bg-[#15803D] hover:bg-[#166534] rounded-lg cursor-pointer transition-colors shadow-2xs"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          Lưu thẻ
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
