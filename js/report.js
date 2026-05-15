/*
 * report.js — 전수 검증 결과 화면 렌더링 및 CSV 내보내기
 *   상단: 커버리지(전수 증명) → 검산 실패 목록(패스별) → 검증 불가 외톨이
 */

function fmtVal(v) {
  if (typeof v === 'number') return { text: v.toLocaleString('ko-KR'), num: true };
  return { text: v == null ? '' : String(v), num: false };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

/* ---------- 커버리지 패널 (전수 증명) ---------- */
function renderCoverage(coverage, fileInfo) {
  const c = coverage;
  let html = '';
  html += `<div class="stat ${c.실패건수 ? 'warn' : 'ok'}"><div class="num">${c.실패건수}</div><div class="lbl">검산 실패 (확인 필요)</div></div>`;
  html += `<div class="stat"><div class="num">${c.숫자셀수.toLocaleString('ko-KR')}</div><div class="lbl">검사한 숫자 셀</div></div>`;
  html += `<div class="stat ${c.커버리지율 >= 95 ? 'ok' : ''}"><div class="num">${c.커버리지율}%</div><div class="lbl">전수 검산 커버리지</div></div>`;
  html += `<div class="stat ${c.외톨이수 ? 'warn' : 'ok'}"><div class="num">${c.외톨이수.toLocaleString('ko-KR')}</div><div class="lbl">검증 불가 (육안 확인)</div></div>`;

  html += `<div class="stat" style="flex:1 1 100%"><div class="lbl">`;
  html += `📂 인식한 파일: ${fileInfo.join(', ') || '없음'}<br>`;
  html += `🔬 전수 적용 범위: ${c.시트수}개 시트 · ${c.데이터행수.toLocaleString('ko-KR')}개 데이터행 · ${c.검산항목수}개 검산 패스를 모든 행에 빠짐없이 적용했습니다. `;
  html += `검사한 ${c.숫자셀수.toLocaleString('ko-KR')}개 숫자 셀 중 ${c.터치된셀수.toLocaleString('ko-KR')}개가 1개 이상의 검산 관계에 포함되었고, 나머지 ${c.외톨이수.toLocaleString('ko-KR')}개는 자동 검증할 관계식이 없어 "육안 확인" 목록으로 분리했습니다.`;
  html += `</div></div>`;
  document.getElementById('summary').innerHTML = html;
}

/* ---------- 검산 결과 (패스별 그룹) — 이상 있는 검산만 펼쳐서 표시 ---------- */
function renderChecks(checks) {
  const passOrder = ['행내 산식', '합계행 검산', '계층 소계', '표 간 교차', '구조 무결성'];
  const byPass = {};
  for (const c of checks) (byPass[c.pass] = byPass[c.pass] || []).push(c);

  let html = '';
  const passedAll = []; // 이상 없는 검산은 한 줄 요약으로 묶어 맨 아래에 표시

  for (const pass of passOrder) {
    const group = byPass[pass];
    if (!group) continue;
    const failing = group.filter((c) => c.issues.length > 0);
    for (const c of group) if (c.issues.length === 0) passedAll.push(c.title);
    if (!failing.length) continue;
    const passTotal = failing.reduce((n, c) => n + c.issues.length, 0);
    html += `<h2 class="pass-head">${pass} <span class="pass-count">${passTotal}건</span></h2>`;
    for (const c of failing) {
      html += `<div class="check-block">`;
      html += `<div class="check-head"><h3>${escapeHtml(c.title)}</h3><span class="count has">${c.issues.length}건</span></div>`;
      html += `<div class="check-desc">${escapeHtml(c.desc)}</div>`;
      html += `<table><thead><tr>${c.columns.map((col) => `<th>${escapeHtml(col)}</th>`).join('')}</tr></thead><tbody>`;
      for (const issue of c.issues) {
        html += '<tr>';
        for (const col of c.columns) {
          const f = fmtVal(issue[col]);
          html += `<td class="${f.num ? 'num' : ''}">${escapeHtml(f.text)}</td>`;
        }
        html += '</tr>';
      }
      html += `</tbody></table></div>`;
    }
  }

  if (passedAll.length) {
    html += `<h2 class="pass-head">✓ 통과한 검산 <span class="pass-count" style="color:#2f7a3f">${passedAll.length}개 이상 없음</span></h2>`;
    html += `<div class="check-block"><div class="check-desc passed-list">`;
    html += passedAll.map((t) => escapeHtml(t)).join(' · ');
    html += `</div></div>`;
  }
  return html;
}

/* ---------- 검증 불가 외톨이 ---------- */
function renderOrphans(coverage) {
  if (!coverage.외톨이수) return '';
  let html = `<h2 class="pass-head">검증 불가 — 육안 확인 필요 <span class="pass-count">${coverage.외톨이수}건</span></h2>`;
  html += `<div class="check-block"><div class="check-desc">아래 숫자 셀들은 자동으로 검산할 산술 관계(산식·합계·계층·교차)가 없어 기계 검증이 불가능합니다. 해당 항목은 작성자가 직접 눈으로 확인하세요.</div>`;
  html += `<table><thead><tr><th>표</th><th>항목</th><th>검증 불가 셀 수</th></tr></thead><tbody>`;
  for (const sheet in coverage.외톨이상세) {
    for (const field in coverage.외톨이상세[sheet]) {
      html += `<tr><td>${escapeHtml(sheet)}</td><td>${escapeHtml(field)}</td><td class="num">${coverage.외톨이상세[sheet][field]}</td></tr>`;
    }
  }
  html += `</tbody></table></div>`;
  return html;
}

function renderReport(result, fileInfo) {
  renderCoverage(result.coverage, fileInfo);
  document.getElementById('report').innerHTML = renderChecks(result.checks) + renderOrphans(result.coverage);
}

/* ---------- CSV 내보내기 ---------- */
function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsv(result, fileInfo) {
  const lines = [];
  const c = result.coverage;
  lines.push(csvCell(`결산서 전수 정합성 점검 결과`));
  lines.push(csvCell(`생성일시: ${new Date().toLocaleString('ko-KR')}`));
  lines.push(csvCell(`인식 파일: ${fileInfo.join(' / ')}`));
  lines.push(csvCell(`전수 커버리지: ${c.커버리지율}% (숫자셀 ${c.숫자셀수} / 검증 ${c.터치된셀수} / 외톨이 ${c.외톨이수} / 실패 ${c.실패건수})`));
  lines.push('');
  // 실패한 검산만 자세히 적고, 통과한 것들은 맨 아래 한 줄 요약
  const passed = [];
  for (const chk of result.checks) {
    if (!chk.issues.length) { passed.push(chk.title); continue; }
    lines.push(`${csvCell(chk.title)},${csvCell(chk.issues.length + '건')}`);
    lines.push(chk.columns.map(csvCell).join(','));
    for (const issue of chk.issues) lines.push(chk.columns.map((col) => csvCell(issue[col])).join(','));
    lines.push('');
  }
  if (passed.length) {
    lines.push(`${csvCell('✓ 다음 ' + passed.length + '개 검산은 이상 없음')},${csvCell(passed.join(' · '))}`);
    lines.push('');
  }
  if (c.외톨이수) {
    lines.push(csvCell('[검증 불가 — 육안 확인] 표,항목,셀 수'));
    for (const sheet in c.외톨이상세) {
      for (const field in c.외톨이상세[sheet]) {
        lines.push([csvCell(sheet), csvCell(field), c.외톨이상세[sheet][field]].join(','));
      }
    }
  }
  return '﻿' + lines.join('\r\n');
}

function downloadCsv(result, fileInfo) {
  const blob = new Blob([buildCsv(result, fileInfo)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `결산서_전수점검_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

window.renderReport = renderReport;
window.downloadCsv = downloadCsv;
