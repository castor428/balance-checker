/*
 * app.js — UI 제어 및 전체 파이프라인 연결
 *   파일 업로드 → SheetJS 파싱 → 별표 파서 → 점검 규칙 → 리포트 렌더
 */

(function () {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const fileStatus = document.getElementById('file-status');
  const uploadSection = document.getElementById('upload-section');
  const resultSection = document.getElementById('result-section');
  const errorSection = document.getElementById('error-section');
  const errorBox = document.getElementById('error-box');

  let lastChecks = null;
  let lastFileName = '';

  function showError(msg) {
    errorSection.hidden = false;
    errorBox.textContent = msg;
  }
  function clearError() {
    errorSection.hidden = true;
    errorBox.textContent = '';
  }

  function handleFile(file) {
    clearError();
    if (!file) return;
    if (!/\.xlsx$/i.test(file.name)) {
      showError('xlsx 파일만 점검할 수 있습니다. 결산서 「5. 세입세출결산서 첨부서류」 xlsx 파일을 올려주세요.');
      return;
    }
    fileStatus.textContent = `${file.name} 읽는 중…`;
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const wb = XLSX.read(e.target.result, { type: 'array' });
        const data = parseWorkbook(wb);
        const allMissing =
          !data.byeolpyo8.sheetFound &&
          !data.byeolpyo12_1.sheetFound &&
          !data.byeolpyo12_2.sheetFound &&
          !data.byeolpyo14_2.sheetFound;
        if (allMissing) {
          showError(
            '별표 8·12·14 시트를 하나도 찾지 못했습니다. 올린 파일이 「5. 세입세출결산서 첨부서류」가 맞는지 확인하세요. ' +
            '(현재 파일의 시트: ' + wb.SheetNames.join(', ') + ')'
          );
          fileStatus.textContent = '';
          return;
        }
        const checks = runAllChecks(data);
        lastChecks = checks;
        lastFileName = file.name;
        renderReport(data, checks);
        uploadSection.hidden = true;
        resultSection.hidden = false;
        window.scrollTo(0, 0);
      } catch (err) {
        console.error(err);
        showError('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
        fileStatus.textContent = '';
      }
    };
    reader.onerror = function () {
      showError('파일을 읽지 못했습니다. 다시 시도해 주세요.');
    };
    reader.readAsArrayBuffer(file);
  }

  // 드래그 앤 드롭
  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
  ['dragenter', 'dragover'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag');
    })
  );
  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
  });

  // 내보내기 / 초기화
  document.getElementById('btn-csv').addEventListener('click', () => {
    if (lastChecks) downloadCsv(lastChecks, lastFileName);
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    lastChecks = null;
    lastFileName = '';
    fileInput.value = '';
    fileStatus.textContent = '';
    resultSection.hidden = true;
    uploadSection.hidden = false;
    clearError();
  });
})();
