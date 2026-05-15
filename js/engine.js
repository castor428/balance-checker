/*
 * engine.js — 전수(全數) 검증 엔진
 *
 * 등록된 모든 시트(constants.js 의 SHEET_SPECS)의 units[] 에 대해
 * 5종 검증 패스를 빠짐없이 적용하고, 각 검산이 "터치한 숫자 셀"을 기록한다.
 * 어느 패스에도 안 걸린 숫자 셀은 "검증 불가 외톨이"로 분리 — 이것이 전수의 증명.
 *
 *   Pass 1  행내 산식      — 헤더에 명시된 등식(㉰=㉮+㉯ 등)을 모든 행에서 검산
 *   Pass 2  합계행 검산    — "계"·"합계" 행 = 데이터 행 합산
 *   Pass 3  계층 소계      — 상위 과목 = 직속 하위 과목 합
 *   Pass 4  표 간 교차     — 같은 값이 여러 표/파일에 나오면 일치 검증
 *   Pass 5  구조 무결성    — 연도 행 누락·중복, 진도율 산출근거 등
 */

/* ===== 셀 터치 기록 ===== */
function cellKey(specId, row, field) {
  return `${specId}#${row}#${field}`;
}

/* ===== 산식 문자열 파서 ===== "결과 = 항목 + 항목 - 항목" */
function parseEq(eq) {
  const [lhs, rhs] = eq.split('=').map((s) => s.trim());
  const terms = [];
  let sign = 1;
  for (const t of rhs.split(/\s+/)) {
    if (t === '+') sign = 1;
    else if (t === '-') sign = -1;
    else if (t) { terms.push({ sign, f: t }); sign = 1; }
  }
  return { target: lhs, terms, eq };
}

/* ===== Pass 1 — 행내 산식 ===== */
function pass1_formulas(sheets, touched) {
  const results = [];
  for (const spec of SHEET_SPECS) {
    const ps = sheets[spec.id];
    if (!ps || !ps.found || !spec.formulas || !spec.formulas.length) continue;
    const res = {
      id: `F-${spec.id}`, pass: '행내 산식', title: `[행내 산식] ${spec.label}`,
      desc: '결산서 양식 헤더에 명시된 등식이 모든 행에서 성립하는지 검산합니다.',
      columns: ['구획', '행(엑셀)', '산식', '계산값', '표기값', '차이'], issues: [],
    };
    const eqs = spec.formulas.map((f) => parseEq(f.eq));
    for (const u of ps.units) {
      for (const { target, terms, eq } of eqs) {
        const actual = u.n[target];
        const hasTarget = actual !== null && actual !== undefined;
        const operandsAllPresent = terms.every((t) => u.n[t.f] !== null && u.n[t.f] !== undefined);
        // 결산서 회계 관행: 빈칸은 0과 동치. 타겟·피연산자 모두 빈칸이면 식 자체가 의미 없어 skip.
        if (!hasTarget && !operandsAllPresent) continue;
        let expected = 0;
        for (const t of terms) {
          const v = u.n[t.f];
          expected += t.sign * (v === null || v === undefined ? 0 : v);
        }
        const actualVal = hasTarget ? actual : 0;
        // 관련 셀 모두 터치 (null 셀은 allCells 에 없으므로 마킹해도 무해)
        touched.add(cellKey(spec.id, u._row, target));
        for (const t of terms) touched.add(cellKey(spec.id, u._row, t.f));
        if (Math.abs(actualVal - expected) > TOLERANCE.금액_원) {
          res.issues.push({
            구획: u._section || '-', '행(엑셀)': u._row + 1, 산식: eq,
            계산값: expected, 표기값: hasTarget ? actual : '(빈칸)', 차이: actualVal - expected,
          });
        }
      }
    }
    results.push(res);
  }
  return results;
}

