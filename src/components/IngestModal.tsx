import React, { useState, useEffect } from 'react';
import { ExternalLink, FileAudio, FileText, Key, Loader2, Upload, X } from 'lucide-react';
import type { ListeningTestPack } from '../types/ielts';
import { extractErrorMessage, safeParseJsonResponse } from '../utils/safeFetchJson';
import { processIngestClientSide } from '../utils/clientGemini';
import { saveMediaBlob } from '../utils/indexedDBStorage';

interface IngestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIngestSuccess: (testPack: ListeningTestPack) => void;
  onOpenApiKey?: () => void;
}

interface IngestJobStatusResponse {
  jobId?: string;
  status?: 'processing' | 'done' | 'error';
  stepLabel?: string;
  progressPercent?: number;
  testPack?: ListeningTestPack;
  error?: unknown;
}

export const IngestModal: React.FC<IngestModalProps> = ({
  isOpen,
  onClose,
  onIngestSuccess,
  onOpenApiKey,
}) => {
  const [title, setTitle] = useState('');
  const [partLabel, setPartLabel] = useState('Part 2');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioPreviewUrl, setAudioPreviewUrl] = useState<string | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState('');
  const [userApiKey, setUserApiKey] = useState(() => localStorage.getItem('GEMINI_API_KEY') || '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState('Đang tải tệp lên máy chủ...');
  const [progressPercent, setProgressPercent] = useState(10);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (audioFile) {
      const url = URL.createObjectURL(audioFile);
      setAudioPreviewUrl(url);
      return () => {
        URL.revokeObjectURL(url);
      };
    } else {
      setAudioPreviewUrl(null);
    }
  }, [audioFile]);

  useEffect(() => {
    if (isOpen) {
      setUserApiKey(localStorage.getItem('GEMINI_API_KEY') || '');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (!audioFile && !pdfFile && !rawText.trim()) {
      setErrorMsg(
        'Vui lòng tải lên tệp Audio (MP3/WAV), tệp PDF đề thi, hoặc dán văn bản script/câu hỏi.'
      );
      return;
    }

    const apiKey = userApiKey.trim() || localStorage.getItem('GEMINI_API_KEY') || '';
    if (!apiKey) {
      setErrorMsg(
        'Vui lòng dán khóa Gemini API Key vào ô màu vàng phía trên trước khi xử lý (Lấy key miễn phí tại aistudio.google.com/api-keys).'
      );
      return;
    }
    // Save valid API Key to localStorage for instant reuse
    try {
      localStorage.setItem('GEMINI_API_KEY', apiKey);
    } catch {
      // ignore
    }

    const totalBytes = (audioFile?.size || 0) + (pdfFile?.size || 0);
    if (totalBytes > 30 * 1024 * 1024) {
      setErrorMsg(
        `Tổng dung lượng Audio + PDF (${(totalBytes / (1024 * 1024)).toFixed(1)} MB) vượt quá giới hạn truyền tải 30 MB của máy chủ. Vui lòng nén nhẹ file Audio hoặc tách từng Part.`
      );
      return;
    }

    setIsSubmitting(true);
    setProgressLabel('Đang gửi tệp & khởi tạo phiên đồng bộ Tech-Sync...');
    setProgressPercent(10);

    try {
      let finalPack: ListeningTestPack | undefined;
      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1' ||
          window.location.port === '3000');

      if (!isLocalhost) {
        // Direct Client-Side Gemini AI (Zero server dependencies, 100% reliable on Vercel)
        setProgressLabel('Đang đọc tệp & kết nối Gemini AI trực tiếp từ trình duyệt...');
        setProgressPercent(15);
        finalPack = await processIngestClientSide({
          audioFile,
          pdfFile,
          rawText,
          title,
          partLabel,
          apiKey,
          onProgress: (step, percent) => {
            setProgressLabel(step);
            setProgressPercent(percent);
          },
        });
      } else {
        // On localhost: try local Express server first, with automatic fallback
        try {
          const formData = new FormData();
          formData.append('title', title);
          formData.append('partLabel', partLabel);
          formData.append('rawText', rawText);
          if (apiKey) formData.append('apiKey', apiKey);
          if (audioFile) formData.append('audio', audioFile);
          if (pdfFile) formData.append('pdf', pdfFile);

          const startRes = await fetch('/api/ielts/ingest/start', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              Accept: 'application/json',
              ...(apiKey ? { 'x-gemini-api-key': apiKey } : {}),
            },
            body: formData,
          });

          if (startRes.ok) {
            const startData = await safeParseJsonResponse<IngestJobStatusResponse>(
              startRes,
              'Không thể khởi tạo phiên xử lý đề thi.'
            );

            if (startData.jobId) {
              if (startData.stepLabel) setProgressLabel(startData.stepLabel);
              if (typeof startData.progressPercent === 'number') {
                setProgressPercent(startData.progressPercent);
              }

              // Poll job status until completion
              const maxPolls = 150;
              for (let i = 0; i < maxPolls; i++) {
                await new Promise((resolve) => setTimeout(resolve, 1200));
                try {
                  const statusRes = await fetch(
                    `/api/ielts/ingest/status/${encodeURIComponent(startData.jobId)}`,
                    {
                      method: 'GET',
                      credentials: 'same-origin',
                      headers: {
                        Accept: 'application/json',
                        ...(apiKey ? { 'x-gemini-api-key': apiKey } : {}),
                      },
                      cache: 'no-store',
                    }
                  );
                  if (statusRes.ok) {
                    const statusData = await safeParseJsonResponse<IngestJobStatusResponse>(
                      statusRes,
                      'Không thể kiểm tra tiến trình xử lý.'
                    );
                    if (statusData.stepLabel) setProgressLabel(statusData.stepLabel);
                    if (typeof statusData.progressPercent === 'number') {
                      setProgressPercent(statusData.progressPercent);
                    }
                    if (statusData.status === 'done' && statusData.testPack) {
                      finalPack = statusData.testPack;
                      break;
                    }
                    if (statusData.status === 'error') {
                      throw new Error(extractErrorMessage(statusData.error, 'Không thể xử lý dữ liệu tải lên.'));
                    }
                  }
                } catch {
                  // retry
                }
              }
            } else if (startData.testPack) {
              finalPack = startData.testPack;
            }
          }
        } catch {
          // Local server failed, fall back to client-side
        }

        if (!finalPack) {
          setProgressLabel('Đang xử lý trực tiếp bằng Gemini AI qua trình duyệt...');
          setProgressPercent(15);
          finalPack = await processIngestClientSide({
            audioFile,
            pdfFile,
            rawText,
            title,
            partLabel,
            apiKey,
            onProgress: (step, percent) => {
              setProgressLabel(step);
              setProgressPercent(percent);
            },
          });
        }
      }

      if (!finalPack) {
        throw new Error(
          'Không thể xử lý tệp. Vui lòng kiểm tra lại khóa Gemini API Key hoặc thử với tệp nhỏ hơn.'
        );
      }

      // Ensure media is permanently saved to IndexedDB regardless of server/client ingest
      if (audioFile && finalPack) {
        try {
          const liveAudioUrl = await saveMediaBlob(finalPack.id, 'audio', audioFile, audioFile.name);
          finalPack.audioUrl = liveAudioUrl;
          finalPack.audioFileName = audioFile.name;
        } catch (saveErr) {
          console.warn('[IngestModal] Failed to persist audio to IndexedDB:', saveErr);
        }
      }

      if (pdfFile && finalPack) {
        try {
          const livePdfUrl = await saveMediaBlob(finalPack.id, 'pdf', pdfFile, pdfFile.name);
          finalPack.pdfUrl = livePdfUrl;
          finalPack.pdfFileName = pdfFile.name;
        } catch (saveErr) {
          console.warn('[IngestModal] Failed to persist PDF to IndexedDB:', saveErr);
        }
      }

      onIngestSuccess(finalPack);
      setTitle('');
      setAudioFile(null);
      setPdfFile(null);
      setRawText('');
      onClose();
    } catch (err: unknown) {
      setErrorMsg(extractErrorMessage(err, 'Lỗi kết nối máy chủ hoặc Gemini AI.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ingest-modal-title"
      className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-xl">
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div>
            <h2 id="ingest-modal-title" className="text-base font-bold text-slate-900">
              Nạp đề thi & Audio (Tech-Sync AI)
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Chuyển đổi Audio MP3/WAV và đề PDF thô thành bài thi IELTS đồng bộ từng mili giây
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng hộp thoại"
            className="p-1.5 text-slate-400 hover:text-slate-800 rounded-lg cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Ô nhập Gemini API Key trực tiếp trong IngestModal */}
          <div className="p-3.5 bg-amber-50/90 border border-amber-300 rounded-xl space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label
                htmlFor="modal-gemini-key"
                className="text-xs font-bold text-amber-900 flex items-center gap-1.5"
              >
                <Key className="w-3.5 h-3.5 text-amber-700 shrink-0" />
                Khóa Gemini API Key (Bắt buộc để AI đọc Audio & PDF)
              </label>
              <a
                href="https://aistudio.google.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-bold text-blue-700 hover:text-blue-900 underline"
              >
                Lấy key miễn phí (Google AI Studio)
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="modal-gemini-key"
                type="password"
                value={userApiKey}
                onChange={(e) => {
                  const val = e.target.value;
                  setUserApiKey(val);
                  localStorage.setItem('GEMINI_API_KEY', val.trim());
                }}
                placeholder="Dán mã API Key của bạn (bắt đầu bằng AIzaSy...)"
                className="flex-1 px-3 py-2 text-xs font-mono bg-white border border-amber-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
              {userApiKey.trim() ? (
                <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-lg whitespace-nowrap">
                  ✓ Đã có Key
                </span>
              ) : (
                <span className="text-[11px] font-semibold text-amber-800 bg-amber-100 border border-amber-300 px-2.5 py-1.5 rounded-lg whitespace-nowrap">
                  Chưa có Key
                </span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="sm:col-span-2">
              <label
                htmlFor="ingest-title"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Tên bài luyện nghe (tùy chọn)
              </label>
              <input
                id="ingest-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="VD: Cambridge 18 Test 2 — Part 3"
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
              />
            </div>

            <div>
              <label
                htmlFor="ingest-part"
                className="block text-xs font-semibold text-slate-700 mb-1.5"
              >
                Phần thi IELTS
              </label>
              <select
                id="ingest-part"
                value={partLabel}
                onChange={(e) => setPartLabel(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-700"
              >
                <option value="Part 1">Part 1 (Hội thoại)</option>
                <option value="Part 2">Part 2 (Độc thoại)</option>
                <option value="Part 3">Part 3 (Thảo luận học thuật)</option>
                <option value="Part 4">Part 4 (Bài giảng đại học)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="relative flex flex-col items-center justify-center gap-2 p-5 border border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-slate-100/70 transition-colors text-center">
              {audioFile && (
                <button
                  type="button"
                  onClick={() => setAudioFile(null)}
                  aria-label="Xóa tệp audio"
                  className="absolute top-2.5 right-2.5 p-1 text-slate-400 hover:text-red-700 rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <label className="flex flex-col items-center justify-center gap-1.5 cursor-pointer w-full">
                <FileAudio className="w-6 h-6 text-blue-700" aria-hidden="true" />
                <span className="text-xs font-semibold text-slate-800 max-w-[210px] truncate">
                  {audioFile ? audioFile.name : 'Tải lên Audio (MP3 / WAV / M4A)'}
                </span>
                <span className="text-[11px] text-slate-500">
                  {audioFile
                    ? `${(audioFile.size / (1024 * 1024)).toFixed(2)} MB`
                    : 'Tự động tách câu & gán [mm:ss.xx]'}
                </span>
                <input
                  type="file"
                  accept=".mp3,.wav,.m4a,.ogg,.webm,.flac,audio/mpeg,audio/wav,audio/mp4,audio/x-m4a,audio/webm,audio/ogg,audio/flac"
                  className="sr-only"
                  onClick={(e) => {
                    (e.target as HTMLInputElement).value = '';
                  }}
                  onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                />
              </label>
              {audioPreviewUrl && (
                <div className="mt-1 w-full flex flex-col items-center gap-1">
                  <span className="text-[10px] text-slate-500 font-medium">Nghe thử file âm thanh:</span>
                  <audio controls src={audioPreviewUrl} className="h-7 w-full max-w-[220px]" />
                </div>
              )}
            </div>

            <div className="relative flex flex-col items-center justify-center gap-2 p-5 border border-dashed border-slate-300 rounded-xl bg-slate-50 hover:bg-slate-100/70 transition-colors text-center">
              {pdfFile && (
                <button
                  type="button"
                  onClick={() => setPdfFile(null)}
                  aria-label="Xóa tệp PDF"
                  className="absolute top-2.5 right-2.5 p-1 text-slate-400 hover:text-red-700 rounded cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <label className="flex flex-col items-center justify-center gap-1.5 cursor-pointer w-full">
                <FileText className="w-6 h-6 text-slate-700" aria-hidden="true" />
                <span className="text-xs font-semibold text-slate-800 max-w-[210px] truncate">
                  {pdfFile ? pdfFile.name : 'Tải lên Đề thi PDF (OCR)'}
                </span>
                <span className="text-[11px] text-slate-500">
                  {pdfFile
                    ? `${(pdfFile.size / (1024 * 1024)).toFixed(2)} MB`
                    : 'Nhận diện câu hỏi & bảng đáp án'}
                </span>
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  className="sr-only"
                  onClick={(e) => {
                    (e.target as HTMLInputElement).value = '';
                  }}
                  onChange={(e) => setPdfFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>
          </div>

          <div>
            <label
              htmlFor="ingest-raw-text"
              className="block text-xs font-semibold text-slate-700 mb-1.5"
            >
              Hoặc dán nội dung Transcript / Câu hỏi thô
            </label>
            <textarea
              id="ingest-raw-text"
              rows={5}
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              placeholder="Dán đoạn transcript hội thoại, bài giảng hoặc danh sách câu hỏi IELTS tại đây để AI tự động thiết kế câu hỏi, bẫy Distractor và từ vựng AWL..."
              className="w-full px-3 py-2.5 text-sm border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            />
          </div>

          {isSubmitting && (
            <div className="p-3 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg text-xs space-y-2">
              <div className="flex items-center justify-between gap-2 font-medium">
                <span>{progressLabel}</span>
                <span className="tabular-nums">{progressPercent}%</span>
              </div>
              <div className="h-1.5 w-full bg-blue-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-blue-700 transition-all duration-300"
                  style={{ width: `${Math.min(100, Math.max(8, progressPercent))}%` }}
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div
              role="alert"
              className="p-3.5 bg-red-50 border border-red-200 text-red-800 rounded-xl text-xs space-y-2"
            >
              <div className="font-semibold leading-relaxed">{errorMsg}</div>
              <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-red-200/60">
                {onOpenApiKey && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenApiKey();
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-semibold rounded-lg text-xs transition-colors cursor-pointer"
                  >
                    <Key className="w-3.5 h-3.5" />
                    Cài đặt / Thay đổi Gemini API Key
                  </button>
                )}
                <a
                  href="https://aistudio.google.com/api-keys"
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-semibold text-red-700 hover:text-red-900 underline text-xs"
                >
                  Lấy khóa API miễn phí
                  <ExternalLink className="w-3 h-3" />
                </a>
              </div>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Hủy
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 px-5 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors cursor-pointer disabled:opacity-60"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  Đang đồng bộ hóa Tech-Sync...
                </>
              ) : (
                <>
                  <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                  Xử lý & Tạo phòng thi
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
