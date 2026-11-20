import React, { useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  FileAudio,
  FileText,
  FolderInput,
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import type { FlashcardItem, ListeningTestPack } from '../types/ielts';
import {
  downloadBlob,
  getAllStoredMediaRecords,
  getMediaBlob,
  type StoredMediaRecord,
} from '../utils/indexedDBStorage';
import {
  downloadQuickBackup,
  isFileSystemAccessSupported,
  loadAllDataFromDirectory,
  loadSavedLocalDirectory,
  pickLocalDirectory,
  restoreBackupFromFile,
  saveAllDataToDirectory,
  saveBackupWithFilePicker,
  unlinkSavedDirectory,
} from '../utils/localDiskSync';

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
  flashcards?: FlashcardItem[];
  answersByTest?: Record<string, Record<string, string>>;
  reportsByTest?: Record<string, unknown>;
  onImportTests?: (newTests: ListeningTestPack[]) => void;
  onImportFlashcards?: (newCards: FlashcardItem[]) => void;
  onImportAnswers?: (answers: Record<string, Record<string, string>>) => void;
  onImportReports?: (reports: Record<string, unknown>) => void;
  onSelectTest?: (testId: string) => void;
  onPlayAudio?: (sec: number) => void;
}

export const LocalFilesManagerModal: React.FC<LocalFilesManagerModalProps> = ({
  isOpen,
  onClose,
  activeTestPack,
  allTests,
  flashcards = [],
  answersByTest = {},
  reportsByTest = {},
  onImportTests,
  onImportFlashcards,
  onImportAnswers,
  onImportReports,
  onSelectTest,
  onPlayAudio,
}) => {
  // Directory handle state
  const [savedDirectory, setSavedDirectory] = useState<{
    handle: FileSystemDirectoryHandle;
    name: string;
  } | null>(null);

  // Loading states
  const [isSavingDir, setIsSavingDir] = useState(false);
  const [isLoadingDir, setIsLoadingDir] = useState(false);
  const [isSavingBackup, setIsSavingBackup] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isOpeningFolder, setIsOpeningFolder] = useState(false);

  // Feedback message
  const [feedbackMsg, setFeedbackMsg] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // File lists for detailed inspection
  const [storedRecords, setStoredRecords] = useState<StoredMediaRecord[]>([]);
  const [serverAudios, setServerAudios] = useState<ServerFileInfo[]>([]);
  const [serverPdfs, setServerPdfs] = useState<ServerFileInfo[]>([]);
  const [localStoragePath, setLocalStoragePath] = useState<string>('');
  const [showMediaDetails, setShowMediaDetails] = useState(false);
  const [activeMediaTab, setActiveMediaTab] = useState<'audio' | 'pdf'>('audio');

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Calculate stats
  const testsCount = allTests.length;
  const flashcardsCount = flashcards.length;
  const totalAnswersGiven = Object.values(answersByTest).reduce(
    (sum, ans) => sum + Object.keys(ans).length,
    0
  );
  const notesCount = Math.max(1, totalAnswersGiven + Object.keys(reportsByTest).length);

  // Initialize and load saved directory & stored records on modal open
  useEffect(() => {
    if (!isOpen) return;

    void (async () => {
      // 1. Load saved directory from IndexedDB
      try {
        const saved = await loadSavedLocalDirectory();
        if (saved) {
          setSavedDirectory(saved);
        }
      } catch {
        // ignore
      }

      // 2. Load stored media records from IndexedDB
      try {
        const records = await getAllStoredMediaRecords();
        setStoredRecords(records);
      } catch {
        // ignore
      }

      // 3. Load server local_storage files if running with backend
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
      }
    })();
  }, [isOpen]);

  if (!isOpen) return null;

  // Pick or Change Directory
  const handlePickDirectory = async () => {
    setFeedbackMsg(null);
    try {
      const picked = await pickLocalDirectory();
      if (picked) {
        setSavedDirectory(picked);
        setFeedbackMsg({
          type: 'success',
          text: `Đã định vị thành công thư mục: "${picked.name}". Bạn có thể bấm "Lưu dữ liệu" hoặc "Đọc dữ liệu" ngay bây giờ!`,
        });
      }
    } catch (err: unknown) {
      setFeedbackMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể chọn thư mục.',
      });
    }
  };

  // Unlink Directory
  const handleUnlinkDirectory = async () => {
    try {
      await unlinkSavedDirectory();
      setSavedDirectory(null);
      setFeedbackMsg({
        type: 'info',
        text: 'Đã hủy liên kết thư mục máy tính.',
      });
    } catch {
      setSavedDirectory(null);
    }
  };

  // Save all data into chosen directory
  const handleSaveToDirectory = async () => {
    setFeedbackMsg(null);
    let targetDir = savedDirectory;

    if (!targetDir) {
      try {
        const picked = await pickLocalDirectory();
        if (!picked) return;
        targetDir = picked;
        setSavedDirectory(picked);
      } catch (err: unknown) {
        setFeedbackMsg({
          type: 'error',
          text: err instanceof Error ? err.message : 'Chưa chọn thư mục lưu trữ.',
        });
        return;
      }
    }

    setIsSavingDir(true);
    try {
      const res = await saveAllDataToDirectory(targetDir.handle, {
        tests: allTests,
        flashcards,
        answersByTest,
        reportsByTest,
      });

      setFeedbackMsg({
        type: 'success',
        text: `Đã lưu thành công ${res.testsCount} bài nghe, ${flashcards.length} từ vựng và ${res.audiosCount} file Audio vào thư mục "${targetDir.name}"!`,
      });

      // Refresh records
      const refreshed = await getAllStoredMediaRecords();
      setStoredRecords(refreshed);
    } catch (err: unknown) {
      setFeedbackMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể lưu dữ liệu vào thư mục.',
      });
    } finally {
      setIsSavingDir(false);
    }
  };

  // Read all data from chosen directory
  const handleLoadFromDirectory = async () => {
    setFeedbackMsg(null);
    let targetDir = savedDirectory;

    if (!targetDir) {
      try {
        const picked = await pickLocalDirectory();
        if (!picked) return;
        targetDir = picked;
        setSavedDirectory(picked);
      } catch (err: unknown) {
        setFeedbackMsg({
          type: 'error',
          text: err instanceof Error ? err.message : 'Chưa chọn thư mục đọc dữ liệu.',
        });
        return;
      }
    }

    setIsLoadingDir(true);
    try {
      const res = await loadAllDataFromDirectory(targetDir.handle);

      if (onImportTests && res.tests.length > 0) {
        onImportTests(res.tests);
      }
      if (onImportFlashcards && res.flashcards.length > 0) {
        onImportFlashcards(res.flashcards);
      }
      if (onImportAnswers && res.answersByTest) {
        onImportAnswers(res.answersByTest);
      }
      if (onImportReports && res.reportsByTest) {
        onImportReports(res.reportsByTest);
      }

      setFeedbackMsg({
        type: 'success',
        text: `Đã nạp thành công ${res.tests.length} bài nghe, ${res.flashcards.length} từ vựng và ${res.loadedAudiosCount} file Audio từ thư mục "${targetDir.name}"!`,
      });

      const refreshed = await getAllStoredMediaRecords();
      setStoredRecords(refreshed);
    } catch (err: unknown) {
      setFeedbackMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể đọc dữ liệu từ thư mục này.',
      });
    } finally {
      setIsLoadingDir(false);
    }
  };

  // Windows "Save As" file picker (.json)
  const handleSaveAsBackup = async () => {
    setFeedbackMsg(null);
    setIsSavingBackup(true);
    try {
      const ok = await saveBackupWithFilePicker({
        tests: allTests,
        flashcards,
        answersByTest,
        reportsByTest,
      });

      if (ok) {
        setFeedbackMsg({
          type: 'success',
          text: 'Đã lưu tệp sao lưu .json thành công vào vị trí bạn đã chọn!',
        });
      }
    } catch (err: unknown) {
      setFeedbackMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Lỗi khi lưu tệp sao lưu.',
      });
    } finally {
      setIsSavingBackup(false);
    }
  };

  // Quick download .json
  const handleQuickDownload = () => {
    setFeedbackMsg(null);
    try {
      downloadQuickBackup({
        tests: allTests,
        flashcards,
        answersByTest,
        reportsByTest,
      });
      setFeedbackMsg({
        type: 'success',
        text: 'Đang tải tệp sao lưu .json về thư mục Downloads của máy tính...',
      });
    } catch {
      setFeedbackMsg({
        type: 'error',
        text: 'Không thể tải nhanh tệp sao lưu.',
      });
    }
  };

  // Restore backup from file input
  const handleFileRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFeedbackMsg(null);
    setIsRestoring(true);

    try {
      const res = await restoreBackupFromFile(file);

      if (onImportTests && res.tests.length > 0) {
        onImportTests(res.tests);
      }
      if (onImportFlashcards && res.flashcards.length > 0) {
        onImportFlashcards(res.flashcards);
      }
      if (onImportAnswers && res.answersByTest) {
        onImportAnswers(res.answersByTest);
      }
      if (onImportReports && res.reportsByTest) {
        onImportReports(res.reportsByTest);
      }

      setFeedbackMsg({
        type: 'success',
        text: `Khôi phục thành công ${res.tests.length} bài nghe, ${res.flashcards.length} từ vựng và ${res.audioRestoredCount} tệp âm thanh!`,
      });

      const refreshed = await getAllStoredMediaRecords();
      setStoredRecords(refreshed);
    } catch (err: unknown) {
      setFeedbackMsg({
        type: 'error',
        text: err instanceof Error ? err.message : 'Không thể khôi phục dữ liệu từ tệp này.',
      });
    } finally {
      setIsRestoring(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Open local_storage folder in Windows Explorer
  const handleOpenFolderOnComputer = async () => {
    setIsOpeningFolder(true);
    try {
      const res = await fetch('/api/ielts/files/open-folder', { method: 'POST' });
      if (res.ok) {
        setFeedbackMsg({
          type: 'success',
          text: 'Đã mở thư mục lưu trữ trên Windows Explorer!',
        });
      } else {
        throw new Error('Máy chủ chưa hỗ trợ mở thư mục trực tiếp.');
      }
    } catch {
      setFeedbackMsg({
        type: 'info',
        text: `Thư mục lưu trữ: ${localStoragePath || 'local_storage/'}. Bạn có thể mở trực tiếp từ File Explorer của Windows.`,
      });
    } finally {
      setIsOpeningFolder(false);
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
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div className="bg-white border border-slate-200 rounded-2xl sm:rounded-3xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 sm:px-6 py-4 sm:py-5 border-b border-slate-100 flex items-start justify-between gap-4 bg-white shrink-0">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-200 flex items-center justify-center shadow-xs shrink-0">
              <HardDrive className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                Lưu trữ & Quản lý Dữ liệu trên Máy tính
              </h2>
              <p className="text-xs font-semibold text-slate-500 mt-0.5 leading-snug">
                Toàn bộ dữ liệu được lưu cục bộ trên máy tính của bạn (Local-First), an toàn và không phụ thuộc server.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer shrink-0"
            aria-label="Đóng cửa sổ"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body - Scrollable */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1 bg-white">
          {/* Feedback Alert */}
          {feedbackMsg && (
            <div
              className={`px-4 py-3 rounded-xl text-xs font-bold flex items-center justify-between border shadow-xs animate-in fade-in ${
                feedbackMsg.type === 'success'
                  ? 'bg-emerald-50 text-emerald-900 border-emerald-200'
                  : feedbackMsg.type === 'error'
                  ? 'bg-rose-50 text-rose-900 border-rose-200'
                  : 'bg-blue-50 text-blue-900 border-blue-200'
              }`}
            >
              <div className="flex items-center gap-2">
                {feedbackMsg.type === 'success' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 shrink-0" />
                )}
                <span>{feedbackMsg.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setFeedbackMsg(null)}
                className="text-xs hover:underline ml-3 font-extrabold cursor-pointer"
              >
                Đóng
              </button>
            </div>
          )}

          {/* Section 1: Status & Counters */}
          <div className="p-4 rounded-2xl border border-emerald-200 bg-[#F7FCF8]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-emerald-900">
                <ShieldCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Trạng thái: Hoạt động trên máy tính cá nhân</span>
              </div>
              <span className="px-3 py-1 bg-emerald-100/70 text-emerald-800 border border-emerald-300 rounded-full text-[11px] font-extrabold tracking-wide">
                IndexedDB + LocalStorage
              </span>
            </div>

            <div className="grid grid-cols-3 gap-3 mt-3">
              <div className="bg-white border border-emerald-100 rounded-xl p-3 text-center shadow-xs">
                <span className="text-2xl font-black text-slate-900">{testsCount}</span>
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">Bài nghe trên máy</p>
              </div>

              <div className="bg-white border border-emerald-100 rounded-xl p-3 text-center shadow-xs">
                <span className="text-2xl font-black text-slate-900">{flashcardsCount}</span>
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">Từ vựng Pre-teach</p>
              </div>

              <div className="bg-white border border-emerald-100 rounded-xl p-3 text-center shadow-xs">
                <span className="text-2xl font-black text-slate-900">{notesCount}</span>
                <p className="text-[11px] font-bold text-slate-500 mt-0.5">Ghi chú & Điểm thi</p>
              </div>
            </div>
          </div>

          {/* Section 2: Directory Picker (TRỰC TIẾP TRÊN Ổ ĐĨA) */}
          <div className="border-2 border-emerald-300 bg-[#F7FCF8] rounded-2xl p-4 sm:p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-900 font-black text-sm">
                <FolderOpen className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>Định vị Thư mục / Ổ đĩa lưu trữ trên máy (Ổ D:, E:, Google Drive...)</span>
              </div>
              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-800 font-extrabold text-[10px] rounded-lg border border-emerald-300 tracking-wider">
                TRỰC TIẾP TRÊN Ổ ĐĨA
              </span>
            </div>

            <p className="text-xs font-semibold text-slate-600 mt-2 leading-relaxed">
              Chỉ định trực tiếp ổ đĩa và thư mục trên máy tính (ví dụ{' '}
              <code className="bg-white px-1.5 py-0.5 rounded border border-emerald-200 font-mono text-emerald-800 font-bold">
                D:\Du_Lieu_Thay_Phuc
              </code>{' '}
              hoặc thư mục đồng bộ Google Drive/OneDrive). Bạn có thể bấm lưu dữ liệu hoặc đọc dữ liệu từ thư mục đó bất kỳ lúc nào.
            </p>

            {/* Folder badge row */}
            <div className="bg-white border border-emerald-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3 mt-3">
              <div className="flex items-center gap-2 text-xs font-bold text-slate-800 min-w-0">
                <FolderOpen className="w-4 h-4 text-emerald-700 shrink-0" />
                <span className="shrink-0">Đang định vị tại thư mục:</span>
                <span className="bg-emerald-100 text-emerald-900 font-mono font-black text-xs px-2.5 py-1 rounded-md border border-emerald-300 truncate max-w-[200px] sm:max-w-xs">
                  {savedDirectory ? savedDirectory.name : '1. IELTS_LISTENING'}
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handlePickDirectory}
                  className="px-3 py-1.5 text-xs font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded-lg transition-colors cursor-pointer"
                  title="Chọn thư mục khác trên ổ đĩa máy tính"
                >
                  {savedDirectory ? 'Đổi thư mục' : 'Chọn thư mục'}
                </button>

                {savedDirectory && (
                  <button
                    type="button"
                    onClick={handleUnlinkDirectory}
                    className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer"
                    title="Hủy liên kết thư mục này"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>

            {/* 2 Big Action Buttons */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3.5">
              <button
                type="button"
                onClick={handleSaveToDirectory}
                disabled={isSavingDir}
                className="bg-[#0D5A30] hover:bg-[#0A4625] text-white font-bold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                title="Lưu toàn bộ đề thi, từ vựng và tệp âm thanh vào thư mục đã chọn"
              >
                {isSavingDir ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Lưu dữ liệu ngay vào thư mục này</span>
              </button>

              <button
                type="button"
                onClick={handleLoadFromDirectory}
                disabled={isLoadingDir}
                className="bg-[#D1FAE5] hover:bg-[#A7F3D0] text-[#065F46] border border-emerald-300 font-bold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                title="Đọc và nạp toàn bộ đề thi, từ vựng từ thư mục đã chọn"
              >
                {isLoadingDir ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                <span>Đọc dữ liệu từ thư mục này</span>
              </button>
            </div>
          </div>

          {/* Section 3: Backup (1. Sao lưu & Chọn vị trí lưu tệp) */}
          <div className="border border-slate-200 bg-slate-50/70 rounded-2xl p-4 sm:p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-900 font-black text-sm">
                <Download className="w-4 h-4 text-emerald-700 shrink-0" />
                <span>1. Sao lưu & Chọn vị trí lưu tệp (Save As to Drive D:, E:... )</span>
              </div>
              <span className="px-2 py-0.5 bg-slate-200 text-slate-700 font-mono font-bold text-[10px] rounded">
                .json
              </span>
            </div>

            <p className="text-xs font-semibold text-slate-600 mt-2 leading-relaxed">
              Mở cửa sổ duyệt ổ đĩa Windows (Save As) để bạn tự do chọn ổ D:, E:, USB hoặc Google Drive, đặt tên file và bấm Save.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3.5">
              <button
                type="button"
                onClick={handleSaveAsBackup}
                disabled={isSavingBackup}
                className="bg-[#0D5A30] hover:bg-[#0A4625] text-white font-bold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
              >
                {isSavingBackup ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Save className="w-4 h-4" />
                )}
                <span>Chọn ổ đĩa & Lưu tệp sao lưu (.json)</span>
              </button>

              <button
                type="button"
                onClick={handleQuickDownload}
                className="bg-white hover:bg-slate-100 text-slate-800 border border-slate-300 font-bold text-xs py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
              >
                <Download className="w-4 h-4 text-slate-600" />
                <span>Tải nhanh về máy</span>
              </button>
            </div>
          </div>

          {/* Section 4: Restore (2. Khôi phục dữ liệu từ tệp sao lưu) */}
          <div className="border border-slate-200 bg-slate-50/70 rounded-2xl p-4 sm:p-5 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-slate-900 font-black text-sm">
                <FolderInput className="w-4 h-4 text-blue-700 shrink-0" />
                <span>2. Khôi phục dữ liệu từ tệp sao lưu (.json / .lexisync)</span>
              </div>
              <span className="px-2 py-0.5 bg-blue-100 text-blue-800 font-bold text-[10px] rounded">
                Khôi phục
              </span>
            </div>

            <p className="text-xs font-semibold text-slate-600 mt-2 leading-relaxed">
              Chọn tệp sao lưu .json hoặc .lexisync từ máy tính của bạn để phục hồi toàn bộ đề thi, âm thanh và từ vựng.
            </p>

            <input
              type="file"
              ref={fileInputRef}
              onChange={handleFileRestore}
              accept=".json,.lexisync,.lexisync_pack"
              className="hidden"
            />

            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isRestoring}
              className="w-full mt-3.5 py-3 px-4 bg-white hover:bg-slate-100 text-blue-800 border border-blue-200 rounded-xl font-bold text-xs flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer disabled:opacity-50"
            >
              {isRestoring ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 text-blue-700" />
              )}
              <span>Chọn tệp sao lưu từ máy tính để khôi phục</span>
            </button>
          </div>

          {/* Section 5: Collapsible Media Files Details */}
          <div className="border border-slate-200 rounded-2xl overflow-hidden bg-white">
            <button
              type="button"
              onClick={() => setShowMediaDetails(!showMediaDetails)}
              className="w-full px-4 py-3 bg-slate-50 hover:bg-slate-100/80 flex items-center justify-between text-xs font-bold text-slate-700 transition-colors cursor-pointer"
            >
              <div className="flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-slate-600" />
                <span>
                  Xem chi tiết các tệp Audio & PDF trong bộ nhớ máy tính ({audioRecords.length + serverAudios.length} audio, {pdfRecords.length + serverPdfs.length} pdf)
                </span>
              </div>
              {showMediaDetails ? (
                <ChevronUp className="w-4 h-4 text-slate-500" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" />
              )}
            </button>

            {showMediaDetails && (
              <div className="p-4 space-y-4 border-t border-slate-200 bg-slate-50/40">
                {/* Tabs */}
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setActiveMediaTab('audio')}
                      className={`text-xs font-bold pb-1 flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                        activeMediaTab === 'audio'
                          ? 'border-[#0D5A30] text-[#0D5A30]'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <FileAudio className="w-3.5 h-3.5" />
                      <span>Âm thanh Audio ({audioRecords.length + serverAudios.length})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setActiveMediaTab('pdf')}
                      className={`text-xs font-bold pb-1 flex items-center gap-1.5 border-b-2 transition-colors cursor-pointer ${
                        activeMediaTab === 'pdf'
                          ? 'border-red-600 text-red-600'
                          : 'border-transparent text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <FileText className="w-3.5 h-3.5" />
                      <span>Đề thi PDF ({pdfRecords.length + serverPdfs.length})</span>
                    </button>
                  </div>

                  {localStoragePath && (
                    <button
                      type="button"
                      onClick={handleOpenFolderOnComputer}
                      disabled={isOpeningFolder}
                      className="px-2.5 py-1 text-[11px] font-bold text-slate-700 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg inline-flex items-center gap-1 shadow-xs cursor-pointer"
                    >
                      {isOpeningFolder ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <FolderOpen className="w-3 h-3 text-emerald-700" />
                      )}
                      <span>Mở Explorer</span>
                    </button>
                  )}
                </div>

                {/* Audio Tab */}
                {activeMediaTab === 'audio' && (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {audioRecords.length === 0 && serverAudios.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-4">
                        Chưa có tệp Audio nào được lưu trong máy.
                      </p>
                    ) : (
                      <>
                        {audioRecords.map((rec) => {
                          const matched = allTests.find((t) => t.id === rec.testId);
                          return (
                            <div
                              key={rec.key}
                              className="p-2.5 bg-white border border-slate-200 rounded-lg flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileAudio className="w-4 h-4 text-emerald-700 shrink-0" />
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-900 truncate">
                                    {rec.fileName || `${rec.testId}.mp3`}
                                  </p>
                                  <p className="text-[10px] text-slate-500">
                                    {formatBytes(rec.size)} · {matched?.title || rec.testId}
                                  </p>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 shrink-0">
                                {matched && onSelectTest && matched.id !== activeTestPack.id && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      onSelectTest(matched.id);
                                      onClose();
                                    }}
                                    className="px-2 py-1 text-[11px] font-bold text-emerald-800 bg-emerald-50 hover:bg-emerald-100 rounded border border-emerald-200 cursor-pointer"
                                  >
                                    Chọn đề này
                                  </button>
                                )}
                                <button
                                  type="button"
                                  onClick={() =>
                                    downloadBlob(rec.blob, rec.fileName || `${rec.testId}.mp3`)
                                  }
                                  className="px-2 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 inline-flex items-center gap-1 cursor-pointer"
                                >
                                  <Download className="w-3 h-3" />
                                  <span>Tải</span>
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}

                {/* PDF Tab */}
                {activeMediaTab === 'pdf' && (
                  <div className="space-y-2 max-h-60 overflow-y-auto">
                    {pdfRecords.length === 0 && serverPdfs.length === 0 ? (
                      <p className="text-xs text-slate-500 text-center py-4">
                        Chưa có tệp PDF nào được lưu trong máy.
                      </p>
                    ) : (
                      <>
                        {pdfRecords.map((rec) => {
                          const matched = allTests.find((t) => t.id === rec.testId);
                          return (
                            <div
                              key={rec.key}
                              className="p-2.5 bg-white border border-slate-200 rounded-lg flex items-center justify-between gap-3 text-xs"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <FileText className="w-4 h-4 text-red-600 shrink-0" />
                                <div className="min-w-0">
                                  <p className="font-bold text-slate-900 truncate">
                                    {rec.fileName || `${rec.testId}.pdf`}
                                  </p>
                                  <p className="text-[10px] text-slate-500">
                                    {formatBytes(rec.size)} · {matched?.title || rec.testId}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  downloadBlob(rec.blob, rec.fileName || `${rec.testId}.pdf`)
                                }
                                className="px-2 py-1 text-[11px] font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded border border-slate-300 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Download className="w-3 h-3" />
                                <span>Tải</span>
                              </button>
                            </div>
                          );
                        })}
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 sm:px-6 py-3.5 border-t border-slate-100 bg-white flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
            <Sparkles className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
            <span>Dữ liệu lưu an toàn trên máy tính cá nhân của bạn, không lo mất dữ liệu.</span>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-slate-800 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