/* ===== Pass 2 — 합계행 검산 ===== */
function pass2_totals(sheets, touched) {
  const res = {
    id: 'T-ALL', pass: '합계행 검산', title: '[합계행 검산] 전 시트',
    desc: '각 표의 "계"·"합계" 행이 데이터 행의 합산값과 일치하는지 검산합니다.',
    columns: ['표', '구획', '항목', '합계행 값', '데이터행 합산', '차이'], issues: [],
  };
  for (const spec of SHEET_SPECS) {
    const ps = sheets[spec.id];
    if (!ps || !ps.found) continue;
    // 구획(_section)별로 묶기
    const groups = new Map();
    for (const u of ps.units) {
      const k = u._section || '_';
      if (!groups.has(k)) groups.set(k, { totals: [], details: [] });
      (u._isTotal ? groups.get(k).totals : groups.get(k).details).push(u);
    }
    for (const [sec, g] of groups) {
      if (!g.totals.length) continue;
      // 계층 시트는 최상위(depth 0)만 합산, 아니면 전체 데이터 행 합산
      const base = spec.hierarchy ? g.details.filter((u) => u._depth === 0) : g.details;
      if (!base.length) continue;
      for (const tot of g.totals) {
        for (const field in tot.n) {
          const totVal = tot.n[field];
          if (totVal === null || totVal === undefined) continue;
          let sum = 0, any = false;
          for (const u of base) {
            const v = u.n[field];
            if (v !== null && v !== undefined) { sum += v; any = true; }
          }
          if (!any) continue;
          touched.add(cellKey(spec.id, tot._row, field));
          for (const u of base) {
            if (u.n[field] !== null && u.n[field] !== undefined) touched.add(cellKey(spec.id, u._row, field));
          }
          if (Math.abs(totVal - sum) > TOLERANCE.금액_원) {
            res.issues.push({
              표: spec.label, 구획: sec === '_' ? '-' : sec, 항목: field,
              '합계행 값': totVal, '데이터행 합산': sum, 차이: totVal - sum,
            });
          }
        }
      }
    }
  }
  return res;
}

/* ===== Pass 3 — 계층 소계 ===== */
function pass3_hierarchy(sheets, touched) {
  const res = {
    id: 'H-ALL', pass: '계층 소계', title: '[계층 소계 검산] 전 시트',
    desc: '상위 과목(장·관·분야·부문 등)의 값이 직속 하위 과목 합과 일치하는지 검산합니다.',
    columns: ['표', '상위 과목', '항목', '상위값', '하위 합산', '차이'], issues: [],
  };
  for (const spec of SHEET_SPECS) {
    const ps = sheets[spec.id];
    if (!ps || !ps.found || !spec.hierarchy) continue;
    const us = ps.units.filter((u) => !u._isTotal && u._depth !== null && u._depth !== undefined);
    for (let i = 0; i < us.length; i++) {
      const parent = us[i];
      // 직속 하위 = 바로 뒤 연속된 depth+1 행 (depth<=parent 만나면 종료)
      const children = [];
      for (let j = i + 1; j < us.length; j++) {
        if (us[j]._depth <= parent._depth) break;
        if (us[j]._depth === parent._depth + 1) children.push(us[j]);
      }
      if (!children.length) continue;
      for (const field in parent.n) {
        const pv = parent.n[field];
        if (pv === null || pv === undefined) continue;
        let sum = 0, any = false;
        for (const c of children) {
          const v = c.n[field];
          if (v !== null && v !== undefined) { sum += v; any = true; }
        }
        if (!any) continue;
        touched.add(cellKey(spec.id, parent._row, field));
        for (const c of children) {
          if (c.n[field] !== null && c.n[field] !== undefined) touched.add(cellKey(spec.id, c._row, field));
        }
        if (Math.abs(pv - sum) > TOLERANCE.금액_원) {
          res.issues.push({
            표: spec.label, '상위 과목': parent._key, 항목: field,
            상위값: pv, '하위 합산': sum, 차이: pv - sum,
          });
        }
      }
    }
  }
  return res;
}

/* ===== Pass 4 — 표 간 교차검증 ===== */

function mark(touched, specId, rows, field) {
  for (const r of [].concat(rows)) if (r !== null && r !== undefined) touched.add(cellKey(specId, r, field));
}
function latestYearRow(block) {
  if (!block.years || !block.years.length) return null;
  return block.years.reduce((a, b) => (b.연도 > a.연도 ? b : a));
}
function generalSection12_1(ps) {
  if (!ps || !ps.found) return null;
  const ss = ps.sections || [];
  return ss.find((s) => s.회계.replace(/\s/g, '').includes('일반회계')) || ss[0] || null;
}

