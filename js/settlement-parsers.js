/*
 * settlement-parsers.js — 「2. 결산서」(파일2) 시트 파서
 *
 * 결산서의 세입·세출 계열 시트는 "과목 라벨이 들어간 열 인덱스 = 계층 깊이" 구조다.
 * 시트별 설정(SETTLE_SHEETS)만 다를 뿐 파싱 로직은 공통(parseSettleSheet).
 *
 * 출력은 parsers.js 와 동일한 공통 모델(units[])이라 엔진이 그대로 전수 검산한다.
 *
 * ★ 결산서 서식이 바뀌어 열 위치가 달라지면 아래 SETTLE_SHEETS 의 cols 만 수정.
 */

const SETTLE_SHEETS = {
  세입결산총괄: {
    match: SHEET.세입결산총괄.match, labelCols: [0, 1, 2],
    cols: { 예산액: 3, 전년도이월액: 4, 예산현액: 5, 징수결정액: 6, 수납총액: 7, 물납액: 8, 환급액: 9, 실제수납액: 10, 정리보류액: 11, 미수납액: 12 },
  },
  세출결산총괄: {
    match: SHEET.세출결산총괄.match, labelCols: [0, 1, 2],
    cols: { 예산액: 2, 예산성립후증감액: 3, 예산현액: 4, 지출액: 5, 이월계: 7, 명시이월: 8, 사고이월: 9, 계속비이월: 10, 보조금반납금: 11, 집행잔액: 12 },
  },
  세입관별: {
    match: SHEET.세입관별.match, labelCols: [0, 1, 2],
    cols: { 예산액: 2, 전년도이월액: 4, 예산현액: 5, 징수결정액: 7, 수납총액: 8, 물납액: 9, 환급액: 10, 실제수납액: 11, 정리보류액: 12, 미수납액: 14 },
  },
  // 세입(목별)은 부서별 반복 헤더 구조라 계층 파싱 전용 보강 필요 — 후속 과제로 제외
  세출부문별: {
    match: SHEET.세출부문별.match, labelCols: [0, 1, 2],
    cols: { 예산액: 2, 예산성립후증감액: 3, 예산현액: 7, 지출액: 8, 이월계: 10, 명시이월: 11, 사고이월: 12, 계속비이월: 13, 보조금반납금: 14, 집행잔액: 15 },
  },
  세출목별: {
    match: SHEET.세출목별.match, labelCols: [0, 1, 2],
    cols: { 예산액: 3, 예산성립후증감액: 4, 예산현액: 8, 지출액: 11, 이월계: 12, 명시이월: 13, 사고이월: 14, 계속비이월: 15, 보조금반납금: 16, 집행잔액: 17 },
  },
  세출구조별: {
    match: SHEET.세출구조별.match, labelCols: [0, 1, 2],
    cols: { 예산액: 3, 예산성립후증감액: 5, 예산현액: 8, 지출액: 11, 이월계: 12, 명시이월: 13, 사고이월: 14, 계속비이월: 15, 보조금반납금: 16, 집행잔액: 17 },
  },
};

function isTotalLabel(s) {
  return s.replace(/\s/g, '') === '합계';
}
function isAccountSectionHeader(s) {
  // "일반회계", "기타특별회계" 등 — 회계로 끝나고 숫자가 없는 행
  return /회계$/.test(s.replace(/\s/g, '')) && s.replace(/\s/g, '').length <= 12;
}

function parseSettleSheet(wb, id, config) {
  const sheet = findSheet(wb, config.match);
  if (!sheet) return { specId: id, found: false, units: [] };
  const { labelCols, cols } = config;
  const raw = [];
  let curSection = null;

  for (let r = 0; r < sheet.rows.length; r++) {
    const row = sheet.rows[r] || [];

    // 라벨 위치 찾기 (labelCols 중 처음으로 비어있지 않은 열)
    let labelCol = -1, label = '';
    for (const c of labelCols) {
      const t = cellText(row[c]);
      if (t) { labelCol = c; label = t; break; }
    }
    if (labelCol < 0) continue;

    // 값 수집
    const n = {};
    let hasNum = false;
    for (const f in cols) {
      const v = parseNum(row[cols[f]]);
      n[f] = v;
      if (v !== null) hasNum = true;
    }

    // 숫자 없는 라벨 행 = 헤더 또는 회계구분 섹션 헤더
    if (!hasNum) {
      if (labelCol === labelCols[0] && isAccountSectionHeader(label)) curSection = label;
      continue;
    }
    raw.push({ _row: r, labelCol, label, isTotal: isTotalLabel(label), n, section: curSection });
  }

  // 비합계 데이터 행의 최소 labelCol = 계층 base (이 열이 깊이 0)
  const dataCols = raw.filter((x) => !x.isTotal).map((x) => x.labelCol);
  const base = dataCols.length ? Math.min(...dataCols) : 0;

  const units = raw.map((x) => ({
    _row: x._row, _key: x.label, _isTotal: x.isTotal, _section: x.section,
    _depth: x.isTotal ? null : Math.max(0, x.labelCol - base),
    n: x.n,
  }));
  return { specId: id, found: true, sheetName: sheet.name, units };
}

function parseSettlementSheets(wb) {
  const out = {};
  for (const id in SETTLE_SHEETS) out[id] = parseSettleSheet(wb, id, SETTLE_SHEETS[id]);
  return out;
}

window.parseSettlementSheets = parseSettlementSheets;
