/*
 * checks.js — 정합성·오류 점검 규칙 9종
 *
 * 각 규칙은 parseWorkbook() 결과를 받아 점검 결과 객체를 반환한다:
 *   { id, title, desc, columns: [열이름...], issues: [ {열이름: 값, ...} ] }
 * issues 가 비어 있으면 "이상 없음".
 */

/* ---------- 공통 ---------- */

function diff(a, b) {
  if (a === null || b === null) return null;
  return a - b;
}
function sameDate(a, b) {
  return (a || '') === (b || '');
}
// 별표12-1 일반회계 섹션 (없으면 첫 섹션)
function generalSection(data) {
  const ss = data.byeolpyo12_1.sections || [];
  return ss.find((s) => s.회계.replace(/\s/g, '').includes('일반회계')) || ss[0] || null;
}
// 별표12-2 블록의 당해연도(최신연도) 총괄 행
function latestYearRow(block) {
  if (!block.years || !block.years.length) return null;
  return block.years.reduce((a, b) => (b.연도 > a.연도 ? b : a));
}

/* ---------- 규칙 1 — 별표8 ↔ 별표14-2 총사업비 대조 ---------- */

function check1_totalCost(data) {
  const res = {
    id: 'C1',
    title: '별표8 ↔ 별표14-2 총사업비 대조',
    desc: '같은 사업의 총사업비가 별표8(주요사업추진현황)과 별표14-2(이월사유별현황·계속비)에서 일치하는지 점검합니다.',
    columns: ['사업명', '별표8 총사업비', '별표14-2 총사업비', '차이'],
    issues: [],
  };
  if (!data.byeolpyo8.sheetFound || !data.byeolpyo14_2.sheetFound) return res;
  const m = matchByName(data.byeolpyo14_2.groups, data.byeolpyo8.rows, '세부사업', '사업명');
  for (const { a, b } of m.matched) {
    if (a.총사업비 === null || b.총사업비 === null) continue;
    if (a.총사업비 !== b.총사업비) {
      res.issues.push({
        사업명: b.사업명,
        '별표8 총사업비': b.총사업비,
        '별표14-2 총사업비': a.총사업비,
        차이: b.총사업비 - a.총사업비,
      });
    }
  }
  return res;
}

/* ---------- 규칙 2 — 별표8 ↔ 별표14-2 사업기간 대조 ---------- */

function check2_period(data) {
  const res = {
    id: 'C2',
    title: '별표8 ↔ 별표14-2 사업기간 대조',
    desc: '같은 사업의 사업기간 시작·종료일이 별표8과 별표14-2에서 일치하는지 점검합니다.',
    columns: ['사업명', '별표8 사업기간', '별표14-2 사업기간', '불일치'],
    issues: [],
  };
  if (!data.byeolpyo8.sheetFound || !data.byeolpyo14_2.sheetFound) return res;
  const m = matchByName(data.byeolpyo14_2.groups, data.byeolpyo8.rows, '세부사업', '사업명');
  for (const { a, b } of m.matched) {
    const startDiff = !sameDate(a.사업기간.start, b.사업기간.start) && a.사업기간.start && b.사업기간.start;
    const endDiff = !sameDate(a.사업기간.end, b.사업기간.end) && a.사업기간.end && b.사업기간.end;
    if (startDiff || endDiff) {
      const which = [startDiff ? '시작일' : null, endDiff ? '종료일' : null].filter(Boolean).join(', ');
      res.issues.push({
        사업명: b.사업명,
        '별표8 사업기간': `${b.사업기간.start || '?'} ~ ${b.사업기간.end || '?'}`,
        '별표14-2 사업기간': `${a.사업기간.start || '?'} ~ ${a.사업기간.end || '?'}`,
        불일치: which,
      });
    }
  }
  return res;
}

/* ---------- 규칙 3 — 별표12-1 총괄 ↔ 별표12-2 사업별 합계 대조 ---------- */

