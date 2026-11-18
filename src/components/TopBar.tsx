import React from 'react';
import { FolderInput, Key, Maximize, Minimize } from 'lucide-react';

export type WorkspaceView = 'exam' | 'analysis' | 'practice' | 'vocabulary';

interface TopBarProps {
  activeView: WorkspaceView;
  onChangeView: (view: WorkspaceView) => void;
  onOpenIngest: () => void;
  onOpenApiKey?: () => void;
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
  onImportPackage,
  fontScale = 100,
  onIncreaseFont,
  onDecreaseFont,
  onResetFont,
  isFullscreen = false,
  onToggleFullscreen,
}) => {
  return (
    <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-sm border-b border-slate-200">
      <div className="max-w-[1400px] mx-auto px-6 h-16 flex items-center justify-between gap-8">
        {/* Zone 1: Single-line brand wordmark */}
        <button
          type="button"
          onClick={() => onChangeView('exam')}
          className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded"
        >
          LexiSync IELTS
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
                className={`relative py-2 text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 rounded ${
                  isActive
                    ? 'text-blue-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-900'
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
        <div className="flex items-center gap-3 shrink-0">
          {/* Font Size Scaling Controls */}
          {onIncreaseFont && onDecreaseFont && (
            <div
              role="group"
              aria-label="Điều chỉnh kích cỡ chữ toàn trang"
              className="flex items-center bg-slate-100 rounded-lg p-0.5 border border-slate-200"
            >
              <button
                type="button"
                onClick={onDecreaseFont}
                disabled={fontScale <= 90}
                className="px-2 py-1 text-slate-700 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
                title="Giảm cỡ chữ toàn trang (A-)"
                aria-label="Giảm cỡ chữ toàn trang"
              >
                <span className="text-xs font-bold leading-none">A-</span>
              </button>

              <button
                type="button"
                onClick={onResetFont}
                className="px-2 py-1 text-xs font-mono font-semibold text-slate-800 hover:bg-white rounded transition-colors cursor-pointer select-none tabular-nums"
                title="Nhấp để đặt lại cỡ chữ 100%"
              >
                {fontScale}%
              </button>

              <button
                type="button"
                onClick={onIncreaseFont}
                disabled={fontScale >= 150}
                className="px-2 py-1 text-slate-700 hover:text-slate-900 hover:bg-white rounded transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed select-none"
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
              className={`inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap cursor-pointer ${
                isFullscreen
                  ? 'bg-slate-900 text-white border-slate-900'
                  : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
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
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg border border-red-400 bg-red-50 text-red-700 hover:bg-red-100 transition-colors whitespace-nowrap cursor-pointer shadow-xs"
            title="Cài đặt khóa Gemini API Key để nạp đề & dùng AI"
          >
            <Key className="w-3.5 h-3.5 text-red-600 shrink-0" />
            <span>API Key</span>
            <span className="hidden sm:inline text-[11px] font-normal text-red-600">
              (Lấy key miễn phí)
            </span>
          </button>

          {/* Nút Nhập gói đề thi (.lexisync) từ máy khác */}
          {onImportPackage && (
            <label
              title="Nhập gói đề thi (.lexisync) từ máy khác bao gồm câu hỏi, transcript và audio"
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg whitespace-nowrap cursor-pointer transition-colors shadow-xs"
            >
              <FolderInput className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
              <span>Nhập đề thi</span>
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
            className="px-4 py-2 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
          >
            Nạp đề & Audio
          </button>
        </div>
      </div>
    </header>
  );
};
