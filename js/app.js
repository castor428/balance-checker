/*
 * app.js — UI 제어 및 전체 파이프라인 연결
 *   다중 파일 업로드 → SheetJS 파싱 → parseWorkbooks → verifyAll(전수 엔진) → renderReport
 */

(function () {
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('file-input');
  const fileStatus = document.getElementById('file-status');
  const uploadSection = document.getElementById('upload-section');
  const resultSection = document.getElementById('result-section');
  const errorSection = document.getElementById('error-section');
  const errorBox = document.getElementById('error-box');

  let lastResult = null;
  let lastFileInfo = [];

  function showError(msg) {
    errorSection.hidden = false;
    errorBox.textContent = msg;
  }
  function clearError() {
    errorSection.hidden = true;
    errorBox.textContent = '';
  }

  function handleFiles(fileList) {
    clearError();
    const files = [...fileList].filter((f) => /\.xlsx$/i.test(f.name));
    if (!files.length) {
      showError('xlsx 파일을 올려주세요. 「2. 결산서」와 「5. 세입세출결산서 첨부서류」를 함께 올리면 파일 간 교차검증까지 수행합니다.');
      return;
    }
    if (files.length > 4) {
      showError('한 번에 최대 4개까지 올릴 수 있습니다.');
      return;
    }
    fileStatus.textContent = `${files.map((f) => f.name).join(', ')} 읽는 중…`;

    const readers = files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            try {
              resolve({ name: file.name, wb: XLSX.read(e.target.result, { type: 'array' }) });
            } catch (err) {
              reject(new Error(`${file.name}: ${err.message}`));
            }
          };
          reader.onerror = () => reject(new Error(`${file.name} 읽기 실패`));
          reader.readAsArrayBuffer(file);
        })
    );

    Promise.all(readers)
      .then((loaded) => {
        const fileInfo = loaded.map((l) => `${l.name} (${detectFileType(l.wb)})`);
        const unknown = loaded.filter((l) => detectFileType(l.wb) === 'unknown');
        if (unknown.length === loaded.length) {
          showError(
            '올린 파일에서 결산서·첨부서류 시트를 찾지 못했습니다. ' +
            '「2. 결산서」 또는 「5. 세입세출결산서 첨부서류」 xlsx가 맞는지 확인하세요.'
          );
          fileStatus.textContent = '';
          return;
        }
        const { sheets, hasAttach, hasSettle } = parseWorkbooks(loaded.map((l) => l.wb));
        const result = verifyAll(sheets);
        lastResult = result;
        lastFileInfo = fileInfo;
        renderReport(result, fileInfo);
        uploadSection.hidden = true;
        resultSection.hidden = false;
        window.scrollTo(0, 0);
        if (!hasAttach || !hasSettle) {
          const missing = [!hasAttach ? '첨부서류(파일5)' : null, !hasSettle ? '결산서(파일2)' : null].filter(Boolean);
          fileStatus.textContent = `※ ${missing.join(', ')}가 없어 해당 파일이 필요한 검증은 건너뛰었습니다.`;
        } else {
          fileStatus.textContent = '';
        }
      })
      .catch((err) => {
        console.error(err);
        showError('파일을 읽는 중 오류가 발생했습니다: ' + err.message);
        fileStatus.textContent = '';
      });
  }

  dropzone.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', (e) => handleFiles(e.target.files));
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
    if (e.dataTransfer.files && e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  });

  document.getElementById('btn-csv').addEventListener('click', () => {
    if (lastResult) downloadCsv(lastResult, lastFileInfo);
  });
  document.getElementById('btn-reset').addEventListener('click', () => {
    lastResult = null;
    lastFileInfo = [];
    fileInput.value = '';
    fileStatus.textContent = '';
    resultSection.hidden = true;
    uploadSection.hidden = false;
    clearError();
  });
})();
