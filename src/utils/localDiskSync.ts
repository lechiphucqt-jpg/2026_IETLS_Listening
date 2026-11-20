/**
 * Local Disk Storage & Sync Engine (Local-First) for LexiSync IELTS
 * 
 * Supports:
 * 1. Direct Directory Reading & Writing via HTML5 File System Access API (window.showDirectoryPicker)
 * 2. Windows "Save As" file picker via window.showSaveFilePicker
 * 3. Quick download & offline backup .json / .lexisync restoration
 * 4. Automatic audio & PDF binary extraction and rehydration to IndexedDB
 */

import type { FlashcardItem, ListeningTestPack } from '../types/ielts';
import {
  base64ToBlob,
  blobToBase64,
  clearDirectoryHandleFromDB,
  downloadBlob,
  getDirectoryHandleFromDB,
  getMediaBlob,
  importTestPackage,
  saveCustomTestsToIndexedDB,
  saveDirectoryHandleToDB,
  saveFlashcardsToIndexedDB,
  saveMediaBlob,
} from './indexedDBStorage';

// Type augmentations for File System Access API
export interface NativeDirectoryHandle {
  kind: 'directory';
  name: string;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<NativeFileHandle>;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<NativeDirectoryHandle>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  values(): AsyncIterable<NativeDirectoryHandle | NativeFileHandle>;
  queryPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission(descriptor?: { mode?: 'read' | 'readwrite' }): Promise<'granted' | 'denied' | 'prompt'>;
}

export interface NativeFileHandle {
  kind: 'file';
  name: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<NativeWritableStream>;
}

export interface NativeWritableStream {
  write(data: string | Blob | BufferSource): Promise<void>;
  close(): Promise<void>;
}

export interface LocalStorageStats {
  testsCount: number;
  flashcardsCount: number;
  notesCount: number;
}

export interface LocalAppFullBackup {
  format: 'lexisync_ielts_full_backup_v1';
  version: '2.0';
  app: 'LexiSync IELTS';
  exportedAt: string;
  tests: ListeningTestPack[];
  flashcards: FlashcardItem[];
  answersByTest?: Record<string, Record<string, string>>;
  reportsByTest?: Record<string, unknown>;
  audioPackages?: Array<{
    testId: string;
    fileName: string;
    mimeType: string;
    base64: string;
  }>;
  pdfPackages?: Array<{
    testId: string;
    fileName: string;
    mimeType: string;
    base64: string;
  }>;
}

/**
 * Check if the current browser environment supports the File System Access API
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/**
 * Prompt the user to pick a folder on their computer (e.g. D:\Du_Lieu_Thay_Phuc or E:\1. IELTS_LISTENING)
 */
export async function pickLocalDirectory(): Promise<{
  handle: FileSystemDirectoryHandle;
  name: string;
} | null> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('Trình duyệt của bạn chưa hỗ trợ chọn thư mục trực tiếp. Hãy dùng Google Chrome hoặc Microsoft Edge trên máy tính.');
  }

  try {
    const showDir = (window as unknown as { showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
    const handle = await showDir({ mode: 'readwrite' });
    if (!handle) return null;

    // Persist handle in IndexedDB
    await saveDirectoryHandleToDB(handle, handle.name);

    return {
      handle,
      name: handle.name,
    };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      return null; // User cancelled the picker dialog
    }
    throw err;
  }
}

/**
 * Load the previously saved directory handle from IndexedDB and verify permission
 */
export async function loadSavedLocalDirectory(): Promise<{
  handle: FileSystemDirectoryHandle;
  name: string;
} | null> {
  const saved = await getDirectoryHandleFromDB();
  if (!saved) return null;

  try {
    const handle = saved.handle as unknown as NativeDirectoryHandle;
    // Check permission
    const status = await handle.queryPermission({ mode: 'readwrite' });
    if (status === 'granted') {
      return saved;
    }
    // If prompt, try asking
    const reqStatus = await handle.requestPermission({ mode: 'readwrite' });
    if (reqStatus === 'granted') {
      return saved;
    }
    return saved;
  } catch {
    return saved;
  }
}

/**
 * Unlink / remove saved directory
 */
export async function unlinkSavedDirectory(): Promise<void> {
  await clearDirectoryHandleFromDB();
}

/**
 * Verify / request readwrite permission for a directory handle
 */