function check3_b12sync(data) {
  const res = {
    id: 'C3',
    title: '별표12-1 총괄 ↔ 별표12-2 사업별 대조',
    desc: '별표12-1(총괄)의 사업별 금액이 별표12-2(사업별) 당해연도 총괄 행과 일치하는지 점검합니다.',
    columns: ['사업명', '항목', '별표12-1', '별표12-2(당해연도)', '차이'],
    issues: [],
  };
  if (!data.byeolpyo12_1.sheetFound || !data.byeolpyo12_2.sheetFound) return res;
  const sec = generalSection(data);
  if (!sec) return res;
  const m = matchByName(sec.rows, data.byeolpyo12_2.blocks, '사업명', '세부사업명');
  const fields = ['예산현액', '지출액', '다음연도이월액'];
  for (const { a, b } of m.matched) {
    const yr = latestYearRow(b);
    if (!yr) continue;
    for (const f of fields) {
      if (a[f] === null || yr[f] === null) continue;
      if (a[f] !== yr[f]) {
        res.issues.push({
          사업명: a.사업명,
          항목: f,
          '별표12-1': a[f],
          '별표12-2(당해연도)': yr[f],
          차이: a[f] - yr[f],
        });
      }
    }
  }
  return res;
}

/* ---------- 규칙 4 — 별표12-2 연도행 누락·중복 검출 ---------- */

function check4_b12_2structure(data) {
  const res = {
    id: 'C4',
    title: '별표12-2 연도행 누락·중복 검출',
    desc: '별표12-2에서 같은 사업이 중복 등재되었거나, 사업의 연도 행이 중간에 빠졌는지 점검합니다.',
    columns: ['세부사업명', '유형', '내용'],
    issues: [],
  };
  if (!data.byeolpyo12_2.sheetFound) return res;

  // 중복 등재
  const seen = new Map();
  for (const blk of data.byeolpyo12_2.blocks) {
    const k = normName(blk.세부사업명);
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push(blk);
  }
  for (const [, blks] of seen) {
    if (blks.length > 1) {
      res.issues.push({
        세부사업명: blks[0].세부사업명,
        유형: '중복 등재',
        내용: `같은 사업이 ${blks.length}회 등재됨 (엑셀 행 ${blks.map((b) => b._row + 1).join(', ')})`,
      });
    }
  }

  // 연도 시퀀스 끊김
  for (const blk of data.byeolpyo12_2.blocks) {
    const years = blk.years.map((y) => y.연도).sort((x, y) => x - y);
    if (years.length < 2) continue;
    const missing = [];
    for (let y = years[0]; y < years[years.length - 1]; y++) {
      if (!years.includes(y)) missing.push(y);
    }
    if (missing.length) {
      res.issues.push({
        세부사업명: blk.세부사업명,
        유형: '연도 행 누락',
        내용: `등재 연도 ${years.join('·')} — ${missing.join('·')}년 행 누락 의심`,
      });
    }
  }
  return res;
}

/* ---------- 규칙 5 — 별표12-2 이월액 연결 검증 ---------- */

function check5_carryover(data) {
  const res = {
    id: 'C5',
    title: '별표12-2 이월액 연결 검증',
    desc: 'n년도 "다음연도이월액"이 (n+1)년도 "전년도이월사업비"와 일치하는지 점검합니다.',
    columns: ['세부사업명', '연결 구간', 'n년 다음연도이월액', '(n+1)년 전년도이월사업비', '차이'],
    issues: [],
  };
  if (!data.byeolpyo12_2.sheetFound) return res;
  for (const blk of data.byeolpyo12_2.blocks) {
    const years = [...blk.years].sort((a, b) => a.연도 - b.연도);
    for (let i = 0; i < years.length - 1; i++) {
      const cur = years[i];
      const nxt = years[i + 1];
      if (nxt.연도 !== cur.연도 + 1) continue; // 연속 연도만
      if (cur.다음연도이월액 === null || nxt.전년도이월사업비 === null) continue;
      if (cur.다음연도이월액 !== nxt.전년도이월사업비) {
        res.issues.push({
          세부사업명: blk.세부사업명,
          '연결 구간': `${cur.연도} → ${nxt.연도}`,
          'n년 다음연도이월액': cur.다음연도이월액,
          '(n+1)년 전년도이월사업비': nxt.전년도이월사업비,
          차이: cur.다음연도이월액 - nxt.전년도이월사업비,
        });
      }
    }
  }
  return res;
}

