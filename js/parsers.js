/*
 * parsers.js — 결산서 xlsx 시트 파서
 *
 * 각 파서는 워크북을 받아 두 가지를 함께 내보낸다:
 *   1) 리치 구조 (parser-specific) — 표 간 교차검증 빌더가 사용
 *   2) units[] (공통 모델)         — 전수 검증 엔진의 범용 패스가 사용
 *
 * units[] 의 각 원소(UnitRow):
 *   { _row, _key, _depth, _isTotal, _section, n: { 항목명: number|null } }
 *     _row     : 엑셀 행 인덱스 (0-based)
 *     _key     : 행 식별자 (사업명·과목·연도 등)
 *     _depth   : 계층 깊이 (0=최상위, null=계층 없음)
 *     _isTotal : "계"·"합계" 행 여부
 *     _section : 회계구분 등 구획 키 (null 가능)
 *     n        : 숫자 항목들 — 엔진의 산식·합계·계층·교차·커버리지가 이 값들을 검산
 */

/* ---------- 공통 유틸 ---------- */

function parseNum(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/,/g, '').replace(/\s/g, '').replace(/△/g, '-');
  if (s === '' || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function cellText(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function normDate(v) {
  const s = cellText(v).replace(/[.]/g, '-').replace(/\s/g, '');
  const m = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (!m) return '';
  return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
}

function parsePeriod(v) {
  const s = cellText(v);
  const parts = s.split(/~|∼|～|-{2,}/);
  if (parts.length >= 2) {
    return { start: normDate(parts[0]), end: normDate(parts[parts.length - 1]) };
  }
  return { start: normDate(s), end: '' };
}

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
  if (!sheet) return { specId: 'b8', found: false, rows: [], total: null, units: [] };
  const C = COL_B8;
  const rows = [];
  let total = null;
  const units = [];

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
      units.push({
        _row: r, _key: '계', _depth: null, _isTotal: true, _section: null,
        n: { 총사업비: cost, 기투자: total.기투자, 당해사업비: total.당해사업비 },
      });
      continue;
    }
    if (name && cost !== null) {
      const next = sheet.rows[r + 1] || [];
      const rec = {
        사업명: name,
        총사업비: cost,
        사업기간: parsePeriod(row[C.사업기간]),
        기투자: parseNum(row[C.기투자]),
        당해사업비: parseNum(row[C.당해사업비]),
        진도율: parseNum(row[C.진도율]),
        주관부서: cellText(row[C.주관부서]),
        사업내용: cellText(next[C.사업내용]),
        _row: r,
      };
      rows.push(rec);
      units.push({
        _row: r, _key: name, _depth: null, _isTotal: false, _section: null,
        n: { 총사업비: rec.총사업비, 기투자: rec.기투자, 당해사업비: rec.당해사업비 },
      });
    }
  }
  return { specId: 'b8', found: true, sheetName: sheet.name, rows, total, units };
}

/* ---------- 별표 12-1 — 계속비결산명세서 총괄 ---------- */

function parseByeolpyo12_1(wb) {
  const sheet = findSheet(wb, SHEET.byeolpyo12_1.match);
  if (!sheet) return { specId: 'b12_1', found: false, sections: [], units: [] };
  const C = COL_B12_1;
  const sectionMap = new Map();
  const units = [];
  let cur = null;

  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];
    const c0 = cellText(row[C.사업명]);
    if (!c0 || isFooter(c0)) continue;

    if (cellText(row[C.단위표시]).includes('단위')) {
      const key = c0.replace(/\s/g, '');
      if (!sectionMap.has(key)) sectionMap.set(key, { 회계: c0, total: null, rows: [] });
      cur = sectionMap.get(key);
      continue;
    }
    if (!cur) continue;
    if (c0 === '사업명' || c0.includes('예산성립후증감')) continue;

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
    const isTotal = norm === '합계';
    if (isTotal) {
      if (!cur.total) cur.total = rec;
    } else if (rec.예산현액 !== null || rec.지출액 !== null || rec.다음연도이월액 !== null) {
      cur.rows.push(rec);
    } else {
      continue;
    }
    units.push({
      _row: r, _key: c0, _depth: null, _isTotal: isTotal, _section: cur.회계,
      n: {
        예산액: rec.예산액, 예산현액: rec.예산현액, 지출액: rec.지출액,
        다음연도이월액: rec.다음연도이월액, 집행잔액: rec.집행잔액,
      },
    });
  }
  return { specId: 'b12_1', found: true, sheetName: sheet.name, sections: [...sectionMap.values()], units };
}

/* ---------- 별표 12-2 — 계속비결산명세서 사업별(일반) ---------- */

