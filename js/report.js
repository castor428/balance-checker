/*
 * report.js — 점검 결과 화면 렌더링 및 CSV 내보내기
 */

function fmtVal(v) {
  if (typeof v === 'number') {
    return { text: v.toLocaleString('ko-KR'), num: true };
  }
  return { text: v == null ? '' : String(v), num: false };
}

function renderSummary(data, checks) {
  const totalIssues = checks.reduce((s, c) => s + c.issues.length, 0);
  const sheets = [
    ['별표8', data.byeolpyo8.sheetFound],
    ['별표12-1', data.byeolpyo12_1.sheetFound],
    ['별표12-2', data.byeolpyo12_2.sheetFound],
    ['별표14-2', data.byeolpyo14_2.sheetFound],
  ];
  const missing = sheets.filter(([, f]) => !f).map(([n]) => n);

  let html = '';
  html += `<div class="stat ${totalIssues ? 'warn' : 'ok'}">
    <div class="num">${totalIssues}</div><div class="lbl">확인 필요 항목</div></div>`;
  html += `<div class="stat"><div class="num">${checks.filter((c) => c.issues.length).length}</div>
    <div class="lbl">이상 발견 점검규칙</div></div>`;
  html += `<div class="stat ${missing.length ? 'warn' : 'ok'}">
    <div class="num">${4 - missing.length}/4</div><div class="lbl">인식된 별표 시트</div></div>`;

  if (missing.length) {
    html += `<div class="stat warn" style="flex:1 1 100%">
      <div class="lbl">⚠ 인식하지 못한 시트: ${missing.join(', ')} — 해당 시트가 필요한 점검은 건너뛰었습니다.
      파일이 「5. 세입세출결산서 첨부서류」가 맞는지, 시트명이 바뀌지 않았는지 확인하세요.</div></div>`;
  }
  document.getElementById('summary').innerHTML = html;
}

function renderChecks(checks) {
  let html = '';
  for (const c of checks) {
    const n = c.issues.length;
    html += `<div class="check-block">`;
    html += `<div class="check-head"><h3>[${c.id}] ${c.title}</h3>
      <span class="count ${n ? 'has' : 'none'}">${n ? n + '건' : '이상 없음'}</span></div>`;
    html += `<div class="check-desc">${c.desc}</div>`;
    html += `<table><thead><tr>${c.columns.map((col) => `<th>${col}</th>`).join('')}</tr></thead><tbody>`;
    if (n === 0) {
      html += `<tr class="empty-row"><td colspan="${c.columns.length}">점검 결과 이상이 발견되지 않았습니다.</td></tr>`;
    } else {
      for (const issue of c.issues) {
        html += '<tr>';
        for (const col of c.columns) {
          const f = fmtVal(issue[col]);
          html += `<td class="${f.num ? 'num' : ''}">${escapeHtml(f.text)}</td>`;
        }
        html += '</tr>';
      }
    }
    html += `</tbody></table></div>`;
  }
  document.getElementById('report').innerHTML = html;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function renderReport(data, checks) {
  renderSummary(data, checks);
  renderChecks(checks);
}

/* ---------- CSV 내보내기 ---------- */

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(checks, fileName) {
  const lines = [];
  lines.push(csvCell(`결산서 정합성 점검 결과 — ${fileName}`));
  lines.push(csvCell(`생성일시: ${new Date().toLocaleString('ko-KR')}`));
  lines.push('');
  for (const c of checks) {
    lines.push(`${csvCell('[' + c.id + '] ' + c.title)},${csvCell(c.issues.length ? c.issues.length + '건' : '이상 없음')}`);
    if (c.issues.length) {
      lines.push(c.columns.map(csvCell).join(','));
      for (const issue of c.issues) {
        lines.push(c.columns.map((col) => csvCell(issue[col])).join(','));
      }
    }
    lines.push('');
  }
  return '﻿' + lines.join('\r\n'); // BOM — 엑셀 한글 깨짐 방지
}

function downloadCsv(checks, fileName) {
  const csv = buildCsv(checks, fileName);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `정합성점검_${fileName.replace(/\.xlsx$/i, '')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

window.renderReport = renderReport;
window.downloadCsv = downloadCsv;
