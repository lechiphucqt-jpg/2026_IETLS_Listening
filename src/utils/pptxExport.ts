import type { ClassroomDrillSentence, ListeningTestPack } from '../types/ielts';

/**
 * Triggers a browser file download.
 */
function downloadFile(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Generates an HTML presentation slide file that can be opened in PowerPoint / Google Slides
 * or directly projected in class.
 */
export function exportDictationSlidesPptx(testPack: ListeningTestPack) {
  const safeTitle = testPack.title.replace(/[/\\?%*:|"<>]/g, '-');
  const drills: ClassroomDrillSentence[] =
    testPack.classroomDrills && testPack.classroomDrills.length > 0
      ? testPack.classroomDrills
      : testPack.segments.slice(0, 12).map((seg, i) => ({
          id: seg.id,
          order: i + 1,
          speaker: seg.speaker,
          sentence: seg.text,
          translationVi: '',
          startSec: seg.startSec,
          endSec: seg.endSec,
          timestampLabel: seg.timestampLabel,
          selectionReasonVi: 'Trích đoạn câu tiêu biểu từ audio',
          stressPattern: seg.stressPattern || '',
          connectedSpeechNote: seg.intonationNote || '',
          keyWords: [],
        }));

  const slidesHtml = drills
    .map(
      (item) => `
    <div class="slide">
      <div class="header">
        <span class="badge">CÂU ${String(item.order).padStart(2, '0')} · ${item.speaker}</span>
        <span class="timestamp">${item.timestampLabel} (${item.startSec.toFixed(1)}s – ${item.endSec.toFixed(1)}s)</span>
      </div>

      <div class="sentence-box">
        <p class="sentence">“${item.sentence}”</p>
        ${item.translationVi ? `<p class="translation">${item.translationVi}</p>` : ''}
      </div>

      <div class="meta-grid">
        <div class="meta-card">
          <h4>Trọng âm chính (Word Stress)</h4>
          <p class="mono">${item.stressPattern || 'Nhấn vào các từ khóa nội dung'}</p>
        </div>
        <div class="meta-card">
          <h4>Hiện tượng nối âm & Ngữ điệu</h4>
          <p>${item.connectedSpeechNote || 'Lên giọng nhẹ ở mệnh đề phụ, hạ giọng ở cuối câu'}</p>
        </div>
      </div>

      <div class="footer">
        <strong>Lý do chọn câu:</strong> ${item.selectionReasonVi || 'Chứa cấu trúc ngữ pháp học thuật & bẫy thông tin'}
        ${item.keyWords && item.keyWords.length > 0 ? ` · <strong>Từ khóa:</strong> ${item.keyWords.join(', ')}` : ''}
      </div>
    </div>
  `
    )
    .join('');

  const vocabSlide =
    testPack.vocabulary && testPack.vocabulary.length > 0
      ? `
    <div class="slide">
      <div class="header">
        <span class="badge">TỪ VỰNG HỌC THUẬT (AWL SPOTLIGHT)</span>
        <span class="timestamp">${testPack.vocabulary.length} TỪ KHÓA ĐẮT GIÁ</span>
      </div>
      <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; margin-top: 10px;">
        ${testPack.vocabulary
          .slice(0, 6)
          .map(
            (v) => `
          <div class="meta-card">
            <div style="display: flex; justify-content: space-between; align-items: baseline;">
              <strong style="font-size: 18px; color: #1E3A8A;">${v.word}</strong>
              <span class="mono" style="color: #64748B; font-size: 13px;">${v.ipa} (${v.pos})</span>
            </div>
            <p style="margin: 4px 0 0; color: #0F172A; font-weight: 500;">${v.contextualMeaningVi || v.definitionVi}</p>
            <p style="margin: 4px 0 0; font-size: 12px; color: #475569; font-style: italic;">“${v.exampleInAudio}”</p>
          </div>
        `
          )
          .join('')}
      </div>
    </div>
  `
      : '';

  const fullHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Slide_${safeTitle}</title>
  <style>
    @page {
      size: 11in 6.19in landscape; /* 16:9 widescreen presentation */
      margin: 0;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: 'Arial', sans-serif;
      background-color: #0F172A;
      color: #0F172A;
    }
    .slide {
      width: 100vw;
      height: 100vh;
      box-sizing: border-box;
      padding: 36px 48px;
      background-color: #FFFFFF;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 2px solid #E2E8F0;
      padding-bottom: 12px;
    }
    .badge {
      background-color: #1E3A8A;
      color: #FFFFFF;
      font-weight: bold;
      font-size: 14px;
      padding: 4px 12px;
      border-radius: 6px;
      letter-spacing: 0.5px;
    }
    .timestamp {
      font-family: 'Courier New', monospace;
      font-weight: bold;
      color: #2563EB;
      font-size: 14px;
    }
    .sentence-box {
      background-color: #F8FAFC;
      border-left: 6px solid #2563EB;
      padding: 20px 24px;
      border-radius: 8px;
      margin: 16px 0;
    }
    .sentence {
      font-size: 24px;
      font-weight: bold;
      line-height: 1.4;
      color: #0F172A;
      margin: 0 0 8px;
    }
    .translation {
      font-size: 15px;
      color: #475569;
      margin: 0;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 16px;
      margin-bottom: 16px;
    }
    .meta-card {
      background-color: #F1F5F9;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      padding: 12px 16px;
    }
    .meta-card h4 {
      margin: 0 0 6px;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #64748B;
    }
    .meta-card p {
      margin: 0;
      font-size: 14px;
      color: #1E293B;
      line-height: 1.4;
    }
    .mono {
      font-family: 'Courier New', monospace;
      font-weight: bold;
      color: #1E3A8A;
    }
    .footer {
      font-size: 13px;
      color: #64748B;
      border-top: 1px solid #E2E8F0;
      padding-top: 10px;
    }
  </style>
</head>
<body>
  <!-- Title Slide -->
  <div class="slide" style="background: linear-gradient(135deg, #1E3A8A 0%, #0F172A 100%); color: #FFFFFF; justify-content: center; text-align: center; padding: 60px;">
    <div style="font-size: 16px; letter-spacing: 3px; text-transform: uppercase; color: #93C5FD; margin-bottom: 16px; font-weight: bold;">
      IELTS LISTENING MASTERCLASS — GIÁO ÁN DICTATION & SHADOWING
    </div>
    <h1 style="font-size: 42px; margin: 0 0 16px; font-weight: 800; line-height: 1.2;">
      ${testPack.title}
    </h1>
    <div style="font-size: 20px; color: #E2E8F0; margin-bottom: 30px;">
      ${testPack.partLabel} · Target Band: ${testPack.bandTarget || '7.0+'} · Topic: ${testPack.topic || 'Academic'}
    </div>
    <div style="display: inline-block; background-color: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); border-radius: 30px; padding: 10px 24px; font-size: 15px;">
      Bộ ${drills.length} câu đắt giá nhất phục vụ luyện nghe chép & nhại giọng tại lớp
    </div>
  </div>

  ${vocabSlide}
  ${slidesHtml}
</body>
</html>`;

  downloadFile(
    fullHtml,
    `Slide_Giao_An_${safeTitle}_${testPack.partLabel.replace(/\s+/g, '_')}.html`,
    'text/html'
  );
}
