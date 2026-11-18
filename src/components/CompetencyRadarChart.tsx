import React from 'react';
import type { AnswerKeyAnalysisRow } from '../types/ielts';

interface CompetencyRadarChartProps {
  answerKey: AnswerKeyAnalysisRow[];
  className?: string;
}

interface CompetencyDimension {
  id: string;
  name: string;
  score: number; // 0 - 100%
  description: string;
  advice: string;
}

export const CompetencyRadarChart: React.FC<CompetencyRadarChartProps> = ({
  answerKey,
  className = '',
}) => {
  if (!answerKey || answerKey.length === 0) return null;

  const total = answerKey.length;

  // Calculate scores for 5 core IELTS Listening dimensions
  // 1. Distractor Detection
  const distractorQuestions = answerKey.filter(
    (q) => q.distractorType && q.distractorType !== 'None'
  );
  const distractorCorrect = distractorQuestions.filter((q) => q.isCorrect).length;
  const distractorScore =
    distractorQuestions.length > 0
      ? Math.round((distractorCorrect / distractorQuestions.length) * 100)
      : 85;

  // 2. Spelling Accuracy
  const spellingErrors = answerKey.filter((q) => q.errorCategory === 'Spelling').length;
  const spellingScore = Math.max(20, Math.round(100 - (spellingErrors / total) * 100 * 2));

  // 3. Singular / Plural Precision
  const pluralErrors = answerKey.filter((q) => q.errorCategory === 'Plural/Singular').length;
  const pluralScore = Math.max(25, Math.round(100 - (pluralErrors / total) * 100 * 2.5));

  // 4. Word Limit Compliance
  const wordLimitErrors = answerKey.filter((q) => q.errorCategory === 'WordLimit').length;
  const wordLimitScore = Math.max(30, Math.round(100 - (wordLimitErrors / total) * 100 * 3));

  // 5. Paraphrasing Recognition
  const correctCount = answerKey.filter((q) => q.isCorrect).length;
  const overallAccuracy = Math.round((correctCount / total) * 100);
  const paraphraseScore = Math.max(20, Math.min(100, Math.round(overallAccuracy * 1.05)));

  const dimensions: CompetencyDimension[] = [
    {
      id: 'distractor',
      name: 'Nhận diện Bẫy (Traps)',
      score: distractorScore,
      description: 'Khả năng phát hiện bẫy tự sửa lỗi, thông tin gây nhiễu và từ phủ định ngầm.',
      advice: distractorScore < 70 ? 'Chú ý các từ nối chuyển ý như "actually", "however", "though".' : 'Phản xạ né bẫy rất tốt.',
    },
    {
      id: 'spelling',
      name: 'Chính tả (Spelling)',
      score: spellingScore,
      description: 'Mức độ chính xác khi chép lại tên riêng, đánh vần chữ cái và nguyên âm đôi.',
      advice: spellingScore < 70 ? 'Cần luyện thêm bảng chữ cái và các cặp nguyên âm dễ nhầm (i/e, a/e).' : 'Độ chính xác chính tả xuất sắc.',
    },
    {
      id: 'plural',
      name: 'Số ít / Số nhiều (S/ES)',
      score: pluralScore,
      description: 'Phản xạ bắt âm đuôi -s/-es và danh từ đếm được/không đếm được.',
      advice: pluralScore < 70 ? 'Tập trung nghe âm xì đuôi hoặc mạo từ a/an phía trước.' : 'Bắt âm đuôi rất chuẩn xác.',
    },
    {
      id: 'wordlimit',
      name: 'Tuân thủ Số từ (Word Limit)',
      score: wordLimitScore,
      description: 'Không vượt quá số từ yêu cầu (ONE WORD ONLY / NO MORE THAN TWO WORDS).',
      advice: wordLimitScore < 80 ? 'Luôn khoanh tròn yêu cầu số từ ở đầu mỗi phần trước khi nghe.' : 'Tuân thủ quy định số từ tốt.',
    },
    {
      id: 'paraphrase',
      name: 'Bắt Paraphrasing',
      score: paraphraseScore,
      description: 'Nhận diện từ đồng nghĩa và cấu trúc tương đương giữa câu hỏi và audio.',
      advice: paraphraseScore < 70 ? 'Mở rộng vốn từ vựng đồng nghĩa và từ loại (noun/verb transformation).' : 'Vốn từ vựng tương đương rất phong phú.',
    },
  ];

  // Radar geometry calculations
  const size = 320;
  const center = size / 2;
  const radius = center - 45;
  const numPoints = dimensions.length;
  const angleStep = (Math.PI * 2) / numPoints;

  // Grid levels (20%, 40%, 60%, 80%, 100%)
  const levels = [0.2, 0.4, 0.6, 0.8, 1.0];

  const getCoordinates = (index: number, factor: number) => {
    const angle = index * angleStep - Math.PI / 2;
    const x = center + radius * factor * Math.cos(angle);
    const y = center + radius * factor * Math.sin(angle);
    return { x, y };
  };

  // Polygon points of candidate's score
  const polygonPoints = dimensions
    .map((dim, i) => {
      const { x, y } = getCoordinates(i, dim.score / 100);
      return `${x},${y}`;
    })
    .join(' ');

  const weakestDimension = [...dimensions].sort((a, b) => a.score - b.score)[0];

  return (
    <div className={`bg-white border border-slate-200 rounded-2xl p-6 ${className}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4 pb-3 border-b border-slate-200">
        <div>
          <h3 className="text-base font-bold text-[#0F2744] flex items-center gap-2">
            <span>Biểu đồ Radar Năng lực 5 chiều IELTS Listening</span>
            <span className="text-xs font-mono font-semibold px-2.5 py-0.5 rounded-full bg-slate-100 text-[#0F2744] border border-slate-300">
              D3 Analysis
            </span>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5">
            Đánh giá toàn diện 5 trụ cột tư duy phản xạ nghe giúp bứt phá Band 7.5+
          </p>
        </div>

        {weakestDimension && (
          <div className="text-xs px-3 py-1 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg font-medium">
            Điểm cần ưu tiên khắc phục: <strong>{weakestDimension.name} ({weakestDimension.score}%)</strong>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
        {/* Left: SVG Radar Chart */}
        <div className="md:col-span-6 flex justify-center items-center">
          <svg
            viewBox={`0 0 ${size} ${size}`}
            className="w-full max-w-[320px] aspect-square overflow-visible drop-shadow-xs"
          >
            {/* Grid concentric polygons */}
            {levels.map((level, levelIdx) => {
              const points = Array.from({ length: numPoints })
                .map((_, i) => {
                  const { x, y } = getCoordinates(i, level);
                  return `${x},${y}`;
                })
                .join(' ');
              return (
                <polygon
                  key={levelIdx}
                  points={points}
                  fill="none"
                  stroke="#E2E8F0"
                  strokeWidth="1"
                  strokeDasharray={levelIdx === levels.length - 1 ? 'none' : '2,2'}
                />
              );
            })}

            {/* Axis lines */}
            {Array.from({ length: numPoints }).map((_, i) => {
              const { x, y } = getCoordinates(i, 1.0);
              return (
                <line
                  key={i}
                  x1={center}
                  y1={center}
                  x2={x}
                  y2={y}
                  stroke="#CBD5E1"
                  strokeWidth="1"
                />
              );
            })}

            {/* Candidate Score Filled Polygon */}
            <polygon
              points={polygonPoints}
              fill="rgba(15, 39, 68, 0.18)"
              stroke="#0F2744"
              strokeWidth="2.5"
            />

            {/* Score points & labels */}
            {dimensions.map((dim, i) => {
              const coord = getCoordinates(i, dim.score / 100);
              const labelCoord = getCoordinates(i, 1.22);
              return (
                <g key={dim.id}>
                  <circle
                    cx={coord.x}
                    cy={coord.y}
                    r="4.5"
                    fill="#0F2744"
                    stroke="#FFFFFF"
                    strokeWidth="2"
                  />
                  <text
                    x={labelCoord.x}
                    y={labelCoord.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="text-[11px] font-bold fill-slate-700"
                  >
                    {dim.name}
                  </text>
                  <text
                    x={labelCoord.x}
                    y={labelCoord.y + 13}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="text-[10px] font-mono font-extrabold fill-[#0F2744] tabular-nums"
                  >
                    {dim.score}%
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        {/* Right: Detailed Competency Breakdown Cards */}
        <div className="md:col-span-6 space-y-2.5">
          {dimensions.map((dim) => (
            <div
              key={dim.id}
              className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-start justify-between gap-3 text-xs"
            >
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900">{dim.name}</span>
                  <span className="font-mono font-bold text-[#0F2744] tabular-nums">
                    {dim.score}%
                  </span>
                </div>
                <p className="text-slate-500 text-[11px]">{dim.description}</p>
                <p className="text-slate-700 text-[11.5px] font-medium pt-0.5">
                  💡 <em>{dim.advice}</em>
                </p>
              </div>

              <div className="w-16 h-2 bg-slate-200 rounded-full overflow-hidden mt-1 shrink-0">
                <div
                  className={`h-full rounded-full ${
                    dim.score >= 80
                      ? 'bg-emerald-600'
                      : dim.score >= 60
                        ? 'bg-[#0F2744]'
                        : 'bg-amber-500'
                  }`}
                  style={{ width: `${dim.score}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
