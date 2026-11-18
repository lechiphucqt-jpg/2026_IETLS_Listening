import React, { useState, useEffect } from 'react';
import { Key, ExternalLink, Check, AlertCircle, X, Sparkles } from 'lucide-react';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSaved?: (key: string) => void;
}

export const ApiKeyModal: React.FC<ApiKeyModalProps> = ({
  isOpen,
  onClose,
  onSaved,
}) => {
  const [apiKey, setApiKey] = useState('');
  const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const stored = localStorage.getItem('GEMINI_API_KEY') || '';
      setApiKey(stored);
      const storedModel = localStorage.getItem('GEMINI_MODEL') || 'gemini-2.5-flash';
      setSelectedModel(storedModel);
      setSavedSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = apiKey.trim();
    if (!cleanKey) return;

    localStorage.setItem('GEMINI_API_KEY', cleanKey);
    localStorage.setItem('GEMINI_MODEL', selectedModel);
    setSavedSuccess(true);
    onSaved?.(cleanKey);

    setTimeout(() => {
      onClose();
    }, 600);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-key-modal-title"
      className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 animate-fadeIn"
    >
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-6 py-4 bg-gradient-to-r from-blue-900 to-indigo-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <Key className="w-5 h-5 text-blue-300" aria-hidden="true" />
            </div>
            <div>
              <h2 id="api-key-modal-title" className="text-base font-bold">
                Cài đặt Gemini API Key
              </h2>
              <p className="text-xs text-blue-200">
                Để nạp đề, đồng bộ âm thanh và sử dụng Gia sư AI
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng"
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg cursor-pointer transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-6 space-y-5">
          {/* Instructions Link */}
          <div className="p-3.5 bg-blue-50 border border-blue-200 rounded-xl flex items-start gap-3 text-xs text-blue-900">
            <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <span className="font-semibold block">Bạn chưa có khóa API?</span>
              <p className="text-blue-700 leading-relaxed">
                Google cấp khóa API Gemini hoàn toàn miễn phí. Nhấp vào liên kết bên dưới để lấy key trong 30 giây:
              </p>
              <a
                href="https://aistudio.google.com/api-keys"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-bold text-blue-800 underline hover:text-blue-950 pt-0.5"
              >
                https://aistudio.google.com/api-keys
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          {/* API Key Input */}
          <div>
            <label
              htmlFor="gemini-api-key-input"
              className="block text-xs font-semibold text-slate-700 mb-1"
            >
              Nhập khóa Gemini API Key của bạn <span className="text-red-500">*</span>
            </label>
            <input
              id="gemini-api-key-input"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="AIzaSy..."
              required
              className="w-full bg-slate-50 border border-slate-300 focus:bg-white focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20 rounded-xl px-4 py-2.5 text-sm font-mono text-slate-900 outline-none transition-all"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Khóa API được lưu an toàn trực tiếp trên trình duyệt (localStorage) của bạn.
            </p>
          </div>

          {/* Model Selection */}
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-2">
              Chọn Model AI ưu tiên
            </label>
            <div className="grid grid-cols-3 gap-2">
              {[
                { id: 'gemini-2.5-flash', name: '2.5 Flash', badge: 'Mặc định' },
                { id: 'gemini-2.0-flash', name: '2.0 Flash', badge: 'Nhanh' },
                { id: 'gemini-1.5-flash', name: '1.5 Flash', badge: 'Ổn định' },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setSelectedModel(m.id)}
                  className={`p-2.5 text-left border rounded-xl transition-all cursor-pointer ${
                    selectedModel === m.id
                      ? 'border-blue-600 bg-blue-50 text-blue-900 font-semibold ring-1 ring-blue-600'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  <div className="text-xs font-bold">{m.name}</div>
                  <div className="text-[10px] text-slate-500">{m.badge}</div>
                </button>
              ))}
            </div>
          </div>

          {savedSuccess && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-600" />
              Đã lưu API Key thành công!
            </div>
          )}

          {/* Modal Actions */}
          <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-200">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 rounded-lg cursor-pointer"
            >
              Đóng
            </button>
            <button
              type="submit"
              disabled={!apiKey.trim()}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              <Check className="w-3.5 h-3.5" />
              Lưu & Áp dụng
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
