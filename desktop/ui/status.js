'use strict';
// E4 이 PC 상태 (디자인 11.6 · 11.7 · 11.8): 연결(E6 코드로 연결 포함) · 실행 중인 작업 · 이 PC에서 쓸 AI 도구 · 앱(업데이트 · 자동 시작 · 알림).
// 상태는 main 이 보내 줌(local:state). 구역마다 내용이 바뀔 때만 다시 그려 초점이 사라지지 않게.

(function () {
  var L = window.paperlabLocal;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  var KIND = { summary: '요약', chat: '대화', write: '글쓰기' };
  var MIN = { claude: '2.1.259' };
  var ICON_WARN = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5v.01"/></svg>';
  var BANNERS = {
    revoked: ['danger', '이 PC 연결이 해지됐어요.', '다시 쓰려면 새 연결 코드를 넣어 주세요.'],
    update_required: ['danger', '이 앱 버전으로는 작업을 받을 수 없어요.', '새 버전을 받는 중이에요. 준비되면 [지금 다시 시작]을 눌러 주세요.'],
    offline: ['warn', '서버에 연결할 수 없어 작업을 받지 못하고 있어요.', '다시 연결되면 이어서 받아요.'],
    no_engine: ['warn', '이 PC에서 쓸 수 있는 AI 도구가 없어요.', 'claude · codex · gemini 중 하나를 설치하고 로그인해 주세요.'],
    no_safe_storage: ['warn', '이 PC에서는 연결 정보를 안전하게 저장할 수 없어요.', '앱을 다시 켜면 다시 연결해야 해요.'],
  };
  var S = null;
  var drawn = {};
  var flash = null;

  function el(html) {
    var t = document.createElement('template');
    t.innerHTML = html.trim();
    return t.content.firstElementChild;
  }
  function clock(ts) {
    return ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : '';
  }
  function elapsed(ms) {
    var s = Math.max(0, Math.floor(ms / 1000));
    if (s < 60) return s + '초';
    var m = Math.floor(s / 60);
    if (m < 60) return m + '분' + (s % 60 ? ' ' + (s % 60) + '초' : '');
    return Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + (m % 60) + '분' : '');
  }
  // 같은 내용이면 다시 그리지 않음
  function section(key, value, draw) {
    var k = JSON.stringify(value);
    if (drawn[key] === k) return;
    drawn[key] = k;
    draw();
  }

  // ---------------------------------------------------------------- 알림 상자 (11.8)
  function drawBanner() {
    section('banner', S.banner, function () {
      var box = $('[data-banner]');
      box.innerHTML = '';
      var b = BANNERS[S.banner];
      if (!b) return;
      box.appendChild(el('<div class="notice" role="alert" data-tone="' + b[0] + '" data-local-banner="' + S.banner + '">' + ICON_WARN +
        '<div><b>' + esc(b[1]) + '</b> ' + esc(b[2]) + (S.banner === 'no_engine' ? ' <button type="button" class="btn sm" data-recheck2>다시 확인</button>' : '') + '</div></div>'));
      var again = $('[data-recheck2]', box);
      if (again) again.onclick = function () { L.action('recheck'); };
    });
  }

  // ---------------------------------------------------------------- 연결 (+ E6 코드로 연결)
  function normalizeCode(v) {
    var s = String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    return s.length > 4 ? s.slice(0, 4) + '-' + s.slice(4) : s;
  }
  function drawConnect() {
    var w = S.worker || {};
    var ws = w.workerState;
    var key = S.paired ? [S.deviceName, S.accountHint, ws, (w.running || []).length, S.settings.paused] : ['pair', ws];
    section('connect', key, function () {
      var box = $('[data-connect]');
      box.innerHTML = '';
      if (!S.paired) {
        box.appendChild(el('<div><div class="field"><label for="pair-code">연결 코드</label>' +
          '<div class="row"><input class="input grow" id="pair-code" data-pair-input maxlength="9" autocomplete="one-time-code" spellcheck="false" placeholder="K7QF-2M9X" />' +
          '<button type="button" class="btn primary" data-pair-go>연결</button></div>' +
          '<p class="hint">웹 설정 → 연결된 PC → [연결 코드 만들기]에서 받은 8자리 코드예요. 앱 창에서 [이 PC 연결]을 눌러도 돼요.</p></div></div>'));
        var input = $('[data-pair-input]', box);
        var go = $('[data-pair-go]', box);
        input.oninput = function () { input.value = normalizeCode(input.value); };
        input.onkeydown = function (e) { if (e.key === 'Enter') go.click(); };
        go.onclick = async function () {
          var code = normalizeCode(input.value);
          if (code.length !== 9) { setFlash('bad', '연결 코드가 맞지 않거나 시간이 지났어요.'); input.focus(); return; }
          go.disabled = true;
          go.textContent = '연결하는 중…';
          var r = null;
          try { r = await L.action('pair', code); } catch (e) { r = null; }
          go.disabled = false;
          go.textContent = '연결';
          if (r && r.ok) setFlash('ok', '✓ 연결됐어요: ' + (r.deviceName || ''));
          else setFlash('bad', (r && r.error) || '잠시 후 다시 시도해 주세요.');
        };
        if (S.focusPair) input.focus();
        return;
      }
      var paused = !!S.settings.paused;
      var chip = ws === 'offline' || ws === 'error' ? '<span class="chip warn">서버 연결 끊김</span>'
        : ws === 'update_required' ? '<span class="chip warn">업데이트 필요</span>'
          : paused ? '<span class="chip warn">❙❙ 일시 중지</span>' : '<span class="chip success">● 작업 받는 중</span>';
      var n = (w.running || []).length;
      var meta = [S.accountHint ? '계정 ' + S.accountHint : '', n ? '실행 중 ' + n + '개' : '', '이름은 웹 설정 → 연결된 PC에서 바꿔요'].filter(Boolean).join(' · ');
      box.appendChild(el('<div><ul class="item-list"><li class="item-card" data-state="' + (paused ? 'paused' : 'online') + '">' +
        '<div class="item-head"><span class="item-title">' + esc(S.deviceName || '이 PC') + '</span>' + chip +
        '<span class="item-actions"><button type="button" class="btn sm" data-pause aria-pressed="' + paused + '">' +
        (paused ? '작업 받기 다시 시작' : '작업 받기 일시 중지') + '</button></span></div>' +
        '<p class="item-meta">' + esc(meta) + '</p></li></ul>' +
        '<div class="row end"><button type="button" class="btn sm ghost danger" data-unpair>이 PC에서 연결 끊기</button></div></div>'));
      $('[data-pause]', box).onclick = function () { L.action('pause', !paused); };
      $('[data-unpair]', box).onclick = function () { L.action('unpair'); };
    });
  }
  function setFlash(tone, text) {
    flash = { tone: tone, text: text };
    var box = $('[data-pair-flash]');
    box.innerHTML = '';
    box.appendChild(el('<div class="status-line ' + tone + '" role="' + (tone === 'bad' ? 'alert' : 'status') + '">' + esc(text) + '</div>'));
  }

  // ---------------------------------------------------------------- 실행 중인 작업
  function drawRunning() {
    var list = (S.worker && S.worker.running) || [];
    section('running', list, function () {
      var box = $('[data-running]');
      box.innerHTML = '';
      if (!list.length) { box.appendChild(el('<li><p class="small muted">실행 중인 작업이 없어요.</p></li>')); return; }
      list.forEach(function (j) {
        var li = el('<li class="item-card"><div class="item-head"><span class="chip">' + esc(KIND[j.kind] || j.kind) + '</span>' +
          '<span class="item-title" data-started="' + j.startedAt + '">' + esc(j.engine) + ' · ' + elapsed(Date.now() - j.startedAt) + '</span>' +
          '<span class="item-actions"><button type="button" class="btn sm" data-cancel>취소</button></span></div></li>');
        $('[data-cancel]', li).onclick = function (e) { e.currentTarget.disabled = true; L.action('cancel', j.id); };
        box.appendChild(li);
      });
    });
  }
  setInterval(function () {
    document.querySelectorAll('[data-started]').forEach(function (n) {
      n.textContent = n.textContent.split(' · ')[0] + ' · ' + elapsed(Date.now() - Number(n.dataset.started));
    });
  }, 1000);

  // ---------------------------------------------------------------- 이 PC에서 쓸 AI 도구
  function engineState(e) {
    if (!e.enabled) return 'off';
    if (!S.worker.lastProbeAt) return 'checking';
    if (!e.installed) return 'missing';
    if (e.outdated) return 'outdated';
    return e.logged_in ? 'ready' : 'login';
  }
  function drawEngines() {
    var engines = (S.worker && S.worker.engines) || [];
    var total = S.settings.totalSlots;
    section('engines', [engines, total, S.settings.engines], function () {
      $('[data-total]').value = String(total);
      var box = $('[data-engines]');
      box.innerHTML = '';
      engines.forEach(function (e) {
        var st = engineState(e);
        var cfg = S.settings.engines[e.name] || {};
        var chip = { ready: '<span class="chip success">✓ ' + esc(e.version) + ' · 로그인됨</span>', login: '<span class="chip warn">! 로그인 필요</span>',
          missing: '<span class="chip">설치되지 않음</span>', off: '<span class="chip">끔</span>', checking: '<span class="chip">확인하는 중…</span>', outdated: '<span class="chip warn">! 업데이트 필요</span>' }[st];
        var slots = '';
        for (var i = 1; i <= 4; i++) slots += '<option value="' + i + '"' + (i === cfg.slots ? ' selected' : '') + '>' + i + '</option>';
        var pathLine = st === 'checking' ? '' : !e.installed && !cfg.path ?'설치했는데 못 찾으면 경로를 직접 골라 주세요. <button type="button" class="btn sm" data-pick>경로 고르기…</button>'
          : (cfg.path ? '경로: 직접 고름 · ' : '경로: 자동으로 찾음 · ') + esc(e.path || cfg.path) +
            ' <button type="button" class="btn sm" data-pick>바꾸기…</button>' + (cfg.path ? ' <button type="button" class="btn sm" data-auto>자동으로</button>' : '');
        var extra = st === 'login' ? '<p class="item-meta">명령 프롬프트에서 ' + e.name + '를 한 번 실행해 로그인한 뒤 [다시 확인]을 눌러 주세요. 그동안 ' + e.name + ' 작업은 다른 PC가 받아요.</p>'
          : st === 'outdated' ? '<p class="item-meta">' + e.name + ' ' + (MIN[e.name] || '') + ' 이상이 필요해요. 명령 프롬프트에서 업데이트해 주세요.</p>' : '';
        var over = cfg.slots > total ? '<p class="hint">전체 수(' + total + ')가 먼저 적용돼요</p>' : '';
        var li = el('<li class="item-card" data-engine="' + e.name + '" data-state="' + st + '"><div class="item-head">' +
          '<label class="check"><input type="checkbox" data-on' + (e.enabled ? ' checked' : '') + (!e.installed ? ' disabled' : '') + ' /> ' + e.name + '</label>' + chip +
          '<span class="item-actions"><label class="small" for="slots-' + e.name + '">동시</label> <select class="input sm" id="slots-' + e.name + '" data-slots>' + slots + '</select></span></div>' +
          '<p class="item-meta">' + pathLine + '</p>' + extra + over + '</li>');
        $('[data-on]', li).onchange = function (ev) { L.action('engine', { name: e.name, enabled: ev.target.checked }); };
        $('[data-slots]', li).onchange = function (ev) { L.action('engine', { name: e.name, slots: Number(ev.target.value) }); };
        var pick = $('[data-pick]', li);
        if (pick) pick.onclick = function () { L.action('pick-path', e.name); };
        var auto = $('[data-auto]', li);
        if (auto) auto.onclick = function () { L.action('engine', { name: e.name, auto: true }); };
        box.appendChild(li);
      });
      $('[data-probed]').textContent = S.worker.lastProbeAt ? '마지막 확인 ' + clock(S.worker.lastProbeAt) : '확인하는 중…';
      var re = $('[data-recheck]');
      re.disabled = false;
      re.textContent = '다시 확인';
    });
  }

  // ---------------------------------------------------------------- 앱 — 업데이트 줄 (E7)
  function drawUpdate() {
    var u = S.update || {};
    section('update', [u, S.appVersion], function () {
      var v = S.appVersion;
      var line;
      var tone = '';
      var btn = '';
      var bar = '';
      if (u.state === 'dev') line = '버전 ' + v + ' · 개발 실행이라 업데이트를 확인하지 않아요';
      else if (u.state === 'checking') line = '<span class="spinner" aria-hidden="true"></span> 업데이트를 확인하는 중…';
      else if (u.state === 'downloading') {
        line = '버전 ' + v + ' · ' + esc(u.version) + ' 받는 중 ' + (u.percent || 0) + '%';
        bar = '<div class="progress" role="progressbar" aria-label="업데이트 받기" aria-valuemin="0" aria-valuemax="100" aria-valuenow="' + (u.percent || 0) + '"><div class="progress-fill" data-pct="' + (u.percent || 0) + '"></div></div>';
      } else if (u.state === 'ready' && u.restartWhenIdle) { line = '작업이 끝나면 다시 시작해요'; btn = '<button type="button" class="btn sm" data-cancel-restart>취소</button>'; }
      else if (u.state === 'ready') { tone = 'ok'; line = '버전 ' + esc(u.version) + ' 준비됨 · 다음에 앱을 끌 때 설치돼요'; btn = '<button type="button" class="btn sm primary" data-restart>지금 다시 시작</button>'; }
      else if (u.state === 'failed') { tone = 'bad'; line = '업데이트 확인 실패 — 서버 연결 안 됨'; btn = '<button type="button" class="btn sm" data-check>업데이트 확인</button>'; }
      else if (u.state === 'corrupt') { tone = 'bad'; line = '업데이트 파일이 손상됐어요 — 다음에 다시 받아요'; btn = '<button type="button" class="btn sm" data-check>업데이트 확인</button>'; }
      else { line = '버전 ' + v + ' · 최신이에요' + (u.checkedAt ? ' (' + clock(u.checkedAt) + ' 확인)' : ''); btn = '<button type="button" class="btn sm" data-check>업데이트 확인</button>'; }
      var box = $('[data-update]');
      box.innerHTML = '';
      box.appendChild(el('<div><div class="status-line ' + tone + '" role="status" data-update-line><span class="grow">' + line + '</span>' + btn + '</div>' + bar + '</div>'));
      var fill = $('.progress-fill', box);
      if (fill) fill.style.width = fill.dataset.pct + '%';
      var c = $('[data-check]', box);
      if (c) c.onclick = function () { L.action('check-update'); };
      var r = $('[data-restart]', box);
      if (r) r.onclick = function () { L.action('restart-now'); };
      var cr = $('[data-cancel-restart]', box);
      if (cr) cr.onclick = function () { L.action('cancel-restart'); };
    });
    $('[data-autostart]').checked = !!S.autoStart;
    $('[data-notify]').checked = !!S.notify;
    $('[data-version]').textContent = 'PaperLab ' + S.appVersion;
  }

  function render(s) {
    if (!s) return;
    S = s;
    drawBanner();
    drawConnect();
    drawRunning();
    drawEngines();
    drawUpdate();
    if (S.paired && flash && flash.tone === 'bad') { flash = null; $('[data-pair-flash]').innerHTML = ''; }
    if (s.focusPair && !s.paired) { var input = $('[data-pair-input]'); if (input) input.focus(); }
  }

  $('[data-total]').onchange = function (e) { L.action('total', Number(e.target.value)); };
  $('[data-recheck]').onclick = function (e) { e.currentTarget.disabled = true; e.currentTarget.textContent = '확인하는 중…'; drawn.engines = null; L.action('recheck'); };
  $('[data-autostart]').onchange = function (e) { L.action('auto-start', e.target.checked); };
  $('[data-notify]').onchange = function (e) { L.action('notify', e.target.checked); };
  $('[data-logs]').onclick = function () { L.action('open-logs'); };
  L.onState(render);
  L.state().then(function (s) {
    render(s);
    if (!s.focusPair || s.paired) $('[data-head]').focus();
  });
})();
