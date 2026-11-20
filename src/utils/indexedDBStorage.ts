/**
 * IndexedDB Media Storage for LexiSync IELTS
 * 
 * Provides persistent browser-side storage for uploaded Audio and PDF files.
 * Unlike temporary `blob:` URLs which die upon page reload, files stored in
 * IndexedDB persist across sessions, browser restarts, and device reboots.
 */

import type { FlashcardItem, ListeningTestPack } from '../types/ielts';

const DB_NAME = 'lexisync_media_db_v1';
const DB_VERSION = 2;
const STORE_NAME = 'media_records';
const SETTINGS_STORE = 'app_settings';
const TESTS_STORE = 'tests_library';
const FLASHCARDS_STORE = 'flashcards_store';

export interface StoredMediaRecord {
  key: string; // `${testId}_${type}`
  testId: string;
  type: 'audio' | 'pdf';
  blob: Blob;
  fileName?: string;
  mimeType: string;
  size: number;
  updatedAt: number;
}

// In-memory cache of live blob URLs created in this window session
const liveBlobUrlCache = new Map<string, string>();

/**
 * Open or initialize the IndexedDB database
 */
export function openMediaDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      reject(new Error('IndexedDB is not supported in this environment.'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('testId', 'testId', { unique: false });
        store.createIndex('type', 'type', { unique: false });
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(TESTS_STORE)) {
        db.createObjectStore(TESTS_STORE, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(FLASHCARDS_STORE)) {
        db.createObjectStore(FLASHCARDS_STORE, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error || new Error('Failed to open LexiSync IndexedDB.'));
    };
  });
}

/**
 * Save custom test packs to IndexedDB tests_library
 */