/* ---------- 규칙 6 — 진도율 산식 검증 ---------- */

function check6_progress(data) {
  const res = {
    id: 'C6',
    title: '진도율 산식 검증',
    desc: '별표8의 종합진도(%)가 기투자÷총사업비 또는 (기투자+당해사업비)÷총사업비로 설명되는지 점검합니다. 어느 산식으로도 설명되지 않으면 산출근거 확인이 필요합니다.',
    columns: ['사업명', '표기 진도율(%)', '기투자÷총사업비(%)', '(기투자+당해)÷총사업비(%)', '판정'],
    issues: [],
  };
  if (!data.byeolpyo8.sheetFound) return res;
  const tol = TOLERANCE.진도율_퍼센트포인트;
  for (const row of data.byeolpyo8.rows) {
    if (row.진도율 === null || !row.총사업비) continue;
    const r1 = row.기투자 !== null ? (row.기투자 / row.총사업비) * 100 : null;
    const r2 =
      row.기투자 !== null && row.당해사업비 !== null
        ? ((row.기투자 + row.당해사업비) / row.총사업비) * 100
        : null;
    const cands = [r1, r2].filter((x) => x !== null);
    const ok = cands.some((c) => Math.abs(c - row.진도율) <= tol);
    if (!ok) {
      res.issues.push({
        사업명: row.사업명,
        '표기 진도율(%)': row.진도율,
        '기투자÷총사업비(%)': r1 === null ? '-' : r1.toFixed(1),
        '(기투자+당해)÷총사업비(%)': r2 === null ? '-' : r2.toFixed(1),
        판정: '산출근거 불명',
      });
    }
  }
  return res;
}

/* ---------- 규칙 7 — 합계행 검산 ---------- */

function check7_totals(data) {
  const res = {
    id: 'C7',
    title: '합계행 검산',
    desc: '각 별표의 "계"·"합계" 행 값이 데이터 행의 합산값과 일치하는지 점검합니다.',
    columns: ['표', '항목', '합계행 값', '데이터행 합산', '차이'],
    issues: [],
  };
  const add = (표, 항목, 합계, 합산) => {
    if (합계 === null || 합산 === null) return;
    if (합계 !== 합산) res.issues.push({ 표, 항목, '합계행 값': 합계, '데이터행 합산': 합산, 차이: 합계 - 합산 });
  };
  const sum = (arr, f) => arr.reduce((s, x) => s + (x[f] || 0), 0);

  if (data.byeolpyo8.sheetFound && data.byeolpyo8.total) {
    add('별표8', '총사업비', data.byeolpyo8.total.총사업비, sum(data.byeolpyo8.rows, '총사업비'));
    add('별표8', '기투자', data.byeolpyo8.total.기투자, sum(data.byeolpyo8.rows, '기투자'));
  }
  if (data.byeolpyo12_1.sheetFound) {
    for (const sec of data.byeolpyo12_1.sections) {
      if (!sec.total) continue;
      add(`별표12-1 (${sec.회계})`, '예산현액', sec.total.예산현액, sum(sec.rows, '예산현액'));
      add(`별표12-1 (${sec.회계})`, '지출액', sec.total.지출액, sum(sec.rows, '지출액'));
      add(`별표12-1 (${sec.회계})`, '다음연도이월액', sec.total.다음연도이월액, sum(sec.rows, '다음연도이월액'));
    }
  }
  if (data.byeolpyo14_2.sheetFound) {
    for (const sec of data.byeolpyo14_2.sections) {
      if (!sec.total) continue;
      add(`별표14-2 (${sec.회계})`, '총사업비', sec.total.총사업비, sum(sec.groups, '총사업비'));
      add(`별표14-2 (${sec.회계})`, '지출액', sec.total.지출액, sum(sec.rows, '지출액'));
      add(`별표14-2 (${sec.회계})`, '계속비이월액', sec.total.계속비이월액, sum(sec.rows, '계속비이월액'));
    }
  }
  return res;
}

