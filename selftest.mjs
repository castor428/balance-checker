/*
 * selftest.mjs — 전수 검증 엔진 회귀 테스트 (Node.js 전용)
 *
 * 결산서 서식이 개정되거나 코드를 수정한 뒤, 실제 결산서 xlsx로 파서·엔진이
 * 정상 동작하는지 브라우저 없이 콘솔에서 확인한다.
 *
 * 사용법:
 *   node selftest.mjs "<첨부서류 xlsx>" ["<결산서 xlsx>"]
 *   (파일 순서 무관 — 시트 내용으로 자동 식별. 1개만 줘도 가능.)
 */
import { readFileSync } from 'fs';
import XLSX from './lib/xlsx.full.min.js';

const paths = process.argv.slice(2);
if (!paths.length) {
  console.error('사용법: node selftest.mjs "<첨부서류 xlsx>" ["<결산서 xlsx>"]');
  process.exit(1);
}

globalThis.window = globalThis;
globalThis.XLSX = XLSX;
const load = (p) => new Function(readFileSync(new URL(p, import.meta.url), 'utf8'))();
load('./js/constants.js');
load('./js/parsers.js');
load('./js/settlement-parsers.js');
load('./js/matching.js');
load('./js/engine.js');

const wbs = paths.map((p) => XLSX.read(readFileSync(p), { type: 'buffer' }));
wbs.forEach((wb, i) => console.log(`입력 ${i + 1}: ${paths[i].split('/').pop()} → ${detectFileType(wb)}`));

const { sheets, hasAttach, hasSettle } = parseWorkbooks(wbs);
console.log(`\n파일 인식: 첨부서류=${hasAttach ? 'O' : 'X'} 결산서=${hasSettle ? 'O' : 'X'}`);

console.log('\n=== 파서 결과 ===');
for (const id in sheets) {
  const ps = sheets[id];
  console.log(`  ${id.padEnd(8)} : ${ps.found ? `units ${ps.units.length}개` : '시트 없음'}`);
}

const { checks, coverage } = verifyAll(sheets);

console.log('\n=== 커버리지 (전수 증명) ===');
console.log(`  시트 ${coverage.시트수} / 데이터행 ${coverage.데이터행수} / 숫자셀 ${coverage.숫자셀수}`);
console.log(`  검산항목 ${coverage.검산항목수} / 터치된 셀 ${coverage.터치된셀수} / 커버리지율 ${coverage.커버리지율}%`);
console.log(`  외톨이(검증불가) ${coverage.외톨이수}개 / 실패 ${coverage.실패건수}건`);
if (coverage.외톨이수) {
  console.log('  외톨이 상세:');
  for (const sheet in coverage.외톨이상세) {
    console.log(`    ${sheet}: ${JSON.stringify(coverage.외톨이상세[sheet])}`);
  }
}

console.log('\n=== 검산 결과 ===');
for (const c of checks) {
  console.log(`\n[${c.id}] ${c.title} — ${c.issues.length}건`);
  for (const iss of c.issues.slice(0, 30)) console.log('   ', JSON.stringify(iss));
  if (c.issues.length > 30) console.log(`    … 외 ${c.issues.length - 30}건`);
}
