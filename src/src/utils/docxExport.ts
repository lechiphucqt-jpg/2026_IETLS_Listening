import type { ListeningTestPack } from '../types/ielts';

/**
 * Helper to trigger a file download in the browser.
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
 * Wraps clean HTML into a Microsoft Word compatible (.doc / .docx) document.
 */
function wrapWordHtml(title: string, bodyContent: string): string {
  return `<!DOCTYPE html>
<html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
<head>
  <meta charset='utf-8'>
  <title>${title}</title>
  <!--[if gte mso 9]>
  <xml>
    <w:WordDocument>
      <w:View>Print</w:View>
      <w:Zoom>100</w:Zoom>
      <w:DoNotOptimizeForBrowser/>
    </w:WordDocument>
  </xml>
  <![endif]-->
  <style>
    @page {
      size: A4 portrait;
      margin: 20mm 20mm 20mm 20mm;
      mso-header-margin: 10mm;
      mso-footer-margin: 10mm;
    }
    body {
      font-family: 'Times New Roman', 'Arial', serif;
      font-size: 12pt;
      line-height: 1.5;
      color: #111827;
      background-color: #ffffff;
      margin: 0;
      padding: 0;
    }
    h1, h2, h3, h4 {
      font-family: 'Arial', sans-serif;
      color: #0F172A;
      margin-top: 14pt;
      margin-bottom: 6pt;
    }
    h1 {
      font-size: 18pt;
      font-weight: bold;
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.5pt;
      color: #1E3A8A;
      margin-bottom: 2pt;
    }
    .subtitle {
      text-align: center;
      font-size: 10.5pt;
      color: #4B5563;
      margin-bottom: 16pt;
    }
    .candidate-box {
      border: 1.5pt solid #1E3A8A;
      background-color: #F8FAFC;
      padding: 10pt 14pt;
      margin-bottom: 18pt;
      border-radius: 4pt;
    }
    .candidate-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 6pt;
      font-size: 10.5pt;
    }
    .instruction-box {
      background-color: #EFF6FF;
      border-left: 3.5pt solid #2563EB;
      padding: 8pt 12pt;
      font-size: 11pt;
      margin-bottom: 16pt;
      font-weight: 500;
    }
    .question-item {
      margin-bottom: 14pt;
      page-break-inside: avoid;
    }
    .q-number {
      font-weight: bold;
      color: #1E3A8A;
      margin-right: 4pt;
    }
    .blank-line {
      display: inline-block;
      min-width: 140pt;
      border-bottom: 1pt solid #000000;
      margin: 0 4pt;
    }
    .dictation-card {
      border: 1pt solid #CBD5E1;
      border-radius: 4pt;
      padding: 10pt;
      margin-bottom: 14pt;
      background-color: #FAFAFA;
      page-break-inside: avoid;
    }
    .dictation-lines {
      margin-top: 10pt;
      border-bottom: 0.75pt dashed #94A3B8;
      height: 22pt;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10pt;
      margin-bottom: 14pt;
    }
    th, td {
      border: 1pt solid #CBD5E1;
      padding: 6pt 8pt;
      font-size: 10.5pt;
      text-align: left;
    }
    th {
      background-color: #F1F5F9;
      font-weight: bold;
      color: #0F172A;
    }
    .page-break {
      page-break-after: always;
    }
    .tag {
      font-family: 'Arial', sans-serif;
      font-size: 9pt;
      font-weight: bold;
      background-color: #E2E8F0;
      padding: 2pt 6pt;
      border-radius: 3pt;
      color: #334155;
    }
  </style>
</head>
<body>
  ${bodyContent}
</body>
</html>`;
}

/**
 * Export IDP Authentic IELTS Question Paper as Word (.doc / .docx)
 */