/* ---------- 규칙 8 — 사업명 누락 교차검증 ---------- */

function check8_crossPresence(data) {
  const res = {
    id: 'C8',
    title: '사업명 누락 교차검증',
    desc: '계속비 사업이 별표12-1·별표12-2·별표14-2에 모두 등재되어 있는지 점검합니다. 한 표에만 있고 다른 표에 없으면 누락 또는 사업명 표기 불일치 가능성이 있습니다.',
    columns: ['사업명', '별표12-1', '별표12-2', '별표14-2'],
    issues: [],
  };
  const sec = generalSection(data);
  const names = new Map(); // normName -> { display, b121, b122, b142 }
  const touch = (raw, key) => {
    const k = normName(raw);
    if (!k) return;
    if (!names.has(k)) names.set(k, { display: raw, b121: false, b122: false, b142: false });
    names.get(k)[key] = true;
  };
  if (sec) sec.rows.forEach((r) => touch(r.사업명, 'b121'));
  if (data.byeolpyo12_2.sheetFound) data.byeolpyo12_2.blocks.forEach((b) => touch(b.세부사업명, 'b122'));
  if (data.byeolpyo14_2.sheetFound) data.byeolpyo14_2.groups.forEach((g) => touch(g.세부사업, 'b142'));

  // 하나라도 누락된 사업만 보고
  for (const v of names.values()) {
    if (v.b121 && v.b122 && v.b142) continue;
    res.issues.push({
      사업명: v.display,
      '별표12-1': v.b121 ? 'O' : 'X',
      '별표12-2': v.b122 ? 'O' : 'X',
      '별표14-2': v.b142 ? 'O' : 'X',
    });
  }
  return res;
}

/* ---------- 규칙 9 — 단순 오타 패턴 의심 (자릿수 오류) ---------- */

function check9_typoPattern(data) {
  const res = {
    id: 'C9',
    title: '오타 패턴 의심 (자릿수 오류)',
    desc: '별표8과 별표14-2의 같은 사업 총사업비가 정확히 10배·100배 차이나면 자릿수 입력 오류 가능성이 높습니다.',
    columns: ['사업명', '별표8 총사업비', '별표14-2 총사업비', '배수', '의심'],
    issues: [],
  };
  if (!data.byeolpyo8.sheetFound || !data.byeolpyo14_2.sheetFound) return res;
  const m = matchByName(data.byeolpyo14_2.groups, data.byeolpyo8.rows, '세부사업', '사업명');
  for (const { a, b } of m.matched) {
    if (!a.총사업비 || !b.총사업비) continue;
    const hi = Math.max(a.총사업비, b.총사업비);
    const lo = Math.min(a.총사업비, b.총사업비);
    const ratio = hi / lo;
    for (const factor of [10, 100, 1000]) {
      if (Math.abs(ratio - factor) / factor < 0.01) {
        res.issues.push({
          사업명: b.사업명,
          '별표8 총사업비': b.총사업비,
          '별표14-2 총사업비': a.총사업비,
          배수: `약 ${factor}배`,
          의심: '자릿수 입력 오류 의심',
        });
        break;
      }
    }
  }
  return res;
}

/* ---------- 통합 실행 ---------- */

function runAllChecks(data) {
  return [
    check1_totalCost(data),
    check2_period(data),
    check3_b12sync(data),
    check4_b12_2structure(data),
    check5_carryover(data),
    check6_progress(data),
    check7_totals(data),
    check8_crossPresence(data),
    check9_typoPattern(data),
  ];
}

window.runAllChecks = runAllChecks;