export async function verifyDirectoryPermission(
  handle: FileSystemDirectoryHandle,
  readWrite: boolean = true
): Promise<boolean> {
  try {
    const native = handle as unknown as NativeDirectoryHandle;
    const mode = readWrite ? 'readwrite' : 'read';
    if ((await native.queryPermission({ mode })) === 'granted') {
      return true;
    }
    if ((await native.requestPermission({ mode })) === 'granted') {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Save all tests, flashcards, answers, and audio/pdf media directly into the specified directory
 */
export async function saveAllDataToDirectory(
  dirHandle: FileSystemDirectoryHandle,
  data: {
    tests: ListeningTestPack[];
    flashcards: FlashcardItem[];
    answersByTest?: Record<string, Record<string, string>>;
    reportsByTest?: Record<string, unknown>;
  }
): Promise<{ testsCount: number; audiosCount: number; pdfsCount: number }> {
  const hasPerm = await verifyDirectoryPermission(dirHandle, true);
  if (!hasPerm) {
    throw new Error('Chưa được cấp quyền ghi vào thư mục này. Vui lòng thử lại và bấm "Cho phép" (Allow).');
  }

  const nativeDir = dirHandle as unknown as NativeDirectoryHandle;

  // 1. Prepare clean test packs (strip ephemeral blob URLs)
  const cleanTests = data.tests.map((t) => ({
    ...t,
    audioUrl: t.audioUrl && t.audioUrl.startsWith('blob:') ? undefined : t.audioUrl,
    pdfUrl: t.pdfUrl && t.pdfUrl.startsWith('blob:') ? undefined : t.pdfUrl,
  }));

  const backupPayload: LocalAppFullBackup = {
    format: 'lexisync_ielts_full_backup_v1',
    version: '2.0',
    app: 'LexiSync IELTS',
    exportedAt: new Date().toISOString(),
    tests: cleanTests,
    flashcards: data.flashcards,
    answersByTest: data.answersByTest,
    reportsByTest: data.reportsByTest,
  };

  // 2. Write IELTS_Listening_Data.json to the directory
  const jsonFile = await nativeDir.getFileHandle('IELTS_Listening_Data.json', { create: true });
  const jsonWriter = await jsonFile.createWritable();
  await jsonWriter.write(JSON.stringify(backupPayload, null, 2));
  await jsonWriter.close();

  // 3. Write README note for teacher / student
  try {
    const readmeFile = await nativeDir.getFileHandle('HUONG_DAN_DU_LIEU.txt', { create: true });
    const readmeWriter = await readmeFile.createWritable();
    const readmeText = `THƯ MỤC LƯU TRỮ DỮ LIỆU BÀI NGHE IELTS (LOCAL-FIRST)
Được tạo tự động bởi ứng dụng LexiSync IELTS vào: ${new Date().toLocaleString('vi-VN')}

- Tệp "IELTS_Listening_Data.json": Chứa toàn bộ đề thi, transcript theo giây, câu hỏi, đáp án và kho từ vựng Pre-teach.
- Thư mục "audio/": Chứa các tệp âm thanh bài nghe (.mp3).
- Thư mục "pdf/": Chứa các tệp đề thi (.pdf).

Bạn có thể sao lưu thư mục này vào USB hoặc Google Drive. Khi đổi máy tính hoặc mở lại app, chỉ cần bấm "Đọc dữ liệu từ thư mục này" để nạp lại toàn bộ!`;
    await readmeWriter.write(readmeText);
    await readmeWriter.close();
  } catch {
    // optional
  }

  // 4. Save Audio files into subfolder audio/
  let audiosCount = 0;
  try {
    const audioDir = await nativeDir.getDirectoryHandle('audio', { create: true });
    for (const test of data.tests) {
      try {
        const stored = await getMediaBlob(test.id, 'audio');
        let blob: Blob | null = null;
        let fileName = test.audioFileName || `${test.id}.mp3`;

        if (stored?.blob) {
          blob = stored.blob;
          if (stored.fileName) fileName = stored.fileName;
        } else if (test.audioUrl && !test.audioUrl.startsWith('blob:')) {
          const res = await fetch(test.audioUrl);
          if (res.ok) blob = await res.blob();
        }

        if (blob) {
          const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_');
          const audioFile = await audioDir.getFileHandle(safeName, { create: true });
          const writer = await audioFile.createWritable();
          await writer.write(blob);
          await writer.close();
          audiosCount++;
        }
      } catch {
        // ignore per-file audio error
      }
    }
  } catch {
    // ignore
  }

  // 5. Save PDF files into subfolder pdf/
  let pdfsCount = 0;
  try {
    const pdfDir = await nativeDir.getDirectoryHandle('pdf', { create: true });
    for (const test of data.tests) {
      try {
        const stored = await getMediaBlob(test.id, 'pdf');
        let blob: Blob | null = null;
        let fileName = test.pdfFileName || `${test.id}.pdf`;

        if (stored?.blob) {
          blob = stored.blob;
          if (stored.fileName) fileName = stored.fileName;
        } else if (test.pdfUrl && !test.pdfUrl.startsWith('blob:')) {
          const res = await fetch(test.pdfUrl);
          if (res.ok) blob = await res.blob();
        }

        if (blob) {
          const safeName = fileName.replace(/[\\/:*?"<>|]/g, '_');
          const pdfFile = await pdfDir.getFileHandle(safeName, { create: true });
          const writer = await pdfFile.createWritable();
          await writer.write(blob);
          await writer.close();
          pdfsCount++;
        }
      } catch {
        // ignore per-file pdf error
      }
    }
  } catch {
    // ignore
  }

  // Also persist custom tests and flashcards in browser IndexedDB
  await saveCustomTestsToIndexedDB(data.tests.filter((t) => t.isCustomUpload));
  await saveFlashcardsToIndexedDB(data.flashcards);

  return {
    testsCount: data.tests.length,
    audiosCount,
    pdfsCount,
  };
}

/**
 * Read all tests, flashcards, answers, and audio/pdf files from the chosen local directory
 */
export async function loadAllDataFromDirectory(
  dirHandle: FileSystemDirectoryHandle
): Promise<{
  tests: ListeningTestPack[];
  flashcards: FlashcardItem[];
  answersByTest?: Record<string, Record<string, string>>;
  reportsByTest?: Record<string, unknown>;
  loadedAudiosCount: number;
  loadedPdfsCount: number;
}> {
  const hasPerm = await verifyDirectoryPermission(dirHandle, false);
  if (!hasPerm) {
    throw new Error('Chưa được cấp quyền đọc thư mục này. Vui lòng bấm "Cho phép" để đọc dữ liệu.');
  }

  const nativeDir = dirHandle as unknown as NativeDirectoryHandle;

  let loadedTests: ListeningTestPack[] = [];
  let loadedFlashcards: FlashcardItem[] = [];
  let answersByTest: Record<string, Record<string, string>> | undefined;
  let reportsByTest: Record<string, unknown> | undefined;

  // 1. Try reading IELTS_Listening_Data.json
  try {
    const jsonFile = await nativeDir.getFileHandle('IELTS_Listening_Data.json');
    const file = await jsonFile.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text) as LocalAppFullBackup;

    if (parsed && Array.isArray(parsed.tests)) {
      loadedTests = parsed.tests.map((t) => ({ ...t, isCustomUpload: true }));
    }
    if (parsed && Array.isArray(parsed.flashcards)) {
      loadedFlashcards = parsed.flashcards;
    }
    if (parsed && parsed.answersByTest) {
      answersByTest = parsed.answersByTest;
    }
    if (parsed && parsed.reportsByTest) {
      reportsByTest = parsed.reportsByTest;
    }
  } catch {
    // Fallback: check if directory contains other JSON or .lexisync files
    for await (const entry of nativeDir.values()) {
      if (entry.kind === 'file') {
        const name = entry.name.toLowerCase();
        if (name.endsWith('.lexisync') || name.endsWith('.lexisync_pack')) {
          try {
            const f = await entry.getFile();
            const imported = await importTestPackage(f);
            loadedTests.push(...imported);
          } catch {
            // ignore
          }
        }
      }
    }
  }

  if (loadedTests.length === 0 && loadedFlashcards.length === 0) {
    throw new Error('Không tìm thấy tệp "IELTS_Listening_Data.json" hoặc gói đề thi hợp lệ trong thư mục này.');
  }

  // 2. Scan audio/ subfolder and hydrate into IndexedDB
  let loadedAudiosCount = 0;
  try {
    const audioDir = await nativeDir.getDirectoryHandle('audio');
    for await (const entry of audioDir.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        const fName = entry.name;
        // Match against loaded tests by testId or audioFileName
        for (const test of loadedTests) {
          if (
            test.audioFileName === fName ||
            fName.startsWith(test.id) ||
            fName.includes(test.id)
          ) {
            const liveUrl = await saveMediaBlob(test.id, 'audio', file, fName);
            test.audioUrl = liveUrl;
            test.audioFileName = fName;
            loadedAudiosCount++;
          }
        }
      }
    }
  } catch {
    // audio folder may not exist yet
  }

  // 3. Scan pdf/ subfolder and hydrate into IndexedDB
  let loadedPdfsCount = 0;
  try {
    const pdfDir = await nativeDir.getDirectoryHandle('pdf');
    for await (const entry of pdfDir.values()) {
      if (entry.kind === 'file') {
        const file = await entry.getFile();
        const fName = entry.name;
        for (const test of loadedTests) {
          if (
            test.pdfFileName === fName ||
            fName.startsWith(test.id) ||
            fName.includes(test.id)
          ) {
            const liveUrl = await saveMediaBlob(test.id, 'pdf', file, fName);
            test.pdfUrl = liveUrl;
            test.pdfFileName = fName;
            loadedPdfsCount++;
          }
        }
      }
    }
  } catch {
    // pdf folder may not exist yet
  }

  // 4. Save into IndexedDB for persistent startup
  await saveCustomTestsToIndexedDB(loadedTests);
  if (loadedFlashcards.length > 0) {
    await saveFlashcardsToIndexedDB(loadedFlashcards);
  }

  return {
    tests: loadedTests,
    flashcards: loadedFlashcards,
    answersByTest,
    reportsByTest,
    loadedAudiosCount,
    loadedPdfsCount,
  };
}

/**
 * Open Windows "Save As" file picker dialog to let user choose D:, E:, USB, etc.
 */
export async function saveBackupWithFilePicker(data: {
  tests: ListeningTestPack[];
  flashcards: FlashcardItem[];
  answersByTest?: Record<string, Record<string, string>>;
  reportsByTest?: Record<string, unknown>;
}): Promise<boolean> {
  const cleanTests = data.tests.map((t) => ({
    ...t,
    audioUrl: t.audioUrl && t.audioUrl.startsWith('blob:') ? undefined : t.audioUrl,
    pdfUrl: t.pdfUrl && t.pdfUrl.startsWith('blob:') ? undefined : t.pdfUrl,
  }));

  // Build audio packages for complete self-contained backup
  const audioPackages: LocalAppFullBackup['audioPackages'] = [];
  const pdfPackages: LocalAppFullBackup['pdfPackages'] = [];

  for (const t of cleanTests) {
    try {
      const audioRec = await getMediaBlob(t.id, 'audio');
      if (audioRec?.blob) {
        const b64 = await blobToBase64(audioRec.blob);
        audioPackages.push({
          testId: t.id,
          fileName: audioRec.fileName || `${t.id}.mp3`,
          mimeType: audioRec.mimeType || 'audio/mpeg',
          base64: b64,
        });
      }
    } catch {
      // ignore
    }

    try {
      const pdfRec = await getMediaBlob(t.id, 'pdf');
      if (pdfRec?.blob) {
        const b64 = await blobToBase64(pdfRec.blob);
        pdfPackages.push({
          testId: t.id,
          fileName: pdfRec.fileName || `${t.id}.pdf`,
          mimeType: pdfRec.mimeType || 'application/pdf',
          base64: b64,
        });
      }
    } catch {
      // ignore
    }
  }

  const payload: LocalAppFullBackup = {
    format: 'lexisync_ielts_full_backup_v1',
    version: '2.0',
    app: 'LexiSync IELTS',
    exportedAt: new Date().toISOString(),
    tests: cleanTests,
    flashcards: data.flashcards,
    answersByTest: data.answersByTest,
    reportsByTest: data.reportsByTest,
    audioPackages,
    pdfPackages,
  };

  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const dateStr = new Date().toISOString().slice(0, 10);
  const defaultFileName = `IELTS_Listening_Backup_${dateStr}.json`;

  // Check if showSaveFilePicker is supported (Chrome, Edge)
  const windowSave = (window as unknown as {
    showSaveFilePicker?: (options: {
      suggestedName: string;
      types: Array<{ description: string; accept: Record<string, string[]> }>;
    }) => Promise<NativeFileHandle>;
  }).showSaveFilePicker;

  if (typeof windowSave === 'function') {
    try {
      const fileHandle = await windowSave({
        suggestedName: defaultFileName,
        types: [
          {
            description: 'Tệp sao lưu LexiSync IELTS (*.json)',
            accept: { 'application/json': ['.json'] },
          },
        ],
      });
      const writer = await fileHandle.createWritable();
      await writer.write(blob);
      await writer.close();
      return true;
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        return false; // User cancelled
      }
      // If error, fallback to direct download
    }
  }

  // Fallback download
  downloadBlob(blob, defaultFileName);
  return true;
}

/**
 * Quick direct download of .json backup into Downloads folder
 */
export function downloadQuickBackup(data: {
  tests: ListeningTestPack[];
  flashcards: FlashcardItem[];
  answersByTest?: Record<string, Record<string, string>>;
  reportsByTest?: Record<string, unknown>;
}): void {
  const cleanTests = data.tests.map((t) => ({
    ...t,
    audioUrl: t.audioUrl && t.audioUrl.startsWith('blob:') ? undefined : t.audioUrl,
    pdfUrl: t.pdfUrl && t.pdfUrl.startsWith('blob:') ? undefined : t.pdfUrl,
  }));

  const payload: LocalAppFullBackup = {
    format: 'lexisync_ielts_full_backup_v1',
    version: '2.0',
    app: 'LexiSync IELTS',
    exportedAt: new Date().toISOString(),
    tests: cleanTests,
    flashcards: data.flashcards,
    answersByTest: data.answersByTest,
    reportsByTest: data.reportsByTest,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadBlob(blob, `IELTS_Listening_Backup_${dateStr}.json`);
}

/**
 * Restore data from a backup file (.json, .lexisync, .lexisync_pack)
 */
export async function restoreBackupFromFile(file: File): Promise<{
  tests: ListeningTestPack[];
  flashcards: FlashcardItem[];
  answersByTest?: Record<string, Record<string, string>>;
  reportsByTest?: Record<string, unknown>;
  audioRestoredCount: number;
}> {
  const fName = file.name.toLowerCase();

  // If .lexisync or .lexisync_pack format
  if (fName.endsWith('.lexisync') || fName.endsWith('.lexisync_pack')) {
    const importedPacks = await importTestPackage(file);
    await saveCustomTestsToIndexedDB(importedPacks);
    return {
      tests: importedPacks,
      flashcards: [],
      audioRestoredCount: importedPacks.filter((p) => !!p.audioUrl).length,
    };
  }

  // Parse JSON format
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Tệp không đúng định dạng JSON hoặc bị hỏng.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Dữ liệu tệp sao lưu không hợp lệ.');
  }

  const backup = parsed as LocalAppFullBackup;
  let testsToRestore: ListeningTestPack[] = [];
  let flashcardsToRestore: FlashcardItem[] = [];
  let audioRestoredCount = 0;

  // Case 1: Full Backup format
  if (Array.isArray(backup.tests)) {
    testsToRestore = backup.tests.map((t) => ({ ...t, isCustomUpload: true }));
  } else if ((parsed as ListeningTestPack).id && Array.isArray((parsed as ListeningTestPack).questions)) {
    // Single test pack
    testsToRestore = [parsed as ListeningTestPack];
  }

  if (Array.isArray(backup.flashcards)) {
    flashcardsToRestore = backup.flashcards;
  }

  // Rehydrate embedded audio packages if present
  if (Array.isArray(backup.audioPackages)) {
    for (const pkg of backup.audioPackages) {
      try {
        const audioBlob = base64ToBlob(pkg.base64, pkg.mimeType || 'audio/mpeg');
        const liveUrl = await saveMediaBlob(pkg.testId, 'audio', audioBlob, pkg.fileName);
        const matched = testsToRestore.find((t) => t.id === pkg.testId);
        if (matched) {
          matched.audioUrl = liveUrl;
          matched.audioFileName = pkg.fileName;
        }
        audioRestoredCount++;
      } catch {
        // ignore
      }
    }
  }

  // Rehydrate embedded PDF packages if present
  if (Array.isArray(backup.pdfPackages)) {
    for (const pkg of backup.pdfPackages) {
      try {
        const pdfBlob = base64ToBlob(pkg.base64, pkg.mimeType || 'application/pdf');
        const liveUrl = await saveMediaBlob(pkg.testId, 'pdf', pdfBlob, pkg.fileName);
        const matched = testsToRestore.find((t) => t.id === pkg.testId);
        if (matched) {
          matched.pdfUrl = liveUrl;
          matched.pdfFileName = pkg.fileName;
        }
      } catch {
        // ignore
      }
    }
  }

  if (testsToRestore.length === 0 && flashcardsToRestore.length === 0) {
    throw new Error('Tệp JSON không chứa bài nghe hoặc từ vựng hợp lệ.');
  }

  // Save to IndexedDB
  await saveCustomTestsToIndexedDB(testsToRestore);
  if (flashcardsToRestore.length > 0) {
    await saveFlashcardsToIndexedDB(flashcardsToRestore);
  }

  return {
    tests: testsToRestore,
    flashcards: flashcardsToRestore,
    answersByTest: backup.answersByTest,
    reportsByTest: backup.reportsByTest,
    audioRestoredCount,
  };
}
