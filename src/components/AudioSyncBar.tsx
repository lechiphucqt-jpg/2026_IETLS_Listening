import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  AudioWaveform,
  Cloud,
  Download,
  FileText,
  HardDrive,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  Share2,
  Trash2,
  Upload,
  Volume2,
} from 'lucide-react';
import type { ListeningTestPack } from '../types/ielts';
import type { WorkspaceView } from './TopBar';

interface AudioSyncBarProps {
  testPack: ListeningTestPack;
  allTests: ListeningTestPack[];
  onSelectTest: (testId: string) => void;
  activeView?: WorkspaceView;
  onChangeView?: (view: WorkspaceView) => void;
  onDeleteTest?: (testId: string) => void;
  onOpenLocalFiles?: () => void;
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
  onReattachAudio?: (testId: string, file: File) => Promise<void>;
  onExportPackage?: (testPack: ListeningTestPack) => void;
  audioHasError?: boolean;
}

export function formatMmSsXx(seconds: number): string {
  const clamped = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  const whole = Math.floor(secs);
  const hundredths = Math.min(99, Math.round((secs - whole) * 100));
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

// In-memory cache of decoded audio peaks to avoid freezing main thread on re-renders
const peaksCache = new Map<string, number[]>();

const MODE_NAV_ITEMS: { id: WorkspaceView; label: string }[] = [
  { id: 'exam', label: 'Phòng thi IDP' },
  { id: 'analysis', label: 'Phân tích AI' },
  { id: 'practice', label: 'Luyện chuyên sâu' },
  { id: 'vocabulary', label: 'Từ vựng AWL' },
];

export const AudioSyncBar: React.FC<AudioSyncBarProps> = ({
  testPack,
  allTests,
  onSelectTest,
  activeView,
  onChangeView,
  onDeleteTest,
  onOpenLocalFiles,
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
  onReattachAudio,
  onExportPackage,
  audioHasError = false,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<number[]>([]);

  // Extract real PCM amplitude peaks if testPack.audioUrl exists; otherwise compute speech-envelope fallback
  useEffect(() => {
    let cancelled = false;
    const barCount = 110;
    const cacheKey = `${testPack.id}_${testPack.audioUrl || 'no-audio'}`;

    if (peaksCache.has(cacheKey)) {
      setPeaks(peaksCache.get(cacheKey)!);
      return;
    }

    async function extractRealPeaks(url: string) {
      const controller = new AbortController();
      const timeoutId = window.setTimeout(() => controller.abort(), 2500);

      try {
        const res = await fetch(url, { signal: controller.signal });
        window.clearTimeout(timeoutId);

        // Guard against HTML 404 / SPA rewrite fallbacks
        const contentType = res.headers.get('content-type') || '';
        if (contentType.includes('text/html') || !res.ok) {
          throw new Error('Invalid audio response');
        }

        const buf = await res.arrayBuffer();
        // Guard against massive buffers (>30MB) freezing the main UI thread during decode
        if (buf.byteLength > 30 * 1024 * 1024) {
          const envelope = buildEnvelopePeaks(testPack, barCount);
          peaksCache.set(cacheKey, envelope);
          if (!cancelled) setPeaks(envelope);
          return;
        }

        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
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
        await ctx.close().catch(() => {});
        peaksCache.set(cacheKey, computed);
        if (!cancelled) setPeaks(computed);
      } catch {
        const fallback = buildEnvelopePeaks(testPack, barCount);
        peaksCache.set(cacheKey, fallback);
        if (!cancelled) setPeaks(fallback);
      }
    }

    if (testPack.audioUrl && !audioHasError) {
      extractRealPeaks(testPack.audioUrl);
    } else {
      const fallback = buildEnvelopePeaks(testPack, barCount);
      setPeaks(fallback);
    }

    return () => {
      cancelled = true;
    };
  }, [testPack.id, testPack.audioUrl, testPack.durationSec, testPack.segments.length, audioHasError]);

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
        ctx.fillStyle = '#15803D';
      } else {
        ctx.fillStyle = '#E2E8F0';
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
      className="sticky top-16 z-20 bg-white/95 backdrop-blur-md border-b border-slate-200/90 shadow-xs"
    >
      <div className="max-w-[1400px] mx-auto px-6 py-2.5 flex flex-col gap-2">
        {/* Top row: Test selector + Chế độ học tập (Phòng thi, Phân tích AI...) + Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5 min-w-0">
            {/* Chọn bộ đề luyện tập */}
            <div className="flex items-center gap-1.5">
              <label htmlFor="test-pack-select" className="text-xs font-bold text-[#15803D] whitespace-nowrap">
                Bài nghe:
              </label>
              <select
                id="test-pack-select"
                value={testPack.id}
                onChange={(e) => onSelectTest(e.target.value)}
                className="text-xs font-bold text-[#15803D] bg-emerald-50/50 border border-emerald-300 rounded-lg px-2.5 py-1.5 max-w-[200px] sm:max-w-[260px] lg:max-w-[320px] truncate cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 shadow-2xs"
              >
                {allTests.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.partLabel}: {t.title}
                  </option>
                ))}
              </select>
            </div>

            {/* Divider */}
            <div className="hidden sm:block h-5 w-px bg-slate-300" aria-hidden="true" />

            {/* Chức năng chọn chế độ (Phòng thi IDP, Phân tích AI, Luyện chuyên sâu, Từ vựng AWL) - Chữ màu xanh */}
            {activeView && onChangeView && (
              <nav
                aria-label="Chọn chế độ học"
                className="inline-flex items-center gap-1 p-0.5 sm:p-1 bg-emerald-50/80 rounded-lg border border-emerald-200 overflow-x-auto no-scrollbar"
              >
                {MODE_NAV_ITEMS.map((item) => {
                  const isActive = activeView === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => onChangeView(item.id)}
                      className={`px-2.5 sm:px-3 py-1.5 text-xs rounded-md transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                        isActive
                          ? 'bg-[#15803D] text-white font-extrabold shadow-xs'
                          : 'text-[#15803D] font-bold hover:bg-emerald-100/70'
                      }`}
                    >
                      {item.label}
                    </button>
                  );
                })}
              </nav>
            )}

            <div className="hidden 2xl:flex items-center gap-2 text-xs font-semibold text-slate-600">
              <span className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200">{testPack.topic}</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-900 border border-emerald-300 font-bold">{testPack.bandTarget}</span>
              <span aria-hidden="true" className="text-slate-300">·</span>
              <span className="tabular-nums text-emerald-950 font-bold">{testPack.questions.length} câu hỏi</span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Action buttons for PDF (View + Download) */}
            {testPack.pdfUrl && (
              <div className="inline-flex items-center gap-1.5">
                <a
                  href={testPack.pdfUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 shadow-2xs transition-colors"
                  title="Mở tài liệu PDF trong tab mới"
                >
                  <FileText className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                  <span>Xem PDF</span>
                </a>
                <a
                  href={testPack.pdfUrl}
                  download={testPack.pdfFileName || `${testPack.id}.pdf`}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-rose-800 bg-rose-50/80 hover:bg-rose-100 border border-rose-200 rounded-lg whitespace-nowrap shrink-0 shadow-2xs transition-colors"
                  title="Tải tệp PDF đề thi về máy tính"
                >
                  <Download className="w-3.5 h-3.5 text-rose-700" aria-hidden="true" />
                  <span>Tải PDF về máy</span>
                </a>
              </div>
            )}

            {/* Action buttons for Audio */}
            {testPack.audioUrl && !audioHasError ? (
              <div className="inline-flex items-center gap-1.5">
                {testPack.audioUrl.includes('drive.google.com') || testPack.audioUrl.includes('docs.google.com') ? (
                  <span
                    className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-800 bg-blue-50 px-2.5 py-1 rounded-lg border border-blue-200"
                    title="Audio đang phát trực tiếp từ Google Drive cá nhân"
                  >
                    <Cloud className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                    Drive Audio
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-800 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    Audio đồng bộ
                  </span>
                )}

                {/* Direct Download Audio Button to local computer */}
                <a
                  href={testPack.audioUrl}
                  download={testPack.audioFileName || `${testPack.id}.mp3`}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-blue-900 bg-blue-50/80 hover:bg-blue-100 border border-blue-200 rounded-lg whitespace-nowrap shrink-0 shadow-2xs transition-colors"
                  title="Tải file âm thanh về máy tính (.mp3)"
                >
                  <Download className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
                  <span>Tải Audio về máy</span>
                </a>

                {onReattachAudio && testPack.isCustomUpload && (
                  <label
                    title="Chọn lại file audio khác từ máy tính để gắn vào đề này"
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer shadow-2xs"
                  >
                    <Upload className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                    Đổi Audio
                    <input
                      type="file"
                      accept=".mp3,.wav,.m4a,.ogg,.webm,.flac,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/webm,audio/ogg,audio/flac"
                      className="sr-only"
                      onClick={(e) => {
                        (e.target as HTMLInputElement).value = '';
                      }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          onReattachAudio(testPack.id, file);
                        }
                      }}
                    />
                  </label>
                )}
              </div>
            ) : (
              <div className="inline-flex items-center gap-2">
                {audioHasError && (
                  <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-900 bg-amber-50 px-2.5 py-1 rounded-lg border border-amber-300">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                    Audio cần gắn lại
                  </span>
                )}
                {onReattachAudio && (
                  <label className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer transition-colors shadow-2xs">
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    Gắn lại Audio từ máy
                    <input
                      type="file"
                      accept=".mp3,.wav,.m4a,.ogg,.webm,.flac,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/webm,audio/ogg,audio/flac"
                      className="sr-only"
                      onClick={(e) => {
                        (e.target as HTMLInputElement).value = '';
                      }}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          onReattachAudio(testPack.id, file);
                        }
                      }}
                    />
                  </label>
                )}
                <button
                  type="button"
                  onClick={onSynthesizeAudio}
                  disabled={isSynthesizing}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-blue-900 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-800"
                >
                  <AudioWaveform className="w-3.5 h-3.5" aria-hidden="true" />
                  {isSynthesizing
                    ? 'Đang tạo Audio IELTS...'
                    : 'Tạo Audio chuẩn IELTS (AI TTS)'}
                </button>
              </div>
            )}

            {/* Quick button to open Local Files Manager Modal */}
            {onOpenLocalFiles && (
              <button
                type="button"
                onClick={onOpenLocalFiles}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 shadow-2xs cursor-pointer transition-colors"
                title="Xem toàn bộ các tệp Audio & PDF đã lưu trong máy tính"
              >
                <HardDrive className="w-3.5 h-3.5 text-slate-600" />
                <span>Tệp máy tính</span>
              </button>
            )}

            {onExportPackage && (
              <button
                type="button"
                onClick={() => onExportPackage(testPack)}
                title="Đóng gói đề thi kèm Audio/PDF thành file .lexisync để gửi sang máy khác dùng ngay"
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-300 rounded-lg whitespace-nowrap shrink-0 cursor-pointer shadow-2xs transition-colors"
              >
                <Share2 className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                Xuất đề (.lexisync)
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
              title="Lùi 5 giây"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={onTogglePlay}
              aria-label={isPlaying ? 'Tạm dừng' : 'Phát âm thanh'}
              className="p-2.5 bg-[#15803D] hover:bg-[#166534] text-white rounded-lg transition-colors cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
            >
              {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 fill-current" />}
            </button>

            <button
              type="button"
              onClick={() => onSeek(Math.min(effectiveDuration, currentTime + 5))}
              aria-label="Tiến 5 giây"
              title="Tiến 5 giây"
              className="p-2 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700"
            >
              <RotateCw className="w-4 h-4" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 text-xs font-mono shrink-0 tabular-nums bg-emerald-50/70 px-3 py-1.5 rounded-lg border border-emerald-200">
            <span className="font-extrabold text-[#15803D] text-sm">[{formatMmSsXx(currentTime)}]</span>
            <span className="text-slate-400 font-bold">/</span>
            <span className="font-semibold text-slate-600">[{formatMmSsXx(effectiveDuration)}]</span>
          </div>

          <div className="flex-1 min-w-[220px] flex flex-col gap-1">
            <canvas
              ref={canvasRef}
              onClick={handleCanvasClick}
              title="Nhấp vào sóng âm để tua chính xác đến từng mili giây (vạch vàng là vị trí đáp án)"
              className="w-full h-10 cursor-pointer rounded-lg bg-emerald-50/30 border border-emerald-200 shadow-2xs"
            />
            {activeSegment && (
              <div className="text-[11px] text-slate-600 truncate font-medium">
                <span className="font-bold text-[#15803D]">{activeSegment.speaker}:</span>{' '}
                {activeSegment.text}
              </div>
            )}
          </div>

          {/* Speed control segmented tabs */}
          <div
            role="group"
            aria-label="Tốc độ phát âm thanh"
            className="flex items-center gap-1 p-0.5 bg-emerald-50/80 border border-emerald-200 rounded-lg shrink-0"
          >
            {speedOptions.map((opt) => {
              const active = Math.abs(playbackRate - opt.rate) < 0.05;
              return (
                <button
                  key={opt.rate}
                  type="button"
                  onClick={() => onChangeRate(opt.rate)}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 ${
                    active
                      ? 'bg-[#15803D] text-white shadow-xs'
                      : 'text-slate-600 hover:text-[#15803D] hover:bg-white/70'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {ttsNotice && (
          <p className="text-xs text-slate-700 bg-amber-50/90 border border-amber-200 rounded-lg px-3 py-2 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            <span>{ttsNotice}</span>
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
