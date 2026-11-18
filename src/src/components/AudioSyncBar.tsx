import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pause, Play, RotateCcw, RotateCw, Volume2, AudioWaveform, Download, Trash2, FileText } from 'lucide-react';
import type { ListeningTestPack } from '../types/ielts';

interface AudioSyncBarProps {
  testPack: ListeningTestPack;
  allTests: ListeningTestPack[];
  onSelectTest: (testId: string) => void;
  onDeleteTest?: (testId: string) => void;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  playbackRate: number;
  onTogglePlay: () => void;
  onSeek: (sec: number) => void;
  onChangeRate: (rate: number) => void;
  onSynthesizeAudio: () => Promise<void>;
  isSynthesizing: boolean;
  ttsNotice: string | null;
}

export function formatMmSsXx(seconds: number): string {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  const whole = Math.floor(secs);
  const hundredths = Math.min(99, Math.round((secs - whole) * 100));
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export const AudioSyncBar: React.FC<AudioSyncBarProps> = ({
  testPack,
  allTests,
  onSelectTest,
  onDeleteTest,
  currentTime,
  duration,
  isPlaying,
  playbackRate,
  onTogglePlay,
  onSeek,
  onChangeRate,
  onSynthesizeAudio,
  isSynthesizing,
  ttsNotice,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);

  // Extract real PCM amplitude peaks if testPack.audioUrl exists; otherwise compute speech-envelope fallback
  useEffect(() => {
    let cancelled = false;
    const barCount = 110;

    async function extractRealPeaks(url: string) {
      try {
        const res = await fetch(url);
        const buf = await res.arrayBuffer();
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const decoded = await ctx.decodeAudioData(buf);
        const channel = decoded.getChannelData(0);
        const step = Math.max(1, Math.floor(channel.length / barCount));
        const computed: number[] = [];
        for (let i = 0; i < barCount; i++) {
          let maxVal = 0;
          const start = i * step;
          const end = Math.min(channel.length, start + step);
          for (let j = start; j < end; j += Math.max(1, Math.floor(step / 32))) {
            const abs = Math.abs(channel[j]);
            if (abs > maxVal) maxVal = abs;
          }
          computed.push(Math.max(0.12, Math.min(1, maxVal * 1.15)));
        }
        await ctx.close();
        if (!cancelled) setPeaks(computed);
      } catch {
        if (!cancelled) setPeaks(buildEnvelopePeaks(testPack, barCount));
      }
    }

    if (testPack.audioUrl) {
      extractRealPeaks(testPack.audioUrl);
    } else {
      setPeaks(buildEnvelopePeaks(testPack, barCount));
    }

    return () => {
      cancelled = true;
    };
  }, [testPack]);

  const effectiveDuration = duration > 0 ? duration : testPack.durationSec;

  // Draw interactive waveform canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || peaks.length === 0) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    canvas.width = width * dpr;
    canvas.height = height * dpr;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, width, height);

    const progress = effectiveDuration > 0 ? Math.min(1, currentTime / effectiveDuration) : 0;
    const barSlot = width / peaks.length;
    const barWidth = Math.max(2, barSlot * 0.58);

    peaks.forEach((amp, idx) => {
      const x = idx * barSlot;
      const barH = Math.max(4, amp * (height - 8));
      const y = (height - barH) / 2;
      const ratio = idx / peaks.length;

      if (ratio <= progress) {
        ctx.fillStyle = '#1D4ED8';
      } else {
        ctx.fillStyle = '#CBD5E1';
      }
      ctx.beginPath();
      ctx.roundRect(x, y, barWidth, barH, 1.5);
      ctx.fill();
    });

    // Draw question marker ticks along bottom edge
    testPack.questions.forEach((q) => {
      if (effectiveDuration <= 0) return;
      const qx = Math.min(width - 2, Math.max(2, (q.timestampSec / effectiveDuration) * width));
      ctx.fillStyle = '#D97706';
      ctx.fillRect(qx - 1, height - 4, 2, 4);
    });
  }, [peaks, currentTime, effectiveDuration, testPack.questions]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || effectiveDuration <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(ratio * effectiveDuration);
  };

  const activeSegment = useMemo(() => {
    return testPack.segments.find(
      (seg) => currentTime >= seg.startSec && currentTime < seg.endSec
    );
  }, [testPack.segments, currentTime]);

  const speedOptions = [
    { rate: 0.8, label: '0.8x Nối âm' },
    { rate: 1.0, label: '1.0x Chuẩn' },
    { rate: 1.2, label: '1.2x Phản xạ' },
  ];

  return (
    <section
      aria-label="Bộ điều khiển đồng bộ âm thanh"
      className="bg-white border-b border-slate-200"
    >
      <div className="max-w-[1400px] mx-auto px-6 py-3.5 flex flex-col gap-3">
        {/* Top row: Test selector + metadata + Gemini TTS generator */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3 min-w-0">
            <label htmlFor="test-pack-select" className="sr-only">
              Chọn bộ đề luyện tập
            </label>
            <select
              id="test-pack-select"
              value={testPack.id}
              onChange={(e) => onSelectTest(e.target.value)}
              className="text-sm font-semibold text-slate-900 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 max-w-[360px] truncate cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              {allTests.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.partLabel}: {t.title}
                </option>
              ))}
            </select>

            <div className="hidden sm:flex items-center gap-2 text-xs text-slate-500">
              <span>{testPack.topic}</span>
              <span aria-hidden="true">·</span>
              <span>{testPack.bandTarget}</span>
              <span aria-hidden="true">·</span>
              <span className="tabular-nums">{testPack.questions.length} câu hỏi</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {testPack.pdfUrl && (
              <a
                href={testPack.pdfUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg whitespace-nowrap shrink-0"
              >
                <FileText className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                PDF đã lưu
              </a>
            )}

            {testPack.audioUrl ? (
              <div className="inline-flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                  <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                  Audio đã lưu & đồng bộ
                </span>
                {testPack.isCustomUpload && (
                  <a
                    href={testPack.audioUrl}
                    download={testPack.audioFileName || `${testPack.id}.mp3`}
                    className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-slate-700 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md whitespace-nowrap shrink-0"
                  >
                    <Download className="w-3 h-3" aria-hidden="true" />
                    Tải Audio
                  </a>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={onSynthesizeAudio}
                disabled={isSynthesizing}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
              >
                <AudioWaveform className="w-3.5 h-3.5" aria-hidden="true" />
                {isSynthesizing
                  ? 'Đang tạo Audio IELTS...'
                  : 'Tạo Audio chuẩn IELTS (AI TTS)'}
              </button>
            )}

            {testPack.isCustomUpload && onDeleteTest && (
              <button
                type="button"
                onClick={() => onDeleteTest(testPack.id)}
                title="Xóa bài nghe đã nạp"
                aria-label="Xóa bài nghe đã nạp"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-700 bg-red-50/70 hover:bg-red-100 border border-red-200 rounded-lg whitespace-nowrap shrink-0 cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                Xóa đề
              </button>
            )}
          </div>
        </div>

        {/* Bottom row: Play controls + Waveform Scrubber + Speed Control */}
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => onSeek(Math.max(0, currentTime - 5))}
              aria-label="Lùi 5 giây"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Tạm dừng' : 'Phát audio'}
              className="w-10 h-10 flex items-center justify-center rounded-lg bg-slate-900 hover:bg-slate-800 text-white transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>

            <button
              type="button"
              onClick={() => onSeek(Math.min(effectiveDuration, currentTime + 5))}
              aria-label="Tua tới 5 giây"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs font-mono text-slate-700 shrink-0 tabular-nums">
            <span className="font-semibold text-blue-700">[{formatMmSsXx(currentTime)}]</span>
            <span className="text-slate-400">/</span>
            <span>[{formatMmSsXx(effectiveDuration)}]</span>
          </div>

          <div className="flex-1 min-w-[220px] flex flex-col gap-1">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              title="Nhấp vào sóng âm để tua chính xác đến từng mili giây (vạch vàng là vị trí đáp án)"
              className="w-full h-10 cursor-pointer rounded bg-slate-50 border border-slate-200"
            />
            {activeSegment && (
              <div className="text-[11px] text-slate-500 truncate">
                <span className="font-semibold text-slate-700">{activeSegment.speaker}:</span>{' '}
                {activeSegment.text}
              </div>
            )}
          </div>

          {/* Speed control segmented tabs */}
          <div
            role="group"
            aria-label="Tốc độ phát âm thanh"
            className="flex items-center gap-1 p-1 bg-slate-100 rounded-lg shrink-0"
          >
            {speedOptions.map((opt) => {
              const active = Math.abs(playbackRate - opt.rate) < 0.05;
              return (
                <button
                  key={opt.rate}
                  type="button"
                  onClick={() => onChangeRate(opt.rate)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 ${
                    active
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {ttsNotice && (
          <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
            {ttsNotice}
          </p>
        )}
      </div>
    </section>
  );
};

function buildEnvelopePeaks(testPack: ListeningTestPack, barCount: number): number[] {
  const totalDur = Math.max(1, testPack.durationSec);
  const result: number[] = [];
  for (let i = 0; i < barCount; i++) {
    const t = (i / barCount) * totalDur;
    const seg = testPack.segments.find((s) => t >= s.startSec && t <= s.endSec);
    if (!seg) {
      result.push(0.14);
    } else {
      const seed = Math.sin(i * 1.73 + seg.text.length) * 0.5 + 0.5;
      const cadence = Math.cos(i * 0.61) * 0.2 + 0.65;
      result.push(Math.max(0.2, Math.min(0.96, seed * 0.55 + cadence * 0.45)));
    }
  }
  return result;
}
