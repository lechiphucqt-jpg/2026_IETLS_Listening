import React, { useState, useEffect } from 'react';
import {
  AlertCircle,
  Check,
  Cloud,
  CloudDownload,
  Copy,
  ExternalLink,
  FolderOpen,
  HelpCircle,
  Loader2,
  RefreshCw,
  X,
} from 'lucide-react';
import {
  fetchAllTestsFromGoogleDrive,
  getGoogleDriveWebhookUrl,
  GOOGLE_APPS_SCRIPT_TEMPLATE,
  setGoogleDriveWebhookUrl,
  testGoogleDriveConnection,
} from '../utils/googleDriveSync';
import type { ListeningTestPack } from '../types/ielts';

interface GoogleDriveModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncTestsSuccess?: (tests: ListeningTestPack[]) => void;
  activeTestPack?: ListeningTestPack;
  onUploadCurrentTest?: () => Promise<void>;
  isUploadingCurrentTest?: boolean;
}

export const GoogleDriveModal: React.FC<GoogleDriveModalProps> = ({
  isOpen,
  onClose,
  onSyncTestsSuccess,
  activeTestPack,
  onUploadCurrentTest,
  isUploadingCurrentTest = false,
}) => {
  const [webhookUrl, setWebhookUrl] = useState('');
  const [copiedCode, setCopiedCode] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string; folderUrl?: string } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const saved = getGoogleDriveWebhookUrl();
      setWebhookUrl(saved);
      setTestResult(null);
      setSyncNotice(null);
      if (!saved) {
        setShowGuide(true);
      }
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSaveUrl = () => {
    setGoogleDriveWebhookUrl(webhookUrl);
    setTestResult(null);
  };

  const handleTestConnection = async () => {
    handleSaveUrl();
    setIsTesting(true);
    setTestResult(null);
    const result = await testGoogleDriveConnection();
    setIsTesting(false);
    setTestResult({
      ok: result.ok,
      message: result.message || (result.ok ? 'Kết nối thành công!' : 'Kết nối thất bại.'),
      folderUrl: result.folderUrl,
    });
  };

  const handleCopyCode = async () => {
    try {
      await navigator.clipboard.writeText(GOOGLE_APPS_SCRIPT_TEMPLATE);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2500);
    } catch {
      alert('Không thể sao chép tự động. Vui lòng chọn và sao chép thủ công đoạn mã.');
    }
  };

  const handleSyncFromDrive = async () => {
    handleSaveUrl();
    setIsSyncing(true);
    setSyncNotice(null);
    try {
      const tests = await fetchAllTestsFromGoogleDrive();
      if (tests.length === 0) {
        setSyncNotice('Thư mục Google Drive chưa có bài thi nào được lưu.');
      } else {
        if (onSyncTestsSuccess) {
          onSyncTestsSuccess(tests);
        }
        setSyncNotice(`Đồng bộ thành công ${tests.length} bài thi từ Google Drive về máy này!`);
      }
    } catch (err: unknown) {
      setSyncNotice('Lỗi đồng bộ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="gdrive-modal-title"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4"
    >
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto shadow-2xl flex flex-col">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-slate-100 border border-slate-300 flex items-center justify-center text-[#0F2744]">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 id="gdrive-modal-title" className="text-base font-bold text-[#0F2744]">
                Đồng bộ & Lưu trữ Google Drive
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Tự động lưu toàn bộ file Audio, PDF và đề thi vào Google Drive để mở trên mọi máy
              </p>
            </div>
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

        {/* Modal Content */}
        <div className="p-6 space-y-6 flex-1">
          {/* Section 1: Webhook URL Input */}
          <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
            <div className="flex items-center justify-between">
              <label htmlFor="gdrive-url-input" className="text-xs font-bold text-slate-900">
                Đường dẫn Google Apps Script Web App URL
              </label>
              <button
                type="button"
                onClick={() => setShowGuide(!showGuide)}
                className="inline-flex items-center gap-1 text-xs text-blue-700 hover:text-blue-900 font-semibold cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" />
                {showGuide ? 'Ẩn hướng dẫn' : 'Xem hướng dẫn cài đặt (1 phút)'}
              </button>
            </div>

            <input
              id="gdrive-url-input"
              type="url"
              placeholder="https://script.google.com/macros/s/.../exec"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              className="w-full px-3.5 py-2.5 text-xs font-mono bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-700"
            />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={handleTestConnection}
                disabled={isTesting || !webhookUrl.trim()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-800 bg-white hover:bg-slate-100 border border-slate-300 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
              >
                {isTesting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-700" />
                ) : (
                  <RefreshCw className="w-3.5 h-3.5 text-slate-600" />
                )}
                Kiểm tra kết nối
              </button>

              {testResult?.folderUrl && (
                <a
                  href={testResult.folderUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:text-blue-800 bg-blue-50 border border-blue-200 rounded-lg"
                >
                  <FolderOpen className="w-3.5 h-3.5" />
                  Mở thư mục Google Drive
                  <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {testResult && (
              <div
                className={`p-3 rounded-lg text-xs font-medium flex items-center gap-2 ${
                  testResult.ok
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-800 border border-red-200'
                }`}
              >
                {testResult.ok ? (
                  <Check className="w-4 h-4 text-emerald-600 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                )}
                <span>{testResult.message}</span>
              </div>
            )}
          </div>

          {/* Section 2: Quick Cross-Device Actions */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            {/* Sync from Google Drive */}
            <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2 hover:border-blue-300 transition-colors">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-xs">
                <CloudDownload className="w-4 h-4 text-blue-600" />
                Đồng bộ về máy này
              </div>
              <p className="text-[11px] text-slate-500 leading-relaxed">
                Tải toàn bộ các đề thi và file Audio đã lưu trên Google Drive về máy tính / thiết bị này.
              </p>
              <button
                type="button"
                onClick={handleSyncFromDrive}
                disabled={isSyncing || !webhookUrl.trim()}
                className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-lg transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
              >
                {isSyncing ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <CloudDownload className="w-3.5 h-3.5" />
                )}
                Đồng bộ tất cả từ Google Drive
              </button>
            </div>

            {/* Upload active test to Google Drive */}
            {activeTestPack && onUploadCurrentTest && (
              <div className="p-4 bg-white border border-slate-200 rounded-xl space-y-2 hover:border-purple-300 transition-colors">
                <div className="flex items-center gap-2 text-slate-900 font-bold text-xs">
                  <Cloud className="w-4 h-4 text-purple-600" />
                  Lưu bài hiện tại lên Drive
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed truncate" title={activeTestPack.title}>
                  Bài: <strong>{activeTestPack.title}</strong>
                </p>
                <button
                  type="button"
                  onClick={onUploadCurrentTest}
                  disabled={isUploadingCurrentTest || !webhookUrl.trim()}
                  className="w-full mt-2 inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold text-purple-700 bg-purple-50 hover:bg-purple-100 border border-purple-200 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isUploadingCurrentTest ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-purple-600" />
                  ) : (
                    <Cloud className="w-3.5 h-3.5 text-purple-600" />
                  )}
                  Lưu ngay bài này lên Google Drive
                </button>
              </div>
            )}
          </div>

          {syncNotice && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs font-medium text-blue-900 flex items-center gap-2">
              <Check className="w-4 h-4 text-blue-600 shrink-0" />
              <span>{syncNotice}</span>
            </div>
          )}

          {/* Section 3: Collapsible 1-Minute Setup Guide */}
          {showGuide && (
            <div className="p-4 bg-amber-50/80 border border-amber-300 rounded-xl space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-950 flex items-center gap-1.5">
                  <HelpCircle className="w-4 h-4 text-amber-700" />
                  Hướng dẫn cài đặt Google Apps Script (Miễn phí 100%, 1 phút)
                </span>
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-amber-900 bg-amber-100 hover:bg-amber-200 border border-amber-300 rounded-md cursor-pointer"
                >
                  {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-700" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedCode ? 'Đã sao chép mã!' : 'Sao chép mã Apps Script'}
                </button>
              </div>

              <ol className="text-xs text-amber-900 space-y-2 list-decimal list-inside leading-relaxed">
                <li>
                  Truy cập{' '}
                  <a
                    href="https://script.google.com"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-bold underline text-blue-700 hover:text-blue-900"
                  >
                    script.google.com
                  </a>{' '}
                  và bấm <strong>Dự án mới (New project)</strong>.
                </li>
                <li>
                  Xóa hết code mặc định và bấm nút <strong>"Sao chép mã Apps Script"</strong> ở góc trên bên phải để dán vào.
                </li>
                <li>Bấm biểu tượng Đĩa mềm để Lưu (Save).</li>
                <li>
                  Bấm nút xanh <strong>Triển khai (Deploy)</strong> &gt; <strong>Tùy chọn triển khai mới (New deployment)</strong>.
                  <ul className="list-disc list-inside ml-4 mt-1 text-[11px] text-amber-800 space-y-0.5">
                    <li>Loại: <strong>Ứng dụng web (Web app)</strong></li>
                    <li>Thực thi dưới dạng: <strong>Tôi (Me)</strong></li>
                    <li>
                      Quyền truy cập: <strong>Bất kỳ ai (Anyone)</strong> <span className="font-bold text-red-700">(Bắt buộc)</span>
                    </li>
                  </ul>
                </li>
                <li>
                  Bấm <strong>Triển khai</strong>, cho phép quyền truy cập Google Drive của bạn, sau đó sao chép <strong>URL ứng dụng web</strong> dán vào ô bên trên.
                </li>
              </ol>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="px-6 py-3.5 border-t border-slate-200 bg-slate-50 flex items-center justify-between rounded-b-2xl">
          <span className="text-[11px] text-slate-500">
            Dữ liệu lưu an toàn vào Google Drive cá nhân của bạn, không qua máy chủ trung gian.
          </span>
          <button
            type="button"
            onClick={() => {
              handleSaveUrl();
              onClose();
            }}
            className="px-4 py-2 text-xs font-semibold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-lg cursor-pointer shadow-xs transition-colors"
          >
            Lưu & Đóng
          </button>
        </div>
      </div>
    </div>
  );
};