function pass4_crossrefs(sheets, touched) {
  const results = [];
  const b8 = sheets.b8, b12_1 = sheets.b12_1, b12_2 = sheets.b12_2, b14_2 = sheets.b14_2;

  /* X1 — 별표8 ↔ 별표14-2 총사업비 */
  if (b8 && b8.found && b14_2 && b14_2.found) {
    const res = {
      id: 'X1', pass: '표 간 교차', title: '[교차] 별표8 ↔ 별표14-2 총사업비',
      desc: '같은 사업의 총사업비가 별표8과 별표14-2에서 일치하는지 검증합니다.',
      columns: ['사업명', '별표8 총사업비', '별표14-2 총사업비', '차이'], issues: [],
    };
    const m = matchByName(b14_2.groups, b8.rows, '세부사업', '사업명');
    for (const { a, b } of m.matched) {
      if (a.총사업비 === null || b.총사업비 === null) continue;
      mark(touched, 'b8', b._row, '총사업비');
      mark(touched, 'b14_2', a._rows, '총사업비');
      if (a.총사업비 !== b.총사업비) {
        res.issues.push({ 사업명: b.사업명, '별표8 총사업비': b.총사업비, '별표14-2 총사업비': a.총사업비, 차이: b.총사업비 - a.총사업비 });
      }
    }
    results.push(res);
  }

  /* X2 — 별표8 ↔ 별표14-2 사업기간 (날짜 — 커버리지 비대상) */
  if (b8 && b8.found && b14_2 && b14_2.found) {
    const res = {
      id: 'X2', pass: '표 간 교차', title: '[교차] 별표8 ↔ 별표14-2 사업기간',
      desc: '같은 사업의 사업기간 시작·종료일이 별표8과 별표14-2에서 일치하는지 검증합니다.',
      columns: ['사업명', '별표8 사업기간', '별표14-2 사업기간', '불일치'], issues: [],
    };
    const m = matchByName(b14_2.groups, b8.rows, '세부사업', '사업명');
    for (const { a, b } of m.matched) {
      const sd = a.사업기간.start && b.사업기간.start && a.사업기간.start !== b.사업기간.start;
      const ed = a.사업기간.end && b.사업기간.end && a.사업기간.end !== b.사업기간.end;
      if (sd || ed) {
        res.issues.push({
          사업명: b.사업명,
          '별표8 사업기간': `${b.사업기간.start || '?'} ~ ${b.사업기간.end || '?'}`,
          '별표14-2 사업기간': `${a.사업기간.start || '?'} ~ ${a.사업기간.end || '?'}`,
          불일치: [sd ? '시작일' : null, ed ? '종료일' : null].filter(Boolean).join(', '),
        });
      }
    }
    results.push(res);
  }

  /* X3 — 별표12-1 총괄 ↔ 별표12-2 사업별(당해연도) */
  if (b12_1 && b12_1.found && b12_2 && b12_2.found) {
    const res = {
      id: 'X3', pass: '표 간 교차', title: '[교차] 별표12-1 총괄 ↔ 별표12-2 사업별',
      desc: '별표12-1(총괄)의 사업별 금액이 별표12-2(사업별) 당해연도 총괄 행과 일치하는지 검증합니다.',
      columns: ['사업명', '항목', '별표12-1', '별표12-2(당해연도)', '차이'], issues: [],
    };
    const sec = generalSection12_1(b12_1);
    if (sec) {
      const m = matchByName(sec.rows, b12_2.blocks, '사업명', '세부사업명');
      for (const { a, b } of m.matched) {
        const yr = latestYearRow(b);
        if (!yr) continue;
        for (const f of ['예산현액', '지출액', '다음연도이월액']) {
          if (a[f] === null || yr[f] === null) continue;
          mark(touched, 'b12_1', a._row, f);
          mark(touched, 'b12_2', yr._row, f);
          if (a[f] !== yr[f]) {
            res.issues.push({ 사업명: a.사업명, 항목: f, '별표12-1': a[f], '별표12-2(당해연도)': yr[f], 차이: a[f] - yr[f] });
          }
        }
      }
    }
    results.push(res);
  }

  /* X4 — 별표12-2 이월액 연결 (n년 다음연도이월액 = n+1년 전년도이월사업비) */
  if (b12_2 && b12_2.found) {
    const res = {
      id: 'X4', pass: '표 간 교차', title: '[교차] 별표12-2 이월액 연결',
      desc: 'n년도 "다음연도이월액"이 (n+1)년도 "전년도이월사업비"와 일치하는지 검증합니다.',
      columns: ['세부사업명', '연결 구간', 'n년 다음연도이월액', '(n+1)년 전년도이월사업비', '차이'], issues: [],
    };
    for (const blk of b12_2.blocks) {
      const years = [...blk.years].sort((a, b) => a.연도 - b.연도);
      for (let i = 0; i < years.length - 1; i++) {
        const cur = years[i], nxt = years[i + 1];
        if (nxt.연도 !== cur.연도 + 1) continue;
        if (cur.다음연도이월액 === null || nxt.전년도이월사업비 === null) continue;
        mark(touched, 'b12_2', cur._row, '다음연도이월액');
        mark(touched, 'b12_2', nxt._row, '전년도이월사업비');
        if (cur.다음연도이월액 !== nxt.전년도이월사업비) {
          res.issues.push({
            세부사업명: blk.세부사업명, '연결 구간': `${cur.연도} → ${nxt.연도}`,
            'n년 다음연도이월액': cur.다음연도이월액, '(n+1)년 전년도이월사업비': nxt.전년도이월사업비,
            차이: cur.다음연도이월액 - nxt.전년도이월사업비,
          });
        }
      }
    }
    results.push(res);
  }

  /* X5 — 사업명 누락 교차검증 (별표12-1·12-2·14-2) */
  if ((b12_1 && b12_1.found) || (b12_2 && b12_2.found) || (b14_2 && b14_2.found)) {
    const res = {
      id: 'X5', pass: '표 간 교차', title: '[교차] 사업명 누락 교차검증',
      desc: '계속비 사업이 별표12-1·12-2·14-2 모두에 등재되어 있는지 검증합니다. 한 표에만 있으면 누락 또는 표기 불일치 가능성.',
      columns: ['사업명', '별표12-1', '별표12-2', '별표14-2'], issues: [],
    };
    const sec = generalSection12_1(b12_1);
    const names = new Map();
    const touch = (raw, key) => {
      const k = normName(raw);
      if (!k) return;
      if (!names.has(k)) names.set(k, { display: raw, b121: false, b122: false, b142: false });
      names.get(k)[key] = true;
    };
    if (sec) sec.rows.forEach((r) => touch(r.사업명, 'b121'));
    if (b12_2 && b12_2.found) b12_2.blocks.forEach((b) => touch(b.세부사업명, 'b122'));
    if (b14_2 && b14_2.found) b14_2.groups.forEach((g) => touch(g.세부사업, 'b142'));
    for (const v of names.values()) {
      if (v.b121 && v.b122 && v.b142) continue;
      res.issues.push({ 사업명: v.display, '별표12-1': v.b121 ? 'O' : 'X', '별표12-2': v.b122 ? 'O' : 'X', '별표14-2': v.b142 ? 'O' : 'X' });
    }
    results.push(res);
  }

  /* X6 — 오타 패턴 의심 (자릿수 오류) */
  if (b8 && b8.found && b14_2 && b14_2.found) {
    const res = {
      id: 'X6', pass: '표 간 교차', title: '[교차] 오타 패턴 의심 (자릿수 오류)',
      desc: '별표8과 별표14-2의 같은 사업 총사업비가 정확히 10·100배 차이나면 자릿수 입력 오류 가능성이 높습니다.',
      columns: ['사업명', '별표8 총사업비', '별표14-2 총사업비', '배수', '의심'], issues: [],
    };
    const m = matchByName(b14_2.groups, b8.rows, '세부사업', '사업명');
    for (const { a, b } of m.matched) {
      if (!a.총사업비 || !b.총사업비) continue;
      const ratio = Math.max(a.총사업비, b.총사업비) / Math.min(a.총사업비, b.총사업비);
      for (const factor of [10, 100, 1000]) {
        if (Math.abs(ratio - factor) / factor < 0.01) {
          res.issues.push({ 사업명: b.사업명, '별표8 총사업비': b.총사업비, '별표14-2 총사업비': a.총사업비, 배수: `약 ${factor}배`, 의심: '자릿수 입력 오류 의심' });
          break;
        }
      }
    }
    results.push(res);
  }

  /* X7 — 결산서 세출 일반회계 3중 대조 (부문별·목별·구조별) */
  {
    const ids = ['세출부문별', '세출목별', '세출구조별'];
    const totals = ids
      .map((id) => {
        const ps = sheets[id];
        if (!ps || !ps.found) return null;
        const t = ps.units.find((u) => u._isTotal);
        return t ? { id, label: (SHEET_SPEC_BY_ID[id] || {}).label || id, unit: t } : null;
      })
      .filter(Boolean);
    if (totals.length >= 2) {
      const res = {
        id: 'X7', pass: '표 간 교차', title: '[교차] 결산서 세출 일반회계 3중 대조',
        desc: '같은 일반회계 세출을 부문별·목별·구조별로 각각 집계한 합계가 서로 일치하는지 검증합니다. 작성 과정에서 한 절단면만 갱신되면 여기서 드러납니다.',
        columns: ['항목', '기준 시트', '기준값', '대조 시트', '대조값', '차이'], issues: [],
      };
      const fields = ['예산액', '예산현액', '지출액', '명시이월', '사고이월', '계속비이월', '이월계', '집행잔액', '보조금반납금'];
      const ref = totals[0];
      for (let i = 1; i < totals.length; i++) {
        const cmp = totals[i];
        for (const f of fields) {
          const a = ref.unit.n[f], b = cmp.unit.n[f];
          if (a === null || a === undefined || b === null || b === undefined) continue;
          mark(touched, ref.id, ref.unit._row, f);
          mark(touched, cmp.id, cmp.unit._row, f);
          if (a !== b) {
            res.issues.push({ 항목: f, '기준 시트': ref.label, 기준값: a, '대조 시트': cmp.label, 대조값: b, 차이: a - b });
          }
        }
      }
      results.push(res);
    }
  }

  return results;
}

