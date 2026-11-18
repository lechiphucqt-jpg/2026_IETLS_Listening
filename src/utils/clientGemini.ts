import type {
  AwlVocabItem,
  ClassroomDrillSentence,
  ErrorCategory,
  IeltsQuestion,
  IntensiveDrillItem,
  ListeningTestPack,
  QuestionType,
  TranscriptSegment,
} from '../types/ielts';

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(',') ? result.split(',')[1] : result;
      resolve(base64);
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

export function formatTimestampLabel(sec: number): string {
  const clamped = Math.max(0, Number.isFinite(sec) ? sec : 0);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  const whole = Math.floor(secs);
  const hundredths = Math.min(99, Math.round((secs - whole) * 100));
  return `[${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}]`;
}

export function cleanJsonFences(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```json')) {
    cleaned = cleaned.slice(7);
  } else if (cleaned.startsWith('```')) {
    cleaned = cleaned.slice(3);
  }
  if (cleaned.endsWith('```')) {
    cleaned = cleaned.slice(0, -3);
  }
  cleaned = cleaned.trim();

  // Extract clean JSON block if model returns conversational wrappers
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    cleaned = cleaned.substring(firstBrace, lastBrace + 1);
  }
  return cleaned.trim();
}

interface GeminiInlineData {
  inlineData: {
    mimeType: string;
    data: string;
  };
}

interface GeminiTextPart {
  text: string;
}

type GeminiContentPart = GeminiInlineData | GeminiTextPart;

export interface SupportedModelTarget {
  version: 'v1' | 'v1beta';
  modelName: string;
}

let workingTargetCache: SupportedModelTarget | null = null;
let lastApiKeyCache = '';

function scoreModelName(name: string): number {
  const lower = name.toLowerCase();
  // 2.0 Flash and 1.5 Flash have the highest quotas (1M - 4M TPM) on Free Tier
  if (lower.includes('2.0-flash') && !lower.includes('lite') && !lower.includes('exp')) return 120;
  if (lower === 'gemini-1.5-flash' || lower === 'models/gemini-1.5-flash') return 115;
  if (lower.includes('1.5-flash-002') || lower.includes('1.5-flash-001')) return 110;
  if (lower.includes('1.5-flash-latest')) return 108;
  if (lower.includes('1.5-flash-8b')) return 105;
  if (lower.includes('1.5-flash')) return 100;
  if (lower.includes('2.0-flash-exp')) return 95;
  if (lower.includes('2.5-flash')) return 90;
  if (lower.includes('2.0-pro')) return 80;
  if (lower.includes('1.5-pro')) return 70;
  if (lower.includes('flash')) return 65;
  if (lower.includes('pro')) return 60;
  return 40;
}

const STATIC_CANDIDATES: SupportedModelTarget[] = [
  // High-quota Flash models first to avoid 429 RESOURCE_EXHAUSTED
  { version: 'v1', modelName: 'gemini-1.5-flash' },
  { version: 'v1beta', modelName: 'gemini-2.0-flash' },
  { version: 'v1', modelName: 'gemini-1.5-flash-latest' },
  { version: 'v1beta', modelName: 'gemini-1.5-flash' },
  { version: 'v1beta', modelName: 'gemini-1.5-flash-8b' },
  { version: 'v1', modelName: 'gemini-1.5-flash-001' },
  { version: 'v1', modelName: 'gemini-1.5-flash-002' },
  { version: 'v1beta', modelName: 'gemini-2.0-flash-exp' },
  { version: 'v1beta', modelName: 'gemini-2.5-flash' },
  { version: 'v1', modelName: 'gemini-1.5-pro' },
  { version: 'v1beta', modelName: 'gemini-1.5-pro' },
  { version: 'v1', modelName: 'gemini-pro' },
];

export async function discoverSupportedModels(apiKey: string): Promise<SupportedModelTarget[]> {
  const cleanKey = apiKey.trim();
  const versions: ('v1' | 'v1beta')[] = ['v1', 'v1beta'];
  const targets: SupportedModelTarget[] = [];
  const seen = new Set<string>();

  for (const ver of versions) {
    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/${ver}/models?key=${encodeURIComponent(cleanKey)}`
      );
      if (res.ok) {
        const data = (await res.json()) as {
          models?: {
            name?: string;
            supportedGenerationMethods?: string[];
          }[];
        };

        if (Array.isArray(data.models)) {
          for (const m of data.models) {
            const rawName = m.name || '';
            const cleanName = rawName.replace(/^models\//, '');
            const methods = m.supportedGenerationMethods || [];
            if (cleanName && methods.includes('generateContent')) {
              const key = `${ver}:${cleanName}`;
              if (!seen.has(key)) {
                seen.add(key);
                targets.push({ version: ver, modelName: cleanName });
              }
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[ModelDiscovery] Không thể listModels trên ${ver}:`, err);
    }
  }

  targets.sort((a, b) => scoreModelName(b.modelName) - scoreModelName(a.modelName));
  return targets;
}

