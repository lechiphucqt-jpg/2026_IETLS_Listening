import React, { useEffect, useState } from 'react';
import {
  Download,
  FileAudio,
  FileText,
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Sparkles,
  X,
} from 'lucide-react';
import type { ListeningTestPack } from '../types/ielts';
import {
  downloadBlob,
  downloadMediaFile,
  getAllStoredMediaRecords,
  getMediaBlob,
  type StoredMediaRecord,
} from '../utils/indexedDBStorage';

interface ServerFileInfo {
  name: string;
  type: 'audio' | 'pdf';
  size: number;
  createdAt: number;
  url: string;
}

interface LocalFilesManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeTestPack: ListeningTestPack;
  allTests: ListeningTestPack[];
  onSelectTest?: (testId: string) => void;
  onPlayAudio?: (sec: number) => void;
}

export const LocalFilesManagerModal: React.FC<LocalFilesManagerModalProps> = ({
  isOpen,
  onClose,
  activeTestPack,
  allTests,
  onSelectTest,
  onPlayAudio,
}) => {
  const [activeTab, setActiveTab] = useState<'audio' | 'pdf'>('audio');
  const [storedRecords, setStoredRecords] = useState<StoredMediaRecord[]>([]);
  const [serverAudios, setServerAudios] = useState<ServerFileInfo[]>([]);
  const [serverPdfs, setServerPdfs] = useState<ServerFileInfo[]>([]);
  const [localStoragePath, setLocalStoragePath] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [isOpeningFolder, setIsOpeningFolder] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadLocalFiles = async () => {
    setIsLoading(true);
    setFeedbackMsg(null);

    // 1. Fetch browser IndexedDB records (persistent client storage on disk)
    try {
      const records = await getAllStoredMediaRecords();
      setStoredRecords(records);
    } catch {
      // ignore
    }

    // 2. Fetch server local_storage folder records (if server is active)
    try {
      const res = await fetch('/api/ielts/files/list');
      if (res.ok) {
        const data = await res.json();
        if (data.ok) {
          setServerAudios(data.audios || []);
          setServerPdfs(data.pdfs || []);
          if (data.localStoragePath) {
            setLocalStoragePath(data.localStoragePath);
          }
        }
      }
    } catch {
      // Running purely client-side or offline
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      void loadLocalFiles();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleOpenFolderOnComputer = async () => {
    setIsOpeningFolder(true);
    try {
      const res = await fetch('/api/ielts/files/open-folder', { method: 'POST' });
      if (res.ok) {
        setFeedbackMsg({
          type: 'success',
          text: 'Đã mở thư mục lưu trữ "local_storage" trên Windows Explorer!',
        });
      } else {
        throw new Error('Máy chủ chưa hỗ trợ mở thư mục trực tiếp.');
      }
    } catch {
      setFeedbackMsg({
        type: 'error',
        text: `Thư mục lưu trữ trên máy tính: ${localStoragePath || 'local_storage/ (trong thư mục cài app)'}. Bạn có thể mở trực tiếp từ File Explorer.`,
      });
    } finally {
      setIsOpeningFolder(false);
    }
  };

  const handleDownloadRecord = (rec: StoredMediaRecord) => {
    const fileName =
      rec.fileName ||
      (rec.type === 'audio' ? `${rec.testId}.mp3` : `${rec.testId}.pdf`);
    downloadBlob(rec.blob, fileName);
    setFeedbackMsg({
      type: 'success',
      text: `Đang tải xuống "${fileName}" về máy tính...`,
    });
  };

  const handleDownloadAllCurrent = async () => {
    let count = 0;
    try {
      const audioRec = await getMediaBlob(activeTestPack.id, 'audio');
      if (audioRec?.blob) {
        downloadBlob(audioRec.blob, audioRec.fileName || `${activeTestPack.title || activeTestPack.id}.mp3`);
        count++;
      } else if (activeTestPack.audioUrl) {
        const a = document.createElement('a');
        a.href = activeTestPack.audioUrl;
        a.download = activeTestPack.audioFileName || `${activeTestPack.title || activeTestPack.id}.mp3`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        count++;
      }

      await new Promise((r) => setTimeout(r, 400));

      const pdfRec = await getMediaBlob(activeTestPack.id, 'pdf');
      if (pdfRec?.blob) {
        downloadBlob(pdfRec.blob, pdfRec.fileName || `${activeTestPack.title || activeTestPack.id}.pdf`);
        count++;
      } else if (activeTestPack.pdfUrl) {
        const a = document.createElement('a');
        a.href = activeTestPack.pdfUrl;
        a.download = activeTestPack.pdfFileName || `${activeTestPack.title || activeTestPack.id}.pdf`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        count++;
      }

      if (count > 0) {
        setFeedbackMsg({
          type: 'success',
          text: `Đã lưu thành công ${count} tệp (Audio & PDF) của bài nghe này về máy tính!`,
        });
      } else {
        setFeedbackMsg({
          type: 'error',
          text: 'Chưa có tệp tải lên nào cho bài nghe này.',
        });
      }
    } catch {
      setFeedbackMsg({
        type: 'error',
        text: 'Có lỗi khi tải tệp về máy tính.',
      });
    }
  };

  const formatBytes = (bytes: number) => {
    if (!bytes || bytes <= 0) return '0 B';
    const mb = bytes / (1024 * 1024);
    if (mb >= 1) return `${mb.toFixed(2)} MB`;
    const kb = bytes / 1024;
    return `${kb.toFixed(1)} KB`;
  };

  const audioRecords = storedRecords.filter((r) => r.type === 'audio');
  const pdfRecords = storedRecords.filter((r) => r.type === 'pdf');

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white border border-slate-200 rounded-2xl max-w-3xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0F2744] text-white flex items-center justify-center shadow-xs">
              <HardDrive className="w-5 h-5" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base font-bold text-[#0F2744] tracking-tight flex items-center gap-2">
                <span>Quản Lý Tệp Cục Bộ Trên Máy Tính</span>
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-slate-100 text-[#0F2744] border border-slate-300">
                  Local Computer
                </span>
              </h2>
              <p className="text-xs font-medium text-slate-500 mt-0.5">
                Toàn bộ tệp Audio & PDF tải lên đều được tự động lưu trữ vĩnh viễn trên ổ cứng máy tính của bạn
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
            aria-label="Đóng cửa sổ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Directory Bar & Quick Actions */}
        <div className="px-6 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2 text-slate-700 font-medium min-w-0">
            <FolderOpen className="w-4 h-4 text-[#0F2744] shrink-0" />
            <span className="font-bold text-slate-900 shrink-0">Thư mục máy tính:</span>
            <code className="bg-white px-2 py-1 rounded border border-slate-200 text-[#0F2744] font-mono text-[11px] truncate max-w-md select-all">
              {localStoragePath || 'local_storage/'}
            </code>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleOpenFolderOnComputer}
              disabled={isOpeningFolder}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold rounded-lg shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              title="Mở thư mục chứa file trong Windows File Explorer"
            >
              {isOpeningFolder ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FolderOpen className="w-3.5 h-3.5 text-[#0F2744]" />
              )}
              <span>Mở trên Explorer</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadAllCurrent}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0F2744] hover:bg-[#0A1B30] text-white font-bold rounded-lg shadow-xs transition-colors cursor-pointer"
              title="Tải toàn bộ Audio & PDF của đề hiện tại về thư mục Downloads"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải Đề Hiện Tại</span>
            </button>
          </div>
        </div>

        {/* Feedback Alert */}
        {feedbackMsg && (
          <div
            className={`mx-6 mt-3 px-4 py-2.5 rounded-lg text-xs font-semibold flex items-center justify-between border ${
              feedbackMsg.type === 'success'
                ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                : 'bg-amber-50 text-amber-900 border-amber-200'
            }`}
          >
            <span>{feedbackMsg.text}</span>
            <button
              type="button"
              onClick={() => setFeedbackMsg(null)}
              className="text-xs hover:underline ml-2"
            >
              Đóng
            </button>
          </div>
        )}

        {/* Tabs Bar */}
        <div className="px-6 pt-3 flex items-center justify-between border-b border-slate-200 bg-white">
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => setActiveTab('audio')}
              className={`pb-2.5 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'audio'
                  ? 'border-[#0F2744] text-[#0F2744]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileAudio className="w-4 h-4" />
              <span>Tệp Âm Thanh (Audio)</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-[#0F2744]">
                {audioRecords.length + serverAudios.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('pdf')}
              className={`pb-2.5 text-sm font-bold flex items-center gap-2 border-b-2 transition-colors cursor-pointer ${
                activeTab === 'pdf'
                  ? 'border-[#0F2744] text-[#0F2744]'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              <FileText className="w-4 h-4" />
              <span>Tệp Đề Thi (PDF)</span>
              <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-[#0F2744]">
                {pdfRecords.length + serverPdfs.length}
              </span>
            </button>
          </div>

          <button
            type="button"
            onClick={loadLocalFiles}
            className="text-xs font-semibold text-slate-600 hover:text-blue-700 inline-flex items-center gap-1 pb-2 cursor-pointer"
            title="Làm mới danh sách tệp"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Làm mới</span>
          </button>
        </div>

        {/* Content List */}
        <div className="p-6 overflow-y-auto flex-1 space-y-4 bg-slate-50/40">
          {activeTab === 'audio' && (
            <div className="space-y-3">
              {/* Active test audio shortcut card */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-[#0F2744] text-white flex items-center justify-center">
                    <FileAudio className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-900">
                        {activeTestPack.audioFileName || `${activeTestPack.title}.mp3`}
                      </h4>
                      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded bg-slate-200 text-[#0F2744]">
                        Đang Mở
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-600 mt-0.5">
                      Đề: {activeTestPack.partLabel} · {activeTestPack.title}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {activeTestPack.audioUrl && (
                    <a
                      href={activeTestPack.audioUrl}
                      download={activeTestPack.audioFileName || `${activeTestPack.id}.mp3`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-[#0F2744] hover:bg-[#0A1B30] text-white font-bold text-xs rounded-lg shadow-xs transition-colors"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Tải về máy (.mp3)</span>
                    </a>
                  )}
                </div>
              </div>

              {/* IndexedDB stored audio records */}
              {audioRecords.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                    Các tệp Audio đã lưu trong IndexedDB máy tính
                  </h4>
                  {audioRecords.map((rec) => {
                    const matchedTest = allTests.find((t) => t.id === rec.testId);
                    return (
                      <div
                        key={rec.key}
                        className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 hover:border-blue-300 transition-colors shadow-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <FileAudio className="w-5 h-5 text-blue-700 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 truncate">
                              {rec.fileName || `${rec.testId}.mp3`}
                            </p>
                            <p className="text-[11px] font-semibold text-slate-500">
                              Dung lượng: {formatBytes(rec.size)} ·{' '}
                              {matchedTest ? matchedTest.title : `Đề: ${rec.testId}`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {matchedTest && onSelectTest && matchedTest.id !== activeTestPack.id && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectTest(matchedTest.id);
                                onClose();
                              }}
                              className="px-2.5 py-1 text-xs font-bold text-blue-800 bg-blue-50 hover:bg-blue-100 rounded-md border border-blue-200 cursor-pointer"
                            >
                              Chọn đề này
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDownloadRecord(rec)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5 text-slate-600" />
                            <span>Tải về</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Local Storage disk audios from server */}
              {serverAudios.length > 0 && (
                <div className="space-y-2 mt-4">
                  <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                    Các tệp Audio trong thư mục local_storage/audio/
                  </h4>
                  {serverAudios.map((file) => (
                    <div
                      key={file.name}
                      className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 shadow-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileAudio className="w-5 h-5 text-emerald-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {file.name}
                          </p>
                          <p className="text-[11px] font-semibold text-slate-500">
                            Dung lượng: {formatBytes(file.size)}
                          </p>
                        </div>
                      </div>

                      <a
                        href={file.url}
                        download={file.name}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 shrink-0"
                      >
                        <Download className="w-3.5 h-3.5 text-slate-600" />
                        <span>Tải về</span>
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {audioRecords.length === 0 && serverAudios.length === 0 && (
                <div className="p-8 text-center bg-white rounded-xl border border-slate-200">
                  <FileAudio className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-800">
                    Chưa có tệp Audio nào được nạp vào máy tính
                  </p>
                  <p className="text-xs font-semibold text-slate-500 mt-1 max-w-sm mx-auto">
                    Khi bạn nạp đề mới hoặc gắn file Audio, hệ thống sẽ tự động lưu vĩnh viễn tệp vào máy tính của bạn tại đây.
                  </p>
                </div>
              )}
            </div>
          )}

          {activeTab === 'pdf' && (
            <div className="space-y-3">
              {/* Active test PDF shortcut card */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl flex flex-wrap items-center justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-red-600 text-white flex items-center justify-center">
                    <FileText className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-slate-900">
                        {activeTestPack.pdfFileName || `${activeTestPack.title}_exam.pdf`}
                      </h4>
                      <span className="px-2 py-0.5 text-[10px] font-extrabold uppercase rounded bg-red-100 text-red-800">
                        Đang Mở
                      </span>
                    </div>
                    <p className="text-xs font-semibold text-slate-600 mt-0.5">
                      Đề: {activeTestPack.partLabel} · {activeTestPack.title}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {activeTestPack.pdfUrl ? (
                    <>
                      <a
                        href={activeTestPack.pdfUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-800 font-bold text-xs rounded-lg border border-slate-300 shadow-xs transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5 text-red-600" />
                        <span>Xem PDF</span>
                      </a>
                      <a
                        href={activeTestPack.pdfUrl}
                        download={activeTestPack.pdfFileName || `${activeTestPack.id}.pdf`}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors"
                      >
                        <Download className="w-3.5 h-3.5" />
                        <span>Tải về máy (.pdf)</span>
                      </a>
                    </>
                  ) : (
                    <span className="text-xs font-semibold text-slate-500">
                      Chưa nạp file PDF cho đề này
                    </span>
                  )}
                </div>
              </div>

              {/* IndexedDB stored PDF records */}
              {pdfRecords.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                    Các tệp PDF đã lưu trong IndexedDB máy tính
                  </h4>
                  {pdfRecords.map((rec) => {
                    const matchedTest = allTests.find((t) => t.id === rec.testId);
                    return (
                      <div
                        key={rec.key}
                        className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 hover:border-red-300 transition-colors shadow-xs"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <FileText className="w-5 h-5 text-red-600 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 truncate">
                              {rec.fileName || `${rec.testId}.pdf`}
                            </p>
                            <p className="text-[11px] font-semibold text-slate-500">
                              Dung lượng: {formatBytes(rec.size)} ·{' '}
                              {matchedTest ? matchedTest.title : `Đề: ${rec.testId}`}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {matchedTest && onSelectTest && matchedTest.id !== activeTestPack.id && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectTest(matchedTest.id);
                                onClose();
                              }}
                              className="px-2.5 py-1 text-xs font-bold text-slate-800 bg-slate-50 hover:bg-slate-100 rounded-md border border-slate-200 cursor-pointer"
                            >
                              Chọn đề này
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleDownloadRecord(rec)}
                            className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 cursor-pointer"
                          >
                            <Download className="w-3.5 h-3.5 text-slate-600" />
                            <span>Tải PDF về</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Local Storage disk PDFs from server */}
              {serverPdfs.length > 0 && (
                <div className="space-y-2 mt-4">
                  <h4 className="text-xs font-extrabold text-slate-700 uppercase tracking-wider">
                    Các tệp PDF trong thư mục local_storage/pdfs/
                  </h4>
                  {serverPdfs.map((file) => (
                    <div
                      key={file.name}
                      className="p-3 bg-white border border-slate-200 rounded-xl flex items-center justify-between gap-3 shadow-xs"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <FileText className="w-5 h-5 text-red-600 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-xs font-bold text-slate-900 truncate">
                            {file.name}
                          </p>
                          <p className="text-[11px] font-semibold text-slate-500">
                            Dung lượng: {formatBytes(file.size)}
                          </p>
                        </div>
                      </div>

                      <a
                        href={file.url}
                        download={file.name}
                        className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-md border border-slate-300 shrink-0"
                      >
                        <Download className="w-3.5 h-3.5 text-slate-600" />
                        <span>Tải về</span>
                      </a>
                    </div>
                  ))}
                </div>
              )}

              {pdfRecords.length === 0 && serverPdfs.length === 0 && (
                <div className="p-8 text-center bg-white rounded-xl border border-slate-200">
                  <FileText className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                  <p className="text-sm font-bold text-slate-800">
                    Chưa có tệp PDF nào được nạp vào máy tính
                  </p>
                  <p className="text-xs font-semibold text-slate-500 mt-1 max-w-sm mx-auto">
                    Khi nạp đề mới kèm file PDF bài thi IELTS, file PDF sẽ được tự động lưu vĩnh viễn vào máy tính của bạn tại đây.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-white flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs font-bold text-slate-600">
            <Sparkles className="w-4 h-4 text-amber-500 shrink-0" />
            <span>Mẹo: Bạn có thể sao chép hoặc di chuyển các file trong thư mục bất kỳ lúc nào.</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};