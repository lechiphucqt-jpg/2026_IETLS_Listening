import React, { useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  CheckCircle2,
  FileDown,
  Play,
  Plus,
  Check,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { AwlVocabItem, IeltsQuestion, PedagogicalReport } from '../types/ielts';
import { AudioSegmentTimeAdjuster } from './AudioSegmentTimeAdjuster';
import { exportTeacherAnswerKeyDocx } from '../utils/docxExport';
import { CompetencyRadarChart } from './CompetencyRadarChart';
import { AiListeningCoachModal } from './AiListeningCoachModal';

interface PedagogicalReportViewProps {
  report: PedagogicalReport | null;
  currentTime?: number;
  maxDuration?: number;
  onSeekAndPlay: (sec: number, endLimitSec?: number | null) => void;
  onUpdateQuestionTime?: (questionNumber: number, startSec: number, endSec: number) => void;
  onLaunchShadowing: (sec: number) => void;
  onLaunchIntensive: (sec: number) => void;
  onSaveFlashcard: (item: AwlVocabItem) => void;
  savedWords: Set<string>;
  onGoToExam: () => void;
}

export const PedagogicalReportView: React.FC<PedagogicalReportViewProps> = ({
  report,
  currentTime,
  maxDuration,
  onSeekAndPlay,
  onUpdateQuestionTime,
  onLaunchShadowing,
  onLaunchIntensive,
  onSaveFlashcard,
  savedWords,
  onGoToExam,
}) => {
  const [coachQuestion, setCoachQuestion] = useState<IeltsQuestion | null>(null);
  const [coachUserAnswer, setCoachUserAnswer] = useState<string>('');
  const [isCoachOpen, setIsCoachOpen] = useState(false);
  if (!report) {
    return (
      <div className="max-w-[1100px] mx-auto px-6 py-16 text-center">
        <div className="bg-white border border-slate-200 rounded-xl p-10 max-w-xl mx-auto">
          <h2 className="text-xl font-bold text-slate-900">
            Chưa có Báo cáo Phân tích Sư phạm AI
          </h2>
          <p className="text-sm text-slate-600 mt-2 leading-relaxed">
            Hãy hoàn thành bài nghe trong mục <strong>Phòng thi IDP</strong> và nhấn{' '}
            <strong>Nộp bài & Phân tích AI</strong> để hệ thống xuất bản báo cáo 5 phần gồm bảng đối chiếu Paraphrasing, bẫy Distractors, chẩn đoán lỗi hệ thống và lộ trình luyện tập cá nhân hóa.
          </p>
          <button
            type="button"
            onClick={onGoToExam}
            className="mt-6 inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-lg transition-colors cursor-pointer shadow-xs"
          >
            Quay lại Phòng thi IDP
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  }

  const {
    part1AnswerKey,
    part2Explanations,
    part3BehavioralInsights,
    part4AcademicSpotlight,
    part5ActionPlan,
  } = report;

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-10">
      {/* Summary Header */}
      <div className="bg-white border border-slate-200 rounded-xl p-6 flex flex-wrap items-center justify-between gap-6 shadow-xs">
        <div>
          <p className="text-xs font-bold text-[#0F2744]">
            Báo cáo Chẩn đoán Mastermind · {report.testTitle}
          </p>
          <h1 className="text-2xl font-bold text-[#0F2744] mt-1 text-balance">
            Phân tích Sư phạm & Hành vi Người học (5 Phần)
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-8">
            <div>
              <div className="text-xs font-bold text-slate-600">Điểm chính xác</div>
              <div className="text-3xl font-bold text-[#0F2744] tabular-nums mt-0.5">
                {part3BehavioralInsights.correctCount}/{part3BehavioralInsights.totalCount}{' '}
                <span className="text-base font-bold text-slate-500">
                  ({part3BehavioralInsights.accuracyPercent}%)
                </span>
              </div>
            </div>
            <div className="h-10 w-px bg-slate-200" aria-hidden="true" />
            <div>
              <div className="text-xs font-bold text-slate-600">Ước lượng trình độ</div>
              <div className="text-3xl font-bold text-[#0F2744] tabular-nums mt-0.5">
                {part3BehavioralInsights.estimatedBand}
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => exportTeacherAnswerKeyDocx(report)}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-lg transition-colors shadow-xs cursor-pointer whitespace-nowrap"
            title="Xuất bảng đáp án chi tiết, phân tích bẫy và transcript ra Microsoft Word (.doc / .docx)"
          >
            <FileDown className="w-4 h-4" aria-hidden="true" />
            Xuất đáp án Word (.docx)
          </button>
        </div>
      </div>

      {/* Phần 1: Bảng Phân tích Đáp án (Answer Key Analysis) */}
      <section aria-labelledby="part1-heading" className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <h2 id="part1-heading" className="text-base font-bold text-[#0F2744]">
            01. Bảng Phân tích Đáp án (Answer Key Analysis)
          </h2>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            Nhấp vào bất kỳ mốc thời gian [mm:ss.xx] nào để kích hoạt nghe lại ngay lập tức
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold text-[#0F2744] bg-slate-50">
                <th className="py-3 px-4 w-16">Câu</th>
                <th className="py-3 px-4">Bài làm / Đáp án chuẩn</th>
                <th className="py-3 px-4">Trạng thái</th>
                <th className="py-3 px-4">Timestamp</th>
                <th className="py-3 px-4">Biến đổi từ khóa (Paraphrasing)</th>
                <th className="py-3 px-4">Loại bẫy (Distractor)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {part1AnswerKey.map((row) => (
                <tr key={row.questionNumber} className="hover:bg-slate-50/60 align-top">
                  <td className="py-3.5 px-4 font-mono font-semibold text-slate-900 tabular-nums">
                    {row.questionNumber}
                  </td>
                  <td className="py-3.5 px-4">
                    <div className="font-medium text-slate-900">{row.correctAnswer}</div>
                    {!row.isCorrect && (
                      <div className="text-xs text-red-700 mt-0.5">
                        Bạn ghi: {row.userAnswer}
                      </div>
                    )}
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    {row.isCorrect ? (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
                        <CheckCircle2 className="w-4 h-4" aria-hidden="true" />
                        Đúng
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700">
                        <XCircle className="w-4 h-4" aria-hidden="true" />
                        Sai · {row.errorCategory || 'Lỗi'}
                      </span>
                    )}
                  </td>
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() =>
                        onSeekAndPlay(
                          row.timestampSec,
                          row.timestampEndSec || Number((row.timestampSec + 8).toFixed(2))
                        )
                      }
                      className="inline-flex items-center gap-1 font-mono text-xs font-semibold text-blue-700 hover:underline cursor-pointer"
                      title="Nghe đoạn âm thanh câu này"
                    >
                      <Play className="w-3 h-3" aria-hidden="true" />
                      {row.timestampLabel}
                    </button>
                  </td>
                  <td className="py-3.5 px-4 text-slate-700 leading-relaxed max-w-xs">
                    {row.paraphraseMapping}
                  </td>
                  <td className="py-3.5 px-4 text-slate-700">
                    {row.distractorType}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Phần 2: Giải thích chi tiết (In-depth Explanation) */}
      <section aria-labelledby="part2-heading" className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <h2 id="part2-heading" className="text-base font-bold text-[#0F2744]">
            02. Giải thích chi tiết (In-depth Explanation)
          </h2>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            Phân tích logic đáp án đúng, bẫy thông tin và trích dẫn nguyên văn từ Transcript
          </p>
        </div>

        <div className="divide-y divide-slate-200">
          {part2Explanations.map((item) => (
            <div key={item.questionNumber} className="p-6 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2.5">
                  <span className="font-mono text-sm font-bold text-[#0F2744] tabular-nums">
                    Câu {item.questionNumber}
                  </span>
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  {item.correctAnswer && (
                    <span className="text-xs font-semibold text-slate-800">
                      Đáp án chuẩn:{' '}
                      <span className="font-mono text-slate-900 bg-slate-100 px-1.5 py-0.5 rounded">
                        {item.correctAnswer}
                      </span>
                    </span>
                  )}
                  <span aria-hidden="true" className="text-slate-300">·</span>
                  {item.isCorrect ? (
                    <span className="text-xs font-semibold text-emerald-700">
                      Trả lời chính xác
                    </span>
                  ) : (
                    <span className="text-xs font-semibold text-red-700">
                      Bạn ghi: {item.userAnswer || '(Bỏ trống)'}
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      onSeekAndPlay(
                        item.timestampSec,
                        item.timestampEndSec || Number((item.timestampSec + 8).toFixed(2))
                      )
                    }
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-mono font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
                  >
                    <Play className="w-3 h-3" aria-hidden="true" />
                    Nghe lại {item.timestampLabel}
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setCoachQuestion({
                        number: item.questionNumber,
                        type: 'Note Completion',
                        prompt: `Câu ${item.questionNumber}: Đáp án đúng là "${item.correctAnswer || ''}"`,
                        correctAnswer: item.correctAnswer || '',
                        explanationVi: item.logicVi,
                        transcriptQuote: item.directQuote,
                        distractorType: item.distractorType,
                        paraphraseTranscript: item.paraphraseMapping,
                        timestampSec: item.timestampSec,
                        timestampEndSec: item.timestampEndSec,
                        timestampLabel: item.timestampLabel,
                      });
                      setCoachUserAnswer(item.userAnswer || '');
                      setIsCoachOpen(true);
                    }}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-semibold rounded-md bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 transition-colors cursor-pointer"
                    title="Hỏi Gia sư AI 1-on-1 giải thích chi tiết câu này"
                  >
                    <Sparkles className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
                    Gia sư AI
                  </button>
                </div>
              </div>

              {(item.paraphraseMapping || (item.distractorType && item.distractorType !== 'None')) && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
                  {item.paraphraseMapping && (
                    <span>
                      <strong className="text-slate-700">Paraphrasing:</strong> {item.paraphraseMapping}
                    </span>
                  )}
                  {item.distractorType && item.distractorType !== 'None' && (
                    <span>
                      <strong className="text-amber-800">Loại bẫy:</strong> {item.distractorType}
                    </span>
                  )}
                </div>
              )}

              <p className="text-sm text-slate-700 leading-relaxed">{item.logicVi}</p>

              <p className="text-sm text-slate-900 bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 leading-relaxed">
                <span className="text-xs font-medium text-slate-500 block mb-1">
                  Trích dẫn trực tiếp từ Transcript:
                </span>
                <strong>“{item.directQuote}”</strong>
              </p>

              {/* Điều chỉnh thời gian bắt đầu và kết thúc của câu hỏi trong phần đáp án */}
              <AudioSegmentTimeAdjuster
                label={`Đoạn audio Câu ${item.questionNumber}`}
                startSec={item.timestampSec}
                endSec={item.timestampEndSec || Number((item.timestampSec + 8).toFixed(2))}
                currentTime={currentTime}
                maxDuration={maxDuration}
                onChangeTime={(newStart, newEnd) => {
                  onUpdateQuestionTime?.(item.questionNumber, newStart, newEnd);
                }}
                onPlaySegment={(start, end) => {
                  onSeekAndPlay(start, end ?? null);
                }}
                compact
              />
            </div>
          ))}
        </div>
      </section>

      {/* Phần 3: Báo cáo lỗi sai hệ thống (Behavioral Insights) */}
      <section aria-labelledby="part3-heading" className="bg-white border border-slate-200 rounded-xl p-6 space-y-6 shadow-xs">
        <div>
          <h2 id="part3-heading" className="text-base font-bold text-[#0F2744]">
            03. Báo cáo lỗi sai hệ thống & Biểu đồ năng lực 5 chiều
          </h2>
          <p className="text-sm font-semibold text-slate-700 mt-2 leading-relaxed">
            {part3BehavioralInsights.overallDiagnosisVi}
          </p>
        </div>

        {/* Biểu đồ Radar 5 chiều năng lực nghe IELTS */}
        <div className="pt-1">
          <CompetencyRadarChart answerKey={part1AnswerKey} />
        </div>

        {part3BehavioralInsights.errorBreakdown.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {part3BehavioralInsights.errorBreakdown.map((err, idx) => (
              <div
                key={idx}
                className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5"
              >
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-800">
                    <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                    {err.category}
                  </span>
                  <span className="text-xs font-mono font-semibold text-slate-700 tabular-nums">
                    {err.count} lỗi
                  </span>
                </div>
                <p className="text-xs text-slate-600 leading-relaxed">{err.insightVi}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-800 flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            Không phát hiện lỗi hệ thống (Chính tả, Số ít/nhiều, Đơn vị đo lường) trong lần làm bài này.
          </div>
        )}
      </section>

      {/* Phần 4: Kho từ vựng (Academic Spotlight) */}
      <section aria-labelledby="part4-heading" className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-xs">
        <div className="px-6 py-4 border-b border-slate-200 bg-slate-50/80">
          <h2 id="part4-heading" className="text-base font-bold text-[#0F2744]">
            04. Kho từ vựng (Academic Spotlight — AWL)
          </h2>
          <p className="text-xs font-medium text-slate-500 mt-0.5">
            Các từ vựng học thuật được dịch nghĩa tiếng Việt theo đúng ngữ cảnh bài nghe kèm phiên âm và câu ví dụ
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-xs font-bold text-[#0F2744] bg-slate-50">
                <th className="py-3 px-4">Từ vựng</th>
                <th className="py-3 px-4">Phiên âm IPA</th>
                <th className="py-3 px-4">Nghĩa tiếng Việt theo bài</th>
                <th className="py-3 px-4">Ví dụ trong bài & Dịch nghĩa</th>
                <th className="py-3 px-4 text-right">Thao tác</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 text-sm">
              {part4AcademicSpotlight.map((v) => {
                const isSaved = savedWords.has(v.word.toLowerCase());
                return (
                  <tr key={v.word} className="hover:bg-slate-50/60 align-top">
                    <td className="py-3.5 px-4 font-bold text-slate-900">
                      {v.word}
                      <span className="block text-xs font-normal text-slate-500">
                        {v.pos}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 font-mono text-xs text-slate-700 whitespace-nowrap">
                      {v.ipa}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700 max-w-xs">
                      <div className="font-medium text-slate-900">
                        {v.contextualMeaningVi || v.definitionVi}
                      </div>
                      {v.contextualMeaningVi && v.definitionVi !== v.contextualMeaningVi && (
                        <div className="text-xs text-slate-500 mt-0.5">
                          Nghĩa chung: {v.definitionVi}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-600 max-w-sm">
                      <div>
                        “{v.exampleInAudio}”
                        <button
                          type="button"
                          onClick={() => onSeekAndPlay(v.timestampSec)}
                          className="ml-2 font-mono text-xs text-blue-700 hover:underline cursor-pointer"
                        >
                          {v.timestampLabel}
                        </button>
                      </div>
                      {v.exampleTranslationVi && (
                        <div className="text-xs text-slate-500 mt-1 italic">
                          → {v.exampleTranslationVi}
                        </div>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      {isSaved ? (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                          <Check className="w-3.5 h-3.5" aria-hidden="true" />
                          Đã lưu
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSaveFlashcard(v)}
                          className="inline-flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-md transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                          Lưu Flashcard
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Phần 5: Đề xuất luyện tập (Action Plan) */}
      <section aria-labelledby="part5-heading" className="bg-white border border-slate-200 rounded-xl p-6 space-y-5 shadow-xs">
        <div>
          <h2 id="part5-heading" className="text-base font-bold text-[#0F2744]">
            05. Đề xuất luyện tập (Action Plan)
          </h2>
          <p className="text-sm font-semibold text-slate-700 mt-2 leading-relaxed">
            {part5ActionPlan.summaryVi}
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-600">
              Bài tập Shadowing ưu tiên (Ngữ điệu & Trọng âm)
            </h3>
            {part5ActionPlan.shadowingTargets.map((target, i) => (
              <div
                key={i}
                className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {target.label}
                    </span>
                    <span className="font-mono text-xs text-slate-500">
                      {target.timestampLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1 leading-relaxed">
                    {target.focusNote}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onLaunchShadowing(target.timestampSec)}
                  className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md cursor-pointer transition-colors"
                >
                  <BookMarked className="w-3.5 h-3.5" aria-hidden="true" />
                  Mở Shadowing Studio tại {target.timestampLabel}
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <h3 className="text-xs font-bold text-slate-600">
              Bài tập Intensive Listening (Nghe chép & Nối âm)
            </h3>
            {part5ActionPlan.intensiveTargets.map((target, i) => (
              <div
                key={i}
                className="p-4 bg-slate-50 border border-slate-200 rounded-lg flex flex-col justify-between gap-3"
              >
                <div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-slate-900">
                      {target.label}
                    </span>
                    <span className="font-mono text-xs text-slate-500">
                      {target.timestampLabel}
                    </span>
                  </div>
                  <p className="text-xs text-slate-600 mt-1">
                    Trọng tâm dạng bài: {target.questionType}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onLaunchIntensive(target.timestampSec)}
                  className="self-start inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-white bg-[#0F2744] hover:bg-[#0A1B30] rounded-md cursor-pointer transition-colors shadow-xs"
                >
                  <Play className="w-3.5 h-3.5" aria-hidden="true" />
                  Luyện Intensive tại {target.timestampLabel}
                </button>
              </div>
            ))}
          </div>
        </div>
      </section>
      {/* Gia sư AI 1-on-1 Modal */}
      <AiListeningCoachModal
        isOpen={isCoachOpen}
        onClose={() => setIsCoachOpen(false)}
        question={coachQuestion}
        userAnswer={coachUserAnswer}
        testTitle={report.testTitle}
        onSeekAndPlay={onSeekAndPlay}
      />
    </div>
  );
};
