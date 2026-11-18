import React, { useEffect, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Maximize,
  Minimize,
  Play,
  Repeat,
  Sparkles,
  Volume2,
  X,
  FileDown,
  Eye,
  EyeOff,
} from 'lucide-react';
import type { ClassroomDrillSentence, ListeningTestPack } from '../types/ielts';
import { exportDictationSlidesPptx } from '../utils/pptxExport';

interface ClassroomSlideModalProps {
  isOpen: boolean;
  onClose: () => void;
  testPack: ListeningTestPack;
  drills?: ClassroomDrillSentence[];
  onPlaySegment: (startSec: number, endSec?: number) => void;
  isPlaying?: boolean;
}

export const ClassroomSlideModal: React.FC<ClassroomSlideModalProps> = ({
  isOpen,
  onClose,
  testPack,
  drills: propDrills,
  onPlaySegment,
  isPlaying = false,
}) => {
  const drills: ClassroomDrillSentence[] =
    propDrills && propDrills.length > 0
      ? propDrills
      : testPack.classroomDrills && testPack.classroomDrills.length > 0
        ? testPack.classroomDrills
        : testPack.segments.slice(0, 12).map((seg, i) => ({
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

  const [currentSlideIdx, setCurrentSlideIdx] = useState(0);
  const [isLooping, setIsLooping] = useState(false);
  const [revealSentence, setRevealSentence] = useState(true);

  // Keyboard navigation: Left/Right arrows, Space
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault();
        setCurrentSlideIdx((prev) => (prev < drills.length - 1 ? prev + 1 : 0));
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        setCurrentSlideIdx((prev) => (prev > 0 ? prev - 1 : drills.length - 1));
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, drills.length, onClose]);

  if (!isOpen || drills.length === 0) return null;

  const currentDrill = drills[currentSlideIdx];

  const handlePlayCurrent = () => {
    onPlaySegment(currentDrill.startSec, currentDrill.endSec);
  };

  const maskSentenceForDictation = (text: string) => {
    return text.replace(/[a-zA-Z]{4,}/g, (match) => match[0] + '_'.repeat(match.length - 1));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="classroom-slide-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6 bg-slate-950/90 backdrop-blur-md animate-fadeIn select-none"
    >
      <div className="relative w-full max-w-6xl aspect-[16/9] max-h-[92vh] bg-slate-900 border border-slate-800 rounded-3xl overflow-hidden shadow-2xl flex flex-col text-white">
        {/* Slide Top Navigation Strip */}
        <div className="px-6 py-4 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <span className="px-3 py-1 bg-blue-600 font-bold text-xs rounded-full uppercase tracking-wider">
              Slide {currentSlideIdx + 1}/{drills.length}
            </span>
            <span id="classroom-slide-title" className="text-sm font-semibold text-slate-300 hidden sm:inline">
              {testPack.title} ({testPack.partLabel})
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setRevealSentence((prev) => !prev)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
                revealSentence
                  ? 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                  : 'bg-amber-600 text-white border-amber-500'
              }`}
              title="Ẩn/Hiện câu để học sinh luyện chép chính tả tại lớp"
            >
              {revealSentence ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              <span>{revealSentence ? 'Hiện đầy đủ câu' : 'Đang ẩn câu (Dictation Mode)'}</span>
            </button>

            <button
              type="button"
              onClick={() => exportDictationSlidesPptx(testPack)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors cursor-pointer"
              title="Tải bài giảng slide về máy tính"
            >
              <FileDown className="w-3.5 h-3.5" />
              <span>Tải Slide bài giảng (.html/.pptx)</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors cursor-pointer"
              aria-label="Đóng chế độ trình chiếu"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* 16:9 Slide Presentation Canvas */}
        <div className="flex-1 p-8 md:p-12 flex flex-col justify-between overflow-y-auto">
          {/* Header of the Slide */}
          <div className="flex items-center justify-between border-b border-slate-800/80 pb-4">
            <div className="flex items-center gap-3">
              <span className="text-xl md:text-2xl font-extrabold text-blue-400 font-mono">
                CÂU {String(currentDrill.order).padStart(2, '0')}
              </span>
              <span className="text-slate-400 text-sm md:text-base font-semibold">
                Người nói: <strong className="text-slate-200">{currentDrill.speaker}</strong>
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="font-mono text-sm md:text-base text-blue-400 font-bold bg-blue-950/60 border border-blue-800/60 px-3 py-1 rounded-lg">
                {currentDrill.timestampLabel} ({currentDrill.startSec.toFixed(1)}s – {currentDrill.endSec.toFixed(1)}s)
              </span>

              <button
                type="button"
                onClick={handlePlayCurrent}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm rounded-xl transition-all shadow-lg hover:scale-105 active:scale-95 cursor-pointer"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>Phát Audio câu này</span>
              </button>
            </div>
          </div>

          {/* Core Sentence Presentation Area */}
          <div className="my-auto py-6">
            <div className="bg-slate-800/50 border-l-8 border-blue-500 rounded-2xl p-6 md:p-8 backdrop-blur-xs">
              <p className="text-2xl md:text-4xl font-extrabold leading-snug tracking-tight text-white mb-3">
                “{revealSentence ? currentDrill.sentence : maskSentenceForDictation(currentDrill.sentence)}”
              </p>
              {currentDrill.translationVi && (
                <p className="text-base md:text-lg text-slate-400 font-medium leading-relaxed">
                  {currentDrill.translationVi}
                </p>
              )}
            </div>
          </div>

          {/* Linguistic Stress & Connected Speech Insights */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-slate-800/80">
            <div className="bg-slate-800/60 border border-slate-700/80 rounded-xl p-4">
              <span className="text-xs font-bold text-blue-400 uppercase tracking-wider block mb-1">
                Trọng âm chính (Word Stress)
              </span>
              <p className="text-sm md:text-base font-mono font-bold text-slate-200">
                {currentDrill.stressPattern || 'Nhấn mạnh các từ khóa mang thông tin chính'}
              </p>
            </div>

            <div className="bg-slate-800/60 border border-slate-700/80 rounded-xl p-4">
              <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider block mb-1">
                Hiện tượng nối âm & Ngữ điệu (Connected Speech)
              </span>
              <p className="text-sm md:text-base text-slate-200">
                {currentDrill.connectedSpeechNote || 'Lên giọng nhẹ ở mệnh đề phụ, hạ giọng ở cuối câu trần thuật.'}
              </p>
            </div>
          </div>
        </div>

        {/* Slide Bottom Bar Navigation */}
        <div className="px-6 py-4 bg-slate-900 border-t border-slate-800 flex items-center justify-between shrink-0">
          <div className="text-xs text-slate-400 flex items-center gap-2">
            <span>Dùng phím mũi tên</span>
            <kbd className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300 font-mono">←</kbd>
            <kbd className="px-2 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300 font-mono">→</kbd>
            <span>để chuyển câu</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setCurrentSlideIdx((prev) => (prev > 0 ? prev - 1 : drills.length - 1))}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors cursor-pointer"
              aria-label="Câu trước"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>

            <span className="text-sm font-mono font-bold px-3 py-1 bg-slate-800 rounded-lg text-slate-300 tabular-nums">
              {currentSlideIdx + 1} / {drills.length}
            </span>

            <button
              type="button"
              onClick={() => setCurrentSlideIdx((prev) => (prev < drills.length - 1 ? prev + 1 : 0))}
              className="p-2.5 bg-slate-800 hover:bg-slate-700 text-white rounded-xl transition-colors cursor-pointer"
              aria-label="Câu tiếp theo"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
