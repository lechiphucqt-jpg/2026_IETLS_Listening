import React, { useState } from 'react';
import { FileAudio, FileText, Loader2, Upload, X } from 'lucide-react';
import type { ListeningTestPack } from '../types/ielts';
import { safeParseJsonResponse } from '../utils/safeFetchJson';

interface IngestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onIngestSuccess: (testPack: ListeningTestPack) => void;
}

interface IngestJobStatusResponse {
  jobId?: string;
  status?: 'processing' | 'done' | 'error';
  stepLabel?: string;
  progressPercent?: number;
  testPack?: ListeningTestPack;
  error?: string;
}

export const IngestModal: React.FC<IngestModalProps> = ({
  isOpen,
  onClose,
  onIngestSuccess,
}) => {
  const [title, setTitle] = useState('');
  const [partLabel, setPartLabel] = useState('Part 2');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [rawText, setRawText] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressLabel, setProgressLabel] = useState('Đang tải tệp lên máy chủ...');
  const [progressPercent, setProgressPercent] = useState(10);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

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
      const formData = new FormData();
      formData.append('title', title);
      formData.append('partLabel', partLabel);
      formData.append('rawText', rawText);
      if (audioFile) formData.append('audio', audioFile);
      if (pdfFile) formData.append('pdf', pdfFile);

      const startRes = await fetch('/api/ielts/ingest/start', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        body: formData,
      });

      const startData = await safeParseJsonResponse<IngestJobStatusResponse>(
        startRes,
        'Không thể khởi tạo phiên xử lý đề thi.'
      );

      if (!startData.jobId) {
        if (startData.testPack) {
          onIngestSuccess(startData.testPack);
          setTitle('');
          setAudioFile(null);
          setPdfFile(null);
          setRawText('');
          onClose();
          return;
        }
        throw new Error(startData.error || 'Máy chủ không trả về mã phiên xử lý.');
      }

      if (startData.stepLabel) setProgressLabel(startData.stepLabel);
      if (typeof startData.progressPercent === 'number') {
        setProgressPercent(startData.progressPercent);
      }

      // Poll job status until completion (max ~3 minutes)
      let transientFailures = 0;
      const maxPolls = 150;
      let finalPack: ListeningTestPack | undefined;

      for (let i = 0; i < maxPolls; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1200));

        try {
          const statusRes = await fetch(
            `/api/ielts/ingest/status/${encodeURIComponent(startData.jobId)}`,
            {
              method: 'GET',
              credentials: 'same-origin',
              headers: { Accept: 'application/json' },
              cache: 'no-store',
            }
          );

          const statusData = await safeParseJsonResponse<IngestJobStatusResponse>(
            statusRes,
            'Không thể kiểm tra tiến trình xử lý.'
          );

          transientFailures = 0;
          if (statusData.stepLabel) setProgressLabel(statusData.stepLabel);
          if (typeof statusData.progressPercent === 'number') {
            setProgressPercent(statusData.progressPercent);
          }

          if (statusData.status === 'done' && statusData.testPack) {
            finalPack = statusData.testPack;
            break;
          }
          if (statusData.status === 'error') {
            throw new Error(statusData.error || 'Không thể xử lý dữ liệu tải lên.');
          }
        } catch (pollErr: unknown) {
          // Propagate definitive API/job errors immediately; retry up to 3 transient network glitches
          const msg = pollErr instanceof Error ? pollErr.message : '';
          const isTransientNetwork =
            pollErr instanceof TypeError ||
            msg.includes('Failed to fetch') ||
            msg.includes('NetworkError');
          if (!isTransientNetwork || transientFailures >= 3) {
            throw pollErr;
          }
          transientFailures++;
        }
      }

      if (!finalPack) {
        throw new Error(
          'Quá thời gian xử lý tệp. Vui lòng thử tách nhỏ tệp PDF/Audio theo từng Part rồi tải lại.'
        );
      }

      onIngestSuccess(finalPack);
      setTitle('');
      setAudioFile(null);
      setPdfFile(null);
      setRawText('');
      onClose();
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : 'Lỗi kết nối máy chủ.');
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
                  accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.flac"
                  className="sr-only"
                  onChange={(e) => setAudioFile(e.target.files?.[0] || null)}
                />
              </label>
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
              className="p-3 bg-red-50 border border-red-200 text-red-800 rounded-lg text-xs"
            >
              {errorMsg}
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
