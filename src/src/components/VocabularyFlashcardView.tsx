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

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-8">
      {/* Header + Lesson Selector + Scope & Status Filters */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-2">
          <p className="text-xs font-medium text-slate-500">
            Từ vựng đi theo từng bài nghe · Tự dịch tiếng Việt sát ngữ cảnh bài
          </p>
          <h1 className="text-2xl font-bold text-slate-900">
            Kho từ vựng theo bài & Flashcards
          </h1>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <label htmlFor="vocab-lesson-select" className="text-xs font-semibold text-slate-600">
              Bài nghe đang học:
            </label>
            <select
              id="vocab-lesson-select"
              value={testPack.id}
              onChange={(e) => onSelectTest(e.target.value)}
              className="text-xs font-medium text-slate-800 bg-white border border-slate-300 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-700"
            >
              {allTests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.partLabel} — {t.title} ({t.vocabulary.length} từ)
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/* Scope Switcher: Current Lesson vs All Saved Cards */}
          <div
            role="group"
            aria-label="Phạm vi từ vựng"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
          >
            <button
              type="button"
              onClick={() => {
                setScope('lesson');
                setCardIndex(0);
                setIsFlipped(false);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                scope === 'lesson'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
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
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                scope === 'all'
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tất cả thẻ đã lưu ({flashcards.length})
            </button>
          </div>

          <div
            role="group"
            aria-label="Lọc trạng thái thẻ"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg"
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
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                  filter === tab.id
                    ? 'bg-white text-slate-900 shadow-sm'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Contextual AI Vocabulary Translator for the Current Passage */}
      <section className="bg-white border border-slate-200 rounded-xl p-5">
        <form onSubmit={handleTranslateAndAdd} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Tự dịch từ vựng sang tiếng Việt theo ngữ cảnh bài: {testPack.title}
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Nhập bất kỳ từ/cụm từ nào nghe được trong bài; AI sẽ phiên âm IPA và dịch sát nghĩa theo đúng ngữ cảnh đoạn thoại đã chọn
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <input
              type="text"
              value={customWord}
              onChange={(e) => setCustomWord(e.target.value)}
              placeholder="Ví dụ: bottleneck, counter-illumination, induction..."
              className="md:col-span-4 text-sm bg-white border border-slate-300 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-lg px-3.5 py-2 outline-none"
            />
            <select
              value={selectedSegmentId}
              onChange={(e) => setSelectedSegmentId(e.target.value)}
              aria-label="Chọn đoạn ngữ cảnh trong bài"
              className="md:col-span-5 text-xs text-slate-700 bg-slate-50 border border-slate-300 rounded-lg px-3 py-2 outline-none"
            >
              {testPack.segments.map((seg) => (
                <option key={seg.id} value={seg.id}>
                  {seg.timestampLabel} ({seg.speaker}): {seg.text.slice(0, 72)}
                  {seg.text.length > 72 ? '...' : ''}
                </option>
              ))}
            </select>
            <button
              type="submit"
              disabled={isTranslating || !customWord.trim()}
              className="md:col-span-3 inline-flex items-center justify-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-50"
            >
              {isTranslating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Đang dịch theo ngữ cảnh...
                </>
              ) : (
                <>
                  <Languages className="w-3.5 h-3.5" aria-hidden="true" />
                  Dịch & Thêm vào bài
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
      </section>

      {/* Interactive Flashcard Deck Stage */}
      <section aria-label="Ôn tập thẻ ghi nhớ" className="bg-white border border-slate-200 rounded-xl p-6">
        {currentCard ? (
          <div className="max-w-2xl mx-auto space-y-5">
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>
                Bài: {currentCard.sourceTitle} · {currentCard.timestampLabel}
              </span>
              <span className="font-mono tabular-nums">
                Thẻ {safeIndex + 1}/{filteredCards.length}
              </span>
            </div>

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
              className="min-h-[240px] p-8 bg-slate-50 border border-slate-200 rounded-xl flex flex-col items-center justify-center text-center cursor-pointer transition-colors hover:bg-slate-100/70"
            >
              {!isFlipped ? (
                <>
                  <span className="text-xs font-medium text-slate-500 mb-2">
                    {currentCard.pos} · Nhấn để lật xem nghĩa tiếng Việt theo ngữ cảnh bài
                  </span>
                  <h2 className="text-3xl font-bold text-slate-900">{currentCard.word}</h2>
                  <p className="text-sm font-mono text-blue-700 mt-2">{currentCard.ipa}</p>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      speakWord(currentCard.word);
                    }}
                    className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer"
                  >
                    <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                    Phát âm
                  </button>
                </>
              ) : (
                <div className="space-y-3 max-w-xl">
                  <div className="text-xs font-semibold text-blue-700">
                    Nghĩa tiếng Việt theo ngữ cảnh bài
                  </div>
                  <div className="text-lg font-bold text-slate-900">
                    {currentCard.contextualMeaningVi || currentCard.definitionVi}
                  </div>
                  {currentCard.contextualMeaningVi &&
                    currentCard.definitionVi !== currentCard.contextualMeaningVi && (
                      <div className="text-xs text-slate-500">
                        Nghĩa phổ thông: {currentCard.definitionVi}
                      </div>
                    )}
                  <div className="pt-3 border-t border-slate-200 space-y-1.5">
                    <div className="text-sm text-slate-800 italic">
                      “{currentCard.exampleInAudio}”
                    </div>
                    {currentCard.exampleTranslationVi && (
                      <div className="text-xs text-slate-600">
                        → {currentCard.exampleTranslationVi}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
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
                  className="p-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => setIsFlipped((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" aria-hidden="true" />
                  Lật thẻ
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCardIndex((prev) => (prev + 1) % filteredCards.length);
                    setIsFlipped(false);
                  }}
                  aria-label="Thẻ tiếp theo"
                  className="p-2 border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleSetCardStatus(currentCard, 'reviewing')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                    currentCard.status === 'reviewing'
                      ? 'bg-amber-50 border-amber-400 text-amber-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Cần ôn lại
                </button>
                <button
                  type="button"
                  onClick={() => handleSetCardStatus(currentCard, 'mastered')}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer ${
                    currentCard.status === 'mastered'
                      ? 'bg-emerald-50 border-emerald-500 text-emerald-900'
                      : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Đã thuộc
                </button>
                {currentCard.isSaved && (
                  <button
                    type="button"
                    onClick={() => onDeleteFlashcard(currentCard.id)}
                    aria-label="Xóa thẻ này"
                    className="p-2 text-slate-400 hover:text-red-700 cursor-pointer"
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

      {/* Lesson Vocabulary Table */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              Danh sách từ vựng của bài: {testPack.title}
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tự động hiển thị theo bài đang chọn kèm nghĩa tiếng Việt sát ngữ cảnh và bản dịch câu mẫu trong Audio
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-semibold text-slate-600 bg-slate-50/40">
                <th className="py-3 px-4">Từ vựng</th>
                <th className="py-3 px-4">IPA</th>
                <th className="py-3 px-4">Nghĩa tiếng Việt theo ngữ cảnh bài</th>
                <th className="py-3 px-4">Ngữ cảnh Audio & Bản dịch</th>
                <th className="py-3 px-4 text-right">Flashcard</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {testPack.vocabulary.map((item) => {
                const isSaved = savedSetForTest.has(item.word.toLowerCase());
                return (
                  <tr key={item.word} className="hover:bg-slate-50/60 align-top">
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      {item.word}
                      <span className="block text-xs font-normal text-slate-500">
                        {item.pos}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                      {item.ipa}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 max-w-xs">
                      <div className="font-medium text-slate-900">
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
                          className="ml-2 inline-flex items-center gap-0.5 font-mono text-blue-700 hover:underline cursor-pointer"
                        >
                          <Play className="w-2.5 h-2.5" aria-hidden="true" />
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
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          Đã lưu
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSaveFlashcard(item)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer"
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
