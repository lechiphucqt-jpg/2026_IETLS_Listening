import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import type {
  ClassroomDrillSentence,
  ErrorCategory,
  IeltsQuestion,
  ListeningTestPack,
  PedagogicalReport,
  TranscriptSegment,
} from './src/types/ielts.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

function getAiClient(clientApiKey?: string, apiVersion?: string): GoogleGenAI {
  const apiKey = clientApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY chưa được cấu hình. Vui lòng bấm vào nút "API Key (Lấy API key để sử dụng app)" trên Header để nhập khóa Gemini API miễn phí của bạn.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    ...(apiVersion ? { apiVersion } : {}),
    httpOptions: {
      timeout: 45000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function formatGeminiError(err: unknown): string {
  let raw = '';
  if (err instanceof Error) {
    raw = err.message;
  } else if (typeof err === 'object' && err !== null) {
    const anyErr = err as Record<string, unknown>;
    if (typeof anyErr.message === 'string') {
      raw = anyErr.message;
    } else if (anyErr.error && typeof anyErr.error === 'object') {
      const nested = anyErr.error as Record<string, unknown>;
      raw = typeof nested.message === 'string' ? nested.message : JSON.stringify(anyErr.error);
    } else if (typeof anyErr.error === 'string') {
      raw = anyErr.error;
    } else {
      try {
        raw = JSON.stringify(err);
      } catch {
        raw = String(err);
      }
    }
  } else {
    raw = String(err);
  }

  if (raw.includes('429') || raw.includes('RESOURCE_EXHAUSTED')) {
    return 'Hạn mức API miễn phí (Free Tier quota) đã tạm thời hết. Bạn có thể bấm nút "API Key" trên thanh điều hướng để đổi sang khóa Gemini API khác.';
  }
  if (
    raw.includes('403') ||
    raw.includes('PERMISSION_DENIED') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('API key not valid')
  ) {
    return 'Khóa Gemini API không hợp lệ hoặc chưa được kích hoạt. Vui lòng lấy khóa mới miễn phí tại aistudio.google.com/api-keys và nhập vào mục "API Key".';
  }
  if (raw.includes('404') || raw.includes('NOT_FOUND')) {
    return 'Model AI được yêu cầu không khả dụng hoặc phiên bản đã được Google cập nhật.';
  }
  if (
    raw.includes('TimeoutError') ||
    raw.includes('timed out') ||
    raw.includes('AbortError') ||
    raw.includes('aborted')
  ) {
    return 'Máy chủ AI phản hồi quá lâu (hết thời gian chờ). Vui lòng thử lại với tệp Audio/PDF có dung lượng nhỏ hơn.';
  }
  return raw || 'Không thể xử lý yêu cầu AI.';
}

async function generateWithFallback(
  ai: GoogleGenAI,
  params: Parameters<GoogleGenAI['models']['generateContent']>[0],
  timeoutMs = 45000
) {
  const modelsToTry = [
    params.model || 'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
  ];
  const uniqueModels = Array.from(new Set(modelsToTry));

  let lastError: unknown = null;
  for (let i = 0; i < uniqueModels.length; i++) {
    const currentModel = uniqueModels[i];
    try {
      const config = {
        ...(params.config || {}),
        abortSignal: params.config?.abortSignal || AbortSignal.timeout(timeoutMs),
      };
      if (i > 0 && (config as any).thinkingConfig) {
        delete (config as any).thinkingConfig;
      }
      return await ai.models.generateContent({
        ...params,
        model: currentModel,
        config,
      });
    } catch (err: unknown) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[gemini] Model ${currentModel} error: ${msg}. Retrying next fallback...`);
    }
  }
  throw lastError;
}

// Persistent disk + RAM storage for uploaded Audio, PDFs, and Test Packs
const DATA_DIR = path.resolve(__dirname, '.lexisync_data');
const AUDIO_DIR = path.join(DATA_DIR, 'audio');
const PDF_DIR = path.join(DATA_DIR, 'pdfs');
const TESTS_DB_PATH = path.join(DATA_DIR, 'tests.json');

fs.mkdirSync(AUDIO_DIR, { recursive: true });
fs.mkdirSync(PDF_DIR, { recursive: true });

interface StoredAudio {
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
  createdAt: number;
}
const audioStore = new Map<string, StoredAudio>();
const MAX_RAM_AUDIOS = 20;

function cacheAudioInRam(id: string, entry: StoredAudio) {
  if (audioStore.size >= MAX_RAM_AUDIOS && !audioStore.has(id)) {
    const oldestKey = audioStore.keys().next().value;
    if (oldestKey) audioStore.delete(oldestKey);
  }
  audioStore.set(id, entry);
}

function saveAudioBuffer(buffer: Buffer, mimeType: string, originalName?: string): string {
  const id = crypto.randomUUID();
  const entry: StoredAudio = {
    buffer,
    mimeType,
    originalName,
    createdAt: Date.now(),
  };
  cacheAudioInRam(id, entry);
  try {
    fs.writeFileSync(path.join(AUDIO_DIR, `${id}.bin`), buffer);
    fs.writeFileSync(
      path.join(AUDIO_DIR, `${id}.json`),
      JSON.stringify({ mimeType, originalName, createdAt: entry.createdAt })
    );
  } catch (diskErr) {
    console.warn('[storage] Failed to persist audio buffer to disk:', diskErr);
  }
  return id;
}

function getStoredAudio(id: string): StoredAudio | undefined {
  const safeId = path.basename(id);
  const inRam = audioStore.get(safeId);
  if (inRam) return inRam;

  const binPath = path.join(AUDIO_DIR, `${safeId}.bin`);
  const metaPath = path.join(AUDIO_DIR, `${safeId}.json`);
  if (!fs.existsSync(binPath)) return undefined;

  try {
    const buffer = fs.readFileSync(binPath);
    let mimeType = 'audio/mpeg';
    let originalName: string | undefined;
    let createdAt = Date.now();
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as {
        mimeType?: string;
        originalName?: string;
        createdAt?: number;
      };
      if (meta.mimeType) mimeType = meta.mimeType;
      if (meta.originalName) originalName = meta.originalName;
      if (meta.createdAt) createdAt = meta.createdAt;
    }
    const entry: StoredAudio = { buffer, mimeType, originalName, createdAt };
    cacheAudioInRam(safeId, entry);
    return entry;
  } catch (diskErr) {
    console.warn('[storage] Failed to read audio from disk:', diskErr);
    return undefined;
  }
}

function savePdfBuffer(buffer: Buffer, originalName?: string): string {
  const id = crypto.randomUUID();
  try {
    fs.writeFileSync(path.join(PDF_DIR, `${id}.pdf`), buffer);
    fs.writeFileSync(
      path.join(PDF_DIR, `${id}.json`),
      JSON.stringify({ originalName: originalName || 'exam.pdf', createdAt: Date.now() })
    );
  } catch (diskErr) {
    console.warn('[storage] Failed to persist PDF buffer to disk:', diskErr);
  }
  return id;
}

function getStoredPdf(id: string): { buffer: Buffer; originalName: string } | undefined {
  const safeId = path.basename(id);
  const pdfPath = path.join(PDF_DIR, `${safeId}.pdf`);
  const metaPath = path.join(PDF_DIR, `${safeId}.json`);
  if (!fs.existsSync(pdfPath)) return undefined;
  try {
    const buffer = fs.readFileSync(pdfPath);
    let originalName = 'exam.pdf';
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')) as { originalName?: string };
      if (meta.originalName) originalName = meta.originalName;
    }
    return { buffer, originalName };
  } catch (diskErr) {
    console.warn('[storage] Failed to read PDF from disk:', diskErr);
    return undefined;
  }
}

function loadSavedTests(): ListeningTestPack[] {
  try {
    if (!fs.existsSync(TESTS_DB_PATH)) return [];
    const raw = fs.readFileSync(TESTS_DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as ListeningTestPack[]) : [];
  } catch (err) {
    console.warn('[storage] Failed to load tests.json:', err);
    return [];
  }
}

function writeSavedTests(list: ListeningTestPack[]) {
  try {
    const tmpPath = `${TESTS_DB_PATH}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(list.slice(0, 50), null, 2));
    fs.renameSync(tmpPath, TESTS_DB_PATH);
  } catch (err) {
    console.warn('[storage] Failed to write tests.json:', err);
  }
}

function upsertSavedTest(pack: ListeningTestPack) {
  const current = loadSavedTests();
  const idx = current.findIndex((t) => t.id === pack.id);
  if (idx >= 0) {
    current[idx] = pack;
  } else {
    current.unshift(pack);
  }
  writeSavedTests(current);
}

function deleteSavedTest(id: string): boolean {
  const current = loadSavedTests();
  const target = current.find((t) => t.id === id);
  const next = current.filter((t) => t.id !== id);
  writeSavedTests(next);

  if (target?.audioUrl?.startsWith('/api/ielts/audio/')) {
    const audioId = path.basename(target.audioUrl.slice('/api/ielts/audio/'.length));
    audioStore.delete(audioId);
    fs.promises.unlink(path.join(AUDIO_DIR, `${audioId}.bin`)).catch(() => {});
    fs.promises.unlink(path.join(AUDIO_DIR, `${audioId}.json`)).catch(() => {});
  }
  if (target?.pdfUrl?.startsWith('/api/ielts/pdf/')) {
    const pdfId = path.basename(target.pdfUrl.slice('/api/ielts/pdf/'.length));
    fs.promises.unlink(path.join(PDF_DIR, `${pdfId}.pdf`)).catch(() => {});
    fs.promises.unlink(path.join(PDF_DIR, `${pdfId}.json`)).catch(() => {});
  }
  return current.length !== next.length;
}

interface IngestJobState {
  jobId: string;
  status: 'processing' | 'done' | 'error';
  stepLabel: string;
  progressPercent: number;
  testPack?: ListeningTestPack;
  error?: string;
  createdAt: number;
}
const ingestJobs = new Map<string, IngestJobState>();
const MAX_INGEST_JOBS = 30;

function createIngestJob(): IngestJobState {
  const now = Date.now();
  for (const [key, job] of ingestJobs.entries()) {
    if (now - job.createdAt > 15 * 60 * 1000) {
      ingestJobs.delete(key);
    }
  }
  while (ingestJobs.size >= MAX_INGEST_JOBS) {
    const oldestKey = ingestJobs.keys().next().value;
    if (!oldestKey) break;
    ingestJobs.delete(oldestKey);
  }
  const job: IngestJobState = {
    jobId: crypto.randomUUID(),
    status: 'processing',
    stepLabel: 'Đang khởi tạo phiên xử lý Tech-Sync...',
    progressPercent: 10,
    createdAt: now,
  };
  ingestJobs.set(job.jobId, job);
  return job;
}

function normalizeAudioMimeType(reportedMime: string, originalName: string): {
  streamMime: string;
  geminiMime: string;
} {
  const ext = path.extname(originalName || '').toLowerCase();
  const raw = (reportedMime || '').toLowerCase();

  if (ext === '.mp3' || raw === 'audio/mp3' || raw === 'audio/mpeg' || raw === 'audio/x-mp3') {
    return { streamMime: 'audio/mpeg', geminiMime: 'audio/mp3' };
  }
  if (ext === '.wav' || raw === 'audio/wav' || raw === 'audio/x-wav' || raw === 'audio/wave') {
    return { streamMime: 'audio/wav', geminiMime: 'audio/wav' };
  }
  if (ext === '.m4a' || ext === '.mp4' || raw === 'audio/mp4' || raw === 'audio/x-m4a') {
    return { streamMime: 'audio/mp4', geminiMime: 'audio/mp4' };
  }
  if (ext === '.aac' || raw === 'audio/aac') {
    return { streamMime: 'audio/aac', geminiMime: 'audio/aac' };
  }
  if (ext === '.ogg' || raw === 'audio/ogg') {
    return { streamMime: 'audio/ogg', geminiMime: 'audio/ogg' };
  }
  if (ext === '.webm' || raw === 'audio/webm') {
    return { streamMime: 'audio/webm', geminiMime: 'audio/webm' };
  }
  if (ext === '.flac' || raw === 'audio/flac') {
    return { streamMime: 'audio/flac', geminiMime: 'audio/flac' };
  }
  return {
    streamMime: raw.startsWith('audio/') ? raw : 'audio/mpeg',
    geminiMime: raw.startsWith('audio/') ? raw : 'audio/mp3',
  };
}

type GeminiPart =
  | { text: string }
  | { inlineData: { mimeType: string; data: string } }
  | { fileData: { fileUri: string; mimeType: string } };

async function buildGeminiMediaPart(
  ai: GoogleGenAI,
  buffer: Buffer,
  mimeType: string,
  originalName: string,
  cleanupFiles: string[]
): Promise<GeminiPart> {
  // Use inlineData for <= 2MB, and Gemini Files API for larger PDF/audio files
  if (buffer.length <= 2 * 1024 * 1024) {
    return {
      inlineData: {
        mimeType,
        data: buffer.toString('base64'),
      },
    };
  }

  const ext = path.extname(originalName || '') || (mimeType === 'application/pdf' ? '.pdf' : '.mp3');
  const tmpPath = path.join(os.tmpdir(), `lexisync-${crypto.randomUUID()}${ext}`);
  await fs.promises.writeFile(tmpPath, buffer);
  try {
    let uploaded = await ai.files.upload({
      file: tmpPath,
      config: { mimeType },
    });
    if (uploaded.name) {
      cleanupFiles.push(uploaded.name);
    }
    let attempts = 0;
    while (uploaded.state === 'PROCESSING' && attempts < 40) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!uploaded.name) break;
      uploaded = await ai.files.get({ name: uploaded.name });
      attempts++;
    }
    if (uploaded.state === 'FAILED') {
      throw new Error(
        `Gemini File API không thể giải mã tệp "${originalName || mimeType}". Vui lòng kiểm tra lại định dạng tệp.`
      );
    }
    if (uploaded.state === 'PROCESSING') {
      throw new Error(
        `Tệp "${originalName || mimeType}" mất quá nhiều thời gian xử lý trên máy chủ AI. Vui lòng thử nén nhỏ hơn hoặc tách từng Part.`
      );
    }
    if (!uploaded.uri) {
      throw new Error('Không thể tải tệp lên Gemini File API.');
    }
    return {
      fileData: {
        fileUri: uploaded.uri,
        mimeType: uploaded.mimeType || mimeType,
      },
    };
  } finally {
    fs.promises.unlink(tmpPath).catch(() => {});
  }
}

