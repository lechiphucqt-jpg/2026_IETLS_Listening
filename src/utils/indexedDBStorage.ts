/**
 * IndexedDB Media Storage for LexiSync IELTS
 * 
 * Provides persistent browser-side storage for uploaded Audio and PDF files.
 * Unlike temporary `blob:` URLs which die upon page reload, files stored in
 * IndexedDB persist across sessions, browser restarts, and device reboots.
 */

const DB_NAME = 'lexisync_media_db_v1';
const DB_VERSION = 1;
const STORE_NAME = 'media_records';

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
function openMediaDatabase(): Promise<IDBDatabase> {
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
