import React from 'react';
import { Cloud, FolderInput, HardDrive, Key, Maximize, Minimize } from 'lucide-react';

export type WorkspaceView = 'exam' | 'analysis' | 'practice' | 'vocabulary';

interface TopBarProps {
  activeView?: WorkspaceView;
  onChangeView?: (view: WorkspaceView) => void;
  onOpenIngest: () => void;
  onOpenApiKey?: () => void;
  onOpenGoogleDrive?: () => void;
  onOpenLocalFiles?: () => void;
  onImportPackage?: (file: File) => Promise<void>;
  fontScale?: number;
  onIncreaseFont?: () => void;
  onDecreaseFont?: () => void;
  onResetFont?: () => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  onChangeView,
  onOpenIngest,
  onOpenApiKey,
  onOpenGoogleDrive,
  onOpenLocalFiles,
  onImportPackage,
  fontScale = 100,
  onIncreaseFont,
  onDecreaseFont,
  onResetFont,
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-emerald-100 shadow-xs">
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between gap-6">
        {/* Brand wordmark with International Academic Standard badge */}
        <button
          type="button"
          onClick={() => onChangeView?.('exam')}
          className="flex items-center gap-2.5 text-lg font-black tracking-tight text-[#15803D] whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 rounded select-none group"
        >
          <div className="w-8 h-8 rounded-full bg-[#15803D] flex items-center justify-center text-white font-black text-sm shadow-xs group-hover:scale-105 transition-transform">
            P
          </div>
          <span className="group-hover:text-emerald-800 transition-colors">Tiếng Anh Thầy Phúc</span>
          <span className="hidden sm:inline-block px-2.5 py-0.5 text-[10px] font-extrabold uppercase rounded-full bg-emerald-50 text-emerald-800 border border-emerald-300 tracking-wider">
            Vocabulary Bank • IELTS
          </span>
        </button>

        {/* Actions & Accessibility Controls */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Font Size Scaling Controls */}
          {onIncreaseFont && onDecreaseFont && (
            <div
              role="group"
              aria-label="Điều chỉnh kích cỡ chữ toàn trang"
              className="flex items-center bg-emerald-50/80 rounded-lg p-0.5 border border-emerald-200"
            >
              <button
                type="button"
                onClick={onDecreaseFont}
                disabled={fontScale <= 90}
                className="px-2 py-1 text-emerald-900 hover:text-[#15803D] hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
                title="Giảm cỡ chữ toàn trang (A-)"
                aria-label="Giảm cỡ chữ toàn trang"
              >
                <span className="text-xs font-bold leading-none">A-</span>
              </button>

              <button
                type="button"
                onClick={onResetFont}
                className="px-2 py-1 text-xs font-mono font-bold text-emerald-950 hover:bg-white rounded transition-colors cursor-pointer select-none tabular-nums"
                title="Nhấp để đặt lại cỡ chữ 100%"
              >
                {fontScale}%
              </button>

              <button
                type="button"
                onClick={onIncreaseFont}
                disabled={fontScale >= 150}
                className="px-2 py-1 text-emerald-900 hover:text-[#15803D] hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
                title="Tăng cỡ chữ toàn trang (A+)"
                aria-label="Tăng cỡ chữ toàn trang"
              >
                <span className="text-xs font-bold leading-none">A+</span>
              </button>
            </div>
          )}

          {/* Fullscreen Toggle */}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                isFullscreen
                  ? 'bg-[#15803D] text-white border-[#15803D] shadow-xs'
                  : 'bg-emerald-50/70 text-emerald-800 border-emerald-300 hover:bg-emerald-100'
              }`}
              title={isFullscreen ? 'Thoát toàn màn hình (F11 hoặc Esc)' : 'Bật toàn màn hình (F11)'}
              aria-label={isFullscreen ? 'Thoát toàn màn hình' : 'Toàn màn hình'}
            >
              {isFullscreen ? (
                <Minimize className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Maximize className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span className="hidden sm:inline">
                {isFullscreen ? 'Thu nhỏ' : 'Toàn màn hình'}
              </span>
            </button>
          )}

          {/* Nút Cài đặt API Key & Hướng dẫn lấy key */}
          <button
            type="button"
            onClick={() => onOpenApiKey?.()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 bg-amber-50/80 text-amber-900 hover:bg-amber-100 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
            title="Cài đặt khóa Gemini API Key để nạp đề & dùng AI"
          >
            <Key className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>API Key</span>
            <span className="hidden sm:inline text-[11px] font-normal text-amber-800">
              (Miễn phí)
            </span>
          </button>

          {/* Nút Quản lý Tệp Máy Tính (Audio & PDF cục bộ) */}
          {onOpenLocalFiles && (
            <button
              type="button"
              onClick={onOpenLocalFiles}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-emerald-200 bg-white text-emerald-900 hover:bg-emerald-50 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
              title="Quản lý và tải các tệp Audio & PDF đã lưu trên máy tính"
            >
              <HardDrive className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
              <span>Tệp máy tính</span>
            </button>
          )}

          {/* Nút Đồng bộ Google Drive - Theme vàng/amber như Image 3 */}
          {onOpenGoogleDrive && (
            <button
              type="button"
              onClick={onOpenGoogleDrive}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-300 bg-amber-100/80 text-amber-900 hover:bg-amber-200 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
              title="Đồng bộ đề thi và âm thanh với Google Drive cá nhân"
            >
              <Cloud className="w-3.5 h-3.5 text-amber-800 shrink-0" />
              <span>Google Drive</span>
            </button>
          )}

          {/* Nút Nhập gói đề thi (.lexisync) từ máy khác */}
          {onImportPackage && (
            <label
              title="Nhập gói đề thi (.lexisync) từ máy khác bao gồm câu hỏi, transcript và audio"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-emerald-900 bg-white hover:bg-emerald-50 border border-emerald-300 rounded-lg whitespace-nowrap cursor-pointer transition-colors shadow-xs"
            >
              <FolderInput className="w-3.5 h-3.5 text-emerald-700" aria-hidden="true" />
              <span>Nhập đề</span>
              <input
                type="file"
                accept=".lexisync,.lexisync_pack,.json"
                className="sr-only"
                onClick={(e) => {
                  (e.target as HTMLInputElement).value = '';
                }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    onImportPackage(file);
                  }
                }}
              />
            </label>
          )}

          {/* Primary Action - Green Educational Standard */}
          <button
            type="button"
            onClick={onOpenIngest}
            className="px-4 py-2 text-xs font-black text-white bg-[#15803D] hover:bg-[#166534] rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-700 focus-visible:ring-offset-2"
          >
            Nạp đề & Audio
          </button>
        </div>
      </div>
    </header>
  );
};