export function exportExamQuestionPaperDocx(testPack: ListeningTestPack) {
  const dateStr = new Date().toLocaleDateString('vi-VN');
  const safeTitle = testPack.title.replace(/[/\\?%*:|"<>]/g, '-');

  const questionsHtml = testPack.questions
    .map((q) => {
      let content = '';
      if (!q.options || q.options.length === 0) {
        content = `
          <div style="font-size: 11pt; margin-top: 4pt;">
            ${q.contextBefore || ''}
            <span class="blank-line">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span>
            <strong style="color: #2563EB;">[Question ${q.number}]</strong>
            ${q.contextAfter || ''}
          </div>
        `;
      } else {
        content = `
          <div style="margin-top: 6pt; margin-left: 14pt; font-size: 10.5pt;">
            ${q.options
              .map(
                (opt) => `
              <div style="margin-bottom: 3pt;">
                <strong>${opt.key}.</strong> ${opt.text}
              </div>
            `
              )
              .join('')}
          </div>
        `;
      }

      return `
        <div class="question-item">
          <p style="margin: 0; font-size: 11.5pt;">
            <span class="q-number">Question ${q.number}:</span> ${q.prompt}
          </p>
          ${content}
        </div>
      `;
    })
    .join('');

  const body = `
    <h1>IELTS LISTENING PRACTICE TEST</h1>
    <div class="subtitle">${testPack.title} — ${testPack.partLabel} · Target Band: ${testPack.bandTarget || '7.0+'}</div>

    <div class="candidate-box">
      <div class="candidate-row">
        <div><strong>Candidate Name:</strong> __________________________________________________</div>
        <div><strong>Candidate Number:</strong> _______________</div>
      </div>
      <div class="candidate-row" style="margin-bottom: 0;">
        <div><strong>Centre Name / Room:</strong> ____________________________________________</div>
        <div><strong>Date:</strong> ${dateStr}</div>
      </div>
    </div>

    <div class="instruction-box">
      <strong>INSTRUCTIONS TO CANDIDATES:</strong><br>
      • Answer all the questions in ${testPack.partLabel}.<br>
      • ${testPack.questions[0]?.wordLimitInstruction ? `<strong>Instruction:</strong> ${testPack.questions[0].wordLimitInstruction}` : 'Write NO MORE THAN TWO WORDS AND/OR A NUMBER for each answer.'}<br>
      • Write your answers in the spaces provided on this question paper.
    </div>

    <h2 style="font-size: 13pt; border-bottom: 1.5pt solid #1E3A8A; padding-bottom: 4pt; margin-bottom: 12pt;">
      QUESTIONS 1–${testPack.questions.length}
    </h2>

    ${questionsHtml}
  `;

  const fullDoc = wrapWordHtml(`IELTS_Question_Paper_${safeTitle}`, body);
  downloadFile(
    fullDoc,
    `De_Thi_IELTS_${safeTitle}_${testPack.partLabel.replace(/\s+/g, '_')}.doc`,
    'application/msword'
  );
}

/**
 * Export Classroom Dictation & Shadowing Worksheet as Word (.doc / .docx)
 */
export function exportDictationWorksheetDocx(testPack: ListeningTestPack) {
  const drills = testPack.classroomDrills && testPack.classroomDrills.length > 0
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

  const safeTitle = testPack.title.replace(/[/\\?%*:|"<>]/g, '-');
  const dateStr = new Date().toLocaleDateString('vi-VN');

  const drillsHtml = drills
    .map((item) => {
      return `
        <div class="dictation-card">
          <div style="display: flex; justify-content: space-between; font-size: 10pt; color: #64748B; margin-bottom: 4pt;">
            <span><strong style="color: #1E3A8A; font-size: 11pt;">Câu ${String(item.order).padStart(2, '0')}:</strong> ${item.speaker}</span>
            <span style="font-family: monospace; font-weight: bold; color: #2563EB;">Mốc nghe: ${item.timestampLabel} (${item.startSec.toFixed(1)}s – ${item.endSec.toFixed(1)}s)</span>
          </div>

          <div style="font-size: 10pt; color: #475569; margin-bottom: 6pt;">
            <em>Lý do chọn câu:</em> ${item.selectionReasonVi || 'Chứa cấu trúc bẫy & từ vựng quan trọng'}
            ${item.keyWords && item.keyWords.length > 0 ? ` · <strong>Từ khóa:</strong> ${item.keyWords.join(', ')}` : ''}
          </div>

          <div style="font-size: 10.5pt; font-weight: bold; color: #1E293B; margin-bottom: 6pt;">
            Phần chép chính tả của học sinh (Dictation Space):
          </div>
          <div class="dictation-lines"></div>
          <div class="dictation-lines"></div>

          <div style="margin-top: 8pt; padding-top: 6pt; border-top: 0.5pt solid #E2E8F0; font-size: 9.5pt; color: #475569;">
            ${item.stressPattern ? `<div><strong>Trọng âm chính:</strong> ${item.stressPattern}</div>` : ''}
            ${item.connectedSpeechNote ? `<div><strong>Hiện tượng nối âm:</strong> ${item.connectedSpeechNote}</div>` : ''}
          </div>
        </div>
      `;
    })
    .join('');

  const body = `
    <h1>GIÁO ÁN LUYỆN DICTATION & SHADOWING</h1>
    <div class="subtitle">Bộ ${drills.length} câu chọn lọc — ${testPack.title} (${testPack.partLabel}) · Ngày in: ${dateStr}</div>

    <div class="candidate-box">
      <div class="candidate-row">
        <div><strong>Họ và tên học sinh:</strong> __________________________________________________</div>
        <div><strong>Lớp:</strong> _______________</div>
      </div>
      <div class="candidate-row" style="margin-bottom: 0;">
        <div><strong>Giáo viên hướng dẫn:</strong> _______________________________________________</div>
        <div><strong>Số câu hoàn thành:</strong> _____ / ${drills.length}</div>
      </div>
    </div>

    <div class="instruction-box">
      <strong>HƯỚNG DẪN LUYỆN TẬP TẠI LỚP / Ở NHÀ:</strong><br>
      • <strong>Bước 1 (Dictation):</strong> Bật audio đoạn câu tương ứng 2–3 lần. Lắng nghe và chép lại nguyên văn từng từ vào các dòng kẻ.<br>
      • <strong>Bước 2 (Phân tích):</strong> So sánh đối chiếu từ nghe được với đáp án chuẩn, gạch chân âm nuốt và âm nối.<br>
      • <strong>Bước 3 (Shadowing):</strong> Nghe câu mẫu và đọc nhại theo đúng trọng âm và ngữ điệu tự nhiên.
    </div>

    <h2 style="font-size: 13pt; border-bottom: 1.5pt solid #1E3A8A; padding-bottom: 4pt; margin-bottom: 12pt;">
      DANH SÁCH ${drills.length} CÂU LUYỆN TẬP
    </h2>

    ${drillsHtml}
  `;

  const fullDoc = wrapWordHtml(`Dictation_Worksheet_${safeTitle}`, body);
  downloadFile(
    fullDoc,
    `Giao_An_Dictation_${safeTitle}_${testPack.partLabel.replace(/\s+/g, '_')}.doc`,
    'application/msword'
  );
}

/**
 * Export Teacher Complete Answer Key, Explanations & Transcript as Word (.doc / .docx)
 */
export function exportTeacherAnswerKeyDocx(testPack: ListeningTestPack) {
  const safeTitle = testPack.title.replace(/[/\\?%*:|"<>]/g, '-');
  const dateStr = new Date().toLocaleDateString('vi-VN');

  const answerTableRows = testPack.questions
    .map(
      (q) => `
    <tr>
      <td style="text-align: center; font-weight: bold;">${q.number}</td>
      <td style="font-weight: bold; color: #1E3A8A;">${q.correctAnswer}</td>
      <td style="font-family: monospace;">${q.timestampLabel}</td>
      <td>${q.paraphraseQuestion ? `${q.paraphraseQuestion} → ${q.paraphraseTranscript}` : '—'}</td>
      <td>${q.distractorType || 'None'}</td>
      <td>${q.explanationVi || 'Khớp trực tiếp thông tin trong audio.'}</td>
    </tr>
  `
    )
    .join('');

  const transcriptHtml = testPack.segments
    .map(
      (seg) => `
    <p style="margin-bottom: 6pt; font-size: 10.5pt; line-height: 1.6;">
      <span style="font-weight: bold; color: #1E3A8A;">${seg.speaker}</span>
      <span style="font-family: monospace; font-size: 9pt; color: #64748B;">[${seg.timestampLabel}]</span>:
      ${seg.text}
      ${seg.questionRef ? `<strong style="color: #DC2626;"> [★ Chứa đáp án Câu ${seg.questionRef}]</strong>` : ''}
    </p>
  `
    )
    .join('');

  const body = `
    <h1>BẢNG ĐÁP ÁN & GIẢI THÍCH CHI TIẾT (TEACHER KEY)</h1>
    <div class="subtitle">${testPack.title} — ${testPack.partLabel} · Ngày xuất: ${dateStr}</div>

    <h2>1. BẢNG TỔNG HỢP ĐÁP ÁN & BẪY THÔNG TIN</h2>
    <table>
      <thead>
        <tr>
          <th style="width: 35pt; text-align: center;">Câu</th>
          <th style="width: 100pt;">Đáp án chuẩn</th>
          <th style="width: 60pt;">Timestamp</th>
          <th style="width: 120pt;">Biến đổi từ khóa (Paraphrase)</th>
          <th style="width: 90pt;">Loại bẫy (Trap)</th>
          <th>Phân tích logic đáp án đúng</th>
        </tr>
      </thead>
      <tbody>
        ${answerTableRows}
      </tbody>
    </table>

    <div class="page-break"></div>

    <h2>2. TRANSCRIPT NGUYÊN VĂN BÀI NGHE (KÈM ĐÁNH DẤU VỊ TRÍ ĐÁP ÁN)</h2>
    <div style="background-color: #F8FAFC; border: 1pt solid #E2E8F0; padding: 12pt; border-radius: 4pt;">
      ${transcriptHtml}
    </div>
  `;

  const fullDoc = wrapWordHtml(`Teacher_Key_${safeTitle}`, body);
  downloadFile(
    fullDoc,
    `Dap_An_Va_Script_${safeTitle}_${testPack.partLabel.replace(/\s+/g, '_')}.doc`,
    'application/msword'
  );
}
