/**
 * Google Drive Cloud Synchronization & Direct Streaming for LexiSync IELTS
 * 
 * Allows users to automatically or manually upload test packages, real audio MP3/WAV files,
 * and exam PDFs to their personal or institutional Google Drive.
 * 
 * Works 100% on Vercel, Localhost, LAN, and across all devices.
 */

import type { ListeningTestPack } from '../types/ielts';
import { blobToBase64 } from './indexedDBStorage';

export const GDRIVE_WEBHOOK_STORAGE_KEY = 'lexisync_gdrive_webhook_url_v1';
export const GDRIVE_FOLDER_NAME = 'LexiSync_IELTS_Storage';

export interface GoogleDriveUploadResult {
  ok: boolean;
  testId?: string;
  audioDriveUrl?: string;
  pdfDriveUrl?: string;
  testJsonDriveUrl?: string;
  folderUrl?: string;
  error?: string;
}

export interface GoogleDriveSavedTestItem {
  id: string;
  title: string;
  partLabel: string;
  durationSec: number;
  audioUrl?: string;
  audioFileName?: string;
  pdfUrl?: string;
  pdfFileName?: string;
  testPack: ListeningTestPack;
  updatedAt: string;
}

/**
 * Extract Google Drive file ID from various URL formats
 */
export function extractGoogleDriveFileId(url: string): string | null {
  if (!url) return null;
  const trimmed = url.trim();

  // Pattern 1: /file/d/<FILE_ID>/view
  const matchD = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (matchD && matchD[1]) return matchD[1];

  // Pattern 2: id=<FILE_ID>
  const matchId = trimmed.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  if (matchId && matchId[1]) return matchId[1];

  // Pattern 3: /open?id=<FILE_ID> or /uc?id=<FILE_ID>
  const matchOpen = trimmed.match(/\/(?:open|uc)\?(?:.*&)?id=([a-zA-Z0-9_-]+)/);
  if (matchOpen && matchOpen[1]) return matchOpen[1];

  // Raw file ID (alphanumeric 25-45 chars)
  if (/^[a-zA-Z0-9_-]{25,45}$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * Convert any Google Drive view/share link into a direct streaming audio/PDF URL
 */
export function toGoogleDriveDirectStreamUrl(url: string): string {
  const fileId = extractGoogleDriveFileId(url);
  if (!fileId) return url;
  // Use docs.google.com open link which allows direct range audio streaming and CORS audio playback
  return `https://docs.google.com/uc?export=open&id=${fileId}`;
}

/**
 * Get configured Google Apps Script Web App URL from localStorage
 */
export function getGoogleDriveWebhookUrl(): string {
  if (typeof window === 'undefined') return '';
  return (localStorage.getItem(GDRIVE_WEBHOOK_STORAGE_KEY) || '').trim();
}

/**
 * Save Google Apps Script Web App URL to localStorage
 */
export function setGoogleDriveWebhookUrl(url: string): void {
  if (typeof window === 'undefined') return;
  const clean = url.trim();
  if (clean) {
    localStorage.setItem(GDRIVE_WEBHOOK_STORAGE_KEY, clean);
  } else {
    localStorage.removeItem(GDRIVE_WEBHOOK_STORAGE_KEY);
  }
}

/**
 * Upload a Test Pack and its Audio/PDF to Google Drive via Google Apps Script Webhook
 */
export async function uploadTestToGoogleDrive(
  testPack: ListeningTestPack,
  audioBlob?: Blob,
  pdfBlob?: Blob
): Promise<GoogleDriveUploadResult> {
  const webhookUrl = getGoogleDriveWebhookUrl();
  if (!webhookUrl) {
    return {
      ok: false,
      error: 'Chưa cấu hình Google Drive Web App URL. Vui lòng nhấn vào biểu tượng Google Drive trên thanh điều hướng để cài đặt.',
    };
  }

  try {
    let audioBase64: string | undefined;
    let audioMime = 'audio/mpeg';
    const audioFileName = testPack.audioFileName || `${testPack.id}.mp3`;

    if (audioBlob) {
      audioBase64 = await blobToBase64(audioBlob);
      audioMime = audioBlob.type || 'audio/mpeg';
    }

    let pdfBase64: string | undefined;
    let pdfMime = 'application/pdf';
    const pdfFileName = testPack.pdfFileName || `${testPack.id}.pdf`;

    if (pdfBlob) {
      pdfBase64 = await blobToBase64(pdfBlob);
      pdfMime = pdfBlob.type || 'application/pdf';
    }

    const payload = {
      action: 'save_test',
      testId: testPack.id,
      title: testPack.title,
      partLabel: testPack.partLabel,
      testPack: {
        ...testPack,
        audioUrl: undefined,
        pdfUrl: undefined,
      },
      audio: audioBase64
        ? {
            fileName: audioFileName,
            mimeType: audioMime,
            base64: audioBase64,
          }
        : undefined,
      pdf: pdfBase64
        ? {
            fileName: pdfFileName,
            mimeType: pdfMime,
            base64: pdfBase64,
          }
        : undefined,
    };

    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8', // Prevents preflight CORS block in Apps Script
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      throw new Error(`Google Apps Script phản hồi mã lỗi HTTP ${res.status}`);
    }

    const data = await res.json();
    if (!data.ok) {
      throw new Error(data.error || 'Lỗi không xác định khi lưu vào Google Drive.');
    }

    return {
      ok: true,
      testId: testPack.id,
      audioDriveUrl: data.audioDirectUrl || data.audioViewUrl,
      pdfDriveUrl: data.pdfDirectUrl || data.pdfViewUrl,
      testJsonDriveUrl: data.testJsonViewUrl,
      folderUrl: data.folderUrl,
    };
  } catch (err: unknown) {
    console.error('[GoogleDrive] Upload error:', err);
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Fetch all saved tests from Google Drive via the Web App connector
 */
export async function fetchAllTestsFromGoogleDrive(): Promise<ListeningTestPack[]> {
  const webhookUrl = getGoogleDriveWebhookUrl();
  if (!webhookUrl) {
    throw new Error('Chưa cấu hình Google Drive Web App URL.');
  }

  const queryUrl = `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}action=list_tests&t=${Date.now()}`;
  const res = await fetch(queryUrl, {
    method: 'GET',
  });

  if (!res.ok) {
    throw new Error(`Không thể kết nối đến Google Drive (HTTP ${res.status}).`);
  }

  const data = await res.json();
  if (!data || !data.ok || !Array.isArray(data.tests)) {
    throw new Error(data?.error || 'Dữ liệu trả về từ Google Drive không hợp lệ.');
  }

  return (data.tests as GoogleDriveSavedTestItem[]).map((item) => {
    const pack = item.testPack;
    return {
      ...pack,
      isCustomUpload: true,
      audioUrl: item.audioUrl || pack.audioUrl,
      audioFileName: item.audioFileName || pack.audioFileName,
      pdfUrl: item.pdfUrl || pack.pdfUrl,
      pdfFileName: item.pdfFileName || pack.pdfFileName,
    };
  });
}

/**
 * Test connectivity with the configured Google Apps Script Web App
 */
export async function testGoogleDriveConnection(): Promise<{ ok: boolean; folderUrl?: string; message?: string }> {
  const webhookUrl = getGoogleDriveWebhookUrl();
  if (!webhookUrl) {
    return { ok: false, message: 'Vui lòng dán đường dẫn Google Apps Script Web App URL trước.' };
  }

  try {
    const queryUrl = `${webhookUrl}${webhookUrl.includes('?') ? '&' : '?'}action=ping&t=${Date.now()}`;
    const res = await fetch(queryUrl, { method: 'GET' });
    if (!res.ok) {
      return { ok: false, message: `Máy chủ Google phản hồi HTTP ${res.status}` };
    }
    const data = await res.json();
    if (data.ok) {
      return { ok: true, folderUrl: data.folderUrl, message: 'Kết nối Google Drive thành công 100%!' };
    }
    return { ok: false, message: data.error || 'Phản hồi không hợp lệ từ Google Script.' };
  } catch (err: unknown) {
    return {
      ok: false,
      message: 'Không thể kết nối (Kiểm tra lại quyền Deploy Web App: Who has access = Anyone). Chi tiết: ' + String(err),
    };
  }
}

/**
 * Ready-to-copy Google Apps Script code template
 */
export const GOOGLE_APPS_SCRIPT_TEMPLATE = `/**
 * =========================================================================
 * LexiSync IELTS — Google Drive Cloud Storage Connector (Google Apps Script)
 * =========================================================================
 * HƯỚNG DẪN CÀI ĐẶT TRONG 1 PHÚT:
 * 1. Truy cập https://script.google.com và tạo một "Dự án mới" (New project).
 * 2. Xóa toàn bộ nội dung trong file Code.gs và DÁN NGUYÊN VĂN toàn bộ đoạn mã này vào.
 * 3. Bấm biểu tượng Đĩa mềm "Lưu dự án" (Save).
 * 4. Bấm nút màu xanh "Triển khai" (Deploy) ở góc trên bên phải -> "Tùy chọn triển khai mới" (New deployment).
 * 5. Chọn loại: "Ứng dụng web" (Web app).
 *    - Mô tả: LexiSync Drive Storage
 *    - Thực thi dưới dạng (Execute as): "Tôi" (Me - tài khoản Google của bạn)
 *    - Người có quyền truy cập (Who has access): "Bất kỳ ai" (Anyone) -> RẤT QUAN TRỌNG!
 * 6. Bấm "Triển khai" (Deploy) -> Cấp quyền truy cập Google Drive của bạn nếu được hỏi.
 * 7. Sao chép "URL ứng dụng web" (Web App URL có dạng https://script.google.com/macros/s/.../exec) 
 *    và dán vào ô cài đặt Google Drive trong app LexiSync IELTS.
 * =========================================================================
 */

var ROOT_FOLDER_NAME = "LexiSync_IELTS_Storage";

function getOrCreateStorageFolder() {
  var folders = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  var folder;
  if (folders.hasNext()) {
    folder = folders.next();
  } else {
    folder = DriveApp.createFolder(ROOT_FOLDER_NAME);
  }
  // Cho phép bất kỳ ai có link đều có thể đọc/nghe file âm thanh
  folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return folder;
}

function getSubFolder(parent, name) {
  var subFolders = parent.getFoldersByName(name);
  if (subFolders.hasNext()) {
    return subFolders.next();
  }
  var created = parent.createFolder(name);
  created.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return created;
}

function doGet(e) {
  var action = (e && e.parameter && e.parameter.action) ? e.parameter.action : "ping";
  var root = getOrCreateStorageFolder();

  if (action === "ping") {
    return jsonResponse({
      ok: true,
      message: "LexiSync Google Drive Connector is running perfectly!",
      folderUrl: root.getUrl()
    });
  }

  if (action === "list_tests") {
    var testsFolder = getSubFolder(root, "Tests_JSON");
    var files = testsFolder.getFiles();
    var list = [];
    while (files.hasNext()) {
      var file = files.next();
      if (file.getName().endsWith(".json")) {
        try {
          var content = JSON.parse(file.getBlob().getDataAsString());
          list.push(content);
        } catch (err) {}
      }
    }
    return jsonResponse({ ok: true, tests: list });
  }

  return jsonResponse({ ok: false, error: "Action not recognized: " + action });
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse({ ok: false, error: "No post data received." });
    }

    var data = JSON.parse(e.postData.contents);
    var root = getOrCreateStorageFolder();
    var audioFolder = getSubFolder(root, "Audio");
    var pdfFolder = getSubFolder(root, "PDF");
    var testsFolder = getSubFolder(root, "Tests_JSON");

    var testId = data.testId || ("test_" + new Date().getTime());
    var title = data.title || "IELTS_Practice";
    var cleanTitle = title.replace(/[^a-zA-Z0-9_\u00C0-\u1EF9]/g, "_");

    var audioDirectUrl = "";
    var audioViewUrl = "";
    var pdfDirectUrl = "";
    var pdfViewUrl = "";

    // 1. Lưu file Audio vào thư mục Audio
    if (data.audio && data.audio.base64) {
      var audioBytes = Utilities.base64Decode(data.audio.base64);
      var audioMime = data.audio.mimeType || "audio/mpeg";
      var audioExt = audioMime.indexOf("wav") !== -1 ? ".wav" : ".mp3";
      var audioName = cleanTitle + "_" + testId + audioExt;
      var audioBlob = Utilities.newBlob(audioBytes, audioMime, audioName);
      var audioFile = audioFolder.createFile(audioBlob);
      audioFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      audioViewUrl = audioFile.getUrl();
      audioDirectUrl = "https://docs.google.com/uc?export=open&id=" + audioFile.getId();
    }

    // 2. Lưu file PDF vào thư mục PDF
    if (data.pdf && data.pdf.base64) {
      var pdfBytes = Utilities.base64Decode(data.pdf.base64);
      var pdfName = cleanTitle + "_" + testId + ".pdf";
      var pdfBlob = Utilities.newBlob(pdfBytes, "application/pdf", pdfName);
      var pdfFile = pdfFolder.createFile(pdfBlob);
      pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      pdfViewUrl = pdfFile.getUrl();
      pdfDirectUrl = "https://docs.google.com/uc?export=open&id=" + pdfFile.getId();
    }

    // 3. Cập nhật và lưu TestPack JSON vào thư mục Tests_JSON
    var testPackToSave = data.testPack || {};
    testPackToSave.id = testId;
    testPackToSave.title = title;
    if (audioDirectUrl) testPackToSave.audioUrl = audioDirectUrl;
    if (pdfDirectUrl) testPackToSave.pdfUrl = pdfDirectUrl;

    var recordToSave = {
      id: testId,
      title: title,
      partLabel: data.partLabel || "Part 2",
      durationSec: testPackToSave.durationSec || 180,
      audioUrl: audioDirectUrl || testPackToSave.audioUrl || "",
      audioFileName: data.audio ? data.audio.fileName : testPackToSave.audioFileName,
      pdfUrl: pdfDirectUrl || testPackToSave.pdfUrl || "",
      pdfFileName: data.pdf ? data.pdf.fileName : testPackToSave.pdfFileName,
      testPack: testPackToSave,
      updatedAt: new Date().toISOString()
    };

    var jsonFileName = cleanTitle + "_" + testId + ".json";
    // Xóa file cũ nếu đã tồn tại
    var existingJsonFiles = testsFolder.getFilesByName(jsonFileName);
    while (existingJsonFiles.hasNext()) {
      existingJsonFiles.next().setTrashed(true);
    }

    var jsonFile = testsFolder.createFile(jsonFileName, JSON.stringify(recordToSave, null, 2), "application/json");
    jsonFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

    return jsonResponse({
      ok: true,
      testId: testId,
      audioDirectUrl: audioDirectUrl,
      audioViewUrl: audioViewUrl,
      pdfDirectUrl: pdfDirectUrl,
      pdfViewUrl: pdfViewUrl,
      testJsonViewUrl: jsonFile.getUrl(),
      folderUrl: root.getUrl()
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