function cleanJsonText(rawText: string | undefined): string {
  return (rawText || '{}')
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function parseModelJson<T>(rawText: string | undefined): T {
  const cleaned = cleanJsonText(rawText);
  try {
    return JSON.parse(cleaned || '{}') as T;
  } catch {
    const firstBrace = cleaned.indexOf('{');
    const lastBrace = cleaned.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(cleaned.slice(firstBrace, lastBrace + 1)) as T;
    }
    throw new Error('Phản hồi JSON từ AI không hợp lệ.');
  }
}

function safeParseModelJson<T>(rawText: string | undefined): T | null {
  try {
    if (!rawText || !rawText.trim()) return null;
    return parseModelJson<T>(rawText);
  } catch {
    return null;
  }
}

function formatTimestampLabel(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  const wholeSecs = Math.floor(secs);
  const hundredths = Math.round((secs - wholeSecs) * 100);
  const mm = String(mins).padStart(2, '0');
  const ss = String(wholeSecs).padStart(2, '0');
  const xx = String(hundredths >= 100 ? 99 : hundredths).padStart(2, '0');
  return `[${mm}:${ss}.${xx}]`;
}

function normalizeAlignText(text: string): string {
  return text
    .toLowerCase()
    .replace(/’/g, "'")
    .replace(/\bi'm\b/g, 'i am')
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bshan't\b/g, 'shall not')
    .replace(/n't\b/g, ' not')
    .replace(/'re\b/g, ' are')
    .replace(/'ve\b/g, ' have')
    .replace(/'ll\b/g, ' will')
    .replace(/'d\b/g, ' would')
    .replace(/[“”"'`.,!?;:()[\]—–-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitTextIntoSentences(rawText: string): string[] {
  const cleaned = (rawText || '').trim();
  if (!cleaned) return [];

  const abbrevPattern =
    /\b(Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|No|Fig|Vol|vs|etc|e\.g|i\.e|a\.m|p\.m|U\.S|U\.K)\./gi;
  let protectedText = cleaned.replace(abbrevPattern, '$1\uE000');
  // Protect decimal numbers (e.g. 45.50) and numbered list markers (e.g. "1. ")
  protectedText = protectedText.replace(/(\d)\.(\d)/g, '$1\uE000$2');
  protectedText = protectedText.replace(/(^|\s)(\d{1,2})\.\s+/g, '$1$2\uE000 ');

  const lines = protectedText
    .split(/\r?\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const rawSentences: string[] = [];
  for (const line of lines) {
    const parts = line
      .split(/(?<=[.!?])\s+(?=[A-Z0-9“"'(\[])/)
      .map((s) => s.replace(/\uE000/g, '.').trim())
      .filter((s) => s.length > 0);
    rawSentences.push(...parts);
  }

  // Merge ultra-short micro-utterances (<= 2 words like "Yes.", "Right.") into next sentence
  const merged: string[] = [];
  for (let i = 0; i < rawSentences.length; i++) {
    const cur = rawSentences[i];
    const wordCount = cur.split(/\s+/).filter(Boolean).length;
    if (wordCount <= 2 && i + 1 < rawSentences.length) {
      rawSentences[i + 1] = `${cur} ${rawSentences[i + 1]}`;
    } else if (wordCount <= 2 && merged.length > 0) {
      merged[merged.length - 1] = `${merged[merged.length - 1]} ${cur}`;
    } else {
      merged.push(cur);
    }
  }
  return merged;
}

const NON_SPEAKER_LABELS =
  /^(Note|Tip|Part|Section|Question|Questions|Audio|Time|Date|Day|Price|Cost|Total|Address|Phone|Email|Hours|Opening hours|Fee|Example|Answer|Warning|Notice|Room|Number|Name|Location|Title|Step|Rule)$/i;

function splitInlineSpeakerTurns(
  rawText: string,
  fallbackSpeaker: string
): Array<{ speaker: string; text: string }> {
  const text = (rawText || '').trim();
  if (!text) return [];

  // Only treat Label: as speaker turn at start, newline, or right after sentence punctuation (.!?)
  const turnRegex = /(?:^|\n|(?<=[.!?])\s+)([A-Z][A-Za-z0-9 ._-]{1,20}):\s+/g;
  const matches: Array<{ speaker: string; index: number; bodyStart: number }> = [];
  let m: RegExpExecArray | null;
  while ((m = turnRegex.exec(text)) !== null) {
    const label = m[1].trim();
    if (!NON_SPEAKER_LABELS.test(label)) {
      matches.push({
        speaker: label,
        index: m.index,
        bodyStart: m.index + m[0].length,
      });
    }
  }

  if (matches.length >= 2 || (matches.length === 1 && matches[0].index === 0 && fallbackSpeaker.includes('/'))) {
    const turns: Array<{ speaker: string; text: string }> = [];
    for (let i = 0; i < matches.length; i++) {
      const end = i + 1 < matches.length ? matches[i + 1].index : text.length;
      const body = text.slice(matches[i].bodyStart, end).trim();
      if (body) {
        turns.push({ speaker: matches[i].speaker, text: body });
      }
    }
    if (turns.length > 0) return turns;
  }

  return [{ speaker: fallbackSpeaker, text }];
}

function hasCollapsedTimestamps(
  items: Array<{ startSec: number; endSec: number }>,
  durationHintSec = 0
): boolean {
  if (items.length <= 1) return false;
  const distinctStarts = new Set(items.map((s) => Math.round(s.startSec * 4))).size;
  const zeroStarts = items.filter((s) => s.startSec <= 0.05).length;
  let nonIncreasing = 0;
  for (let i = 1; i < items.length; i++) {
    if (items[i].startSec <= items[i - 1].startSec + 0.05) {
      nonIncreasing++;
    }
  }
  const maxEnd = Math.max(...items.map((s) => s.endSec));
  if (zeroStarts > 1) return true;
  if (distinctStarts <= Math.max(1, Math.floor(items.length * 0.5))) return true;
  if (nonIncreasing >= Math.max(1, Math.floor(items.length * 0.5))) return true;
  if (durationHintSec > 25 && maxEnd <= 10) return true;
  return false;
}

function ensureGranularSegments(
  inputSegments: Array<Partial<TranscriptSegment>>,
  durationHintSec = 0
): TranscriptSegment[] {
  const validRaw = inputSegments.filter((s) => (s.text || '').trim().length > 0);
  if (validRaw.length === 0) return [];

  const expanded: Array<{
    speaker: string;
    startSec: number;
    endSec: number;
    text: string;
    stressPattern?: string;
    intonationNote?: string;
    questionRef?: number;
  }> = [];

  for (let i = 0; i < validRaw.length; i++) {
    const seg = validRaw[i];
    const rawSpeaker = (seg.speaker || 'Speaker').trim() || 'Speaker';
    const segStart = Number.isFinite(seg.startSec) ? Math.max(0, Number(seg.startSec)) : i * 6;
    const segEnd =
      Number.isFinite(seg.endSec) && Number(seg.endSec) > segStart
        ? Number(seg.endSec)
        : segStart + 6;
    const segSpan = Math.max(2, segEnd - segStart);

    const turns = splitInlineSpeakerTurns(seg.text || '', rawSpeaker);
    const turnSentences: Array<{ speaker: string; text: string }> = [];

    for (const turn of turns) {
      const sents = splitTextIntoSentences(turn.text);
      if (sents.length > 1) {
        for (const sent of sents) {
          turnSentences.push({ speaker: turn.speaker, text: sent });
        }
      } else {
        turnSentences.push({ speaker: turn.speaker, text: turn.text.trim() });
      }
    }

    const totalWeight = Math.max(
      1,
      turnSentences.reduce((sum, item) => sum + Math.max(8, item.text.length), 0)
    );
    let cursor = segStart;
    turnSentences.forEach((item, subIdx) => {
      const weight = Math.max(8, item.text.length) / totalWeight;
      const subDur = segSpan * weight;
      const subStart = Number(cursor.toFixed(2));
      const subEnd =
        subIdx === turnSentences.length - 1
          ? Number(Math.max(subStart + 1.4, segEnd).toFixed(2))
          : Number((cursor + subDur).toFixed(2));
      cursor += subDur;

      expanded.push({
        speaker: item.speaker,
        startSec: subStart,
        endSec: subEnd,
        text: item.text,
        stressPattern: seg.stressPattern,
        intonationNote: seg.intonationNote,
        questionRef: seg.questionRef,
      });
    });
  }

  const collapsed = hasCollapsedTimestamps(expanded, durationHintSec);
  if (collapsed) {
    const totalWords = expanded.reduce(
      (sum, s) => sum + Math.max(1, s.text.split(/\s+/).filter(Boolean).length),
      0
    );
    const maxRawEnd = Math.max(...expanded.map((s) => s.endSec));
    const targetDuration = Math.max(
      Number(durationHintSec) || 0,
      maxRawEnd > 20 ? maxRawEnd : 0,
      Math.round(totalWords / 2.3),
      expanded.length * 3.8
    );
    const totalWeight = Math.max(
      1,
      expanded.reduce((sum, s) => sum + Math.max(10, s.text.length), 0)
    );
    let cursor = 0;
    for (let i = 0; i < expanded.length; i++) {
      const weight = Math.max(10, expanded[i].text.length) / totalWeight;
      const span = Math.max(1.8, targetDuration * weight);
      expanded[i].startSec = Number(cursor.toFixed(2));
      expanded[i].endSec = Number((cursor + span).toFixed(2));
      cursor += span;
    }
  } else {
    for (let i = 0; i < expanded.length; i++) {
      if (i > 0 && expanded[i].startSec < expanded[i - 1].startSec) {
        expanded[i].startSec = Number((expanded[i - 1].startSec + 0.5).toFixed(2));
      }
      expanded[i].endSec = Number(
        Math.max(expanded[i].startSec + 1.5, expanded[i].endSec).toFixed(2)
      );
    }
  }

  return expanded.map((s, idx) => ({
    id: `seg-${idx + 1}`,
    speaker: s.speaker,
    startSec: s.startSec,
    endSec: s.endSec,
    timestampLabel: formatTimestampLabel(s.startSec),
    text: s.text,
    stressPattern: s.stressPattern,
    intonationNote: s.intonationNote,
    questionRef: s.questionRef,
  }));
}

interface RawExtractedSentence {
  segmentIndex?: number;
  speaker?: string;
  startSec?: number;
  endSec?: number;
  sentence?: string;
  translationVi?: string;
  selectionReasonVi?: string;
  stressPattern?: string;
  connectedSpeechNote?: string;
  keyWordsCsv?: string;
}

function findBestMatchingSegmentIndex(
  sentenceText: string,
  segments: TranscriptSegment[],
  hintSegIdx: number,
  minPreferIdx: number
): number {
  if (segments.length === 0) return 0;
  const sentNorm = normalizeAlignText(sentenceText);
  if (!sentNorm) return Math.min(Math.max(0, hintSegIdx), segments.length - 1);

  const sentTokens = new Set(sentNorm.split(' ').filter((w) => w.length > 2));
  const prefix = sentNorm.slice(0, Math.min(22, sentNorm.length));
  const midStart = Math.floor(sentNorm.length * 0.35);
  const middle = sentNorm.slice(midStart, midStart + Math.min(22, sentNorm.length - midStart));

  let bestIdx = -1;
  let bestScore = -1;

  for (let i = 0; i < segments.length; i++) {
    const segNorm = normalizeAlignText(segments[i].text);
    if (!segNorm) continue;

    let score = 0;
    if (prefix.length >= 8 && segNorm.includes(prefix)) {
      score = 1.0;
    } else if (middle.length >= 8 && segNorm.includes(middle)) {
      score = 0.9;
    } else if (segNorm.length >= 10 && sentNorm.includes(segNorm)) {
      score = 0.85;
    } else if (sentTokens.size > 0) {
      const segTokens = new Set(segNorm.split(' ').filter((w) => w.length > 2));
      let overlap = 0;
      for (const tok of sentTokens) {
        if (segTokens.has(tok)) overlap++;
      }
      const denom = Math.max(1, Math.min(sentTokens.size, segTokens.size));
      score = overlap / denom;
    }

    if (i >= minPreferIdx) {
      score += 0.08;
    }
    if (i === hintSegIdx) {
      score += 0.05;
    }

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  if (bestIdx >= 0 && bestScore >= 0.42) {
    return bestIdx;
  }
  if (hintSegIdx >= 0 && hintSegIdx < segments.length) {
    return hintSegIdx;
  }
  return Math.min(minPreferIdx, segments.length - 1);
}

function alignClassroomDrills(
  rawSentences: RawExtractedSentence[],
  segments: TranscriptSegment[],
  durationHintSec: number,
  testId: string
): ClassroomDrillSentence[] {
  const granularSegments = ensureGranularSegments(segments, durationHintSec);
  const validRaw = rawSentences
    .filter((s) => (s.sentence || '').trim().split(/\s+/).filter(Boolean).length >= 3)
    .slice(0, 30);
  if (validRaw.length === 0) return [];

  const maxSegEnd =
    granularSegments.length > 0 ? Math.max(...granularSegments.map((s) => s.endSec)) : 0;
  const totalWords = validRaw.reduce(
    (sum, s) => sum + Math.max(1, (s.sentence || '').split(/\s+/).filter(Boolean).length),
    0
  );
  const effectiveDuration = Math.max(
    Number(durationHintSec) || 0,
    maxSegEnd,
    Math.round(totalWords / 2.2),
    validRaw.length * 3.5
  );

  // Check if Gemini provided valid, non-collapsed timestamps directly (e.g. from direct audio pass)
  const directValidCount = validRaw.filter(
    (s, idx) =>
      Number.isFinite(s.startSec) &&
      (idx === 0 ? Number(s.startSec) >= 0 : Number(s.startSec) > 0.25)
  ).length;
  const directDistinct = new Set(
    validRaw
      .filter((s) => Number.isFinite(s.startSec))
      .map((s) => Math.round(Number(s.startSec) * 4))
  ).size;
  const useDirectTimestamps =
    validRaw.length > 0 &&
    directValidCount >= Math.max(2, Math.floor(validRaw.length * 0.7)) &&
    directDistinct >= Math.max(2, Math.floor(validRaw.length * 0.7));

  let minPreferIdx = 0;
  const mapped = validRaw.map((s, idx) => {
    const sentenceText = (s.sentence || '').trim();
    const hintIdx =
      typeof s.segmentIndex === 'number' &&
      s.segmentIndex >= 0 &&
      s.segmentIndex < granularSegments.length
        ? s.segmentIndex
        : Math.min(idx, Math.max(0, granularSegments.length - 1));

    const matchedIdx =
      granularSegments.length > 0
        ? findBestMatchingSegmentIndex(sentenceText, granularSegments, hintIdx, minPreferIdx)
        : 0;
    if (matchedIdx >= minPreferIdx) {
      minPreferIdx = matchedIdx;
    }

    const parentSeg = granularSegments[matchedIdx];
    const estWords = Math.max(3, sentenceText.split(/\s+/).filter(Boolean).length);
    const estDur = Math.max(2.0, Number((estWords / 2.2).toFixed(2)));

    let startSec = 0;
    let endSec = estDur;

    if (useDirectTimestamps && Number.isFinite(s.startSec)) {
      startSec = Math.max(0, Number(s.startSec));
      endSec =
        Number.isFinite(s.endSec) && Number(s.endSec) > startSec
          ? Number(s.endSec)
          : Number((startSec + estDur).toFixed(2));
    } else if (parentSeg) {
      startSec = parentSeg.startSec;
      endSec = parentSeg.endSec;
      const segDuration = Math.max(1.5, parentSeg.endSec - parentSeg.startSec);
      const normSeg = normalizeAlignText(parentSeg.text);
      const normSent = normalizeAlignText(sentenceText);
      const sentWords = normSent.split(' ').filter(Boolean);
      const anchorStart = sentWords.slice(0, Math.min(3, sentWords.length)).join(' ');
      const anchorEnd = sentWords.slice(Math.max(0, sentWords.length - 3)).join(' ');

      let pos = anchorStart.length >= 4 ? normSeg.indexOf(anchorStart) : -1;
      if (pos < 0 && normSent.length >= 8) {
        pos = normSeg.indexOf(normSent.slice(0, Math.min(18, normSent.length)));
      }

      if (pos >= 0 && normSeg.length > 0) {
        const endPos =
          anchorEnd.length >= 4 ? normSeg.indexOf(anchorEnd, pos) : -1;
        const matchedEnd =
          endPos >= pos ? endPos + anchorEnd.length : pos + normSent.length;
        const startRatio = pos / normSeg.length;
        const endRatio = Math.min(1, matchedEnd / normSeg.length);
        startSec = Number((parentSeg.startSec + startRatio * segDuration).toFixed(2));
        endSec = Number(
          Math.max(startSec + 1.8, parentSeg.startSec + endRatio * segDuration).toFixed(2)
        );
      }
    }

    const rawSpeaker = (s.speaker || '').trim();
    const parentSpeaker = (parentSeg?.speaker || '').trim();
    const cleanSpeaker =
      rawSpeaker && rawSpeaker !== 'Speaker' && !rawSpeaker.includes('/')
        ? rawSpeaker
        : parentSpeaker && !parentSpeaker.includes('/')
          ? parentSpeaker
          : rawSpeaker || parentSpeaker || 'Speaker';

    return {
      idx,
      matchedIdx,
      speaker: cleanSpeaker,
      sentence: sentenceText,
      translationVi: s.translationVi || '',
      startSec,
      endSec,
      selectionReasonVi: s.selectionReasonVi || 'Câu trọng tâm giàu cấu trúc IELTS.',
      stressPattern: s.stressPattern || parentSeg?.stressPattern || '',
      connectedSpeechNote: s.connectedSpeechNote || parentSeg?.intonationNote || '',
      keyWords: (s.keyWordsCsv || '')
        .split(',')
        .map((k) => k.trim())
        .filter(Boolean)
        .slice(0, 4),
    };
  });

  // Anti-collapse & monotonicity enforcement: ensure no duplicate [00:00.00] or stalled timestamps
  if (hasCollapsedTimestamps(mapped, effectiveDuration)) {
    const totalWeight = Math.max(
      1,
      mapped.reduce((sum, item) => sum + Math.max(12, item.sentence.length), 0)
    );
    let cursor = 0;
    for (let i = 0; i < mapped.length; i++) {
      const span = Math.max(
        2.0,
        (Math.max(12, mapped[i].sentence.length) / totalWeight) * effectiveDuration
      );
      mapped[i].startSec = Number(cursor.toFixed(2));
      mapped[i].endSec = Number((cursor + span).toFixed(2));
      cursor += span;
    }
  } else {
    // Resolve local tie groups (e.g. 2-3 sentences extracted from the same segment)
    let i = 0;
    while (i < mapped.length) {
      let j = i;
      while (
        j + 1 < mapped.length &&
        Math.abs(mapped[j + 1].startSec - mapped[i].startSec) < 0.25
      ) {
        j++;
      }
      if (j > i) {
        const groupStart = mapped[i].startSec;
        const nextAnchor =
          j + 1 < mapped.length && mapped[j + 1].startSec > groupStart + 0.5
            ? mapped[j + 1].startSec
            : Math.max(
                mapped[i].endSec,
                groupStart + (j - i + 1) * 2.8,
                Math.min(effectiveDuration, groupStart + (j - i + 1) * 4.5)
              );
        const span = Math.max((j - i + 1) * 2.0, nextAnchor - groupStart);
        const groupWeight = Math.max(
          1,
          mapped.slice(i, j + 1).reduce((s, d) => s + Math.max(10, d.sentence.length), 0)
        );
        let cursor = groupStart;
        for (let k = i; k <= j; k++) {
          const sliceDur = (Math.max(10, mapped[k].sentence.length) / groupWeight) * span;
          mapped[k].startSec = Number(cursor.toFixed(2));
          mapped[k].endSec = Number((cursor + Math.max(1.8, sliceDur)).toFixed(2));
          cursor += sliceDur;
        }
      }
      i = j + 1;
    }

    // Final strict monotonicity guard
    for (let k = 0; k < mapped.length; k++) {
      if (k > 0 && mapped[k].startSec <= mapped[k - 1].startSec + 0.15) {
        mapped[k].startSec = Number((mapped[k - 1].startSec + 2.2).toFixed(2));
      }
      mapped[k].endSec = Number(Math.max(mapped[k].startSec + 1.8, mapped[k].endSec).toFixed(2));
    }
  }

  return mapped.map((item, idx) => ({
    id: `cd-${testId}-${idx + 1}`,
    order: idx + 1,
    speaker: item.speaker,
    sentence: item.sentence,
    translationVi: item.translationVi,
    startSec: item.startSec,
    endSec: item.endSec,
    timestampLabel: formatTimestampLabel(item.startSec),
    selectionReasonVi: item.selectionReasonVi,
    stressPattern: item.stressPattern,
    connectedSpeechNote: item.connectedSpeechNote,
    keyWords: item.keyWords,
  }));
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}

function normalizeAnswer(val: string): string {
  return val.trim().toLowerCase().replace(/\s+/g, ' ');
}

function classifyError(q: IeltsQuestion, userRaw: string): ErrorCategory {
  const user = normalizeAnswer(userRaw);
  const correct = normalizeAnswer(q.correctAnswer);
  if (!user) return 'Unanswered';

  // Word limit check
  if (q.wordLimitInstruction?.includes('ONE WORD') && user.split(' ').length > 1) {
    return 'WordLimit';
  }
  if (q.wordLimitInstruction?.includes('TWO WORDS') && user.split(' ').length > 2) {
    return 'WordLimit';
  }

  // Plural / Singular check
  if (
    user + 's' === correct ||
    user + 'es' === correct ||
    correct + 's' === user ||
    correct + 'es' === user
  ) {
    return 'Plural/Singular';
  }

  // Numeric / Unit check
  if (/\d/.test(correct) || q.errorCategoryHint === 'Unit') {
    const userDigits = user.replace(/[^\d.]/g, '');
    const correctDigits = correct.replace(/[^\d.]/g, '');
    if (userDigits && correctDigits && userDigits === correctDigits && user !== correct) {
      return 'Unit';
    }
    if (q.errorCategoryHint === 'Unit' && /\d/.test(user)) {
      return 'Unit';
    }
  }

  // Spelling check (close Levenshtein distance on completion items)
  if (q.type === 'completion' && levenshtein(user, correct) <= 2) {
    return 'Spelling';
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

const MASTERMIND_SYSTEM_INSTRUCTION = `Bạn là một Chuyên gia Công nghệ Giáo dục (EdTech) cấp cao, chuyên về thiết kế hệ thống luyện thi IELTS Listening kỹ thuật số (AI IELTS Listening Mastermind & Tech-Pedagogy Architect).
Phong cách: Chuyên nghiệp, chính xác, phân tích sâu sắc và mang tính kiến tạo như một huấn luyện viên dữ liệu (Data Coach).
Sử dụng thuật ngữ chuyên môn IELTS chuẩn xác (Distractors, Signposting language, Lexical resource, Paraphrasing, Connected speech).`;

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB per file
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  // Saved custom tests & uploaded files persistence endpoints
  app.get('/api/ielts/tests', (_req: Request, res: Response) => {
    res.json({ tests: loadSavedTests() });
  });

  app.put('/api/ielts/tests/:id', (req: Request, res: Response) => {
    const { testPack } = req.body as { testPack?: ListeningTestPack };
    if (!testPack || !testPack.id) {
      res.status(400).json({ error: 'Thiếu dữ liệu bài nghe để lưu.' });
      return;
    }
    upsertSavedTest(testPack);
    res.json({ ok: true, testPack });
  });

  app.delete('/api/ielts/tests/:id', (req: Request, res: Response) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const deleted = deleteSavedTest(id);
    res.json({ ok: true, deleted });
  });

  // Two-way sync endpoint for custom tests + media from any client machine
  const syncMediaMiddleware = upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'pdf', maxCount: 1 },
  ]);

  app.post('/api/ielts/sync-test', syncMediaMiddleware, (req: Request, res: Response) => {
    try {
      const raw = req.body.testPack;
      if (!raw) {
        res.status(400).json({ error: 'Thiếu thông tin testPack.' });
        return;
      }
      const testPack: ListeningTestPack = typeof raw === 'string' ? JSON.parse(raw) : raw;
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const audioFile = files?.audio?.[0];
      const pdfFile = files?.pdf?.[0];

      if (audioFile) {
        const { streamMime } = normalizeAudioMimeType(audioFile.mimetype, audioFile.originalname);
        const audioId = saveAudioBuffer(audioFile.buffer, streamMime, audioFile.originalname);
        testPack.audioUrl = `/api/ielts/audio/${audioId}`;
        testPack.audioFileName = audioFile.originalname;
      }

      if (pdfFile) {
        const pdfId = savePdfBuffer(pdfFile.buffer, pdfFile.originalname);
        testPack.pdfUrl = `/api/ielts/pdf/${pdfId}`;
        testPack.pdfFileName = pdfFile.originalname;
      }

      upsertSavedTest(testPack);
      res.json({ ok: true, testPack });
    } catch (err: unknown) {
      console.error('[sync-test] Error:', err);
      res.status(500).json({ error: 'Không thể đồng bộ đề thi lên máy chủ.' });
    }
  });

  // Stream stored original PDF file
  app.get('/api/ielts/pdf/:id', (req: Request, res: Response) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const stored = getStoredPdf(id);
    if (!stored) {
      res.status(404).json({ error: 'Không tìm thấy tệp PDF đã lưu.' });
      return;
    }
    const disposition = req.query.download === '1' ? 'attachment' : 'inline';
    const safeName = encodeURIComponent(stored.originalName || 'ielts-exam.pdf');
    res.writeHead(200, {
      'Content-Type': 'application/pdf',
      'Content-Length': stored.buffer.length,
      'Content-Disposition': `${disposition}; filename*=UTF-8''${safeName}`,
    });
    res.end(stored.buffer);
  });

  // Stream stored audio with HTTP Range support so HTML5 <audio> scrubbing works reliably (RAM + disk)
  app.get('/api/ielts/audio/:id', (req: Request, res: Response) => {
    const rawId = req.params.id;
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const stored = getStoredAudio(id);
    if (!stored) {
      res.status(404).json({ error: 'Audio file not found or expired.' });
      return;
    }

    const total = stored.buffer.length;
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${total}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': stored.mimeType,
      });
      res.end(stored.buffer.subarray(start, end + 1));
      return;
    }

    res.writeHead(200, {
      'Content-Length': total,
      'Accept-Ranges': 'bytes',
      'Content-Type': stored.mimeType,
    });
    res.end(stored.buffer);
  });

  // Synthesize authentic IELTS WAV audio from segments using Gemini 3.8 TTS
  app.post('/api/ielts/synthesize-audio', async (req: Request, res: Response) => {
    try {
      const { testId, segments, speakers } = req.body as {
        testId?: string;
        segments: ListeningTestPack['segments'];
        speakers: ListeningTestPack['speakers'];
      };

      if (!Array.isArray(segments) || segments.length === 0) {
        res.status(400).json({ error: 'Segments are required to synthesize audio.' });
        return;
      }

      const ai = getAiClient('v1beta');
      const distinctSpeakers = Array.isArray(speakers) ? speakers : [];
      let base64Audio: string | undefined;

      if (distinctSpeakers.length === 2) {
        const s1 = distinctSpeakers[0];
        const s2 = distinctSpeakers[1];
        const parts = segments.map((seg) => {
          const matched = distinctSpeakers.find(
            (sp) => sp.name.toLowerCase() === seg.speaker.toLowerCase()
          );
          const speakerName = matched ? matched.name : s1.name;
          return {
            text: `${speakerName}: ${seg.text}`,
            speechMetadata: {
              speaker: speakerName,
              style: matched?.style || 'Clear, natural British IELTS listening accent',
            },
          };
        });

        const ttsRes = await ai.models.generateContent({
          model: 'gemini-3.8-flash-tts',
          contents: [{ role: 'user', parts }],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              multiSpeakerVoiceConfig: {
                speakerVoiceConfigs: [
                  {
                    speaker: s1.name,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: s1.voice || 'Kore' } },
                  },
                  {
                    speaker: s2.name,
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: s2.voice || 'Puck' } },
                  },
                ],
              },
            },
          },
        });

        base64Audio = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      } else {
        const singleSpeaker = distinctSpeakers[0];
        const combinedText = segments.map((seg) => seg.text).join(' ');
        const ttsRes = await ai.models.generateContent({
          model: 'gemini-3.8-flash-lite-tts',
          contents: [
            {
              role: 'user',
              parts: [
                {
                  text: combinedText,
                  speechMetadata: {
                    style:
                      singleSpeaker?.style ||
                      'Clear, articulate British academic IELTS lecturer',
                  },
                },
              ],
            },
          ],
          config: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: singleSpeaker?.voice || 'Fenrir' },
              },
            },
          },
        });

        base64Audio = ttsRes.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      }

      if (!base64Audio) {
        res.status(502).json({ error: 'Gemini TTS did not return audio data.' });
        return;
      }

      const wavBuffer = Buffer.from(base64Audio, 'base64');
      // Calculate exact WAV duration from RIFF PCM data bytes (24kHz, mono, 16-bit = 48000 bytes/sec)
      const dataBytes = Math.max(0, wavBuffer.length - 44);
      const actualDurationSec = Number((dataBytes / 48000).toFixed(2)) || 60;

      // Proportionally realign segment start/end times to match the generated WAV duration
      const totalChars = segments.reduce((sum, s) => sum + Math.max(1, s.text.length), 0);
      let cursor = 0;
      const alignedSegments = segments.map((seg) => {
        const proportion = Math.max(1, seg.text.length) / totalChars;
        const segDuration = proportion * actualDurationSec;
        const startSec = Number(cursor.toFixed(2));
        const endSec = Number(Math.min(actualDurationSec, cursor + segDuration).toFixed(2));
        cursor = endSec;
        return {
          ...seg,
          startSec,
          endSec,
          timestampLabel: formatTimestampLabel(startSec),
        };
      });

      const audioId = saveAudioBuffer(wavBuffer, 'audio/wav', `${testId || 'ielts'}.wav`);
      const audioUrl = `/api/ielts/audio/${audioId}`;
      if (testId) {
        const saved = loadSavedTests().find((t) => t.id === testId);
        if (saved) {
          upsertSavedTest({
            ...saved,
            audioUrl,
            durationSec: actualDurationSec,
            segments: alignedSegments,
          });
        }
      }
      res.json({
        audioUrl,
        durationSec: actualDurationSec,
        alignedSegments,
      });
    } catch (err: unknown) {
      const message = formatGeminiError(err);
      console.error('TTS error:', err);
      res.status(500).json({ error: message });
    }
  });

  interface IngestInput {
    audioFile?: Express.Multer.File;
    pdfFile?: Express.Multer.File;
    rawText: string;
    customTitle: string;
    partLabel: string;
    apiKey?: string;
    onProgress?: (stepLabel: string, progressPercent: number) => void;
  }

  async function runIngestPipeline({
    audioFile,
    pdfFile,
    rawText,
    customTitle,
    partLabel,
    apiKey,
    onProgress,
  }: IngestInput): Promise<ListeningTestPack> {
    const cleanupFiles: string[] = [];
    let ai: GoogleGenAI | null = null;
    try {
      console.log(
        `[ingest] start audio=${audioFile ? `${audioFile.originalname} (${audioFile.size}B)` : 'none'} pdf=${pdfFile ? `${pdfFile.originalname} (${pdfFile.size}B)` : 'none'} rawText=${rawText.length}chars`
      );

      ai = getAiClient(apiKey);
      let audioUrl: string | undefined;
      let audioFileName: string | undefined;
      let pdfUrl: string | undefined;
      let pdfFileName: string | undefined;
      let transcribedSegments: Array<{
        speaker: string;
        startSec: number;
        endSec: number;
        text: string;
      }> = [];
      let transcribedText = '';

      let audioPart: GeminiPart | null = null;

      // Always save PDF on disk right away if provided so original exam file is preserved
      if (pdfFile) {
        pdfFileName = pdfFile.originalname || 'exam.pdf';
        const pdfId = savePdfBuffer(pdfFile.buffer, pdfFileName);
        pdfUrl = `/api/ielts/pdf/${pdfId}`;
      }

      // Step 1: Always store audio to RAM + disk and transcribe every single sentence with exact audio timestamps
      if (audioFile) {
        onProgress?.('Đang lưu Audio & tách lời thoại theo từng câu...', 25);
          const { streamMime, geminiMime } = normalizeAudioMimeType(
            audioFile.mimetype,
            audioFile.originalname
          );
          audioFileName = audioFile.originalname || 'audio.mp3';
          const audioId = saveAudioBuffer(audioFile.buffer, streamMime, audioFileName);
          audioUrl = `/api/ielts/audio/${audioId}`;

          audioPart = await buildGeminiMediaPart(
            ai,
            audioFile.buffer,
            geminiMime,
            audioFile.originalname,
            cleanupFiles
          );

          try {
            const trRes = await generateWithFallback(ai, {
              model: 'gemini-2.5-flash',
              contents: {
                parts: [
                  audioPart,
                  {
                    text: 'Listen to the entire audio carefully and transcribe EVERY single spoken sentence chronologically (up to 45 sentences — NEVER merge 2 complete sentences or 2 speakers into one item). If there is silence or a narrator intro before dialogue starts, startSec MUST reflect the real elapsed seconds (do NOT set every startSec to 0). Each item MUST have exactly ONE speaker name (e.g. "Agent" or "Emma", NEVER "Agent/Emma"), exact startSec and endSec to 0.1s precision, and verbatim English text.',
                  },
                ],
              },
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    segments: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          speaker: { type: Type.STRING },
                          startSec: { type: Type.NUMBER },
                          endSec: { type: Type.NUMBER },
                          text: { type: Type.STRING },
                        },
                      },
                    },
                  },
                },
              },
            });
            const trParsed = safeParseModelJson<{
              segments?: { speaker?: string; startSec?: number; endSec?: number; text?: string }[];
            }>(trRes.text);
            transcribedSegments = (trParsed?.segments || [])
              .filter((s) => (s.text || '').trim().length > 0)
              .map((s, idx) => {
                const startSec = Number.isFinite(s.startSec) ? Number(s.startSec) : idx * 6;
                const endSec =
                  Number.isFinite(s.endSec) && Number(s.endSec) > startSec
                    ? Number(s.endSec)
                    : startSec + 6;
                return {
                  speaker: (s.speaker || 'Speaker').trim(),
                  startSec,
                  endSec,
                  text: (s.text || '').trim(),
                };
              });
            if (transcribedSegments.length === 0) {
              console.warn(
                `[ingest] Step 1 JSON segments empty (finishReason=${trRes.candidates?.[0]?.finishReason || 'unknown'})`
              );
            }
          } catch (trErr) {
            console.warn('[ingest] Step 1 JSON transcription warning:', trErr);
          }

          // Fallback plain-text transcription if structured audio JSON returned empty
          if (transcribedSegments.length === 0) {
            try {
              const plainTr = await generateWithFallback(ai, {
                model: 'gemini-2.5-flash',
                contents: {
                  parts: [
                    audioPart,
                    {
                      text: 'Transcribe all spoken English words from this audio line by line in the format "[00:00] Speaker: sentence". Do not summarize.',
                    },
                  ],
                },
                config: {
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                },
              });
              const lines = (plainTr.text || '')
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l.length > 3);
              transcribedSegments = lines.slice(0, 24).map((line, idx) => {
                const m = line.match(/^\[?(\d{1,2}):(\d{2})(?:\.\d+)?\]?\s*(?:([^:]{1,30}):)?\s*(.+)$/);
                if (m) {
                  const startSec = Number(m[1]) * 60 + Number(m[2]);
                  return {
                    speaker: (m[3] || 'Speaker').trim(),
                    startSec,
                    endSec: startSec + 6,
                    text: m[4].trim(),
                  };
                }
                return {
                  speaker: 'Speaker',
                  startSec: idx * 6,
                  endSec: idx * 6 + 6,
                  text: line,
                };
              });
            } catch (plainErr) {
              console.warn('[ingest] Step 1 plain-text fallback warning:', plainErr);
            }
          }

          transcribedText = transcribedSegments
            .map((s) => `${formatTimestampLabel(s.startSec)} ${s.speaker}: ${s.text}`)
            .join('\n');
          console.log(`[ingest] Step 1 audio segments=${transcribedSegments.length}`);
        }

        // Step 2A: Core extraction (segments + questions + metadata) with lean schema & LOW thinking
        onProgress?.(
          pdfFile
            ? 'Đang đọc đề PDF (OCR) & đối chiếu câu hỏi với Audio...'
            : 'Đang cấu trúc câu hỏi & đáp án IELTS chuẩn IDP...',
          55
        );
        const coreParts: GeminiPart[] = [];
        if (audioPart && transcribedSegments.length === 0) {
          coreParts.push(audioPart);
        }
        let pdfPart: GeminiPart | null = null;
        if (pdfFile) {
          pdfPart = await buildGeminiMediaPart(
            ai,
            pdfFile.buffer,
            'application/pdf',
            pdfFile.originalname || 'exam.pdf',
            cleanupFiles
          );
          coreParts.push(pdfPart);
        }

        const needSegmentsFromStep2 = transcribedSegments.length === 0;
        const coreInstruction = `Hãy đóng vai AI IELTS Listening Mastermind & Tech-Pedagogy Architect.
Nhiệm vụ: Đọc kỹ tất cả tài liệu đầu vào (tệp PDF đề thi — kể cả PDF dạng ảnh scan cần OCR trực quan, transcript từ Audio, hoặc văn bản thô) để trích xuất ĐẦY ĐỦ câu hỏi và cấu trúc bài thi IELTS Listening đồng bộ hóa.

Thông tin bổ sung:
- Tiêu đề gợi ý: ${customTitle || 'Tự động đặt tiêu đề chuẩn học thuật từ nội dung'}
- Phần thi: ${partLabel}
${transcribedText ? `\n--- TRANSCRIPT TỪ AUDIO ---\n${transcribedText}\n` : ''}
${rawText ? `\n--- VĂN BẢN ĐỀ THI / SCRIPT NGƯỜI DÙNG CUNG CẤP ---\n${rawText}\n` : ''}

Yêu cầu kỹ thuật (QUAN TRỌNG — BẮT BUỘC phải trả về mảng "questions" không rỗng):
1. "questions" (ƯU TIÊN CAO NHẤT): Trích xuất từ PDF/văn bản toàn bộ câu hỏi chính thuộc ${partLabel} (tối đa 15 câu; dạng "completion", "mcq" hoặc "matching"). Nếu chỉ có Audio/Transcript mà chưa có PDF câu hỏi, hãy tự thiết kế 6–8 câu hỏi IELTS Listening chuẩn IDP/BC bám sát nội dung bài nghe.
2. Với mỗi câu hỏi trong "questions":
   - number, type ("completion" | "mcq" | "matching"), prompt (nội dung câu hỏi rõ ràng, giữ dấu ____ cho ô trống), contextBefore, contextAfter, wordLimitInstruction.
   - Nếu là trắc nghiệm ("mcq") hoặc có danh sách lựa chọn, điền options [{ key: "A", text: "..." }, ...].
   - Đối chiếu với Audio Transcript/PDF để điền "correctAnswer" chính xác (nếu PDF không kèm đáp án, hãy suy luận đáp án hợp lý nhất từ transcript/ngữ cảnh, KHÔNG được bỏ qua câu hỏi).
   - Điền timestampSec, timestampLabel "[mm:ss.xx]", paraphraseQuestion, paraphraseTranscript, distractorType, distractorDetail (tiếng Việt), transcriptQuote, explanationVi (giải thích cụ thể bằng tiếng Việt VÌ SAO đáp án đúng và các bẫy bị loại), errorCategoryHint ("Spelling" | "Plural/Singular" | "Unit" | "Distractor" | "WordLimit").
${needSegmentsFromStep2 ? '3. "segments": Tách lời thoại/script từ PDF hoặc văn bản thành TỪNG CÂU ĐƠN / LƯỢT THOẠI RIÊNG BIỆT theo trình tự thời gian (tối đa 45 câu, mỗi câu 1 người nói duy nhất).' : '3. "segments": Có thể bỏ trống mảng này vì đã có Transcript từ Audio ở trên.'}`;

        let parsed: Partial<ListeningTestPack> | null = null;

        const questionItemSchema = {
          type: Type.OBJECT,
          properties: {
            number: { type: Type.INTEGER },
            type: { type: Type.STRING },
            prompt: { type: Type.STRING },
            contextBefore: { type: Type.STRING },
            contextAfter: { type: Type.STRING },
            wordLimitInstruction: { type: Type.STRING },
            options: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  key: { type: Type.STRING },
                  text: { type: Type.STRING },
                },
              },
            },
            correctAnswer: { type: Type.STRING },
            acceptedVariants: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            timestampSec: { type: Type.NUMBER },
            timestampLabel: { type: Type.STRING },
            paraphraseQuestion: { type: Type.STRING },
            paraphraseTranscript: { type: Type.STRING },
            distractorType: { type: Type.STRING },
            distractorDetail: { type: Type.STRING },
            transcriptQuote: { type: Type.STRING },
            explanationVi: { type: Type.STRING },
            errorCategoryHint: { type: Type.STRING },
          },
        };

        try {
          const schemaProps: Record<string, unknown> = {
            title: { type: Type.STRING },
            partLabel: { type: Type.STRING },
            topic: { type: Type.STRING },
            bandTarget: { type: Type.STRING },
            durationSec: { type: Type.NUMBER },
            speakers: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  name: { type: Type.STRING },
                  voice: { type: Type.STRING },
                  style: { type: Type.STRING },
                },
              },
            },
            questions: {
              type: Type.ARRAY,
              items: questionItemSchema,
            },
          };

          if (needSegmentsFromStep2) {
            schemaProps.segments = {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING },
                  speaker: { type: Type.STRING },
                  startSec: { type: Type.NUMBER },
                  endSec: { type: Type.NUMBER },
                  timestampLabel: { type: Type.STRING },
                  text: { type: Type.STRING },
                  stressPattern: { type: Type.STRING },
                  intonationNote: { type: Type.STRING },
                  questionRef: { type: Type.INTEGER },
                },
              },
            };
          }

          const structRes = await generateWithFallback(ai, {
            model: 'gemini-2.5-flash',
            contents: { parts: [...coreParts, { text: coreInstruction }] },
            config: {
              systemInstruction: MASTERMIND_SYSTEM_INSTRUCTION,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: schemaProps,
              },
            },
          });

          parsed = safeParseModelJson<Partial<ListeningTestPack>>(structRes.text);
          console.log(
            `[ingest] Step 2A finishReason=${structRes.candidates?.[0]?.finishReason || 'unknown'} questions=${parsed?.questions?.length ?? 0} segments=${parsed?.segments?.length ?? 0}`
          );
        } catch (step2Err) {
          console.warn('[ingest] Step 2A core schema warning:', step2Err);
        }

        // Step 2A Fallback: If questions are missing (even if segments existed!), run a dedicated OCR/JSON pass
        const hasExtractedQuestions =
          parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0;

        if (!hasExtractedQuestions && (pdfPart || rawText || transcribedText)) {
          console.log('[ingest] Triggering dedicated question OCR/JSON fallback pass...');
          try {
            const fallbackPrompt = `Perform careful visual OCR on any attached PDF exam pages and read all provided transcript/text.
Return ONLY valid JSON (no markdown fences) extracting ALL exam questions (or designing 6 IELTS Listening questions if inputs have no printed questions):
{
  "title": "${parsed?.title || customTitle || 'IELTS Listening Custom Practice'}",
  "partLabel": "${partLabel}",
  "topic": "${parsed?.topic || 'IELTS Listening Practice'}",
  "questions": [
    {
      "number": 1,
      "type": "completion",
      "prompt": "question text with ____",
      "contextBefore": "",
      "contextAfter": "",
      "wordLimitInstruction": "ONE WORD AND/OR A NUMBER",
      "options": [],
      "correctAnswer": "answer",
      "timestampSec": 0,
      "transcriptQuote": "exact quote from audio if available",
      "explanationVi": "Giải thích ngắn gọn bằng tiếng Việt vì sao chọn đáp án này"
    }
  ]${needSegmentsFromStep2 ? ',\n  "segments": [{"speaker":"Speaker","startSec":0,"endSec":6,"text":"..."}]' : ''}
}
${transcribedText ? `\nAudio Transcript:\n${transcribedText}\n` : ''}
${rawText ? `\nRaw Input Text:\n${rawText}\n` : ''}
IMPORTANT: Do NOT leave "questions" empty. Extract up to 15 questions (or generate 6 IELTS Listening questions if only audio/script exists).`;

            const fbRes = await generateWithFallback(ai, {
              model: 'gemini-2.5-flash',
              contents: { parts: [...coreParts, { text: fallbackPrompt }] },
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseMimeType: 'application/json',
              },
            });
            const fbParsed = safeParseModelJson<Partial<ListeningTestPack>>(fbRes.text);
            if (fbParsed) {
              parsed = {
                ...parsed,
                ...fbParsed,
                segments:
                  Array.isArray(parsed?.segments) && parsed.segments.length > 0
                    ? parsed.segments
                    : fbParsed.segments,
              };
            }
            console.log(
              `[ingest] Fallback pass questions=${parsed?.questions?.length ?? 0} segments=${parsed?.segments?.length ?? 0}`
            );
          } catch (fbErr) {
            console.warn('[ingest] Fallback pass warning:', fbErr);
          }
        }

        // Preserve high-granularity audio timestamps from Step 1 if Step 2A collapsed or coarsened them
        const parsedSegs = Array.isArray(parsed?.segments) ? parsed.segments : [];
        const parsedHintDur = Number.isFinite(parsed?.durationSec) ? Number(parsed?.durationSec) : 0;
        const step1Granular = ensureGranularSegments(transcribedSegments, parsedHintDur);
        const step2Granular = ensureGranularSegments(parsedSegs, parsedHintDur);

        const step2Collapsed =
          parsedSegs.length === 0 ||
          hasCollapsedTimestamps(
            parsedSegs.map((s, idx) => ({
              startSec: Number.isFinite(s.startSec) ? Number(s.startSec) : idx * 6,
              endSec: Number.isFinite(s.endSec) ? Number(s.endSec) : idx * 6 + 6,
            })),
            parsedHintDur
          ) ||
          (step1Granular.length > 0 && step2Granular.length < Math.floor(step1Granular.length * 0.7));

        const normalizedSegments =
          step1Granular.length > 0 && (audioFile ? step2Collapsed : step2Granular.length === 0)
            ? step1Granular
            : step2Granular.length > 0
              ? step2Granular
              : step1Granular;

        // If we have transcript segments or PDF but STILL 0 questions, synthesize 6 questions reliably
        let rawQuestions = Array.isArray(parsed?.questions) ? parsed.questions : [];
        if (rawQuestions.length === 0 && (normalizedSegments.length > 0 || pdfPart)) {
          console.log('[ingest] Generating questions from extracted content...');
          try {
            const genParts: GeminiPart[] = pdfPart ? [pdfPart] : [];
            genParts.push({
              text: `Từ nội dung bài nghe IELTS Listening (${partLabel}) sau, hãy trích xuất hoặc thiết kế 6–8 câu hỏi chuẩn IELTS Listening gồm điền từ ("completion") và trắc nghiệm ("mcq"), kèm đáp án chính xác và giải thích tiếng Việt:\n\n${normalizedSegments
                .map((s) => `${s.timestampLabel} ${s.speaker}: ${s.text}`)
                .join('\n')}`,
            });
            const qGenRes = await generateWithFallback(ai, {
              model: 'gemini-2.5-flash',
              contents: { parts: genParts },
              config: {
                thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    questions: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          number: { type: Type.INTEGER },
                          type: { type: Type.STRING },
                          prompt: { type: Type.STRING },
                          options: {
                            type: Type.ARRAY,
                            items: {
                              type: Type.OBJECT,
                              properties: {
                                key: { type: Type.STRING },
                                text: { type: Type.STRING },
                              },
                            },
                          },
                          correctAnswer: { type: Type.STRING },
                          timestampSec: { type: Type.NUMBER },
                          paraphraseQuestion: { type: Type.STRING },
                          paraphraseTranscript: { type: Type.STRING },
                          distractorType: { type: Type.STRING },
                          distractorDetail: { type: Type.STRING },
                          transcriptQuote: { type: Type.STRING },
                          explanationVi: { type: Type.STRING },
                        },
                      },
                    },
                  },
                },
              },
            });
            const qGenParsed = safeParseModelJson<{ questions?: Partial<IeltsQuestion>[] }>(qGenRes.text);
            if (Array.isArray(qGenParsed?.questions) && qGenParsed.questions.length > 0) {
              rawQuestions = qGenParsed.questions as IeltsQuestion[];
            }
          } catch (qGenErr) {
            console.warn('[ingest] Question generation from segments warning:', qGenErr);
          }
        }

        if (rawQuestions.length === 0 && normalizedSegments.length === 0) {
          throw new Error(
            'Không trích xuất được câu hỏi hoặc nội dung từ tệp đã tải lên. Hãy chắc chắn PDF không bị khóa mật khẩu/hỏng và tệp Audio có lời thoại rõ ràng.'
          );
        }

        // Step 2B: Fast text-only enrichment for Vocabulary & Intensive Drills (non-blocking)
        onProgress?.('Đang trích xuất từ vựng AWL & tạo bài tập nghe chép...', 82);
        let enrichedVocab = Array.isArray(parsed?.vocabulary) ? parsed.vocabulary : [];
        let enrichedDrills = Array.isArray(parsed?.intensiveDrills) ? parsed.intensiveDrills : [];

        if (enrichedVocab.length === 0 || enrichedDrills.length === 0) {
          try {
            const contextSnippet = [
              ...normalizedSegments.slice(0, 12).map((s) => `${s.timestampLabel} ${s.text}`),
              ...rawQuestions.slice(0, 8).map((q) => `Q${q.number}: ${q.prompt} (${q.correctAnswer || ''})`),
            ].join('\n');

            if (contextSnippet.trim()) {
              const enrichRes = await generateWithFallback(ai, {
                model: 'gemini-2.5-flash',
                contents: `Từ nội dung bài nghe IELTS sau, hãy trích xuất:
1. "vocabulary": 5–6 từ vựng học thuật/từ khóa quan trọng kèm IPA, pos, definitionVi, contextualMeaningVi (nghĩa tiếng Việt sát ngữ cảnh bài), definitionEn, exampleInAudio, exampleTranslationVi, timestampSec, isAwl=true.
2. "intensiveDrills": 2 câu luyện nghe chép chuyên sâu từ bài kèm sentenceWithBlanks (dùng ___), missingPhrases ([{ answer, hintContext, letterMask }]), connectedSpeechNote, startSec, endSec.

--- NỘI DUNG ---
${contextSnippet}`,
                config: {
                  thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      vocabulary: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            word: { type: Type.STRING },
                            ipa: { type: Type.STRING },
                            pos: { type: Type.STRING },
                            definitionVi: { type: Type.STRING },
                            contextualMeaningVi: { type: Type.STRING },
                            definitionEn: { type: Type.STRING },
                            exampleInAudio: { type: Type.STRING },
                            exampleTranslationVi: { type: Type.STRING },
                            timestampSec: { type: Type.NUMBER },
                            isAwl: { type: Type.BOOLEAN },
                          },
                        },
                      },
                      intensiveDrills: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            startSec: { type: Type.NUMBER },
                            endSec: { type: Type.NUMBER },
                            sentenceWithBlanks: { type: Type.STRING },
                            missingPhrases: {
                              type: Type.ARRAY,
                              items: {
                                type: Type.OBJECT,
                                properties: {
                                  answer: { type: Type.STRING },
                                  hintContext: { type: Type.STRING },
                                  letterMask: { type: Type.STRING },
                                },
                              },
                            },
                            connectedSpeechNote: { type: Type.STRING },
                          },
                        },
                      },
                    },
                  },
                },
              });
              const enrichParsed = safeParseModelJson<Partial<ListeningTestPack>>(enrichRes.text);
              if (enrichedVocab.length === 0 && Array.isArray(enrichParsed?.vocabulary)) {
                enrichedVocab = enrichParsed.vocabulary;
              }
              if (enrichedDrills.length === 0 && Array.isArray(enrichParsed?.intensiveDrills)) {
                enrichedDrills = enrichParsed.intensiveDrills;
              }
            }
          } catch (enrichErr) {
            console.warn('[ingest] Step 2B enrichment skipped:', enrichErr);
          }
        }

        const allowedVoices = new Set(['Puck', 'Kore', 'Charon', 'Fenrir', 'Zephyr']);
        const computedDuration =
          parsed?.durationSec && parsed.durationSec > 0
            ? Math.max(
                parsed.durationSec,
                normalizedSegments.length > 0
                  ? Math.max(...normalizedSegments.map((s) => s.endSec))
                  : 0
              )
            : normalizedSegments.length > 0
              ? Math.max(...normalizedSegments.map((s) => s.endSec))
              : 90;

        const provisionalTestId = `custom-${crypto.randomUUID().slice(0, 8)}`;

        // Non-blocking Classroom Drills extraction (12 separated sentences with real timestamps)
        let initialClassroomDrills: ClassroomDrillSentence[] = [];
        if (normalizedSegments.length > 0) {
          onProgress?.('Đang tách 12 câu luyện Dictation & Shadowing theo từng câu...', 91);
          try {
            const drillRes = await extractClassroomDrillsWithAi({
              ai,
              testPack: {
                id: provisionalTestId,
                title: parsed?.title || customTitle || 'Custom IELTS Listening Pack',
                partLabel: parsed?.partLabel || partLabel,
                durationSec: computedDuration,
                audioUrl,
                segments: normalizedSegments,
              },
              targetCount: 12,
              existingAudioPart: audioPart || undefined,
              cleanupFiles,
            });
            initialClassroomDrills = drillRes.classroomDrills;
          } catch (drillErr) {
            console.warn('[ingest] Classroom drills pre-extraction skipped:', drillErr);
          }
        }

        const testPack: ListeningTestPack = {
          id: provisionalTestId,
          title: parsed?.title || customTitle || 'Custom IELTS Listening Pack',
          partLabel: parsed?.partLabel || partLabel,
          topic: parsed?.topic || 'IELTS Listening Practice',
          bandTarget: parsed?.bandTarget || 'Band 7.0+',
          durationSec: computedDuration,
          audioUrl,
          audioFileName,
          pdfUrl,
          pdfFileName,
          createdAt: new Date().toISOString(),
          isCustomUpload: true,
          speakers: (parsed?.speakers || []).slice(0, 2).map((sp, idx) => ({
            name: sp.name || `Speaker ${idx + 1}`,
            voice: allowedVoices.has(sp.voice)
              ? (sp.voice as 'Puck' | 'Kore' | 'Charon' | 'Fenrir' | 'Zephyr')
              : idx === 0
                ? 'Kore'
                : 'Puck',
            style: sp.style || 'Clear IELTS speaker',
          })),
          segments: normalizedSegments,
          questions: rawQuestions.map((q, idx) => {
            const ts = Number.isFinite(q.timestampSec) ? Number(q.timestampSec) : 0;
            const validOptions = Array.isArray(q.options)
              ? q.options.filter((o) => o && (o.key || o.text))
              : [];
            const resolvedType =
              q.type === 'mcq' && validOptions.length > 0
                ? 'mcq'
                : q.type === 'matching' && validOptions.length > 0
                  ? 'matching'
                  : 'completion';
            const fallbackPrompt = [q.contextBefore, '____', q.contextAfter]
              .filter(Boolean)
              .join(' ')
              .trim();
            return {
              ...q,
              number: q.number || idx + 1,
              type: resolvedType,
              prompt: (q.prompt || '').trim() || fallbackPrompt || `Question ${idx + 1}`,
              options: validOptions,
              correctAnswer: q.correctAnswer || '',
              timestampSec: ts,
              timestampLabel: q.timestampLabel || formatTimestampLabel(ts),
              paraphraseQuestion: q.paraphraseQuestion || '',
              paraphraseTranscript: q.paraphraseTranscript || '',
              distractorType: q.distractorType || 'None',
              distractorDetail: q.distractorDetail || '',
              transcriptQuote: q.transcriptQuote || '',
              explanationVi: q.explanationVi || '',
              errorCategoryHint: (q.errorCategoryHint as ErrorCategory) || 'Distractor',
            };
          }),
          vocabulary: enrichedVocab
            .filter((v) => (v.word || '').trim().length > 0)
            .map((v) => {
              const ts = Number.isFinite(v.timestampSec) ? Number(v.timestampSec) : 0;
              return {
                ...v,
                ipa: v.ipa || '',
                pos: v.pos || 'word',
                definitionVi: v.definitionVi || v.contextualMeaningVi || '',
                contextualMeaningVi: v.contextualMeaningVi || v.definitionVi || '',
                definitionEn: v.definitionEn || '',
                exampleInAudio: v.exampleInAudio || '',
                exampleTranslationVi: v.exampleTranslationVi || '',
                timestampSec: ts,
                timestampLabel: v.timestampLabel || formatTimestampLabel(ts),
                isAwl: v.isAwl !== false,
              };
            }),
          intensiveDrills: enrichedDrills
            .filter((d) => (d.sentenceWithBlanks || '').trim().length > 0)
            .map((d, idx) => {
              const start = Number.isFinite(d.startSec) ? Number(d.startSec) : 0;
              const end =
                Number.isFinite(d.endSec) && Number(d.endSec) > start ? Number(d.endSec) : start + 12;
              return {
                ...d,
                id: d.id || `drill-${idx + 1}`,
                segmentId: d.segmentId || `seg-${idx + 1}`,
                startSec: start,
                endSec: end,
                timestampLabel: d.timestampLabel || formatTimestampLabel(start),
                missingPhrases: d.missingPhrases || [],
                connectedSpeechNote: d.connectedSpeechNote || '',
              };
            }),
          classroomDrills: initialClassroomDrills,
        };

        // Persist custom test pack to server disk immediately so uploaded files & tests survive refreshes
        upsertSavedTest(testPack);

        console.log(
          `[ingest] success id=${testPack.id} segments=${testPack.segments.length} questions=${testPack.questions.length} vocab=${testPack.vocabulary.length}`
        );
        onProgress?.('Hoàn tất đồng bộ hóa phòng thi!', 100);
        return testPack;
    } finally {
      if (ai && cleanupFiles.length > 0) {
        for (const name of cleanupFiles) {
          ai.files.delete({ name }).catch(() => {});
        }
      }
    }
  }

  const ingestUploadMiddleware = upload.fields([
    { name: 'audio', maxCount: 1 },
    { name: 'pdf', maxCount: 1 },
  ]);

  // Async ingest start (returns jobId immediately so reverse proxies never drop long multipart requests)
  app.post(
    '/api/ielts/ingest/start',
    ingestUploadMiddleware,
    (req: Request, res: Response) => {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const audioFile = files?.audio?.[0];
      const pdfFile = files?.pdf?.[0];
      const rawText = typeof req.body.rawText === 'string' ? req.body.rawText.trim() : '';
      const customTitle = typeof req.body.title === 'string' ? req.body.title.trim() : '';
      const partLabel =
        typeof req.body.partLabel === 'string' ? req.body.partLabel.trim() : 'Part 2';

      const apiKey =
        (req.headers['x-gemini-api-key'] as string) ||
        (typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '') ||
        process.env.GEMINI_API_KEY ||
        '';

      if (!audioFile && !pdfFile && !rawText) {
        res.status(400).json({
          error: 'Vui lòng tải lên tệp Audio (MP3/WAV), tệp đề PDF, hoặc dán nội dung đề/transcript.',
        });
        return;
      }

      if (!apiKey) {
        res.status(400).json({
          error:
            'Chưa có Gemini API Key. Vui lòng bấm vào nút "API Key (Lấy API key để sử dụng app)" trên thanh Header để nhập khóa Gemini API miễn phí của bạn.',
        });
        return;
      }

      const job = createIngestJob();
      res.status(202).json({
        jobId: job.jobId,
        status: job.status,
        stepLabel: job.stepLabel,
        progressPercent: job.progressPercent,
      });

      void runIngestPipeline({
        audioFile,
        pdfFile,
        rawText,
        customTitle,
        partLabel,
        apiKey,
        onProgress: (stepLabel, progressPercent) => {
          job.stepLabel = stepLabel;
          job.progressPercent = progressPercent;
        },
      })
        .then((testPack) => {
          job.status = 'done';
          job.stepLabel = 'Hoàn tất đồng bộ hóa phòng thi!';
          job.progressPercent = 100;
          job.testPack = testPack;
        })
        .catch((err: unknown) => {
          const message = formatGeminiError(err);
          console.error('Ingest job error:', err);
          job.status = 'error';
          job.error = message;
        });
    }
  );

  // Poll async ingest status
  app.get('/api/ielts/ingest/status/:jobId', (req: Request, res: Response) => {
    const rawId = req.params.jobId;
    const jobId = Array.isArray(rawId) ? rawId[0] : rawId;
    const job = ingestJobs.get(jobId);
    if (!job) {
      res.status(404).json({
        error: 'Phiên xử lý không tồn tại hoặc đã hết hạn. Vui lòng thử nạp lại đề.',
      });
      return;
    }
    res.json({
      jobId: job.jobId,
      status: job.status,
      stepLabel: job.stepLabel,
      progressPercent: job.progressPercent,
      testPack: job.testPack,
      error: job.error,
    });
  });

  // Synchronous Ingest endpoint (kept for direct API callers)
  app.post('/api/ielts/ingest', ingestUploadMiddleware, async (req: Request, res: Response) => {
    try {
      const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
      const audioFile = files?.audio?.[0];
      const pdfFile = files?.pdf?.[0];
      const rawText = typeof req.body.rawText === 'string' ? req.body.rawText.trim() : '';
      const customTitle = typeof req.body.title === 'string' ? req.body.title.trim() : '';
      const partLabel =
        typeof req.body.partLabel === 'string' ? req.body.partLabel.trim() : 'Part 2';

      const apiKey =
        (req.headers['x-gemini-api-key'] as string) ||
        (typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '') ||
        process.env.GEMINI_API_KEY ||
        '';

      if (!audioFile && !pdfFile && !rawText) {
        res.status(400).json({
          error: 'Vui lòng tải lên tệp Audio (MP3/WAV), tệp đề PDF, hoặc dán nội dung đề/transcript.',
        });
        return;
      }

      if (!apiKey) {
        res.status(400).json({
          error:
            'Chưa có Gemini API Key. Vui lòng bấm vào nút "API Key (Lấy API key để sử dụng app)" trên thanh Header để nhập khóa Gemini API miễn phí của bạn.',
        });
        return;
      }

      const testPack = await runIngestPipeline({
        audioFile,
        pdfFile,
        rawText,
        customTitle,
        partLabel,
        apiKey,
      });
      res.json({ testPack });
    } catch (err: unknown) {
      const message = formatGeminiError(err);
      console.error('Ingest error:', err);
      res.status(500).json({ error: message });
    }
  });

  // Generate 5-Part Pedagogical Report via Gemini 4 Hydrogen + deterministic grading
  app.post('/api/ielts/analyze', async (req: Request, res: Response) => {
    try {
      const { testPack, userAnswers, timeSpentSec } = req.body as {
        testPack: ListeningTestPack;
        userAnswers: Record<number, string>;
        timeSpentSec: number;
      };

      if (!testPack || !Array.isArray(testPack.questions)) {
        res.status(400).json({ error: 'Valid testPack is required for analysis.' });
        return;
      }

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

      // Count systematic errors
      const errorCounts = new Map<string, number>();
      for (const row of part1AnswerKey) {
        if (!row.isCorrect && row.errorCategory) {
          errorCounts.set(row.errorCategory, (errorCounts.get(row.errorCategory) || 0) + 1);
        }
      }

      const reqApiKey =
        (req.headers['x-gemini-api-key'] as string) ||
        (typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '') ||
        process.env.GEMINI_API_KEY ||
        '';
      const ai = getAiClient(reqApiKey);
      const diagnosticPrompt = `Phân tích kết quả làm bài IELTS Listening của học viên dưới góc độ Chuyên gia Sư phạm Ngôn ngữ & Data Coach:
- Bài thi: ${testPack.title} (${testPack.partLabel})
- Thời gian làm bài: ${timeSpentSec} giây
- Điểm số: ${correctCount}/${totalCount} (${accuracyPercent}% — Ước lượng: ${estimatedBand})
- Chi tiết từng câu:
${part1AnswerKey
  .map(
    (r) =>
      `Câu ${r.questionNumber}: Học viên="${r.userAnswer}" | Chuẩn="${r.correctAnswer}" | Kết quả=${r.isCorrect ? 'ĐÚNG' : `SAI (${r.errorCategory})`} | Timestamp=${r.timestampLabel} | Bẫy=${r.distractorType}`
  )
  .join('\n')}

- Các đoạn transcript sẵn có để gợi ý Shadowing/Intensive:
${testPack.segments
  .map((s) => `${s.timestampLabel} (${s.speaker}): "${s.text}"`)
  .join('\n')}

Hãy tạo Phần 3 (Behavioral Insights) và Phần 5 (Action Plan) thật cụ thể, chỉ thẳng xu hướng lỗi (ví dụ: âm đuôi -s/-es, lỗi chính tả, mất tập trung khi gặp bẫy tự sửa lỗi, hay giới hạn từ) và đề xuất 2 đoạn Shadowing + 2 bài luyện Intensive kèm mốc timestampSec & timestampLabel chính xác từ danh sách trên.`;

      const aiRes = await generateWithFallback(ai, {
        model: 'gemini-2.5-flash',
        contents: diagnosticPrompt,
        config: {
          systemInstruction: MASTERMIND_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              overallDiagnosisVi: { type: Type.STRING },
              errorBreakdown: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: { type: Type.STRING },
                    count: { type: Type.INTEGER },
                    insightVi: { type: Type.STRING },
                  },
                },
              },
              actionPlanSummaryVi: { type: Type.STRING },
              shadowingTargets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    timestampSec: { type: Type.NUMBER },
                    timestampLabel: { type: Type.STRING },
                    focusNote: { type: Type.STRING },
                  },
                },
              },
              intensiveTargets: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    label: { type: Type.STRING },
                    questionType: { type: Type.STRING },
                    timestampSec: { type: Type.NUMBER },
                    timestampLabel: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const aiDiagnostic = parseModelJson<{
        overallDiagnosisVi?: string;
        errorBreakdown?: { category: string; count: number; insightVi: string }[];
        actionPlanSummaryVi?: string;
        shadowingTargets?: {
          label: string;
          timestampSec: number;
          timestampLabel: string;
          focusNote: string;
        }[];
        intensiveTargets?: {
          label: string;
          questionType: string;
          timestampSec: number;
          timestampLabel: string;
        }[];
      }>(aiRes.text);

      const part2Explanations = testPack.questions.map((q, idx) => ({
        questionNumber: q.number,
        isCorrect: part1AnswerKey[idx]?.isCorrect ?? false,
        userAnswer: part1AnswerKey[idx]?.userAnswer || '(Bỏ trống)',
        correctAnswer: q.correctAnswer,
        paraphraseMapping: part1AnswerKey[idx]?.paraphraseMapping || '',
        distractorType: q.distractorType || 'None',
        logicVi: `${q.explanationVi}${q.distractorDetail ? ` Phân tích bẫy: ${q.distractorDetail}` : ''}`,
        directQuote: q.transcriptQuote,
        timestampSec: q.timestampSec,
        timestampEndSec: q.timestampEndSec,
        timestampLabel: q.timestampLabel,
      }));

      const report: PedagogicalReport = {
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
          errorBreakdown:
            aiDiagnostic.errorBreakdown && aiDiagnostic.errorBreakdown.length > 0
              ? aiDiagnostic.errorBreakdown
              : Array.from(errorCounts.entries()).map(([category, count]) => ({
                  category,
                  count,
                  insightVi: `Phát hiện ${count} lỗi thuộc nhóm ${category}.`,
                })),
          overallDiagnosisVi:
            aiDiagnostic.overallDiagnosisVi ||
            'Hệ thống đã hoàn tất chẩn đoán hành vi làm bài dựa trên dữ liệu đáp án.',
        },
        part4AcademicSpotlight: testPack.vocabulary,
        part5ActionPlan: {
          summaryVi:
            aiDiagnostic.actionPlanSummaryVi ||
            'Ưu tiên luyện nghe chép chính tả ở tốc độ 0.8x tại các đoạn chứa bẫy thông tin.',
          shadowingTargets: aiDiagnostic.shadowingTargets || [],
          intensiveTargets: aiDiagnostic.intensiveTargets || [],
        },
      };

      res.json({ report });
    } catch (err: unknown) {
      const message = formatGeminiError(err);
      console.error('Analyze error:', err);
      res.status(500).json({ error: message });
    }
  });

  // Contextual Vietnamese Vocabulary Translator per listening passage
  app.post('/api/ielts/translate-vocab', async (req: Request, res: Response) => {
    try {
      const { word, sentenceContext, testTitle, topic } = req.body as {
        word?: string;
        sentenceContext?: string;
        testTitle?: string;
        topic?: string;
      };

      const cleanWord = (word || '').trim();
      if (!cleanWord) {
        res.status(400).json({ error: 'Vui lòng nhập từ hoặc cụm từ tiếng Anh cần tra nghĩa theo ngữ cảnh.' });
        return;
      }

      const reqApiKey =
        (req.headers['x-gemini-api-key'] as string) ||
        (typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '') ||
        process.env.GEMINI_API_KEY ||
        '';
      const ai = getAiClient(reqApiKey);
      const prompt = `Hãy đóng vai chuyên gia từ vựng học thuật IELTS Listening (Anh–Việt).
Dịch và phân tích từ/cụm từ tiếng Anh sau theo ĐÚNG NGỮ CẢNH của bài nghe IELTS:
- Từ/cụm từ: "${cleanWord}"
- Bài nghe: ${testTitle || 'IELTS Listening Practice'} (${topic || 'Academic / General'})
- Câu ngữ cảnh trong audio: "${sentenceContext || '(Không có câu cụ thể, hãy đặt một câu ngữ cảnh phù hợp chủ đề bài nghe)'}"

Yêu cầu trả về JSON chuẩn xác:
- word: giữ nguyên từ/cụm từ chuẩn chính tả
- ipa: phiên âm IPA chuẩn Anh–Anh (UK)
- pos: loại từ tiếng Anh (noun, verb, adjective, adverb, phrase...)
- definitionVi: nghĩa tiếng Việt phổ thông ngắn gọn
- contextualMeaningVi: nghĩa tiếng Việt sát nhất với ngữ cảnh cụ thể của bài nghe này
- definitionEn: định nghĩa ngắn gọn bằng tiếng Anh chuẩn học thuật
- exampleInAudio: câu ngữ cảnh trong bài (hoặc câu minh họa sát bài)
- exampleTranslationVi: bản dịch tiếng Việt tự nhiên, chuẩn xác của exampleInAudio`;

      const aiRes = await generateWithFallback(ai, {
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction: MASTERMIND_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            required: [
              'word',
              'ipa',
              'pos',
              'definitionVi',
              'contextualMeaningVi',
              'definitionEn',
              'exampleInAudio',
              'exampleTranslationVi',
            ],
            properties: {
              word: { type: Type.STRING },
              ipa: { type: Type.STRING },
              pos: { type: Type.STRING },
              definitionVi: { type: Type.STRING },
              contextualMeaningVi: { type: Type.STRING },
              definitionEn: { type: Type.STRING },
              exampleInAudio: { type: Type.STRING },
              exampleTranslationVi: { type: Type.STRING },
            },
          },
        },
      });

      const translated = parseModelJson<{
        word?: string;
        ipa?: string;
        pos?: string;
        definitionVi?: string;
        contextualMeaningVi?: string;
        definitionEn?: string;
        exampleInAudio?: string;
        exampleTranslationVi?: string;
      }>(aiRes.text);

      res.json({
        vocabItem: {
          word: translated.word || cleanWord,
          ipa: translated.ipa || '',
          pos: translated.pos || 'word',
          definitionVi: translated.definitionVi || '',
          contextualMeaningVi: translated.contextualMeaningVi || translated.definitionVi || '',
          definitionEn: translated.definitionEn || '',
          exampleInAudio: translated.exampleInAudio || sentenceContext || '',
          exampleTranslationVi: translated.exampleTranslationVi || '',
        },
      });
    } catch (err: unknown) {
      const message = formatGeminiError(err);
      console.error('Translate vocab error:', err);
      res.status(500).json({ error: message });
    }
  });

  async function extractClassroomDrillsWithAi({
    ai,
    testPack,
    targetCount,
    existingAudioPart,
    cleanupFiles,
  }: {
    ai: GoogleGenAI;
    testPack: Pick<
      ListeningTestPack,
      'id' | 'title' | 'partLabel' | 'durationSec' | 'audioUrl' | 'segments'
    >;
    targetCount: number;
    existingAudioPart?: GeminiPart;
    cleanupFiles: string[];
  }): Promise<{
    classroomDrills: ClassroomDrillSentence[];
    updatedSegments: TranscriptSegment[];
  }> {
    const granularSegments = ensureGranularSegments(
      testPack.segments || [],
      testPack.durationSec || 0
    );

    // Always attach stored audio when available so Gemini verifies exact sentence splits & real audio timestamps
    let audioPartForExtraction: GeminiPart | undefined = existingAudioPart;
    if (!audioPartForExtraction && testPack.audioUrl) {
      const audioPrefix = '/api/ielts/audio/';
      if (testPack.audioUrl.startsWith(audioPrefix)) {
        const audioId = testPack.audioUrl.slice(audioPrefix.length);
        const stored = getStoredAudio(audioId);
        if (stored) {
          try {
            const { geminiMime } = normalizeAudioMimeType(
              stored.mimeType,
              stored.originalName || 'audio.mp3'
            );
            audioPartForExtraction = await buildGeminiMediaPart(
              ai,
              stored.buffer,
              geminiMime,
              stored.originalName || 'classroom-drill-audio.mp3',
              cleanupFiles
            );
          } catch (mediaErr) {
            console.warn('[drills] Could not attach audioPart, falling back to transcript:', mediaErr);
          }
        }
      }
    }

    const extractAllMode = targetCount >= 25;
    const prompt = `${audioPartForExtraction ? 'Nghe TRỰC TIẾP file Audio đính kèm (đối chiếu với Transcript tham khảo bên dưới) để ' : 'Từ Transcript bài nghe '} "${testPack.title}" (${testPack.partLabel}), ${extractAllMode ? 'tách TẤT CẢ các câu đơn / câu phức hoàn chỉnh theo trình tự thời gian (tối đa 30 câu)' : `tách và trích xuất ĐÚNG ${targetCount} CÂU ĐƠN / CÂU PHỨC HOÀN CHỈNH (7–28 từ/câu) hay nhất theo đúng trình tự thời gian`} để học sinh luyện Dictation và Shadowing từng câu.

QUY TẮC BẮT BUỘC (KHÔNG ĐƯỢC VI PHẠM):
1. MỖI MỤC LÀ ĐÚNG 1 CÂU HOÀN CHỈNH: Không gộp 2 câu vào 1 mục, không cắt nửa câu, và KHÔNG tách rời các từ cảm thán 1–2 từ như "Yes." / "Hello." thành câu riêng.
2. CHÍNH XÁC NGUYÊN VĂN (VERBATIM): Viết đúng từng từ nghe được trong Audio/Transcript, KHÔNG tự tóm tắt hay viết lại câu.
3. MỖI CÂU CHỈ GHI 1 TÊN NGƯỜI NÓI CỤ THỂ (ví dụ "Agent" hoặc "Emma" — TUYỆT ĐỐI KHÔNG gộp "Agent/Emma").
4. ${audioPartForExtraction ? 'Đo trực tiếp trên Audio để điền CHÍNH XÁC "startSec" và "endSec" (tính bằng giây, lẻ 0.1s) bao trọn từ đầu đến hết từ cuối của câu đó (tính cả khoảng lặng hoặc lời dẫn mở đầu nếu có).' : 'Điền "segmentIndex" khớp với đoạn chứa câu đó và ước lượng "startSec", "endSec" tăng dần chính xác theo thứ tự trong bài.'}

--- TRANSCRIPT THAM KHẢO ---
${granularSegments
  .map(
    (seg, idx) =>
      `[${idx}] ${seg.timestampLabel} (${seg.startSec.toFixed(2)}s-${seg.endSec.toFixed(2)}s) ${seg.speaker}: "${seg.text}"`
  )
  .join('\n')}

Với mỗi câu trong mảng "sentences", giữ giải thích ngắn gọn (<= 18 từ):
- segmentIndex: chỉ số đoạn tham khảo (0..${Math.max(0, granularSegments.length - 1)})
- speaker: tên 1 người nói duy nhất cho câu đó
- startSec: thời điểm bắt đầu câu (giây, số thực)
- endSec: thời điểm kết thúc câu (giây, số thực)
- sentence: nguyên văn 1 câu tiếng Anh hoàn chỉnh trong bài
- translationVi: dịch tiếng Việt sát ngữ cảnh
- selectionReasonVi: lý do ngắn gọn tại sao câu này hay để luyện
- stressPattern: các âm tiết/từ mang trọng âm
- connectedSpeechNote: ghi chú ngắn về nối âm/nuốt âm
- keyWordsCsv: 2–3 từ khóa nổi bật ngăn cách bởi dấu phẩy`;

    const parts: GeminiPart[] = audioPartForExtraction
      ? [audioPartForExtraction, { text: prompt }]
      : [{ text: prompt }];

    const aiRes = await generateWithFallback(ai, {
      model: 'gemini-2.5-flash',
      contents: { parts },
      config: {
        systemInstruction: MASTERMIND_SYSTEM_INSTRUCTION,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          required: ['sentences'],
          properties: {
            sentences: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ['segmentIndex', 'speaker', 'startSec', 'endSec', 'sentence', 'translationVi', 'selectionReasonVi'],
                properties: {
                  segmentIndex: { type: Type.INTEGER },
                  speaker: { type: Type.STRING },
                  startSec: { type: Type.NUMBER },
                  endSec: { type: Type.NUMBER },
                  sentence: { type: Type.STRING },
                  translationVi: { type: Type.STRING },
                  selectionReasonVi: { type: Type.STRING },
                  stressPattern: { type: Type.STRING },
                  connectedSpeechNote: { type: Type.STRING },
                  keyWordsCsv: { type: Type.STRING },
                },
              },
            },
          },
        },
      },
    });

    const parsed = parseModelJson<{ sentences?: RawExtractedSentence[] }>(aiRes.text);
    const classroomDrills = alignClassroomDrills(
      parsed.sentences || [],
      granularSegments,
      testPack.durationSec || 0,
      testPack.id
    );

    return {
      classroomDrills,
      updatedSegments: granularSegments,
    };
  }

  // Extract 10–30 sentences from the listening passage for Classroom Dictation & Shadowing
  app.post('/api/ielts/extract-classroom-drills', async (req: Request, res: Response) => {
    const cleanupFiles: string[] = [];
    let ai: GoogleGenAI | null = null;
    try {
      const { testPack, count } = req.body as {
        testPack?: ListeningTestPack;
        count?: number;
      };

      if (!testPack || !Array.isArray(testPack.segments) || testPack.segments.length === 0) {
        res.status(400).json({ error: 'Bài nghe chưa có dữ liệu Transcript để trích xuất câu.' });
        return;
      }

      const targetCount = Math.min(30, Math.max(8, Number(count) || 12));
      const reqApiKey =
        (req.headers['x-gemini-api-key'] as string) ||
        (typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '') ||
        process.env.GEMINI_API_KEY ||
        '';
      ai = getAiClient(reqApiKey);

      const { classroomDrills, updatedSegments } = await extractClassroomDrillsWithAi({
        ai,
        testPack,
        targetCount,
        cleanupFiles,
      });

      const saved = loadSavedTests().find((t) => t.id === testPack.id);
      if (saved) {
        upsertSavedTest({
          ...saved,
          classroomDrills,
          segments: updatedSegments.length > 0 ? updatedSegments : saved.segments,
        });
      }

      res.json({ classroomDrills, updatedSegments });
    } catch (err: unknown) {
      const message = formatGeminiError(err);
      console.error('Extract classroom drills error:', err);
      res.status(500).json({ error: message });
    } finally {
      if (ai && cleanupFiles.length > 0) {
        for (const name of cleanupFiles) {
          ai.files.delete({ name }).catch(() => {});
        }
      }
    }
  });

  // Recover / generate IELTS questions if an uploaded pack has empty questions
  app.post('/api/ielts/generate-questions', async (req: Request, res: Response) => {
    const cleanupFiles: string[] = [];
    let ai: GoogleGenAI | null = null;
    try {
      const { testPack } = req.body as { testPack?: ListeningTestPack };
      if (!testPack) {
        res.status(400).json({ error: 'Thiếu dữ liệu bài nghe.' });
        return;
      }

      const reqApiKey =
        (req.headers['x-gemini-api-key'] as string) ||
        (typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '') ||
        process.env.GEMINI_API_KEY ||
        '';
      ai = getAiClient(reqApiKey);
      const parts: GeminiPart[] = [];

      if (testPack.pdfUrl?.startsWith('/api/ielts/pdf/')) {
        const pdfId = testPack.pdfUrl.slice('/api/ielts/pdf/'.length);
        const storedPdf = getStoredPdf(pdfId);
        if (storedPdf) {
          const pdfPart = await buildGeminiMediaPart(
            ai,
            storedPdf.buffer,
            'application/pdf',
            storedPdf.originalName,
            cleanupFiles
          );
          parts.push(pdfPart);
        }
      }

      const transcriptBlock = (testPack.segments || [])
        .map((s) => `${s.timestampLabel} ${s.speaker}: ${s.text}`)
        .join('\n');

      parts.push({
        text: `Từ tài liệu PDF đính kèm (nếu có) và/hoặc Transcript bài nghe IELTS Listening "${testPack.title}" (${testPack.partLabel}) dưới đây, hãy trích xuất toàn bộ câu hỏi hoặc thiết kế 6–10 câu hỏi IELTS Listening chuẩn IDP/BC (gồm completion và mcq) kèm đáp án chuẩn và giải thích chi tiết bằng tiếng Việt:\n\n${transcriptBlock}`,
      });

      const qRes = await generateWithFallback(ai, {
        model: 'gemini-2.5-flash',
        contents: { parts },
        config: {
          systemInstruction: MASTERMIND_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            required: ['questions'],
            properties: {
              questions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    number: { type: Type.INTEGER },
                    type: { type: Type.STRING },
                    prompt: { type: Type.STRING },
                    contextBefore: { type: Type.STRING },
                    contextAfter: { type: Type.STRING },
                    wordLimitInstruction: { type: Type.STRING },
                    options: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          key: { type: Type.STRING },
                          text: { type: Type.STRING },
                        },
                      },
                    },
                    correctAnswer: { type: Type.STRING },
                    timestampSec: { type: Type.NUMBER },
                    paraphraseQuestion: { type: Type.STRING },
                    paraphraseTranscript: { type: Type.STRING },
                    distractorType: { type: Type.STRING },
                    distractorDetail: { type: Type.STRING },
                    transcriptQuote: { type: Type.STRING },
                    explanationVi: { type: Type.STRING },
                    errorCategoryHint: { type: Type.STRING },
                  },
                },
              },
            },
          },
        },
      });

      const parsed = parseModelJson<{ questions?: Partial<IeltsQuestion>[] }>(qRes.text);
      const questions: IeltsQuestion[] = (parsed.questions || []).map((q, idx) => {
        const ts = Number.isFinite(q.timestampSec) ? Number(q.timestampSec) : 0;
        const validOptions = Array.isArray(q.options)
          ? q.options.filter((o) => o && (o.key || o.text))
          : [];
        const resolvedType =
          q.type === 'mcq' && validOptions.length > 0
            ? 'mcq'
            : q.type === 'matching' && validOptions.length > 0
              ? 'matching'
              : 'completion';
        const fallbackPrompt = [q.contextBefore, '____', q.contextAfter]
          .filter(Boolean)
          .join(' ')
          .trim();
        return {
          number: q.number || idx + 1,
          type: resolvedType,
          prompt: (q.prompt || '').trim() || fallbackPrompt || `Question ${idx + 1}`,
          contextBefore: q.contextBefore,
          contextAfter: q.contextAfter,
          wordLimitInstruction: q.wordLimitInstruction,
          options: validOptions,
          correctAnswer: q.correctAnswer || '',
          timestampSec: ts,
          timestampLabel: formatTimestampLabel(ts),
          paraphraseQuestion: q.paraphraseQuestion || '',
          paraphraseTranscript: q.paraphraseTranscript || '',
          distractorType: q.distractorType || 'None',
          distractorDetail: q.distractorDetail || '',
          transcriptQuote: q.transcriptQuote || '',
          explanationVi: q.explanationVi || '',
          errorCategoryHint: (q.errorCategoryHint as ErrorCategory) || 'Distractor',
        };
      });

      const saved = loadSavedTests().find((t) => t.id === testPack.id);
      if (saved && questions.length > 0) {
        upsertSavedTest({ ...saved, questions });
      }

      res.json({ questions });
    } catch (err: unknown) {
      const message = formatGeminiError(err);
      console.error('Generate questions error:', err);
      res.status(500).json({ error: message });
    } finally {
      if (ai && cleanupFiles.length > 0) {
        for (const name of cleanupFiles) {
          ai.files.delete({ name }).catch(() => {});
        }
      }
    }
  });

  // AI 1-on-1 IELTS Listening Coach Chat endpoint
  app.post('/api/ielts/coach-chat', async (req: Request, res: Response) => {
    try {
      const {
        testTitle,
        partLabel,
        question,
        userAnswer,
        message,
        history,
      } = req.body as {
        testTitle?: string;
        partLabel?: string;
        question?: IeltsQuestion;
        userAnswer?: string;
        message?: string;
        history?: { role: 'user' | 'model'; text: string }[];
      };

      if (!message || !message.trim()) {
        res.status(400).json({ error: 'Vui lòng nhập câu hỏi dành cho Gia sư AI.' });
        return;
      }

      const reqApiKey =
        (req.headers['x-gemini-api-key'] as string) ||
        (typeof req.body.apiKey === 'string' ? req.body.apiKey.trim() : '') ||
        process.env.GEMINI_API_KEY ||
        '';
      const ai = getAiClient(reqApiKey);
      const prompt = `Bạn là một Cựu Giám khảo / Chuyên gia Sư phạm IELTS Listening hàng đầu (AI IELTS Listening Master Coach), nói tiếng Việt chuẩn mực, giàu tính khích lệ, phân tích sắc bén và sư phạm.

NGỮ CẢNH BÀI THI & CÂU HỎI:
- Bài thi: ${testTitle || 'IELTS Listening Practice'} (${partLabel || 'Listening Section'})
- Câu hỏi số: ${question?.number || 1}
- Dạng câu: ${question?.type || 'completion'}
- Yêu cầu câu hỏi (Prompt): "${question?.prompt || ''}"
- Đáp án của thí sinh đã làm: "${userAnswer || '(Chưa làm / Bỏ trống)'}"
- Đáp án chuẩn (Correct Answer): "${question?.correctAnswer || ''}"
- Các biến thể chấp nhận: ${JSON.stringify(question?.acceptedVariants || [])}
- Trích đoạn Transcript chứa đáp án: "${question?.transcriptQuote || ''}"
- Giải thích vì sao đúng: "${question?.explanationVi || ''}"
- Bẫy thông tin (Distractor): "${question?.distractorType || 'None'}" - Chi tiết bẫy: "${question?.distractorDetail || ''}"
- Biến đổi từ khóa (Paraphrasing): "${question?.paraphraseQuestion || ''}" -> "${question?.paraphraseTranscript || ''}"

LỊCH SỬ HỘI THOẠI TRƯỚC ĐÓ:
${Array.isArray(history) && history.length > 0 ? history.map((h) => `${h.role === 'user' ? 'Thí sinh' : 'Gia sư'}: ${h.text}`).join('\n') : '(Bắt đầu cuộc trò chuyện)'}

CÂU HỎI MỚI CỦA THÍ SINH:
"${message.trim()}"

HƯỚNG DẪN TRẢ LỜI CỦA GIA SƯ:
1. Trực tiếp giải đáp thắc mắc của thí sinh một cách dễ hiểu, thân thiện, mang tính sư phạm cao.
2. Chỉ rõ vì sao đáp án chuẩn là như vậy, phân tích cụ thể bẫy người nói đặt ra (từ nối, chuyển ý, phủ định ngầm, hay ngữ âm đánh vần).
3. Đưa ra "Mẹo thực chiến (Pro Tips)" để học sinh không bao giờ bị lừa ở dạng bài tương tự trong phòng thi thật.
4. Trả lời bằng tiếng Việt tự nhiên, có điểm xuyết các thuật ngữ học thuật tiếng Anh trong bài. Định dạng Markdown rõ ràng, gạch đầu dòng các ý chính, không lan man.`;

      const aiRes = await generateWithFallback(ai, {
        model: 'gemini-2.5-flash',
        contents: prompt,
        config: {
          systemInstruction: MASTERMIND_SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const reply = aiRes.text || 'Gia sư AI chưa thể phản hồi lúc này. Vui lòng thử lại sau.';
      res.json({ reply });
    } catch (err: unknown) {
      const message = formatGeminiError(err);
      console.error('Coach chat error:', err);
      res.status(500).json({ error: message });
    }
  });

  // Ensure unmatched /api routes always return JSON (never fall through to SPA HTML)
  app.use('/api', (_req: Request, res: Response) => {
    res.status(404).json({ error: 'API endpoint không tồn tại.' });
  });

  // Ensure Multer / upload / body-parser errors always return structured JSON
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === 'LIMIT_FILE_SIZE'
          ? 'Tệp tải lên vượt quá giới hạn 50MB.'
          : `Lỗi tải tệp: ${err.message}`;
      res.status(400).json({ error: msg });
      return;
    }
    const status =
      typeof (err as { status?: number })?.status === 'number'
        ? (err as { status: number }).status
        : 500;
    const msg =
      status === 413
        ? 'Dữ liệu gửi lên vượt quá giới hạn kích thước cho phép.'
        : err instanceof Error
          ? err.message
          : 'Lỗi máy chủ không xác định.';
    res.status(status).json({ error: msg });
  });

  // Vite dev middleware vs production static serve
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`LexiSync IELTS server running on http://0.0.0.0:${PORT}`);
  });
  server.requestTimeout = 300_000;
  server.headersTimeout = 60_000;
}

startServer();
