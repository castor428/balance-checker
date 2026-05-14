/*
 * parsers.js — 별표별 xlsx 시트 파서
 *
 * SheetJS가 읽은 워크북을 받아, 각 별표를 공통 데이터 모델로 정규화한다.
 * 시트·열 위치는 constants.js 참조. 행 구조는 e-호조 표준 결산서 서식 기준.
 */

/* ---------- 공통 유틸 ---------- */

// 셀 값을 숫자로. 빈칸(" ")·null·쉼표포함문자열 모두 처리. 숫자 아니면 null.
function parseNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '').replace(/\s/g, '').replace(/△/g, '-');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// 셀 값을 정리된 문자열로.
function cellText(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

// 날짜 문자열 정규화: "2024-10-30" / "2024.10.30" → "2024-10-30"
function normDate(v) {
  const s = cellText(v).replace(/[.]/g, '-').replace(/\s/g, '');
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

// "2024-10-30    ~     2025-07-29" → { start, end }
function parsePeriod(v) {
  const s = cellText(v);
  const parts = s.split(/~|∼|～|-{2,}/);
  if (parts.length >= 2) {
    return { start: normDate(parts[0]), end: normDate(parts[parts.length - 1]) };
  }
  return { start: normDate(s), end: '' };
}

// 시트명 부분일치로 워크시트 찾기
function findSheet(wb, regex) {
  const name = wb.SheetNames.find((n) => regex.test(n));
  if (!name) return null;
  return { name, rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: true, defval: null }) };
}

function isFooter(s) {
  return /^-\s*\d+\s*-$/.test(cellText(s));
}

/* ---------- 별표 8 — 주요사업 추진현황 ---------- */

function parseByeolpyo8(wb) {
  const sheet = findSheet(wb, SHEET.byeolpyo8.match);
  if (!sheet) return { sheetFound: false, rows: [], total: null };
  const C = COL_B8;
  const rows = [];
  let total = null;

  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const name = cellText(row[C.사업명]);
    const cost = parseNum(row[C.총사업비]);

    if (name === '계' && cost !== null) {
      total = {
        총사업비: cost,
        기투자: parseNum(row[C.기투자]),
        당해사업비: parseNum(row[C.당해사업비]),
        _row: r,
      };
      continue;
    }
    // 본 데이터 행: 사업명 + 총사업비(숫자)
    if (name && cost !== null) {
      const next = sheet.rows[r + 1] || [];
      rows.push({
        사업명: name,
        총사업비: cost,
        사업기간: parsePeriod(row[C.사업기간]),
        기투자: parseNum(row[C.기투자]),
        당해사업비: parseNum(row[C.당해사업비]),
        진도율: parseNum(row[C.진도율]),
        주관부서: cellText(row[C.주관부서]),
        사업내용: cellText(next[C.사업내용]),
        _row: r,
      });
    }
  }
  return { sheetFound: true, sheetName: sheet.name, rows, total };
}

/* ---------- 별표 12-1 — 계속비결산명세서 총괄 ---------- */

function parseByeolpyo12_1(wb) {
  const sheet = findSheet(wb, SHEET.byeolpyo12_1.match);
  if (!sheet) return { sheetFound: false, sections: [] };
  const C = COL_B12_1;
  // 회계구분 헤더가 페이지마다 반복되므로 회계명으로 섹션을 병합한다.
  const sectionMap = new Map();
  let cur = null;

  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const c0 = cellText(row[C.사업명]);
    if (!c0 || isFooter(c0)) continue;

    // 회계구분 섹션 헤더: 단위표시 칸에 "(단위:원)"
    if (cellText(row[C.단위표시]).includes('단위')) {
      const key = c0.replace(/\s/g, '');
      if (!sectionMap.has(key)) sectionMap.set(key, { 회계: c0, total: null, rows: [] });
      cur = sectionMap.get(key);
      continue;
    }
    if (!cur) continue; // 섹션 시작 전 (제목행 등) 무시
    if (c0 === '사업명' || c0.includes('예산성립후증감')) continue; // 표 헤더 (페이지마다 반복)

    const norm = c0.replace(/\s/g, '');
    const rec = {
      사업명: c0,
      예산액: parseNum(row[C.예산액]),
      예산현액: parseNum(row[C.예산현액]),
      지출액: parseNum(row[C.지출액]),
      다음연도이월액: parseNum(row[C.다음연도이월액]),
      집행잔액: parseNum(row[C.집행잔액]),
      _row: r,
    };
    if (norm === '합계') {
      if (!cur.total) cur.total = rec;
    } else if (rec.예산현액 !== null || rec.지출액 !== null || rec.다음연도이월액 !== null) {
      cur.rows.push(rec);
    }
  }
  return { sheetFound: true, sheetName: sheet.name, sections: [...sectionMap.values()] };
}

/* ---------- 별표 12-2 — 계속비결산명세서 사업별(일반) ---------- */