/* ===== Pass 5 — 구조 무결성 ===== */

const STRUCTURAL = {
  // 별표8 — 진도율 산출근거 검증
  진도율검증(ps, touched) {
    const res = {
      id: 'S-진도율', pass: '구조 무결성', title: '[구조] 진도율 산출근거 검증',
      desc: '별표8의 종합진도(%)가 기투자÷총사업비 또는 (기투자+당해사업비)÷총사업비로 설명되는지 검증합니다.',
      columns: ['사업명', '표기 진도율(%)', '기투자÷총사업비(%)', '(기투자+당해)÷총사업비(%)', '판정'], issues: [],
    };
    const tol = TOLERANCE.진도율_퍼센트포인트;
    for (const row of ps.rows) {
      if (row.진도율 === null || !row.총사업비) continue;
      const r1 = row.기투자 !== null ? (row.기투자 / row.총사업비) * 100 : null;
      const r2 = row.기투자 !== null && row.당해사업비 !== null ? ((row.기투자 + row.당해사업비) / row.총사업비) * 100 : null;
      const cands = [r1, r2].filter((x) => x !== null);
      if (cands.some((c) => Math.abs(c - row.진도율) <= tol)) continue;
      res.issues.push({
        사업명: row.사업명, '표기 진도율(%)': row.진도율,
        '기투자÷총사업비(%)': r1 === null ? '-' : r1.toFixed(1),
        '(기투자+당해)÷총사업비(%)': r2 === null ? '-' : r2.toFixed(1),
        판정: '산출근거 불명',
      });
    }
    return res;
  },

  // 별표12-2 — 연도 행 누락·중복 등재
  연도행무결성(ps) {
    const res = {
      id: 'S-연도행', pass: '구조 무결성', title: '[구조] 별표12-2 연도행 누락·중복',
      desc: '같은 사업이 중복 등재되었거나, 사업의 연도 행이 중간에 빠졌는지 검증합니다.',
      columns: ['세부사업명', '유형', '내용'], issues: [],
    };
    const seen = new Map();
    for (const blk of ps.blocks) {
      const k = normName(blk.세부사업명);
      if (!seen.has(k)) seen.set(k, []);
      seen.get(k).push(blk);
    }
    for (const [, blks] of seen) {
      if (blks.length > 1) {
        res.issues.push({ 세부사업명: blks[0].세부사업명, 유형: '중복 등재', 내용: `같은 사업이 ${blks.length}회 등재됨 (엑셀 행 ${blks.map((b) => b._row + 1).join(', ')})` });
      }
    }
    for (const blk of ps.blocks) {
      const years = blk.years.map((y) => y.연도).sort((x, y) => x - y);
      if (years.length < 2) continue;
      const missing = [];
      for (let y = years[0]; y < years[years.length - 1]; y++) if (!years.includes(y)) missing.push(y);
      if (missing.length) {
        res.issues.push({ 세부사업명: blk.세부사업명, 유형: '연도 행 누락', 내용: `등재 연도 ${years.join('·')} — ${missing.join('·')}년 행 누락 의심` });
      }
    }
    return res;
  },
};

