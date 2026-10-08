'use strict';
// E2 첫 실행: 서버 확인(/api/health · /api/public-config) 중엔 [시작] 막음, 실패하면 E9, [시작] → 자동 시작 설정 → 앱 창에 클라우드 화면
(async function () {
  var L = window.paperlabLocal;
  var line = document.querySelector('[data-server]');
  var start = document.querySelector('[data-start]');
  var auto = document.querySelector('[data-autostart]');
  document.getElementById('setup-title').focus();
  var r = null;
  try { r = await L.action('setup-check'); } catch (e) { r = null; }
  if (!r || !r.ok) { await L.action('offline', (r && r.detail) || ''); return; }
  line.className = 'status-line ok';
  line.textContent = '✓ PaperLab 서버에 연결됐어요';
  start.disabled = false;
  start.onclick = function () {
    start.disabled = true;
    L.action('setup-start', auto.checked);
  };
})();