async function getCandidateTargets(apiKey: string): Promise<SupportedModelTarget[]> {
  const cleanKey = apiKey.trim();
  const candidates: SupportedModelTarget[] = [];
  const seen = new Set<string>();

  // 0. User chosen preferred model from Settings modal (if any)
  try {
    const userPreferredModel = typeof window !== 'undefined' ? localStorage.getItem('GEMINI_MODEL') : null;
    if (userPreferredModel) {
      const cleanPref = userPreferredModel.replace(/^models\//, '').trim();
      if (cleanPref) {
        for (const v of ['v1', 'v1beta'] as const) {
          const key = `${v}:${cleanPref}`;
          if (!seen.has(key)) {
            seen.add(key);
            candidates.push({ version: v, modelName: cleanPref });
          }
        }
      }
    }
  } catch {
    // ignore
  }

  // Prioritize cached working target
  if (workingTargetCache && lastApiKeyCache === cleanKey) {
    const key = `${workingTargetCache.version}:${workingTargetCache.modelName}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(workingTargetCache);
    }
  }

  // Dynamic discovery from Google AI Studio
  try {
    const discovered = await discoverSupportedModels(cleanKey);
    for (const t of discovered) {
      const key = `${t.version}:${t.modelName}`;
      if (!seen.has(key)) {
        seen.add(key);
        candidates.push(t);
      }
    }
  } catch (err) {
    console.warn('[ModelDiscovery] Dynamic discovery failed, using static list:', err);
  }

  // Fallback static list
  for (const t of STATIC_CANDIDATES) {
    const key = `${t.version}:${t.modelName}`;
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(t);
    }
  }

  return candidates;
}

export async function callGeminiDirect(
  apiKey: string,
  parts: GeminiContentPart[],
  options?: {
    systemInstruction?: string;
    responseMimeType?: string;
    temperature?: number;
  }
): Promise<string> {
  const cleanKey = apiKey.trim();
  if (!cleanKey) {
    throw new Error('Chưa có khóa Gemini API Key. Vui lòng dán khóa API vào ô màu vàng trước khi xử lý.');
  }

  const candidates = await getCandidateTargets(cleanKey);
  let lastError: Error | null = null;

  for (const target of candidates) {
    const { version, modelName } = target;
    const url = `https://generativelanguage.googleapis.com/${version}/models/${encodeURIComponent(modelName)}:generateContent?key=${encodeURIComponent(cleanKey)}`;

    // Fallback configurations in case responseMimeType or systemInstruction are not supported on this model
    const configsToTry = [
      { useResponseMimeType: !!options?.responseMimeType, useSystemInstruction: !!options?.systemInstruction },
      { useResponseMimeType: false, useSystemInstruction: !!options?.systemInstruction },
      { useResponseMimeType: false, useSystemInstruction: false },
    ];

    for (const config of configsToTry) {
      try {
        let requestParts = parts;
        if (!config.useSystemInstruction && options?.systemInstruction) {
          requestParts = [{ text: `[INSTRUCTIONS]: ${options.systemInstruction}\n\n` }, ...parts];
        }

        const bodyPayload: Record<string, unknown> = {
          contents: [
            {
              role: 'user',
              parts: requestParts,
            },
          ],
          generationConfig: {
            temperature: options?.temperature ?? 0.2,
            ...(config.useResponseMimeType && options?.responseMimeType
              ? { responseMimeType: options.responseMimeType }
              : {}),
          },
        };

        if (config.useSystemInstruction && options?.systemInstruction) {
          bodyPayload.systemInstruction = {
            parts: [{ text: options.systemInstruction }],
          };
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bodyPayload),
        });

        const resText = await res.text();
        let resJson: {
          candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
          error?: { message?: string; status?: string; code?: number };
        };

        try {
          resJson = JSON.parse(resText);
        } catch {
          throw new Error(`Google AI trả về phản hồi không hợp lệ (HTTP ${res.status}): ${resText.slice(0, 150)}`);
        }

        if (!res.ok || resJson.error) {
          const rawErrMsg = resJson.error?.message || `Lỗi HTTP ${res.status}: ${resText.slice(0, 150)}`;
          lastError = new Error(`[${modelName}] ${rawErrMsg}`);

          // Location / VPN error
          if (
            rawErrMsg.includes('User location is not supported') ||
            rawErrMsg.includes('location is not supported')
          ) {
            throw new Error(
              'Khu vực mạng hiện tại chưa được Google Gemini hỗ trợ trực tiếp. Vui lòng bật VPN (sang Singapore, Nhật Bản hoặc Mỹ) rồi thử lại.'
            );
          }

          // API Key invalid or disabled
          if (
            res.status === 400 &&
            (rawErrMsg.includes('API_KEY_INVALID') ||
              rawErrMsg.includes('API key not valid') ||
              rawErrMsg.includes('API_KEY_SERVICE_BLOCKED'))
          ) {
            throw new Error(
              'Khóa Gemini API Key không hợp lệ hoặc đã bị khóa. Vui lòng tạo khóa mới miễn phí tại aistudio.google.com/api-keys rồi dán vào ô màu vàng.'
            );
          }

          // Generative Language API not enabled
          if (
            rawErrMsg.includes('has not been used in project') ||
            rawErrMsg.includes('SERVICE_DISABLED')
          ) {
            throw new Error(
              'Khóa API này chưa được kích hoạt Generative Language API. Vui lòng tạo khóa mới trực tiếp từ aistudio.google.com/api-keys.'
            );
          }

          // Rate limit handling: auto-switch to next candidate model with a short backoff
          if (res.status === 429 || rawErrMsg.includes('RESOURCE_EXHAUSTED')) {
            console.warn(`[Gemini Rate Limit] Model ${modelName} (${version}) chạm hạn mức (429). Đang tự động chuyển sang model tiếp theo...`);
            workingTargetCache = null;
            // Short backoff before trying next candidate model
            await new Promise((resolve) => setTimeout(resolve, 2000));
            break; // Break config loop, try next model candidate in list!
          }

          // If responseMimeType or systemInstruction caused 400, downgrade to next config
          if (
            res.status === 400 &&
            (rawErrMsg.includes('responseMimeType') || rawErrMsg.includes('systemInstruction'))
          ) {
            continue;
          }

          // Model not found or not supported on this version -> try next model candidate
          if (
            res.status === 404 ||
            rawErrMsg.includes('not found') ||
            rawErrMsg.includes('NOT_FOUND') ||
            rawErrMsg.includes('not supported for generateContent')
          ) {
            console.warn(`Model ${modelName} (${version}) không khả dụng (${rawErrMsg}), đang thử model tiếp theo...`);
            break;
          }

          throw new Error(`Google Gemini báo lỗi (${modelName}): ${rawErrMsg}`);
        }

        const replyText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!replyText) {
          throw new Error(`Không nhận được nội dung từ Gemini AI (${modelName}).`);
        }

        // Cache working target for future fast repeat calls
        workingTargetCache = target;
        lastApiKeyCache = cleanKey;
        return replyText;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        // Critical errors propagate immediately
        if (
          lastError.message.includes('API_KEY_INVALID') ||
          lastError.message.includes('API key') ||
          lastError.message.includes('Free Tier') ||
          lastError.message.includes('VPN') ||
          lastError.message.includes('location is not supported') ||
          lastError.message.includes('has not been used in project') ||
          lastError.message.includes('SERVICE_DISABLED')
        ) {
          throw lastError;
        }
        break;
      }
    }
  }

  if (lastError && (lastError.message.includes('RESOURCE_EXHAUSTED') || lastError.message.includes('429'))) {
    throw new Error(
      'Hạn mức gọi của tất cả model Gemini Free Tier tạm thời hết lượt. Vui lòng đợi 30 giây rồi bấm thử lại, hoặc dùng một khóa Gemini API khác.'
    );
  }

  throw (
    lastError ||
    new Error(
      'Không thể kết nối đến Google Gemini AI. Vui lòng kiểm tra lại khóa API hoặc tạo mới miễn phí tại https://aistudio.google.com/api-keys.'
    )
  );
}

