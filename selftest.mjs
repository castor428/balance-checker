/*
 * selftest.mjs — 점검 파이프라인 회귀 테스트 (Node.js 전용)
 *
 * 결산서 서식이 개정되거나 코드를 수정한 뒤, 실제 결산서 xlsx로 파서·점검 규칙이
 * 정상 동작하는지 확인하는 용도. 브라우저 없이 콘솔에서 점검 결과를 출력한다.
 *
 * 사용법:
 *   node selftest.mjs "<결산서 5.첨부서류 xlsx 경로>"
 *
 * 예:
 *   node selftest.mjs "../refs/2025회계연도 결산서 파일/5.2025회계연도 세입 세출 결산서 첨부서류.xlsx"
 */
import { readFileSync } from 'fs';
import XLSX from './lib/xlsx.full.min.js';

const xlsxPath = process.argv[2];
if (!xlsxPath) {
  console.error('사용법: node selftest.mjs "<결산서 5.첨부서류 xlsx 경로>"');
  process.exit(1);
}

// 브라우저 전역(window) 모사 — 앱 코드를 그대로 재사용
globalThis.window = globalThis;
globalThis.XLSX = XLSX;
const load = (p) => new Function(readFileSync(new URL(p, import.meta.url), 'utf8'))();
load('./js/constants.js');
load('./js/parsers.js');
load('./js/matching.js');
load('./js/checks.js');

const wb = XLSX.read(readFileSync(xlsxPath), { type: 'buffer' });
const data = parseWorkbook(wb);

console.log('=== 파서 결과 요약 ===');
console.log('별표8     :', data.byeolpyo8.sheetFound ? `${data.byeolpyo8.rows.length}개 사업` : '시트 없음');
console.log('별표12-1  :', data.byeolpyo12_1.sheetFound
  ? data.byeolpyo12_1.sections.map((s) => `${s.회계}(${s.rows.length}행)`).join(' | ') : '시트 없음');
console.log('별표12-2  :', data.byeolpyo12_2.sheetFound ? `${data.byeolpyo12_2.blocks.length}개 블록` : '시트 없음');
console.log('별표14-2  :', data.byeolpyo14_2.sheetFound
  ? data.byeolpyo14_2.sections.map((s) => `${s.회계}(${s.rows.length}행)`).join(' | ') : '시트 없음');

const checks = runAllChecks(data);
console.log('\n=== 점검 결과 ===');
let totalIssues = 0;
for (const c of checks) {
  totalIssues += c.issues.length;
  console.log(`\n[${c.id}] ${c.title} — ${c.issues.length}건`);
  for (const iss of c.issues) console.log('   ', JSON.stringify(iss));
}
console.log(`\n총 확인 필요 항목: ${totalIssues}건`);
