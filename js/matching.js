/*
 * matching.js — 사업명 정규화 및 별표 간 사업 매칭
 *
 * 표마다 사업명 표기가 미묘하게 다를 수 있어(공백·줄바꿈·괄호 위치),
 * 정규화 후 정확매칭한다. 매칭 실패한 사업명은 호출부에서 리포트로 노출한다.
 */

// 사업명 정규화: 공백 제거, 유사문자 통일
function normName(s) {
  return String(s == null ? '' : s)
    .replace(/\s+/g, '')           // 모든 공백·줄바꿈 제거
    .replace(/[·ㆍ・]/g, '·')       // 가운뎃점 통일
    .replace(/[–—―]/g, '-')        // 대시 통일
    .replace(/[()（）]/g, '(')      // 괄호 시작 통일(단순화)
    .replace(/[)）]/g, ')')
    .toLowerCase();
}

/*
 * 두 목록을 사업명으로 매칭.
 *   listA, listB: 객체 배열
 *   keyA, keyB: 각 목록에서 사업명을 담은 필드명
 * 반환: { matched: [{a,b}], onlyA: [a...], onlyB: [b...] }
 * 같은 정규화명이 한 목록에 여러 개면(중복 등재) 첫 항목과 매칭하고
 * 나머지는 onlyA/onlyB 가 아닌 matched 에 각각 들어가도록 모두 짝지운다.
 */
function matchByName(listA, listB, keyA, keyB) {
  const indexB = new Map();
  for (const b of listB) {
    const k = normName(b[keyB]);
    if (!indexB.has(k)) indexB.set(k, []);
    indexB.get(k).push(b);
  }
  const usedB = new Set();
  const matched = [];
  const onlyA = [];

  for (const a of listA) {
    const k = normName(a[keyA]);
    const bucket = indexB.get(k);
    if (bucket && bucket.length) {
      const b = bucket.shift();
      usedB.add(b);
      matched.push({ a, b });
    } else {
      onlyA.push(a);
    }
  }
  const onlyB = listB.filter((b) => !usedB.has(b));
  return { matched, onlyA, onlyB };
}

window.normName = normName;
window.matchByName = matchByName;