function parseByeolpyo12_2(wb) {
  const sheet = findSheet(wb, SHEET.byeolpyo12_2.match);
  if (!sheet) return { sheetFound: false, blocks: [] };
  const C = COL_B12_2;
  const blocks = [];
  let cur = null;
  let inTotalTable = false;

  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const c0 = cellText(row[0]);

    if (c0.includes('세부사업명')) {
      const name = c0.split(':').slice(1).join(':').trim();
      cur = { 세부사업명: name, years: [], _row: r };
      blocks.push(cur);
      inTotalTable = false;
      continue;
    }
    if (!cur) continue;
    if (c0.includes('[총')) { inTotalTable = true; continue; }
    if (c0.includes('[당해')) { inTotalTable = false; continue; }

    if (inTotalTable && /^\d{4}$/.test(c0)) {
      cur.years.push({
        연도: Number(c0),
        예산액: parseNum(row[C.예산액]),
        전년도이월사업비: parseNum(row[C.전년도이월사업비]),
        예산현액: parseNum(row[C.예산현액]),
        지출액: parseNum(row[C.지출액]),
        다음연도이월액: parseNum(row[C.다음연도이월액]),
        집행잔액: parseNum(row[C.집행잔액]),
        _row: r,
      });
    }
  }
  return { sheetFound: true, sheetName: sheet.name, blocks };
}

/* ---------- 별표 14-2 — 이월사유별현황(계속비) ---------- */

// 14-2 데이터 행 배열 → 세부사업별 그룹 (총사업비는 그룹 내 유일한 비어있지 않은 값)
function buildByeolpyo14_2Groups(rows) {
  const groupMap = new Map();
  for (const rec of rows) {
    if (!groupMap.has(rec.세부사업)) {
      groupMap.set(rec.세부사업, {
        세부사업: rec.세부사업,
        조직: rec.조직,
        총사업비: null,
        사업기간: rec.사업기간,
        통계목: [],
        지출액합: 0,
        계속비이월액합: 0,
        _rows: [],
      });
    }
    const g = groupMap.get(rec.세부사업);
    if (rec.총사업비 !== null && g.총사업비 === null) g.총사업비 = rec.총사업비;
    g.통계목.push(rec.통계목);
    if (rec.지출액 !== null) g.지출액합 += rec.지출액;
    if (rec.계속비이월액 !== null) g.계속비이월액합 += rec.계속비이월액;
    g._rows.push(rec._row);
  }
  return [...groupMap.values()];
}

function parseByeolpyo14_2(wb) {
  const sheet = findSheet(wb, SHEET.byeolpyo14_2.match);
  if (!sheet) return { sheetFound: false, rows: [], groups: [], total: null, sections: [] };
  const C = COL_B14_2;
  // "회계구분 : XX회계" 헤더가 페이지마다 반복되므로 회계명으로 섹션을 병합한다.
  const sectionMap = new Map();
  let cur = null;
  const getSection = (name) => {
    const key = name.replace(/\s/g, '');
    if (!sectionMap.has(key)) sectionMap.set(key, { 회계: name, total: null, rows: [] });
    return sectionMap.get(key);
  };

  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const c0 = cellText(row[C.조직]);
    if (!c0 || isFooter(c0)) continue;

    // 회계구분 섹션 헤더
    if (c0.startsWith('회계구분')) {
      cur = getSection(c0.split(':').slice(1).join(':').trim() || '미상회계');
      continue;
    }
    // 합계 행 (회계별로 각각 존재)
    if (c0.replace(/\s/g, '').startsWith('합계')) {
      if (cur && !cur.total) {
        cur.total = {
          총사업비: parseNum(row[C.총사업비]),
          예산현액: parseNum(row[C.예산현액]),
          지출원인행위액: parseNum(row[C.지출원인행위액]),
          지출액: parseNum(row[C.지출액]),
          계속비이월액: parseNum(row[C.계속비이월액]),
          _row: r,
        };
      }
      continue;
    }
    if (!cur) continue;

    const subName = cellText(row[C.세부사업]);
    const period = cellText(row[C.사업기간]);
    // 데이터 주행: 세부사업명 + 사업기간(날짜) 보유. 표 헤더 행은 세부사업명이 비어 있어 자동 제외.
    if (subName && /\d{4}/.test(period)) {
      const next = sheet.rows[r + 1] || [];
      cur.rows.push({
        조직: c0,
        부문: cellText(row[C.부문]),
        세부사업: subName,
        통계목: cellText(row[C.통계목]),
        사업기간: { start: normDate(period), end: normDate(next[C.사업기간]) },
        총사업비: parseNum(row[C.총사업비]),
        예산현액: parseNum(row[C.예산현액]),
        지출원인행위액: parseNum(row[C.지출원인행위액]),
        지출액: parseNum(row[C.지출액]),
        계속비이월액: parseNum(row[C.계속비이월액]),
        이월사유: cellText(row[C.이월사유]),
        _row: r,
      });
    }
  }

  const sections = [...sectionMap.values()].map((s) => ({ ...s, groups: buildByeolpyo14_2Groups(s.rows) }));
  // 별표8·12-1·12-2(일반)과 대조하므로 최상위 rows/groups/total 은 일반회계 섹션 기준
  const gen = sections.find((s) => s.회계.replace(/\s/g, '').includes('일반회계')) ||
    sections[0] || { rows: [], groups: [], total: null };
  return { sheetFound: true, sheetName: sheet.name, sections, rows: gen.rows, groups: gen.groups, total: gen.total };
}

/* ---------- 통합 진입점 ---------- */

function parseWorkbook(wb) {
  return {
    byeolpyo8: parseByeolpyo8(wb),
    byeolpyo12_1: parseByeolpyo12_1(wb),
    byeolpyo12_2: parseByeolpyo12_2(wb),
    byeolpyo14_2: parseByeolpyo14_2(wb),
  };
}

window.parseWorkbook = parseWorkbook;
window._parseNum = parseNum; // 점검 모듈에서 재사용
