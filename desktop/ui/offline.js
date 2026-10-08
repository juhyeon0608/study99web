'use strict';
// E9: 30초마다 자동 재시도(숫자는 10초 단위로만 바꿈 — 화면 읽기가 매초 읽지 않게), [다시 시도] · [로그 폴더 열기]
(function () {
  var L = window.paperlabLocal;
  var $ = function (s) { return document.querySelector(s); };
  var left = 30;
  var busy = false;
  var countText = $('[data-count-text]');
  var retryBtn = $('[data-retry]');

  function showDetail(detail) {
    var d = $('[data-detail]');
    d.textContent = detail || '';
    d.classList.toggle('hidden', !detail);
  }
  function showNet() {
    var off = navigator.onLine === false;
    $('[data-title]').textContent = off ? '인터넷에 연결되지 않았어요' : 'PaperLab 서버에 연결할 수 없어요';
    $('[data-text]').textContent = off ? '연결을 확인하면 자동으로 다시 시도해요.' : '서버 PC가 꺼져 있거나 인터넷이 끊겼을 수 있어요. 관리자에게 알려 주세요.';
  }
  async function retry() {
    if (busy) return;
    busy = true;
    retryBtn.disabled = true;
    retryBtn.textContent = '다시 연결하는 중…';
    var r = null;
    try { r = await L.action('retry'); } catch (e) { r = null; }
    busy = false;
    retryBtn.disabled = false;
    retryBtn.textContent = '다시 시도';
    if (r && r.ok) return; // main 이 앱 창에 클라우드 화면을 연다
    showDetail(r && r.detail);
    showNet();
    left = 30;
    countText.textContent = '30초 뒤에 다시 시도해요';
  }
  setInterval(function () {
    if (busy) return;
    left -= 1;
    if (left <= 0) { retry(); return; }
    if (left % 10 === 0) countText.textContent = left + '초 뒤에 다시 시도해요';
  }, 1000);
  retryBtn.onclick = retry;
  $('[data-logs]').onclick = function () { L.action('open-logs'); };
  window.addEventListener('online', retry);
  window.addEventListener('offline', showNet);
  L.state().then(function (s) { showDetail(s && s.offlineDetail); });
  showNet();
  $('[data-title]').focus();
})();