export interface ClientIngestInput {
  audioFile?: File | null;
  pdfFile?: File | null;
  rawText?: string;
  title?: string;
  partLabel?: string;
  apiKey: string;
  onProgress?: (stepLabel: string, percent: number) => void;
}

export async function processIngestClientSide({
  audioFile,
  pdfFile,
  rawText = '',
  title = '',
  partLabel = 'Part 2',
  apiKey,
  onProgress,
}: ClientIngestInput): Promise<ListeningTestPack> {
  onProgress?.('Đang nạp tệp âm thanh và tài liệu đề thi...', 10);

  let audioUrl: string | undefined;
  let audioBase64: string | undefined;
  let pdfUrl: string | undefined;
  let pdfBase64: string | undefined;

  if (audioFile) {
    audioUrl = URL.createObjectURL(audioFile);
    try {
      audioBase64 = await fileToBase64(audioFile);
    } catch (err) {
      console.warn('Cannot read audio file base64:', err);
    }
  }

  if (pdfFile) {
    pdfUrl = URL.createObjectURL(pdfFile);
    try {
      pdfBase64 = await fileToBase64(pdfFile);
    } catch (err) {
      console.warn('Cannot read pdf file base64:', err);
    }
  }

  let transcribedSegments: TranscriptSegment[] = [];
  let transcribedText = '';

  // Step 1: Transcribe Audio if audio is uploaded
  if (audioFile && audioBase64) {
    onProgress?.('Đang đồng bộ lời thoại Audio theo mili giây (AI Transcription)...', 30);
    const audioMime = audioFile.type || 'audio/mp3';
    
    const transcribePrompt = `Listen to this IELTS listening audio carefully and transcribe every spoken sentence chronologically (up to 40 sentences).
Each item MUST have:
- "speaker": exactly ONE speaker name (e.g. "Agent", "Emma", "Presenter")
- "startSec": exact starting second (e.g. 1.4)
- "endSec": exact ending second (e.g. 6.8)
- "text": verbatim spoken English sentence

Return ONLY a valid JSON object matching this schema:
{
  "segments": [
    { "speaker": "Speaker", "startSec": 0.0, "endSec": 5.0, "text": "sentence" }
  ]
}`;

    try {
      const trResult = await callGeminiDirect(
        apiKey,
        [
          {
            inlineData: {
              mimeType: audioMime,
              data: audioBase64,
            },
          },
          { text: transcribePrompt },
        ],
        { responseMimeType: 'application/json' }
      );

      const parsedTr = JSON.parse(cleanJsonFences(trResult)) as {
        segments?: { speaker?: string; startSec?: number; endSec?: number; text?: string }[];
      };

      if (Array.isArray(parsedTr.segments) && parsedTr.segments.length > 0) {
        transcribedSegments = parsedTr.segments
          .filter((s) => (s.text || '').trim().length > 0)
          .map((s, idx) => {
            const startSec = Number.isFinite(s.startSec) ? Number(s.startSec) : idx * 6;
            const endSec =
              Number.isFinite(s.endSec) && Number(s.endSec) > startSec ? Number(s.endSec) : startSec + 6;
            return {
              id: `seg_${idx + 1}`,
              speaker: (s.speaker || 'Speaker').trim(),
              startSec,
              endSec,
              timestampLabel: formatTimestampLabel(startSec),
              text: (s.text || '').trim(),
            };
          });
      }
    } catch (trErr) {
      console.warn('Client-side audio transcription fallback triggered:', trErr);
    }

    if (transcribedSegments.length > 0) {
      transcribedText = transcribedSegments
        .map((s) => `${s.timestampLabel} ${s.speaker}: ${s.text}`)
        .join('\n');
    }

    // Short pause to avoid burst rate limit on Google AI Studio Free Tier
    onProgress?.('Đang hoàn tất phân tích âm thanh, chuyển sang đề thi...', 55);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  // Step 2: Extract Exam Questions & Match with Transcript
  onProgress?.('Đang đọc đề thi PDF (OCR) & cấu trúc câu hỏi IELTS chuẩn IDP...', 65);

  const examParts: GeminiContentPart[] = [];
  if (pdfFile && pdfBase64) {
    examParts.push({
      inlineData: {
        mimeType: 'application/pdf',
        data: pdfBase64,
      },
    });
  }
  if (audioFile && audioBase64 && transcribedSegments.length === 0) {
    const audioMime = audioFile.type || 'audio/mp3';
    examParts.push({
      inlineData: {
        mimeType: audioMime,
        data: audioBase64,
      },
    });
  }

  const examPrompt = `Bạn là Chuyên gia Khảo thí IELTS Quốc tế (AI IELTS Listening Mastermind).
Nhiệm vụ: Trích xuất ĐẦY ĐỦ câu hỏi và thiết kế phòng thi chuẩn IELTS Listening cho phần ${partLabel}.

Thông tin đầu vào:
- Tiêu đề mong muốn: "${title || audioFile?.name.replace(/\.[^/.]+$/, '') || 'IELTS Listening Practice'}"
- Phần thi: ${partLabel}
${transcribedText ? `\n--- AUDIO TRANSCRIPT ---\n${transcribedText}\n` : ''}
${rawText ? `\n--- NỘI DUNG VĂN BẢN ĐỀ THI / SCRIPT ---\n${rawText}\n` : ''}

YÊU CẦU:
1. "questions": Trích xuất từ đề thi PDF/văn bản toàn bộ câu hỏi (từ 5 đến 12 câu). Nếu chỉ có Audio mà không có đề in sẵn, hãy tự thiết kế 6-8 câu hỏi chuẩn IELTS Listening (dạng "completion" điền từ hoặc "mcq" trắc nghiệm).
Mỗi câu hỏi gồm:
- number (số thứ tự)
- type ("completion" | "mcq" | "matching")
- prompt (nội dung câu hỏi, giữ dấu ____ cho chỗ trống)
- wordLimitInstruction (ví dụ: "NO MORE THAN TWO WORDS AND/OR A NUMBER")
- options: nếu là mcq, ghi danh sách [{ key: "A", text: "..." }, ...]
- correctAnswer: đáp án đúng
- acceptedVariants: các biến thể chính tả chấp nhận (nếu có)
- timestampSec: mốc giây xuất hiện đáp án trong bài nghe (số thực)
- paraphraseQuestion: cụm từ trong câu hỏi
- paraphraseTranscript: cụm từ đã được paraphrase trong bài nghe
- distractorType: loại bẫy (ví dụ "False Premise", "Correction Trap", "Timing Trap")
- distractorDetail: giải thích chi tiết bẫy bằng tiếng Việt
- transcriptQuote: đoạn văn audio chứa câu trả lời
- explanationVi: giải thích chi tiết bằng tiếng Việt vì sao đúng
- errorCategoryHint: ("Spelling" | "Plural/Singular" | "Unit" | "Distractor" | "WordLimit")

${transcribedSegments.length === 0 ? '2. "segments": Tách đoạn hội thoại thành các câu ngắn có startSec, endSec, speaker, text (khoảng 15-30 câu).' : ''}

3. "vocabulary": 5-8 từ vựng học thuật quan trọng (Academic Word List - AWL) trong bài, gồm: word, ipa, pos, definitionVi, definitionEn, exampleInAudio, timestampSec.

4. "classroomDrills": 3-5 câu thoại tiêu biểu để học sinh luyện nghe chép chính tả (Dictation) và nhại giọng (Shadowing), gồm: id, order, speaker, sentence, translationVi, startSec, endSec, keyWords, selectionReasonVi.

Trả về DUY NHẤT một JSON hợp lệ (không kèm văn bản ngoài):
{
  "title": "${title || 'IELTS Listening Practice'}",
  "partLabel": "${partLabel}",
  "topic": "IELTS Academic / General Training",
  "bandTarget": "Band 6.5 – 8.0",
  "questions": [ ... ],
  ${transcribedSegments.length === 0 ? '"segments": [ ... ],' : ''}
  "vocabulary": [ ... ],
  "classroomDrills": [ ... ]
}`;

  examParts.push({ text: examPrompt });

  let examJsonText = '';
  try {
    examJsonText = await callGeminiDirect(apiKey, examParts, {
      responseMimeType: 'application/json',
    });
  } catch (examErr) {
    console.error('Client-side question extraction error:', examErr);
    throw examErr;
  }

  let parsedExam: {
    title?: string;
    partLabel?: string;
    topic?: string;
    bandTarget?: string;
    questions?: Partial<IeltsQuestion>[];
    segments?: Partial<TranscriptSegment>[];
    vocabulary?: Partial<AwlVocabItem>[];
    classroomDrills?: Partial<ClassroomDrillSentence>[];
  } = {};

  try {
    parsedExam = JSON.parse(cleanJsonFences(examJsonText));
  } catch (parseErr) {
    console.warn('Failed to parse exam JSON directly:', parseErr);
  }

  // Format final questions
  const finalQuestions: IeltsQuestion[] = (parsedExam.questions || []).map((q, idx) => {
    const num = typeof q.number === 'number' ? q.number : idx + 1;
    const type = (['completion', 'mcq', 'matching'].includes(q.type as string)
      ? q.type
      : 'completion') as QuestionType;
    const timestampSec = Number.isFinite(q.timestampSec) ? Number(q.timestampSec) : idx * 15;
    const errorCategoryHint = (q.errorCategoryHint || 'Distractor') as ErrorCategory;

    return {
      number: num,
      type,
      prompt: q.prompt || `Câu hỏi số ${num}`,
      contextBefore: q.contextBefore,
      contextAfter: q.contextAfter,
      wordLimitInstruction: q.wordLimitInstruction || (type === 'completion' ? 'ONE WORD ONLY' : undefined),
      options: Array.isArray(q.options) ? q.options : undefined,
      correctAnswer: (q.correctAnswer || '').trim(),
      acceptedVariants: Array.isArray(q.acceptedVariants) ? q.acceptedVariants : [],
      timestampSec,
      timestampLabel: formatTimestampLabel(timestampSec),
      paraphraseQuestion: q.paraphraseQuestion || '',
      paraphraseTranscript: q.paraphraseTranscript || '',
      distractorType: q.distractorType || 'None',
      distractorDetail: q.distractorDetail || '',
      transcriptQuote: q.transcriptQuote || '',
      explanationVi: q.explanationVi || 'Đối chiếu trực tiếp với bài nghe.',
      errorCategoryHint,
    };
  });

  // If no questions extracted, synthesize minimum 6 questions
  if (finalQuestions.length === 0) {
    for (let i = 1; i <= 6; i++) {
      finalQuestions.push({
        number: i,
        type: 'completion',
        prompt: `Question ${i}: The speaker mentions ____ in the conversation.`,
        wordLimitInstruction: 'ONE WORD AND/OR A NUMBER',
        correctAnswer: 'sample',
        timestampSec: (i - 1) * 20,
        timestampLabel: formatTimestampLabel((i - 1) * 20),
        paraphraseQuestion: '',
        paraphraseTranscript: '',
        distractorType: 'Distractor Trap',
        distractorDetail: 'Chú ý từ nối đổi ý',
        transcriptQuote: '',
        explanationVi: 'Nghe kỹ đoạn thông tin được nhấn mạnh.',
        errorCategoryHint: 'Distractor',
      });
    }
  }

  // Final segments
  let finalSegments: TranscriptSegment[] = transcribedSegments;
  if (finalSegments.length === 0 && Array.isArray(parsedExam.segments) && parsedExam.segments.length > 0) {
    finalSegments = parsedExam.segments.map((s, idx) => {
      const startSec = Number.isFinite(s.startSec) ? Number(s.startSec) : idx * 6;
      const endSec = Number.isFinite(s.endSec) && Number(s.endSec) > startSec ? Number(s.endSec) : startSec + 6;
      return {
        id: s.id || `seg_${idx + 1}`,
        speaker: s.speaker || 'Speaker',
        startSec,
        endSec,
        timestampLabel: formatTimestampLabel(startSec),
        text: s.text || '',
      };
    });
  }

  if (finalSegments.length === 0) {
    finalSegments = [
      {
        id: 'seg_1',
        speaker: 'Speaker',
        startSec: 0,
        endSec: 30,
        timestampLabel: '[00:00.00]',
        text: rawText || 'Bài nghe IELTS Listening',
      },
    ];
  }

  // Final vocabulary
  const finalVocab: AwlVocabItem[] = (parsedExam.vocabulary || []).map((v) => {
    const timestampSec = Number.isFinite(v.timestampSec) ? Number(v.timestampSec) : 0;
    return {
      word: v.word || 'Vocabulary',
      ipa: v.ipa || '',
      pos: v.pos || 'n.',
      definitionVi: v.definitionVi || '',
      contextualMeaningVi: v.contextualMeaningVi || v.definitionVi || '',
      definitionEn: v.definitionEn || '',
      exampleInAudio: v.exampleInAudio || '',
      exampleTranslationVi: v.exampleTranslationVi || '',
      timestampSec,
      timestampLabel: formatTimestampLabel(timestampSec),
      isAwl: true,
    };
  });

  // Final classroom drills
  const finalDrills: ClassroomDrillSentence[] = (parsedExam.classroomDrills || []).map((d, idx) => {
    const startSec = Number.isFinite(d.startSec) ? Number(d.startSec) : idx * 10;
    const endSec = Number.isFinite(d.endSec) && Number(d.endSec) > startSec ? Number(d.endSec) : startSec + 8;
    return {
      id: d.id || `drill_${idx + 1}`,
      order: d.order || idx + 1,
      speaker: d.speaker || 'Speaker',
      sentence: d.sentence || '',
      translationVi: d.translationVi || '',
      startSec,
      endSec,
      timestampLabel: formatTimestampLabel(startSec),
      selectionReasonVi: d.selectionReasonVi || 'Câu quan trọng chứa đáp án và từ vựng học thuật',
      stressPattern: d.stressPattern || '',
      connectedSpeechNote: d.connectedSpeechNote || '',
      keyWords: Array.isArray(d.keyWords) ? d.keyWords : [],
    };
  });

  const durationSec =
    finalSegments.length > 0 ? Math.max(...finalSegments.map((s) => s.endSec), 120) : 180;

  onProgress?.('Hoàn tất tạo phòng thi và đồng bộ câu hỏi!', 100);

  const pack: ListeningTestPack = {
    id: `custom_${Date.now()}`,
    title: parsedExam.title || title || audioFile?.name.replace(/\.[^/.]+$/, '') || 'IELTS Listening Custom Test',
    partLabel: parsedExam.partLabel || partLabel || 'Part 2',
    topic: parsedExam.topic || 'IELTS Listening Practice',
    bandTarget: parsedExam.bandTarget || 'Band 6.5 – 8.0',
    durationSec,
    audioUrl,
    audioFileName: audioFile?.name,
    pdfUrl,
    pdfFileName: pdfFile?.name,
    createdAt: new Date().toISOString(),
    isCustomUpload: true,
    speakers: [
      { name: 'Speaker 1', voice: 'Puck', style: 'Academic British' },
      { name: 'Speaker 2', voice: 'Fenrir', style: 'Natural Conversational' },
    ],
    segments: finalSegments,
    questions: finalQuestions,
    vocabulary: finalVocab,
    intensiveDrills: [],
    classroomDrills: finalDrills,
  };

  return pack;
}

export async function callCoachClientSide(input: {
  apiKey: string;
  testTitle?: string;
  partLabel?: string;
  question?: IeltsQuestion;
  userAnswer?: string;
  message: string;
  history?: { role: 'user' | 'model'; text: string }[];
}): Promise<string> {
  const prompt = `Bạn là một Cựu Giám khảo / Chuyên gia Sư phạm IELTS Listening hàng đầu (AI IELTS Listening Master Coach), nói tiếng Việt chuẩn mực, giàu tính khích lệ, phân tích sắc bén và sư phạm.

NGỮ CẢNH BÀI THI & CÂU HỎI:
- Bài thi: ${input.testTitle || 'IELTS Listening Practice'} (${input.partLabel || 'Listening Section'})
- Câu hỏi số: ${input.question?.number || 1}
- Dạng câu: ${input.question?.type || 'completion'}
- Yêu cầu câu hỏi (Prompt): "${input.question?.prompt || ''}"
- Đáp án của thí sinh đã làm: "${input.userAnswer || '(Chưa làm / Bỏ trống)'}"
- Đáp án chuẩn (Correct Answer): "${input.question?.correctAnswer || ''}"
- Các biến thể chấp nhận: ${JSON.stringify(input.question?.acceptedVariants || [])}
- Trích đoạn Transcript chứa đáp án: "${input.question?.transcriptQuote || ''}"
- Giải thích vì sao đúng: "${input.question?.explanationVi || ''}"
- Bẫy thông tin (Distractor): "${input.question?.distractorType || 'None'}" - Chi tiết bẫy: "${input.question?.distractorDetail || ''}"
- Biến đổi từ khóa (Paraphrasing): "${input.question?.paraphraseQuestion || ''}" -> "${input.question?.paraphraseTranscript || ''}"

LỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ:
${Array.isArray(input.history) && input.history.length > 0 ? input.history.map((h) => `${h.role === 'user' ? 'Thí sinh' : 'Gia sư'}: ${h.text}`).join('\n') : '(Bắt đầu cuộc trò chuyện)'}

CÂU HỎI MỚI CỦA THÍ SINH:
"${input.message.trim()}"

HƯỚNG DẪN TRẢ LỜI CỦA GIA SƯ:
1. Trực tiếp giải đáp thắc mắc của thí sinh một cách dễ hiểu, thân thiện, mang tính sư phạm cao.
2. Chỉ rõ vì sao đáp án chuẩn là như vậy, phân tích cụ thể bẫy người nói đặt ra (từ nối, chuyển ý, phủ định ngầm, hay ngữ âm đánh vần).
3. Đưa ra "Mẹo thực chiến (Pro Tips)" để học sinh không bao giờ bị lừa ở dạng bài tương tự trong phòng thi thật.
4. Trả lời bằng tiếng Việt tự nhiên, có điểm xuyến các thuật ngữ học thuật tiếng Anh trong bài. Định dạng Markdown rõ ràng, gạch đầu dòng các ý chính, không lan man.`;

  return callGeminiDirect(input.apiKey, [{ text: prompt }]);
}


function normalizeAnswer(val: string): string {
  return val.trim().toLowerCase().replace(/\s+/g, ' ');
}

function classifyError(q: IeltsQuestion, userRaw: string): ErrorCategory {
  const user = normalizeAnswer(userRaw);
  const correct = normalizeAnswer(q.correctAnswer);
  if (!user) return 'Unanswered';

  if (q.wordLimitInstruction?.includes('ONE WORD') && user.split(' ').length > 1) {
    return 'WordLimit';
  }
  if (q.wordLimitInstruction?.includes('TWO WORDS') && user.split(' ').length > 2) {
    return 'WordLimit';
  }

  if (
    user + 's' === correct ||
    user + 'es' === correct ||
    correct + 's' === user ||
    correct + 'es' === user
  ) {
    return 'Plural/Singular';
  }

  if (/\d/.test(correct) || q.errorCategoryHint === 'Unit') {
    const userDigits = user.replace(/[^\d.]/g, '');
    const correctDigits = correct.replace(/[^\d.]/g, '');
    if (userDigits && correctDigits && userDigits === correctDigits && user !== correct) {
      return 'Unit';
    }
  }

  return q.errorCategoryHint || 'Distractor';
}

function calculateEstimatedBand(correct: number, total: number): string {
  if (total <= 0) return 'N/A';
  const ratio = correct / total;
  if (ratio >= 0.95) return 'Band 8.5 – 9.0';
  if (ratio >= 0.85) return 'Band 8.0';
  if (ratio >= 0.75) return 'Band 7.0 – 7.5';
  if (ratio >= 0.6) return 'Band 6.5';
  if (ratio >= 0.5) return 'Band 5.5 – 6.0';
  return 'Band 4.5 – 5.0';
}

export async function generatePedagogicalReportClientSide(
  apiKey: string,
  testPack: ListeningTestPack,
  userAnswers: Record<number, string>,
  _timeSpentSec: number
): Promise<import('../types/ielts').PedagogicalReport> {
  const part1AnswerKey = testPack.questions.map((q) => {
    const rawUser = userAnswers?.[q.number] ?? '';
    const normUser = normalizeAnswer(rawUser);
    const accepted = [q.correctAnswer, ...(q.acceptedVariants || [])].map(normalizeAnswer);
    const isCorrect = normUser !== '' && accepted.includes(normUser);
    const errorCategory = isCorrect ? undefined : classifyError(q, rawUser);

    return {
      questionNumber: q.number,
      userAnswer: rawUser.trim() || '(Bỏ trống)',
      correctAnswer: q.correctAnswer,
      isCorrect,
      errorCategory,
      timestampSec: q.timestampSec,
      timestampEndSec: q.timestampEndSec,
      timestampLabel: q.timestampLabel,
      paraphraseMapping: `${q.paraphraseQuestion} → ${q.paraphraseTranscript}`,
      distractorType: q.distractorType,
    };
  });

  const correctCount = part1AnswerKey.filter((r) => r.isCorrect).length;
  const totalCount = part1AnswerKey.length;
  const accuracyPercent = totalCount > 0 ? Math.round((correctCount / totalCount) * 100) : 0;
  const estimatedBand = calculateEstimatedBand(correctCount, totalCount);

  const part2Explanations = testPack.questions.map((q) => {
    const row = part1AnswerKey.find((r) => r.questionNumber === q.number);
    return {
      questionNumber: q.number,
      isCorrect: row?.isCorrect ?? false,
      userAnswer: row?.userAnswer,
      correctAnswer: q.correctAnswer,
      paraphraseMapping: `${q.paraphraseQuestion} → ${q.paraphraseTranscript}`,
      distractorType: q.distractorType,
      logicVi: q.explanationVi || 'Đối chiếu trực tiếp với bài nghe.',
      directQuote: q.transcriptQuote || '',
      timestampSec: q.timestampSec,
      timestampEndSec: q.timestampEndSec,
      timestampLabel: q.timestampLabel,
    };
  });

  let overallDiagnosisVi = `Thí sinh hoàn thành bài thi đạt ${correctCount}/${totalCount} câu đúng (${accuracyPercent}%), ước lượng trình độ ${estimatedBand}.`;
  let actionPlanSummary = 'Tập trung luyện nghe bẫy thông tin (Distractors) và lưu ý các từ nối chuyển ý (However, But, Actually).';

  if (apiKey.trim()) {
    try {
      const prompt = `Phân tích kết quả bài thi IELTS Listening:
- Bài thi: ${testPack.title} (${testPack.partLabel})
- Điểm: ${correctCount}/${totalCount} (${accuracyPercent}% - ${estimatedBand})
- Chi tiết:
${part1AnswerKey.map((r) => `Câu ${r.questionNumber}: Đáp án của học sinh="${r.userAnswer}" | Chuẩn="${r.correctAnswer}" | ${r.isCorrect ? 'ĐÚNG' : `SAI (${r.errorCategory})`}`).join('\n')}

Hãy đưa ra nhận xét ngắn gọn:
1. "overallDiagnosisVi": Nhận xét sư phạm về điểm mạnh và các lỗi thường gặp
2. "actionPlanSummary": Lời khuyên 2-3 câu để cải thiện điểm số

Trả về JSON:
{
  "overallDiagnosisVi": "...",
  "actionPlanSummary": "..."
}`;

      const aiText = await callGeminiDirect(apiKey, [{ text: prompt }], {
        responseMimeType: 'application/json',
      });
      const parsedAi = JSON.parse(cleanJsonFences(aiText));
      if (parsedAi.overallDiagnosisVi) overallDiagnosisVi = parsedAi.overallDiagnosisVi;
      if (parsedAi.actionPlanSummary) actionPlanSummary = parsedAi.actionPlanSummary;
    } catch {
      // Use fallback
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    testId: testPack.id,
    testTitle: testPack.title,
    part1AnswerKey,
    part2Explanations,
    part3BehavioralInsights: {
      correctCount,
      totalCount,
      accuracyPercent,
      estimatedBand,
      errorBreakdown: [],
      overallDiagnosisVi,
    },
    part4AcademicSpotlight: testPack.vocabulary || [],
    part5ActionPlan: {
      summaryVi: actionPlanSummary,
      shadowingTargets: (testPack.segments || []).slice(0, 2).map((s, idx) => ({
        label: `Đoạn thoại ${idx + 1}`,
        timestampSec: s.startSec,
        timestampLabel: s.timestampLabel,
        focusNote: 'Luyện ngữ điệu và nối âm tự nhiên',
      })),
      intensiveTargets: (testPack.questions || [])
        .filter((q) => {
          const row = part1AnswerKey.find((r) => r.questionNumber === q.number);
          return !row?.isCorrect;
        })
        .slice(0, 2)
        .map((q) => ({
          label: `Câu ${q.number}`,
          questionType: q.type,
          timestampSec: q.timestampSec,
          timestampLabel: q.timestampLabel,
        })),
    },
  };
}
