import React from 'react';
import { Cloud, FolderInput, HardDrive, Key, Maximize, Minimize } from 'lucide-react';

export type WorkspaceView = 'exam' | 'analysis' | 'practice' | 'vocabulary';

interface TopBarProps {
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
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

const NAV_ITEMS: { id: WorkspaceView; label: string }[] = [
  { id: 'exam', label: 'Phòng thi IDP' },
  { id: 'analysis', label: 'Phân tích AI' },
  { id: 'practice', label: 'Luyện chuyên sâu' },
  { id: 'vocabulary', label: 'Từ vựng AWL' },
];

export const TopBar: React.FC<TopBarProps> = ({
  activeView,
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
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-blue-200/80 shadow-xs">
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line brand wordmark with academic teen badge */}
        <button
          type="button"
          onClick={() => onChangeView('exam')}
          className="flex items-center gap-2 text-lg font-extrabold tracking-tight text-blue-950 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded select-none group"
        >
          <span className="group-hover:text-blue-700 transition-colors">LexiSync IELTS</span>
          <span className="hidden sm:inline-block px-2 py-0.5 text-[10px] font-extrabold uppercase rounded-full bg-blue-100 text-blue-900 border border-blue-300 tracking-wider">
            Teen Scholar
          </span>
        </button>

        {/* Zone 2: 4 single-line text navigation links */}
        <nav
          aria-label="Điều hướng chính"
          className="flex items-center gap-6 overflow-x-auto no-scrollbar"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeView === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onChangeView(item.id)}
                className={`relative py-2 text-sm whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded ${
                  isActive
                    ? 'text-blue-800 font-extrabold'
                    : 'text-slate-700 hover:text-blue-700 font-bold'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 -bottom-[17px] h-0.5 bg-blue-700"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Actions & Accessibility Controls */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Font Size Scaling Controls */}
          {onIncreaseFont && onDecreaseFont && (
            <div
              role="group"
              aria-label="Điều chỉnh kích cỡ chữ toàn trang"
              className="flex items-center bg-blue-50/80 rounded-lg p-0.5 border border-blue-200"
            >
              <button
                type="button"
                onClick={onDecreaseFont}
                disabled={fontScale <= 90}
                className="px-2 py-1 text-slate-800 hover:text-blue-800 hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
                title="Giảm cỡ chữ toàn trang (A-)"
                aria-label="Giảm cỡ chữ toàn trang"
              >
                <span className="text-xs font-extrabold leading-none">A-</span>
              </button>

              <button
                type="button"
                onClick={onResetFont}
                className="px-2 py-1 text-xs font-mono font-bold text-blue-950 hover:bg-white rounded transition-colors cursor-pointer select-none tabular-nums"
                title="Nhấp để đặt lại cỡ chữ 100%"
              >
                {fontScale}%
              </button>

              <button
                type="button"
                onClick={onIncreaseFont}
                disabled={fontScale >= 150}
                className="px-2 py-1 text-slate-800 hover:text-blue-800 hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
                title="Tăng cỡ chữ toàn trang (A+)"
                aria-label="Tăng cỡ chữ toàn trang"
              >
                <span className="text-xs font-extrabold leading-none">A+</span>
              </button>
            </div>
          )}

          {/* Fullscreen Toggle */}
          {onToggleFullscreen && (
            <button
              type="button"
              onClick={onToggleFullscreen}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                isFullscreen
                  ? 'bg-blue-950 text-white border-blue-950'
                  : 'bg-white text-slate-800 border-blue-200 hover:bg-blue-50/60'
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
            title="Cài đặt khóa Gemini API Key để nạp đề & dùng AI"
          >
            <Key className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>API Key</span>
            <span className="hidden sm:inline text-[11px] font-semibold text-amber-800">
              (Miễn phí)
            </span>
          </button>

          {/* Nút Quản lý Tệp Máy Tính (Audio & PDF cục bộ) */}
          {onOpenLocalFiles && (
            <button
              type="button"
              onClick={onOpenLocalFiles}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-indigo-300 bg-indigo-50 text-indigo-950 hover:bg-indigo-100 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
              title="Quản lý và tải các tệp Audio & PDF đã lưu trên máy tính"
            >
              <HardDrive className="w-3.5 h-3.5 text-indigo-700 shrink-0" />
              <span>Tệp máy tính</span>
            </button>
          )}

          {/* Nút Đồng bộ Google Drive */}
          {onOpenGoogleDrive && (
            <button
              type="button"
              onClick={onOpenGoogleDrive}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg border border-sky-300 bg-sky-50 text-sky-950 hover:bg-sky-100 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
              title="Đồng bộ đề thi và âm thanh với Google Drive cá nhân"
            >
              <Cloud className="w-3.5 h-3.5 text-sky-700 shrink-0" />
              <span>Google Drive</span>
            </button>
          )}

          {/* Nút Nhập gói đề thi (.lexisync) từ máy khác */}
          {onImportPackage && (
            <label
              title="Nhập gói đề thi (.lexisync) từ máy khác bao gồm câu hỏi, transcript và audio"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-slate-800 bg-blue-50/70 hover:bg-blue-100 border border-blue-200 rounded-lg whitespace-nowrap cursor-pointer transition-colors shadow-xs"
            >
              <FolderInput className="w-3.5 h-3.5 text-blue-700" aria-hidden="true" />
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

          {/* Primary Action */}
          <button
            type="button"
            onClick={onOpenIngest}
            className="px-4 py-2 text-xs font-extrabold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            Nạp đề & Audio
          </button>
        </div>
      </div>
    </header>
  );
};
