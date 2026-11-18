import React, { useEffect, useRef, useState } from 'react';
import {
  Bot,
  Send,
  X,
  Sparkles,
  Loader2,
  CheckCircle2,
  HelpCircle,
  Lightbulb,
  ArrowRight,
  Play,
} from 'lucide-react';
import type { IeltsQuestion } from '../types/ielts';
import { callCoachClientSide } from '../utils/clientGemini';

interface AiListeningCoachModalProps {
  isOpen: boolean;
  onClose: () => void;
  question: IeltsQuestion | null;
  userAnswer?: string;
  testTitle?: string;
  partLabel?: string;
  onSeekAndPlay?: (sec: number, endLimitSec?: number | null) => void;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'model';
  text: string;
  timestamp: string;
}

const QUICK_PROMPTS = [
  'Vì sao đáp án này đúng và người nói đã chuyển ý như thế nào?',
  'Phân tích bẫy thông tin (Distractor) ở câu này giúp em.',
  'Từ khóa nào trong đề đã được paraphrase trong audio?',
  'Cho em mẹo thực chiến để không bao giờ bị lừa ở dạng bài này.',
];

export const AiListeningCoachModal: React.FC<AiListeningCoachModalProps> = ({
  isOpen,
  onClose,
  question,
  userAnswer,
  testTitle,
  partLabel,
  onSeekAndPlay,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  // Initialize coach greeting when question changes
  useEffect(() => {
    if (!isOpen || !question) return;

    const initialGreeting = `Xin chào! Thầy/cô là Gia sư AI luyện thi IELTS Listening của bạn.
Chúng ta đang xem lại **Câu ${question.number}** (${question.type}):
- **Đáp án chuẩn:** \`${question.correctAnswer || 'Chưa xác định'}\`
${userAnswer ? `- **Bạn đã điền:** "${userAnswer}"` : ''}

Bạn có thắc mắc gì về lý do chọn đáp án, cách người nói giăng bẫy hay hiện tượng biến đổi từ khóa (paraphrasing) ở câu này không? Hãy chọn gợi ý nhanh bên dưới hoặc gõ câu hỏi cho thầy/cô nhé!`;

    setMessages([
      {
        id: `msg-${Date.now()}`,
        role: 'model',
        text: initialGreeting,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
    setErrorNotice(null);
  }, [isOpen, question, userAnswer]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  if (!isOpen || !question) return null;

  const handleSendMessage = async (textToSend?: string) => {
    const content = (textToSend || inputText).trim();
    if (!content || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      text: content,
      timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setInputText('');
    setIsLoading(true);
    setErrorNotice(null);

    try {
      const history = messages.map((m) => ({
        role: m.role,
        text: m.text,
      }));

      const apiKey = localStorage.getItem('GEMINI_API_KEY') || '';
      let reply = '';
      const isLocalhost =
        typeof window !== 'undefined' &&
        (window.location.hostname === 'localhost' ||
          window.location.hostname === '127.0.0.1' ||
          window.location.port === '3000');

      if (isLocalhost) {
        try {
          const res = await fetch('/api/ielts/coach-chat', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
              'Content-Type': 'application/json',
              Accept: 'application/json',
              ...(apiKey ? { 'x-gemini-api-key': apiKey } : {}),
            },
            body: JSON.stringify({
              testTitle,
              partLabel,
              question,
              userAnswer,
              message: content,
              history,
              apiKey,
            }),
          });

          if (res.ok) {
            const data = (await res.json()) as { reply?: string; error?: string };
            if (data.reply) {
              reply = data.reply;
            }
          }
        } catch {
          // Fallback to client-side direct Gemini
        }
      }

      if (!reply) {
        if (!apiKey) {
          throw new Error('Chưa có Gemini API Key. Vui lòng bấm nút "API Key" để cài đặt khóa API của bạn.');
        }
        reply = await callCoachClientSide({
          apiKey,
          testTitle,
          partLabel,
          question,
          userAnswer,
          message: content,
          history,
        });
      }

      const modelMsg: ChatMessage = {
        id: `model-${Date.now()}`,
        role: 'model',
        text: reply,
        timestamp: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      };

      setMessages((prev) => [...prev, modelMsg]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Lỗi kết nối với Gia sư AI.';
      setErrorNotice(msg);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-coach-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn"
    >
      <div className="bg-white border border-slate-200 rounded-2xl w-full max-w-2xl h-[85vh] max-h-[720px] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 bg-gradient-to-r from-blue-900 to-indigo-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-white/10 rounded-xl">
              <Bot className="w-5 h-5 text-blue-300" aria-hidden="true" />
            </div>
            <div>
              <h2 id="ai-coach-title" className="text-base font-bold flex items-center gap-2">
                Gia sư AI 1-on-1 — Câu {question.number}
                <span className="text-[11px] font-normal px-2 py-0.5 rounded-full bg-blue-800 text-blue-200">
                  {question.type}
                </span>
              </h2>
              <p className="text-xs text-blue-200 line-clamp-1">
                {testTitle} · {partLabel}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
            aria-label="Đóng bảng gia sư"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Question Quick Snapshot Bar */}
        <div className="px-5 py-2.5 bg-slate-50 border-b border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-slate-500 font-medium">Đáp án chuẩn:</span>
            <span className="font-mono font-bold text-slate-900 bg-white border border-slate-200 px-2 py-0.5 rounded">
              {question.correctAnswer}
            </span>
            {userAnswer && (
              <span className="text-slate-500 ml-2">
                Bạn điền: <strong className="text-slate-800">{userAnswer}</strong>
              </span>
            )}
          </div>
          {question.timestampLabel && (
            <div className="flex items-center gap-2">
              <span className="font-mono text-blue-700 font-semibold">
                Mốc audio: {question.timestampLabel}
              </span>
              {onSeekAndPlay && question.timestampSec !== undefined && (
                <button
                  type="button"
                  onClick={() =>
                    onSeekAndPlay(
                      question.timestampSec,
                      question.timestampEndSec || Number((question.timestampSec + 8).toFixed(2))
                    )
                  }
                  className="inline-flex items-center gap-1 px-2 py-0.5 text-[11px] font-semibold text-blue-700 bg-blue-100 hover:bg-blue-200 rounded cursor-pointer transition-colors"
                  title="Nghe lại đoạn audio này"
                >
                  <Play className="w-3 h-3" />
                  Nghe lại
                </button>
              )}
            </div>
          )}
        </div>

        {/* Chat History Messages */}
        <div className="flex-1 p-5 overflow-y-auto space-y-4">
          {messages.map((msg) => {
            const isUser = msg.role === 'user';
            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}
              >
                {!isUser && (
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className="w-4 h-4 text-blue-700" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl p-4 text-sm leading-relaxed ${
                    isUser
                      ? 'bg-blue-700 text-white rounded-br-xs font-medium'
                      : 'bg-slate-50 text-slate-900 border border-slate-200 rounded-bl-xs'
                  }`}
                >
                  <div className="whitespace-pre-wrap">{msg.text}</div>
                  <div
                    className={`text-[10px] mt-1.5 text-right tabular-nums ${
                      isUser ? 'text-blue-200' : 'text-slate-600'
                    }`}
                  >
                    {msg.timestamp}
                  </div>
                </div>
              </div>
            );
          })}

          {isLoading && (
            <div className="flex gap-3 justify-start items-center text-slate-500 text-xs py-2">
              <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                <Loader2 className="w-4 h-4 text-blue-700 animate-spin" />
              </div>
              <span className="italic">Gia sư AI đang phân tích bài nghe và suy nghĩ câu trả lời...</span>
            </div>
          )}

          {errorNotice && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded-xl px-4 py-2.5 text-xs">
              {errorNotice}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Suggestion Prompts */}
        <div className="px-5 py-2.5 bg-slate-50/70 border-t border-slate-200 shrink-0">
          <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium mb-1.5">
            <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
            <span>Gợi ý câu hỏi nhanh:</span>
          </div>
          <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-0.5">
            {QUICK_PROMPTS.map((prompt, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSendMessage(prompt)}
                disabled={isLoading}
                className="px-3 py-1.5 text-xs bg-white hover:bg-blue-50 text-slate-700 hover:text-blue-700 border border-slate-200 hover:border-blue-200 rounded-lg whitespace-nowrap transition-colors cursor-pointer shrink-0 disabled:opacity-50"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>

        {/* Input Form */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSendMessage();
          }}
          className="p-4 bg-white border-t border-slate-200 flex items-center gap-2 shrink-0"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Hỏi gia sư AI về bẫy câu này, từ vựng hoặc mẹo nghe..."
            disabled={isLoading}
            className="flex-1 bg-slate-50 border border-slate-300 rounded-xl px-4 py-2.5 text-sm text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isLoading}
            className="px-4 py-2.5 bg-blue-700 hover:bg-blue-800 text-white font-semibold rounded-xl text-sm transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 shrink-0"
          >
            {isLoading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            <span className="hidden sm:inline">Gửi</span>
          </button>
        </form>
      </div>
    </div>
  );
};