function parseByeolpyo12_2(wb) {
  const sheet = findSheet(wb, SHEET.byeolpyo12_2.match);
  if (!sheet) return { specId: 'b12_2', found: false, blocks: [], units: [] };
  const C = COL_B12_2;
  const blocks = [];
  const units = [];
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
      const y = {
        연도: Number(c0),
        예산액: parseNum(row[C.예산액]),
        전년도이월사업비: parseNum(row[C.전년도이월사업비]),
        예산현액: parseNum(row[C.예산현액]),
        지출액: parseNum(row[C.지출액]),
        다음연도이월액: parseNum(row[C.다음연도이월액]),
        집행잔액: parseNum(row[C.집행잔액]),
        _row: r,
      };
      cur.years.push(y);
      units.push({
        _row: r, _key: `${cur.세부사업명}/${y.연도}`, _depth: null, _isTotal: false, _section: cur.세부사업명,
        n: {
          예산액: y.예산액, 전년도이월사업비: y.전년도이월사업비, 예산현액: y.예산현액,
          지출액: y.지출액, 다음연도이월액: y.다음연도이월액, 집행잔액: y.집행잔액,
        },
      });
    }
  }
  return { specId: 'b12_2', found: true, sheetName: sheet.name, blocks, units };
}

/* ---------- 별표 14-2 — 이월사유별현황(계속비) ---------- */

function buildByeolpyo14_2Groups(rows) {
  const groupMap = new Map();
  for (const rec of rows) {
    if (!groupMap.has(rec.세부사업)) {
      groupMap.set(rec.세부사업, {
        세부사업: rec.세부사업, 조직: rec.조직, 총사업비: null,
        사업기간: rec.사업기간, 통계목: [], 지출액합: 0, 계속비이월액합: 0, _rows: [],
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
  if (!sheet) return { specId: 'b14_2', found: false, rows: [], groups: [], total: null, sections: [], units: [] };
  const C = COL_B14_2;
  const sectionMap = new Map();
  const units = [];
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

    if (c0.startsWith('회계구분')) {
      cur = getSection(c0.split(':').slice(1).join(':').trim() || '미상회계');
      continue;
    }
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
        units.push({
          _row: r, _key: `${cur.회계}/합계`, _depth: null, _isTotal: true, _section: cur.회계,
          n: {
            총사업비: cur.total.총사업비, 예산현액: cur.total.예산현액,
            지출원인행위액: cur.total.지출원인행위액, 지출액: cur.total.지출액,
            계속비이월액: cur.total.계속비이월액,
          },
        });
      }
      continue;
    }
    if (!cur) continue;

    const subName = cellText(row[C.세부사업]);
    const period = cellText(row[C.사업기간]);
    if (subName && /\d{4}/.test(period)) {
      const next = sheet.rows[r + 1] || [];
      const rec = {
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
      };
      cur.rows.push(rec);
      units.push({
        _row: r, _key: `${subName}/${rec.통계목}`, _depth: null, _isTotal: false, _section: cur.회계,
        n: {
          총사업비: rec.총사업비, 예산현액: rec.예산현액, 지출원인행위액: rec.지출원인행위액,
          지출액: rec.지출액, 계속비이월액: rec.계속비이월액,
        },
      });
    }
  }

  const sections = [...sectionMap.values()].map((s) => ({ ...s, groups: buildByeolpyo14_2Groups(s.rows) }));
  const gen = sections.find((s) => s.회계.replace(/\s/g, '').includes('일반회계')) ||
    sections[0] || { rows: [], groups: [], total: null };
  return { specId: 'b14_2', found: true, sheetName: sheet.name, sections, rows: gen.rows, groups: gen.groups, total: gen.total, units };
}

/* ---------- 통합 진입점 ----------
 * 첨부서류(파일5)·결산서(파일2) 워크북을 받아 specId → ParsedSheet 맵으로 반환.
 * 둘 중 하나는 null 가능. */

function parseAll(wbAttach, wbSettle) {
  const sheets = {};
  if (wbAttach) {
    sheets.b8 = parseByeolpyo8(wbAttach);
    sheets.b12_1 = parseByeolpyo12_1(wbAttach);
    sheets.b12_2 = parseByeolpyo12_2(wbAttach);
    sheets.b14_2 = parseByeolpyo14_2(wbAttach);
  }
  if (wbSettle && typeof parseSettlementSheets === 'function') {
    Object.assign(sheets, parseSettlementSheets(wbSettle));
  }
  return sheets;
}

// 워크북이 결산서(파일2)인지 첨부서류(파일5)인지 시트 내용으로 식별
function detectFileType(wb) {
  if (wb.SheetNames.some((n) => /주요사업\s*추진현황/.test(n))) return '첨부서류';
  if (wb.SheetNames.some((n) => /^세입결산총괄/.test(n))) return '결산서';
  return 'unknown';
}

// 업로드된 워크북 목록을 받아 종류별로 분류 후 파싱
function parseWorkbooks(wbList) {
  let attach = null, settle = null;
  for (const wb of wbList) {
    const t = detectFileType(wb);
    if (t === '첨부서류') attach = wb;
    else if (t === '결산서') settle = wb;
  }
  return { sheets: parseAll(attach, settle), hasAttach: !!attach, hasSettle: !!settle };
}

window.parseAll = parseAll;
window.detectFileType = detectFileType;
window.parseWorkbooks = parseWorkbooks;
// 공통 유틸 — settlement-parsers.js·engine.js 등에서 재사용 (node selftest 호환)
window.parseNum = parseNum;
window.cellText = cellText;
window.findSheet = findSheet;
window.isFooter = isFooter;
window.normDate = normDate;
window.parsePeriod = parsePeriod;