export async function saveCustomTestsToIndexedDB(tests: ListeningTestPack[]): Promise<void> {
  try {
    const db = await openMediaDatabase();
    if (!db.objectStoreNames.contains(TESTS_STORE)) return;
    const tx = db.transaction(TESTS_STORE, 'readwrite');
    const store = tx.objectStore(TESTS_STORE);
    store.clear();
    for (const test of tests) {
      // Store test without ephemeral blob URLs
      store.put({
        ...test,
        audioUrl: test.audioUrl && test.audioUrl.startsWith('blob:') ? undefined : test.audioUrl,
        pdfUrl: test.pdfUrl && test.pdfUrl.startsWith('blob:') ? undefined : test.pdfUrl,
      });
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Failed to save custom tests to IndexedDB:', err);
  }
}

/**
 * Retrieve all custom tests from IndexedDB
 */
export async function getAllCustomTestsFromIndexedDB(): Promise<ListeningTestPack[]> {
  try {
    const db = await openMediaDatabase();
    if (!db.objectStoreNames.contains(TESTS_STORE)) return [];
    return await new Promise<ListeningTestPack[]>((resolve, reject) => {
      const tx = db.transaction(TESTS_STORE, 'readonly');
      const store = tx.objectStore(TESTS_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as ListeningTestPack[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * Save flashcards to IndexedDB
 */
export async function saveFlashcardsToIndexedDB(cards: FlashcardItem[]): Promise<void> {
  try {
    const db = await openMediaDatabase();
    if (!db.objectStoreNames.contains(FLASHCARDS_STORE)) return;
    const tx = db.transaction(FLASHCARDS_STORE, 'readwrite');
    const store = tx.objectStore(FLASHCARDS_STORE);
    store.clear();
    for (const card of cards) {
      store.put(card);
    }
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Failed to save flashcards to IndexedDB:', err);
  }
}

/**
 * Retrieve all flashcards from IndexedDB
 */
export async function getAllFlashcardsFromIndexedDB(): Promise<FlashcardItem[]> {
  try {
    const db = await openMediaDatabase();
    if (!db.objectStoreNames.contains(FLASHCARDS_STORE)) return [];
    return await new Promise<FlashcardItem[]>((resolve, reject) => {
      const tx = db.transaction(FLASHCARDS_STORE, 'readonly');
      const store = tx.objectStore(FLASHCARDS_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as FlashcardItem[]) || []);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return [];
  }
}

/**
 * Save FileSystemDirectoryHandle to IndexedDB
 */
export async function saveDirectoryHandleToDB(
  handle: FileSystemDirectoryHandle,
  folderName?: string
): Promise<void> {
  try {
    const db = await openMediaDatabase();
    if (!db.objectStoreNames.contains(SETTINGS_STORE)) return;
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    store.put({
      key: 'saved_directory_handle',
      handle,
      name: folderName || handle.name,
      savedAt: Date.now(),
    });
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Failed to save directory handle:', err);
  }
}

/**
 * Retrieve saved FileSystemDirectoryHandle from IndexedDB
 */
export async function getDirectoryHandleFromDB(): Promise<{
  handle: FileSystemDirectoryHandle;
  name: string;
} | null> {
  try {
    const db = await openMediaDatabase();
    if (!db.objectStoreNames.contains(SETTINGS_STORE)) return null;
    return await new Promise((resolve) => {
      const tx = db.transaction(SETTINGS_STORE, 'readonly');
      const store = tx.objectStore(SETTINGS_STORE);
      const req = store.get('saved_directory_handle');
      req.onsuccess = () => {
        if (req.result && req.result.handle) {
          resolve({
            handle: req.result.handle as FileSystemDirectoryHandle,
            name: (req.result.name as string) || req.result.handle.name,
          });
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Clear saved FileSystemDirectoryHandle from IndexedDB
 */
export async function clearDirectoryHandleFromDB(): Promise<void> {
  try {
    const db = await openMediaDatabase();
    if (!db.objectStoreNames.contains(SETTINGS_STORE)) return;
    const tx = db.transaction(SETTINGS_STORE, 'readwrite');
    const store = tx.objectStore(SETTINGS_STORE);
    store.delete('saved_directory_handle');
    await new Promise<void>((resolve) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch {
    // ignore
  }
}

export const CUSTOM_LOGO_STORAGE_KEY = 'lexisync_custom_app_logo';

/**
 * Process and optimize an uploaded logo image file into a high-res base64 Data URL
 */
export function processLogoImageFile(file: File, maxDim = 512): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Tệp tải lên không phải là định dạng hình ảnh hợp lệ.'));
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const rawDataUrl = e.target?.result as string;
      if (!rawDataUrl) {
        reject(new Error('Không thể đọc dữ liệu ảnh.'));
        return;
      }

      // If SVG image, keep vector quality intact
      if (file.type === 'image/svg+xml') {
        resolve(rawDataUrl);
        return;
      }

      // Resize & optimize bitmap formats using canvas
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, width);
        canvas.height = Math.max(1, height);
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawDataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const optimized = canvas.toDataURL('image/png');
        resolve(optimized);
      };

      img.onerror = () => resolve(rawDataUrl);
      img.src = rawDataUrl;
    };

    reader.onerror = () => reject(new Error('Lỗi khi đọc tệp ảnh.'));
    reader.readAsDataURL(file);
  });
}

/**
 * Permanently save custom logo to both localStorage and IndexedDB
 */
export async function saveCustomLogoToStorage(dataUrl: string): Promise<void> {
  try {
    localStorage.setItem(CUSTOM_LOGO_STORAGE_KEY, dataUrl);
  } catch {
    // ignore quota
  }

  try {
    const db = await openMediaDatabase();
    if (db.objectStoreNames.contains(SETTINGS_STORE)) {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      const store = tx.objectStore(SETTINGS_STORE);
      store.put({
        key: 'custom_app_logo',
        dataUrl,
        updatedAt: Date.now(),
      });
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } catch (err) {
    console.warn('[IndexedDB] Failed to save custom logo to IndexedDB:', err);
  }
}

/**
 * Retrieve custom logo from localStorage or IndexedDB
 */
export async function getCustomLogoFromStorage(): Promise<string | null> {
  // 1. Try localStorage for instant synchronous access
  try {
    const fromLocal = localStorage.getItem(CUSTOM_LOGO_STORAGE_KEY);
    if (fromLocal) return fromLocal;
  } catch {
    // ignore
  }

  // 2. Fallback to persistent IndexedDB
  try {
    const db = await openMediaDatabase();
    if (db.objectStoreNames.contains(SETTINGS_STORE)) {
      return await new Promise<string | null>((resolve) => {
        const tx = db.transaction(SETTINGS_STORE, 'readonly');
        const store = tx.objectStore(SETTINGS_STORE);
        const req = store.get('custom_app_logo');
        req.onsuccess = () => {
          if (req.result && req.result.dataUrl) {
            resolve(req.result.dataUrl as string);
          } else {
            resolve(null);
          }
        };
        req.onerror = () => resolve(null);
      });
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Permanently remove custom logo from both localStorage and IndexedDB
 */
export async function removeCustomLogoFromStorage(): Promise<void> {
  try {
    localStorage.removeItem(CUSTOM_LOGO_STORAGE_KEY);
  } catch {
    // ignore
  }

  try {
    const db = await openMediaDatabase();
    if (db.objectStoreNames.contains(SETTINGS_STORE)) {
      const tx = db.transaction(SETTINGS_STORE, 'readwrite');
      const store = tx.objectStore(SETTINGS_STORE);
      store.delete('custom_app_logo');
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
  } catch {
    // ignore
  }
}

/**
 * Save an Audio or PDF Blob to IndexedDB
 */
export async function saveMediaBlob(
  testId: string,
  type: 'audio' | 'pdf',
  fileOrBlob: Blob | File,
  fileName?: string
): Promise<string> {
  if (!testId) throw new Error('testId is required to save media blob.');

  const db = await openMediaDatabase();
  const name =
    fileName ||
    (fileOrBlob instanceof File ? fileOrBlob.name : undefined) ||
    (type === 'audio' ? 'audio.mp3' : 'exam.pdf');

  const recordKey = `${testId}_${type}`;
  const record: StoredMediaRecord = {
    key: recordKey,
    testId,
    type,
    blob: fileOrBlob,
    fileName: name,
    mimeType: fileOrBlob.type || (type === 'audio' ? 'audio/mpeg' : 'application/pdf'),
    size: fileOrBlob.size,
    updatedAt: Date.now(),
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const putReq = store.put(record);

    putReq.onsuccess = () => resolve();
    putReq.onerror = () => reject(putReq.error || new Error('Failed to put media into IndexedDB.'));
  });

  // Revoke previous live URL for this record if any
  const previousUrl = liveBlobUrlCache.get(recordKey);
  if (previousUrl && previousUrl.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(previousUrl);
    } catch {
      // ignore
    }
  }

  // Generate and cache a fresh live URL for the current session
  const freshUrl = URL.createObjectURL(fileOrBlob);
  liveBlobUrlCache.set(recordKey, freshUrl);
  return freshUrl;
}

/**
 * Retrieve a stored media record from IndexedDB
 */
export async function getMediaBlob(
  testId: string,
  type: 'audio' | 'pdf'
): Promise<StoredMediaRecord | null> {
  if (!testId) return null;
  try {
    const db = await openMediaDatabase();
    const recordKey = `${testId}_${type}`;

    return await new Promise<StoredMediaRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const getReq = store.get(recordKey);

      getReq.onsuccess = () => {
        resolve((getReq.result as StoredMediaRecord) || null);
      };
      getReq.onerror = () => {
        reject(getReq.error || new Error('Failed to retrieve media from IndexedDB.'));
      };
    });
  } catch {
    return null;
  }
}

/**
 * Get or create a valid live blob: URL for the given test media in this window session
 */
export async function getOrCreateLiveMediaUrl(
  testId: string,
  type: 'audio' | 'pdf'
): Promise<{ url: string; fileName?: string } | null> {
  const recordKey = `${testId}_${type}`;
  const existingUrl = liveBlobUrlCache.get(recordKey);

  // If we already created a live URL in this session, verify and return it
  if (existingUrl) {
    return { url: existingUrl };
  }

  const record = await getMediaBlob(testId, type);
  if (!record || !record.blob) return null;

  const freshUrl = URL.createObjectURL(record.blob);
  liveBlobUrlCache.set(recordKey, freshUrl);
  return { url: freshUrl, fileName: record.fileName };
}

/**
 * Check if a test has persistent media stored in IndexedDB
 */
export async function hasMediaInIndexedDB(
  testId: string,
  type: 'audio' | 'pdf'
): Promise<boolean> {
  const record = await getMediaBlob(testId, type);
  return !!record && record.size > 0;
}

/**
 * Delete all media associated with a test from IndexedDB
 */
export async function deleteMediaForTest(testId: string): Promise<void> {
  if (!testId) return;
  try {
    const db = await openMediaDatabase();
    for (const type of ['audio', 'pdf'] as const) {
      const recordKey = `${testId}_${type}`;
      const cachedUrl = liveBlobUrlCache.get(recordKey);
      if (cachedUrl && cachedUrl.startsWith('blob:')) {
        try {
          URL.revokeObjectURL(cachedUrl);
        } catch {
          // ignore
        }
      }
      liveBlobUrlCache.delete(recordKey);
    }

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const reqAudio = store.delete(`${testId}_audio`);
      const reqPdf = store.delete(`${testId}_pdf`);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[IndexedDB] Error deleting media for test:', testId, err);
  }
}

/**
 * Verify whether an audio URL is actually reachable and not an expired blob / broken endpoint.
 */
export async function isAudioUrlPlayable(url: string | undefined): Promise<boolean> {
  if (!url) return false;

  // Local data URLs or valid sample audio are assumed playable
  if (url.startsWith('data:audio/')) return true;

  try {
    // Quick HEAD/GET check
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 2500);

    const res = await fetch(url, {
      method: 'GET',
      headers: { Range: 'bytes=0-10' },
      signal: controller.signal,
    });
    window.clearTimeout(timeoutId);

    // If on Vercel and it returns an HTML fallback page, it's NOT playable audio
    const contentType = res.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      return false;
    }

    return res.ok || res.status === 206;
  } catch {
    return false;
  }
}

export interface LexiSyncPortablePackage {
  format: 'lexisync_package_v1';
  exportedAt: string;
  testPack: ListeningTestPack;
  audioBase64?: string;
  audioMime?: string;
  audioFileName?: string;
  pdfBase64?: string;
  pdfMime?: string;
  pdfFileName?: string;
}

export interface LexiSyncMultiPackage {
  format: 'lexisync_multi_v1';
  exportedAt: string;
  tests: LexiSyncPortablePackage[];
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const res = reader.result as string;
      const base64 = res.includes(',') ? res.split(',')[1] : res;
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

export function base64ToBlob(base64: string, mimeType: string): Blob {
  const byteChars = atob(base64);
  const sliceSize = 1024 * 512;
  const byteArrays: Uint8Array[] = [];

  for (let offset = 0; offset < byteChars.length; offset += sliceSize) {
    const slice = byteChars.slice(offset, offset + sliceSize);
    const byteNumbers = new Array(slice.length);
    for (let i = 0; i < slice.length; i++) {
      byteNumbers[i] = slice.charCodeAt(i);
    }
    byteArrays.push(new Uint8Array(byteNumbers));
  }

  return new Blob(byteArrays, { type: mimeType });
}

/**
 * Trigger browser file download for a Blob
 */
export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download a stored Audio or PDF directly to the user's local computer
 */
export async function downloadMediaFile(
  testId: string,
  type: 'audio' | 'pdf',
  fallbackFileName?: string
): Promise<boolean> {
  try {
    const record = await getMediaBlob(testId, type);
    if (record?.blob) {
      const fileName =
        record.fileName ||
        fallbackFileName ||
        (type === 'audio' ? `${testId}.mp3` : `${testId}.pdf`);
      downloadBlob(record.blob, fileName);
      return true;
    }
    return false;
  } catch (err) {
    console.warn(`[Download] Could not download ${type} for test ${testId}:`, err);
    return false;
  }
}

/**
 * Download both Audio and PDF for a test to the local computer
 */
export async function downloadAllMediaForTest(
  testPack: ListeningTestPack
): Promise<{ audioDownloaded: boolean; pdfDownloaded: boolean }> {
  let audioDownloaded = false;
  let pdfDownloaded = false;

  // 1. Audio
  try {
    const audioRec = await getMediaBlob(testPack.id, 'audio');
    if (audioRec?.blob) {
      const name = audioRec.fileName || testPack.audioFileName || `${testPack.title || testPack.id}.mp3`;
      downloadBlob(audioRec.blob, name);
      audioDownloaded = true;
    } else if (testPack.audioUrl) {
      const res = await fetch(testPack.audioUrl);
      if (res.ok) {
        const blob = await res.blob();
        const name = testPack.audioFileName || `${testPack.title || testPack.id}.mp3`;
        downloadBlob(blob, name);
        audioDownloaded = true;
      }
    }
  } catch (err) {
    console.warn('[Download] Error downloading audio:', err);
  }

  // Small delay so browser handles multiple downloads cleanly
  await new Promise((r) => setTimeout(r, 350));

  // 2. PDF
  try {
    const pdfRec = await getMediaBlob(testPack.id, 'pdf');
    if (pdfRec?.blob) {
      const name = pdfRec.fileName || testPack.pdfFileName || `${testPack.title || testPack.id}.pdf`;
      downloadBlob(pdfRec.blob, name);
      pdfDownloaded = true;
    } else if (testPack.pdfUrl) {
      const res = await fetch(testPack.pdfUrl);
      if (res.ok) {
        const blob = await res.blob();
        const name = testPack.pdfFileName || `${testPack.title || testPack.id}.pdf`;
        downloadBlob(blob, name);
        pdfDownloaded = true;
      }
    }
  } catch (err) {
    console.warn('[Download] Error downloading PDF:', err);
  }

  return { audioDownloaded, pdfDownloaded };
}

/**
 * Retrieve all stored media records currently in IndexedDB
 */
export async function getAllStoredMediaRecords(): Promise<StoredMediaRecord[]> {
  try {
    const db = await openMediaDatabase();
    return await new Promise<StoredMediaRecord[]>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.getAll();
      req.onsuccess = () => resolve((req.result as StoredMediaRecord[]) || []);
      req.onerror = () => reject(req.error || new Error('Failed to fetch media records.'));
    });
  } catch {
    return [];
  }
}

/**
 * Export a single ListeningTestPack bundled with its Audio and PDF as a portable .lexisync file
 */
export async function exportTestPackage(testPack: ListeningTestPack): Promise<void> {
  let audioBase64: string | undefined;
  let audioMime: string | undefined;
  let audioFileName = testPack.audioFileName || `${testPack.id}.mp3`;

  let pdfBase64: string | undefined;
  let pdfMime: string | undefined;
  let pdfFileName = testPack.pdfFileName || `${testPack.id}.pdf`;

  // 1. Fetch Audio Blob (from IndexedDB first, then fallback to URL)
  try {
    const storedAudio = await getMediaBlob(testPack.id, 'audio');
    if (storedAudio?.blob) {
      audioBase64 = await blobToBase64(storedAudio.blob);
      audioMime = storedAudio.mimeType || 'audio/mpeg';
      if (storedAudio.fileName) audioFileName = storedAudio.fileName;
    } else if (testPack.audioUrl) {
      const res = await fetch(testPack.audioUrl);
      if (res.ok) {
        const blob = await res.blob();
        audioBase64 = await blobToBase64(blob);
        audioMime = blob.type || 'audio/mpeg';
      }
    }
  } catch (err) {
    console.warn('[Export] Could not bundle audio:', err);
  }

  // 2. Fetch PDF Blob
  try {
    const storedPdf = await getMediaBlob(testPack.id, 'pdf');
    if (storedPdf?.blob) {
      pdfBase64 = await blobToBase64(storedPdf.blob);
      pdfMime = storedPdf.mimeType || 'application/pdf';
      if (storedPdf.fileName) pdfFileName = storedPdf.fileName;
    } else if (testPack.pdfUrl) {
      const res = await fetch(testPack.pdfUrl);
      if (res.ok) {
        const blob = await res.blob();
        pdfBase64 = await blobToBase64(blob);
        pdfMime = blob.type || 'application/pdf';
      }
    }
  } catch (err) {
    console.warn('[Export] Could not bundle PDF:', err);
  }

  const pkg: LexiSyncPortablePackage = {
    format: 'lexisync_package_v1',
    exportedAt: new Date().toISOString(),
    testPack: {
      ...testPack,
      // Clear host-specific temporary blob URLs so receiving machine regenerates fresh ones
      audioUrl: undefined,
      pdfUrl: undefined,
    },
    audioBase64,
    audioMime,
    audioFileName,
    pdfBase64,
    pdfMime,
    pdfFileName,
  };

  const jsonStr = JSON.stringify(pkg, null, 2);
  const jsonBlob = new Blob([jsonStr], { type: 'application/json' });
  const safeTitle = (testPack.title || 'IELTS_Test').replace(/[^a-zA-Z0-9_\u00C0-\u1EF9]/g, '_');
  downloadBlob(jsonBlob, `${safeTitle}.lexisync`);
}

/**
 * Export all custom tests into a single backup package
 */
export async function exportAllTestsPackage(tests: ListeningTestPack[]): Promise<void> {
  const customTests = tests.filter((t) => t.isCustomUpload);
  if (customTests.length === 0) {
    throw new Error('Chưa có đề thi tự nạp nào để xuất.');
  }

  const packagedList: LexiSyncPortablePackage[] = [];

  for (const t of customTests) {
    let audioBase64: string | undefined;
    let audioMime: string | undefined;
    let audioFileName = t.audioFileName || `${t.id}.mp3`;

    let pdfBase64: string | undefined;
    let pdfMime: string | undefined;
    let pdfFileName = t.pdfFileName || `${t.id}.pdf`;

    try {
      const storedAudio = await getMediaBlob(t.id, 'audio');
      if (storedAudio?.blob) {
        audioBase64 = await blobToBase64(storedAudio.blob);
        audioMime = storedAudio.mimeType || 'audio/mpeg';
        if (storedAudio.fileName) audioFileName = storedAudio.fileName;
      }
    } catch {
      // ignore
    }

    try {
      const storedPdf = await getMediaBlob(t.id, 'pdf');
      if (storedPdf?.blob) {
        pdfBase64 = await blobToBase64(storedPdf.blob);
        pdfMime = storedPdf.mimeType || 'application/pdf';
        if (storedPdf.fileName) pdfFileName = storedPdf.fileName;
      }
    } catch {
      // ignore
    }

    packagedList.push({
      format: 'lexisync_package_v1',
      exportedAt: new Date().toISOString(),
      testPack: { ...t, audioUrl: undefined, pdfUrl: undefined },
      audioBase64,
      audioMime,
      audioFileName,
      pdfBase64,
      pdfMime,
      pdfFileName,
    });
  }

  const multiPkg: LexiSyncMultiPackage = {
    format: 'lexisync_multi_v1',
    exportedAt: new Date().toISOString(),
    tests: packagedList,
  };

  const jsonBlob = new Blob([JSON.stringify(multiPkg, null, 2)], { type: 'application/json' });
  const dateStr = new Date().toISOString().slice(0, 10);
  downloadBlob(jsonBlob, `LexiSync_IELTS_Backup_${dateStr}.lexisync_pack`);
}

/**
 * Import a .lexisync or .lexisync_pack file, unbundle audio/pdf to IndexedDB, and return the test packs
 */
export async function importTestPackage(file: File): Promise<ListeningTestPack[]> {
  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Tệp không đúng định dạng JSON hoặc bị hỏng.');
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Dữ liệu gói đề thi không hợp lệ.');
  }

  const rawObj = parsed as { format?: string; tests?: unknown[]; testPack?: unknown };
  const itemsToProcess: LexiSyncPortablePackage[] = [];

  if (rawObj.format === 'lexisync_package_v1' && rawObj.testPack) {
    itemsToProcess.push(parsed as LexiSyncPortablePackage);
  } else if (rawObj.format === 'lexisync_multi_v1' && Array.isArray(rawObj.tests)) {
    itemsToProcess.push(...(rawObj.tests as LexiSyncPortablePackage[]));
  } else if ((parsed as ListeningTestPack).id && Array.isArray((parsed as ListeningTestPack).questions)) {
    // Raw ListeningTestPack JSON fallback
    itemsToProcess.push({
      format: 'lexisync_package_v1',
      exportedAt: new Date().toISOString(),
      testPack: parsed as ListeningTestPack,
    });
  } else {
    throw new Error('Định dạng gói đề thi không được hỗ trợ (cần file .lexisync hoặc .lexisync_pack).');
  }

  const importedPacks: ListeningTestPack[] = [];

  for (const item of itemsToProcess) {
    const pack = { ...item.testPack, isCustomUpload: true };

    // Unpack Audio if embedded
    if (item.audioBase64) {
      try {
        const audioBlob = base64ToBlob(item.audioBase64, item.audioMime || 'audio/mpeg');
        const liveAudioUrl = await saveMediaBlob(
          pack.id,
          'audio',
          audioBlob,
          item.audioFileName || `${pack.id}.mp3`
        );
        pack.audioUrl = liveAudioUrl;
        pack.audioFileName = item.audioFileName || pack.audioFileName || `${pack.id}.mp3`;
      } catch (err) {
        console.warn('[Import] Could not save unpacked audio to IndexedDB:', err);
      }
    }

    // Unpack PDF if embedded
    if (item.pdfBase64) {
      try {
        const pdfBlob = base64ToBlob(item.pdfBase64, item.pdfMime || 'application/pdf');
        const livePdfUrl = await saveMediaBlob(
          pack.id,
          'pdf',
          pdfBlob,
          item.pdfFileName || `${pack.id}.pdf`
        );
        pack.pdfUrl = livePdfUrl;
        pack.pdfFileName = item.pdfFileName || pack.pdfFileName || `${pack.id}.pdf`;
      } catch (err) {
        console.warn('[Import] Could not save unpacked PDF to IndexedDB:', err);
      }
    }

    importedPacks.push(pack);
  }

  return importedPacks;
}

