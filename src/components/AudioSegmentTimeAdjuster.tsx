import React, { useEffect, useId, useState } from 'react';
import {
  Play,
  Clock,
  SlidersHorizontal,
  ChevronDown,
  ChevronUp,
  Check,
  RotateCcw,
  Volume2,
} from 'lucide-react';
import {
  formatSecondsToTime,
  parseTimeToSeconds,
} from '../utils/audioTime';

export interface AudioSegmentTimeAdjusterProps {
  label?: string;
  startSec: number;
  endSec: number;
  currentTime?: number;
  maxDuration?: number;
  onChangeTime: (startSec: number, endSec: number) => void;
  onPlaySegment: (startSec: number, endSec: number) => void;
  isPlaying?: boolean;
  defaultExpanded?: boolean;
  compact?: boolean;
  className?: string;
}

export const AudioSegmentTimeAdjuster: React.FC<AudioSegmentTimeAdjusterProps> = ({
  label,
  startSec,
  endSec,
  currentTime,
  maxDuration,
  onChangeTime,
  onPlaySegment,
  isPlaying = false,
  defaultExpanded = false,
  compact = false,
  className = '',
}) => {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);
  const [startInput, setStartInput] = useState(() => formatSecondsToTime(startSec));
  const [endInput, setEndInput] = useState(() => formatSecondsToTime(endSec));
  const [showSavedNotice, setShowSavedNotice] = useState(false);
  const startInputId = useId();
  const endInputId = useId();

  // Sync inputs when props change from external source
  useEffect(() => {
    setStartInput(formatSecondsToTime(startSec));
  }, [startSec]);

  useEffect(() => {
    setEndInput(formatSecondsToTime(endSec));
  }, [endSec]);

  const durationSpan = Math.max(0, endSec - startSec);

  const notifySaved = () => {
    setShowSavedNotice(true);
    const timer = window.setTimeout(() => setShowSavedNotice(false), 1600);
    return () => window.clearTimeout(timer);
  };

  const applyNewTimes = (newStart: number, newEnd: number) => {
    const validMax = typeof maxDuration === 'number' && maxDuration > 0 ? maxDuration : 999999;
    let clampedStart = Number(Math.max(0, Math.min(validMax - 0.3, newStart)).toFixed(2));
    let clampedEnd = Number(Math.max(clampedStart + 0.3, Math.min(validMax, newEnd)).toFixed(2));

    if (clampedEnd <= clampedStart) {
      clampedEnd = Number((clampedStart + 0.5).toFixed(2));
    }

    setStartInput(formatSecondsToTime(clampedStart));
    setEndInput(formatSecondsToTime(clampedEnd));
    onChangeTime(clampedStart, clampedEnd);
    notifySaved();
  };

  const handleCommitStart = () => {
    const parsed = parseTimeToSeconds(startInput);
    if (parsed === null) {
      setStartInput(formatSecondsToTime(startSec));
      return;
    }
    let targetEnd = endSec;
    if (parsed >= targetEnd) {
      targetEnd = Number((parsed + 2.0).toFixed(2));
    }
    applyNewTimes(parsed, targetEnd);
  };

  const handleCommitEnd = () => {
    const parsed = parseTimeToSeconds(endInput);
    if (parsed === null) {
      setEndInput(formatSecondsToTime(endSec));
      return;
    }
    let targetStart = startSec;
    if (parsed <= targetStart) {
      targetStart = Number(Math.max(0, parsed - 2.0).toFixed(2));
    }
    applyNewTimes(targetStart, parsed);
  };

  const stepStart = (deltaSec: number) => {
    const nextStart = Number(Math.max(0, startSec + deltaSec).toFixed(2));
    let nextEnd = endSec;
    if (nextStart >= nextEnd) {
      nextEnd = Number((nextStart + 1.5).toFixed(2));
    }
    applyNewTimes(nextStart, nextEnd);
  };

  const stepEnd = (deltaSec: number) => {
    let nextEnd = Number((endSec + deltaSec).toFixed(2));
    let nextStart = startSec;
    if (nextEnd <= nextStart + 0.3) {
      nextEnd = Number((nextStart + 0.5).toFixed(2));
    }
    applyNewTimes(nextStart, nextEnd);
  };

  const captureCurrentForStart = () => {
    if (typeof currentTime !== 'number' || currentTime < 0) return;
    const pos = Number(currentTime.toFixed(2));
    let targetEnd = endSec;
    if (pos >= targetEnd) {
      targetEnd = Number((pos + 3.0).toFixed(2));
    }
    applyNewTimes(pos, targetEnd);
  };

  const captureCurrentForEnd = () => {
    if (typeof currentTime !== 'number' || currentTime < 0) return;
    const pos = Number(currentTime.toFixed(2));
    let targetStart = startSec;
    if (pos <= targetStart) {
      targetStart = Number(Math.max(0, pos - 3.0).toFixed(2));
    }
    applyNewTimes(targetStart, pos);
  };

  const isSegmentCurrentlyPlaying =
    isPlaying &&
    typeof currentTime === 'number' &&
    currentTime >= startSec - 0.2 &&
    currentTime <= endSec + 0.2;

  return (
    <div
      className={`rounded-xl border transition-all ${
        isSegmentCurrentlyPlaying
          ? 'border-blue-400 bg-blue-50/40 shadow-sm ring-1 ring-blue-300'
          : 'border-slate-200 bg-slate-50/80'
      } ${compact ? 'p-2.5 text-xs' : 'p-3.5 text-sm'} ${className}`}
    >
      {/* Top Bar / Summary Line */}
      <div className="flex flex-wrap items-center justify-between gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          {label && (
            <span className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-[#0F2744]" aria-hidden="true" />
              {label}
            </span>
          )}

          <button
            type="button"
            onClick={() => onPlaySegment(startSec, endSec)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 font-semibold rounded-lg text-xs transition-colors cursor-pointer whitespace-nowrap shadow-xs ${
              isSegmentCurrentlyPlaying
                ? 'bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse'
                : 'bg-[#0F2744] hover:bg-[#0A1B30] text-white'
            }`}
            title="Nhấn để nghe riêng đoạn này"
          >
            <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
            <span>
              Nghe đoạn [{formatSecondsToTime(startSec)} → {formatSecondsToTime(endSec)}]
            </span>
          </button>

          <span className="text-[11px] font-mono text-slate-500 bg-white border border-slate-200 px-2 py-0.5 rounded-md tabular-nums">
            {durationSpan.toFixed(1)}s
          </span>

          {showSavedNotice && (
            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md animate-fadeIn">
              <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
              Đã lưu mốc mới
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors cursor-pointer ${
            isExpanded
              ? 'bg-slate-900 text-white border-slate-900'
              : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-100'
          }`}
          aria-expanded={isExpanded}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
          <span>{isExpanded ? 'Đóng chỉnh mốc' : 'Chỉnh thời gian'}</span>
          {isExpanded ? (
            <ChevronUp className="w-3 h-3" aria-hidden="true" />
          ) : (
            <ChevronDown className="w-3 h-3" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Expanded Precision Adjustment Panel */}
      {isExpanded && (
        <div className="mt-3 pt-3 border-t border-slate-200/80 space-y-3">
          <div className="text-[11px] text-slate-500 flex flex-wrap items-center justify-between gap-2">
            <span>
              Điều chỉnh mốc <strong>Bắt đầu</strong> và <strong>Kết thúc</strong> để nghe chuẩn xác
              từng từ. Bấm nút <code>+/-</code> hoặc gõ trực tiếp (mm:ss.xx).
            </span>
            {typeof currentTime === 'number' && (
              <span className="font-mono text-slate-600 bg-white px-2 py-0.5 rounded border border-slate-200 tabular-nums">
                Đang phát tại: <strong className="text-[#0F2744]">{formatSecondsToTime(currentTime)}</strong>
              </span>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Start Time Tuning Column */}
            <div className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={startInputId}
                  className="text-xs font-bold text-slate-800 flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-emerald-500" aria-hidden="true" />
                  Mốc bắt đầu (Start)
                </label>
                <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {startSec.toFixed(2)}s
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  id={startInputId}
                  type="text"
                  value={startInput}
                  onChange={(e) => setStartInput(e.target.value)}
                  onBlur={handleCommitStart}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCommitStart();
                    }
                  }}
                  placeholder="00:00.00"
                  className="w-24 px-2 py-1 text-xs font-mono font-semibold text-slate-900 bg-slate-50 border border-slate-300 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => stepStart(-1)}
                    className="px-1.5 py-1 text-[11px] font-mono font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                    title="Lùi mốc bắt đầu 1 giây"
                  >
                    -1s
                  </button>
                  <button
                    type="button"
                    onClick={() => stepStart(-0.5)}
                    className="px-1.5 py-1 text-[11px] font-mono font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                    title="Lùi mốc bắt đầu 0.5 giây"
                  >
                    -0.5s
                  </button>
                  <button
                    type="button"
                    onClick={() => stepStart(0.5)}
                    className="px-1.5 py-1 text-[11px] font-mono font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                    title="Tăng mốc bắt đầu 0.5 giây"
                  >
                    +0.5s
                  </button>
                  <button
                    type="button"
                    onClick={() => stepStart(1)}
                    className="px-1.5 py-1 text-[11px] font-mono font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                    title="Tăng mốc bắt đầu 1 giây"
                  >
                    +1s
                  </button>
                </div>
              </div>

              {typeof currentTime === 'number' && (
                <button
                  type="button"
                  onClick={captureCurrentForStart}
                  className="w-full text-left inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 rounded cursor-pointer transition-colors"
                >
                  <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                  Gán mốc đang phát ({formatSecondsToTime(currentTime)}) làm Bắt đầu
                </button>
              )}
            </div>

            {/* End Time Tuning Column */}
            <div className="bg-white border border-slate-200 rounded-lg p-2.5 space-y-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor={endInputId}
                  className="text-xs font-bold text-slate-800 flex items-center gap-1.5"
                >
                  <span className="w-2 h-2 rounded-full bg-rose-500" aria-hidden="true" />
                  Mốc kết thúc (End)
                </label>
                <span className="text-[11px] font-mono text-slate-500 tabular-nums">
                  {endSec.toFixed(2)}s
                </span>
              </div>

              <div className="flex items-center gap-1.5">
                <input
                  id={endInputId}
                  type="text"
                  value={endInput}
                  onChange={(e) => setEndInput(e.target.value)}
                  onBlur={handleCommitEnd}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleCommitEnd();
                    }
                  }}
                  placeholder="00:00.00"
                  className="w-24 px-2 py-1 text-xs font-mono font-semibold text-slate-900 bg-slate-50 border border-slate-300 rounded focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600"
                />

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => stepEnd(-1)}
                    className="px-1.5 py-1 text-[11px] font-mono font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                    title="Lùi mốc kết thúc 1 giây"
                  >
                    -1s
                  </button>
                  <button
                    type="button"
                    onClick={() => stepEnd(-0.5)}
                    className="px-1.5 py-1 text-[11px] font-mono font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                    title="Lùi mốc kết thúc 0.5 giây"
                  >
                    -0.5s
                  </button>
                  <button
                    type="button"
                    onClick={() => stepEnd(0.5)}
                    className="px-1.5 py-1 text-[11px] font-mono font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                    title="Tăng mốc kết thúc 0.5 giây"
                  >
                    +0.5s
                  </button>
                  <button
                    type="button"
                    onClick={() => stepEnd(1)}
                    className="px-1.5 py-1 text-[11px] font-mono font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer"
                    title="Tăng mốc kết thúc 1 giây"
                  >
                    +1s
                  </button>
                </div>
              </div>

              {typeof currentTime === 'number' && (
                <button
                  type="button"
                  onClick={captureCurrentForEnd}
                  className="w-full text-left inline-flex items-center justify-center gap-1 px-2 py-1 text-[11px] font-medium text-rose-800 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded cursor-pointer transition-colors"
                >
                  <Check className="w-3 h-3 text-rose-600" aria-hidden="true" />
                  Gán mốc đang phát ({formatSecondsToTime(currentTime)}) làm Kết thúc
                </button>
              )}
            </div>
          </div>

          {/* Quick Action Footer */}
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => onPlaySegment(startSec, endSec)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-md cursor-pointer transition-colors"
              >
                <Play className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
                Nghe thử đoạn vừa chỉnh ({durationSpan.toFixed(1)}s)
              </button>

              <button
                type="button"
                onClick={() => onPlaySegment(startSec, null as unknown as number)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 rounded-md cursor-pointer transition-colors"
                title="Nghe từ mốc bắt đầu không giới hạn thời gian kết thúc"
              >
                <Volume2 className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                Nghe tiếp từ bắt đầu
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                // Quick expand by 1s both ends
                applyNewTimes(startSec - 0.5, endSec + 0.5);
              }}
              className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded cursor-pointer transition-colors"
              title="Tự động mở rộng 0.5s ở cả đầu và cuối"
            >
              <RotateCcw className="w-3 h-3" aria-hidden="true" />
              Nới rộng 2 đầu (+0.5s)
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