function pass5_structural(sheets, touched) {
  const results = [];
  for (const spec of SHEET_SPECS) {
    if (!spec.structural) continue;
    const ps = sheets[spec.id];
    if (!ps || !ps.found) continue;
    const fn = STRUCTURAL[spec.structural];
    if (fn) results.push(fn(ps, touched));
  }
  return results;
}

/* ===== 통합 실행 + 커버리지 ===== */

function verifyAll(sheets) {
  const touched = new Set();

  // 전체 숫자 셀 목록
  const allCells = [];
  for (const specId in sheets) {
    const ps = sheets[specId];
    if (!ps || !ps.found || !ps.units) continue;
    for (const u of ps.units) {
      for (const f in u.n) {
        if (u.n[f] !== null && u.n[f] !== undefined) {
          allCells.push({ specId, row: u._row, field: f, key: cellKey(specId, u._row, f) });
        }
      }
    }
  }

  const checks = [];
  checks.push(...pass1_formulas(sheets, touched));
  checks.push(pass2_totals(sheets, touched));
  checks.push(pass3_hierarchy(sheets, touched));
  checks.push(...pass4_crossrefs(sheets, touched));
  checks.push(...pass5_structural(sheets, touched));

  // 외톨이 — 어느 패스에도 안 걸린 숫자 셀. 셀별 위치·값까지 보존해 사용자가 직접 확인 가능.
  const orphanCells = allCells.filter((c) => !touched.has(c.key));
  const cellValue = (specId, row, field) => {
    const ps = sheets[specId];
    const u = ps && ps.units.find((x) => x._row === row);
    return u ? u.n[field] : null;
  };
  const cellLabel = (specId, row) => {
    const ps = sheets[specId];
    const u = ps && ps.units.find((x) => x._row === row);
    return u ? (u._key || '') : '';
  };
  const orphanList = orphanCells.map((c) => ({
    시트: (SHEET_SPEC_BY_ID[c.specId] || {}).label || c.specId,
    '행(엑셀)': c.row + 1,
    항목: c.field,
    표기값: cellValue(c.specId, c.row, c.field),
    행라벨: cellLabel(c.specId, c.row),
  }));
  const orphansBySheet = {};
  for (const c of orphanCells) {
    const label = (SHEET_SPEC_BY_ID[c.specId] || {}).label || c.specId;
    if (!orphansBySheet[label]) orphansBySheet[label] = {};
    orphansBySheet[label][c.field] = (orphansBySheet[label][c.field] || 0) + 1;
  }

  // 통계
  const foundSheets = Object.values(sheets).filter((s) => s && s.found);
  const dataRowCount = foundSheets.reduce((n, s) => n + (s.units ? s.units.length : 0), 0);
  const issueCount = checks.reduce((n, c) => n + c.issues.length, 0);
  const verificationCount = checks.length;

  const coverage = {
    시트수: foundSheets.length,
    데이터행수: dataRowCount,
    숫자셀수: allCells.length,
    검산항목수: verificationCount,
    터치된셀수: touched.size,
    외톨이수: orphanCells.length,
    커버리지율: allCells.length ? Math.round(((allCells.length - orphanCells.length) / allCells.length) * 1000) / 10 : 0,
    실패건수: issueCount,
    외톨이상세: orphansBySheet,
    외톨이목록: orphanList,
  };

  return { checks, coverage };
}

window.verifyAll = verifyAll;
