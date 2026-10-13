'use strict';
// 이 PC 상태 → "폴더 동기화" 구역 · 첫 연결 미리보기 · 대량 삭제 확인 창 (디자인 docs/design/phase6-folder-sync-ui.md 0.1 · 2 · 3 · 4 · 5 · 6장).
// 상태는 main 이 보내 줌(local:state 의 sync). 문구는 sync-look.js(순수 함수). 경로 · 파일 이름은 esc() 로만 넣는다(AC-693).
// 렌더러는 동작 이름 · 정해진 값 · 상대 경로(위치 열기)만 보낸다 — 루트 경로를 정하거나 파일을 지우는 권한이 없음.

(function () {
  var Look = window.PaperLabSyncLook;
  var L = window.paperlabLocal;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  };
  function el(html) { var t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  var ICON_WARN = '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7.5v5.5M12 16.5v.01"/></svg>';
  var drawn = {};
  var problemsOpen = false;
  var flashText = '';
  var lastLine = '';
  var openedBatch = null;
  var paired = false;
  var base = function (p) { var s = String(p || '').split('\\').filter(Boolean); return s[s.length - 1] || String(p || ''); };

  function section(key, value, draw) {
    var k = JSON.stringify(value);
    if (drawn[key] === k) return;
    drawn[key] = k;
    draw();
  }
  function act(name, arg) { return L.action(name, arg === undefined ? null : arg); }
  function btn(attr, label, cls) { return '<button type="button" class="btn sm' + (cls ? ' ' + cls : '') + '" ' + attr + '>' + esc(label) + '</button>'; }

  // ---------------------------------------------------------------- 구역
  function drawSection(S, sy) {
    var look = Look.syncLook(sy);
    var key = [sy.state, sy.reason, sy.provisional, sy.root, sy.previewRoot, sy.rootIssue, sy.counts, sy.lastSyncAt, sy.problems, sy.archiveBytes,
      sy.settings, sy.pickError, sy.suggestion, sy.confirm && [sy.confirm.batch_id, sy.confirm.count], paired, flashText, sy.userCap,
      sy.state === 'syncing' ? null : sy.progress];
    section('sync', key, function () {
      var box = $('[data-sync]');
      box.dataset.syncState = sy.state;
      box.innerHTML = '';
      if (sy.pickError) box.appendChild(pickErrorBox(sy));
      var ban = Look.syncBanner(sy);
      if (ban) box.appendChild(bannerBox(sy, ban));
      box.appendChild(card(sy, look));
      if (flashText) box.appendChild(el('<div class="status-line" role="status">' + esc(flashText) + '</div>'));
      var groups = Look.groupProblems(sy.problems);
      if (groups.length) box.appendChild(problemsBox(sy, groups));
      if (sy.archiveBytes > 0) {
        var a = el('<p class="sync-archive" data-sync-archive><span>보관함 ' + esc(Look.fmtBytes(sy.archiveBytes)) + ' — Windows 휴지통으로 보내지 못한 파일이에요.</span>' +
          btn('data-sync-archive-open', '보관함 열기') + '</p>');
        $('[data-sync-archive-open]', a).onclick = function () { act('sync-open-archive'); };
        box.appendChild(a);
      }
      if (sy.settings && sy.settings.enabled) {
        var n = el('<label class="check"><input type="checkbox" data-sync-notify' + (sy.settings.notify ? ' checked' : '') + ' /> 창이 숨어 있을 때 동기화 알림 보이기 (충돌 사본 · 번역 지움 · 보관함)</label>');
        $('input', n).onchange = function (e) { act('sync-notify', e.target.checked); };
        box.appendChild(n);
      }
    });
    updateProgress(sy);
    var line = $('[data-sync-line] .grow');
    if (line && line.textContent !== look.line && lastLine !== look.line) line.textContent = look.line; // 글이 바뀔 때만(2.3)
    lastLine = look.line;
  }

  function updateProgress(sy) {
    var bar = $('[data-sync] .progress');
    if (!bar) return;
    var p = sy.progress || {};
    var max = Math.max(1, p.total || 0);
    bar.setAttribute('aria-valuemax', String(max));
    bar.setAttribute('aria-valuenow', String(p.done || 0));
    bar.setAttribute('aria-valuetext', (p.total || 0) + '개 중 ' + (p.done || 0) + '개');
    var fill = $('div', bar);
    if (fill) fill.style.width = Math.round(((p.done || 0) / max) * 100) + '%';
  }

  function pickErrorBox(sy) {
    var e = sy.pickError;
    var t = Look.pickError(e.code, { path: e.path, suggested: sy.suggestion && sy.suggestion.ok ? sy.suggestion.path : '' });
    var canCreate = sy.suggestion && sy.suggestion.ok && !sy.suggestion.exists;
    var box = el('<div class="notice" data-tone="warn" role="alert" data-sync-pick-error="' + esc(e.code) + '">' + ICON_WARN + '<div><b>' + esc(t.title) + '</b> ' +
      esc(t.body) + '<div class="notice-actions">' + btn('data-again', e.code === 'onedrive' && !canCreate && !(sy.suggestion && sy.suggestion.ok) ? '다른 폴더 고르기…' : '폴더 고르기…') +
      (canCreate ? btn('data-create', '이 위치에 새 폴더 만들기') : '') + '</div></div></div>');
    $('[data-again]', box).onclick = function () { act('sync-pick', {}); };
    var c = $('[data-create]', box);
    if (c) c.onclick = function () { act('sync-create-suggested'); };
    return box;
  }

  function bannerBox(sy, ban) {
    var acts = '';
    if (sy.state === 'waiting_confirm') acts = btn('data-open-confirm', '확인하기', 'primary');
    else if (sy.state === 'root_missing') acts = (sy.rootIssue === 'junction' ? '' : btn('data-recheck-root', '다시 확인')) + btn('data-repick', '새 위치 고르기…') + btn('data-off', '동기화 끄기', 'ghost danger');
    else if (sy.state === 'account_mismatch') acts = btn('data-repick', '새 폴더 고르기…', 'primary') + btn('data-off', '동기화 끄기', 'ghost danger');
    var box = el('<div class="notice" data-tone="' + ban.tone + '" role="alert" data-sync-banner="' + esc(sy.state) + '">' + ICON_WARN +
      '<div><b>' + esc(ban.title) + '</b> ' + esc(ban.body) + (acts ? '<div class="notice-actions">' + acts + '</div>' : '') + '</div></div>');
    var o = $('[data-open-confirm]', box); if (o) o.onclick = function () { openConfirm(sy, true); };
    var r = $('[data-recheck-root]', box); if (r) r.onclick = function () { act('sync-now'); };
    var p = $('[data-repick]', box); if (p) p.onclick = function () { act('sync-pick', {}); };
    var f = $('[data-off]', box); if (f) f.onclick = function () { act('sync-off'); };
    return box;
  }

  function card(sy, look) {
    var s = sy.settings || {};
    var chip = '<span class="chip' + (look.chipClass ? ' ' + look.chipClass : '') + '">' + esc(look.chip) + '</span>';
    var line = '<div class="status-line' + (look.tone ? ' ' + look.tone : '') + '" role="status" data-sync-line><span class="grow">' + esc(look.line) + '</span>';
    var li;
    if (sy.state === 'off') {
      if (!paired) {
        li = el('<li class="item-card sync-card" data-sync-state="off"><div class="item-head"><span class="item-title">동기화 폴더</span>' + chip + '</div>' +
          '<div class="status-line bad" role="status" data-sync-line><span class="grow">이 PC가 연결되지 않아 동기화하지 않고 있어요.</span></div>' +
          '<p class="item-meta">위 ‘연결’에서 이 PC를 먼저 연결한 뒤 동기화 폴더를 골라 주세요.</p></li>');
        return wrap(li);
      }
      var sug = sy.suggestion || {};
      var note;
      if (sug.ok && !sug.exists) note = '추천 위치: ' + sug.path + ' (아직 없어요). OneDrive · Dropbox · Google Drive가 맞추는 폴더는 고르지 마세요.';
      else if (sug.ok) note = '추천 위치: ' + sug.path + ' (이미 있어요 — [폴더 고르기…]가 이 폴더에서 열려요). OneDrive · Dropbox · Google Drive가 맞추는 폴더는 고르지 마세요.';
      else if (sug.reason === 'onedrive') note = '사용자 폴더가 OneDrive 안에 있어 추천 위치가 없어요. OneDrive 밖의 폴더를 골라 주세요.';
      else note = '추천 위치를 쓸 수 없어요. 다른 폴더를 골라 주세요.';
      var prev = s.previousRoot || sy.previousRoot;
      li = el('<li class="item-card sync-card" data-sync-state="off"><div class="item-head"><span class="item-title">동기화 폴더</span>' + chip + '</div>' + line + '</div>' +
        '<p class="item-meta">PC의 논문 폴더 하나를 서재 폴더와 같은 모양으로 맞춰요. PDF만 맞추고, 지운 파일은 서재 휴지통(30일)과 Windows 휴지통으로 가요. 폴더를 고르고 미리보기에서 [시작]을 눌러야 동기화가 시작돼요.</p>' +
        '<div class="sync-actions">' + btn('data-sync-pick', '폴더 고르기…', 'primary') + (sug.ok && !sug.exists ? btn('data-sync-create-suggested', '이 위치에 새 폴더 만들기') : '') + '</div>' +
        '<p class="item-meta sync-note" data-sync-suggest>' + esc(note) + '</p>' +
        (prev ? '<p class="item-meta sync-note" data-sync-previous>전에 쓰던 폴더: ' + esc(prev) + ' — ' + btn('data-sync-reconnect', '다시 연결…', 'ghost') + '</p>' : '') + '</li>');
      $('[data-sync-pick]', li).onclick = function () { act('sync-pick', {}); };
      var cr = $('[data-sync-create-suggested]', li); if (cr) cr.onclick = function () { act('sync-create-suggested'); };
      var rc = $('[data-sync-reconnect]', li); if (rc) rc.onclick = function () { act('sync-pick', { from: 'previous' }); };
      return wrap(li);
    }
    if (sy.provisional) {
      var pr = sy.previewRoot || '';
      li = el('<li class="item-card sync-card" data-sync-state="' + esc(sy.state) + '"><div class="item-head"><span class="item-title">' + esc(base(pr)) + '</span>' + chip + '</div>' +
        '<p class="item-meta sync-root" title="' + esc(pr) + '">' + esc(pr) + '</p>' + line +
        (sy.state === 'preview' ? btn('data-open-preview', '미리보기 열기', 'primary') : '') + btn('data-cancel-preview', '취소') + '</div>' +
        (sy.state === 'scanning' ? progressBar(true) : '') + '</li>');
      var op = $('[data-open-preview]', li); if (op) op.onclick = function () { openPreview(sy); };
      $('[data-cancel-preview]', li).onclick = function () { cancelPreview(); };
      return wrap(li);
    }
    var busy = ['syncing', 'scanning', 'paused', 'root_missing', 'revoked', 'update_required', 'account_mismatch'].indexOf(sy.state) >= 0;
    var c = sy.counts || {};
    li = el('<li class="item-card sync-card" data-sync-state="' + esc(sy.state) + '"><div class="item-head"><span class="item-title">' + esc(sy.rootLabel || base(sy.root)) + '</span>' + chip +
      '<span class="item-actions">' + btn('data-sync-now' + (busy ? ' disabled' : ''), '지금 맞추기') + '</span></div>' +
      '<p class="item-meta sync-root" title="' + esc(sy.root) + '">' + esc(sy.root) + '</p>' + line + '</div>' +
      (sy.state === 'syncing' ? progressBar(false) : '') +
      '<p class="item-meta" data-sync-counts>맞춘 파일 ' + esc(Look.fmtNum(c.files)) + '개' + (sy.lastSyncAt ? ' · 마지막 동기화 ' + esc(new Date(sy.lastSyncAt).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' })) : '') + '</p>' +
      '<div class="sync-actions">' + (sy.state === 'root_missing' ? '' : btn('data-sync-open', '폴더 열기')) +
      btn('data-sync-pause aria-pressed="' + !!sy.paused + '"', sy.paused ? '다시 시작' : '일시 중지') + btn('data-sync-change', '폴더 바꾸기…') +
      '<span class="grow"></span>' + btn('data-sync-off', '동기화 끄기', 'ghost danger') + '</div></li>');
    $('[data-sync-now]', li).onclick = function (e) { e.currentTarget.disabled = true; act('sync-now'); };
    var fo = $('[data-sync-open]', li); if (fo) fo.onclick = function () { act('sync-open-folder'); };
    $('[data-sync-pause]', li).onclick = function () { act('sync-pause', !sy.paused); };
    $('[data-sync-change]', li).onclick = function () { act('sync-pick', { from: 'parent' }); };
    $('[data-sync-off]', li).onclick = function () { act('sync-off'); };
    return wrap(li);
  }
  function wrap(li) { var ul = el('<ul class="item-list"></ul>'); ul.appendChild(li); return ul; }
  function progressBar(indeterminate) {
    return '<div class="progress' + (indeterminate ? ' indeterminate' : '') + '" role="progressbar" aria-label="동기화 진행" aria-valuemin="0" aria-valuemax="1" aria-valuenow="0"><div></div></div>';
  }

  function problemsBox(sy, groups) {
    var total = (sy.problems || []).length;
    var d = el('<details class="sync-more" data-sync-problems' + (problemsOpen ? ' open' : '') + '><summary>맞추지 못한 파일 <span class="chip warn">' + esc(Look.fmtNum(total)) +
      (total >= 500 ? ' (최근 500개)' : '') + '</span></summary><ul class="sync-reasons"></ul></details>');
    d.addEventListener('toggle', function () { problemsOpen = d.open; });
    var ul = $('.sync-reasons', d);
    groups.forEach(function (g) {
      var li = el('<li data-problem="' + esc(g.code) + '"><p class="sync-reason">' + esc(g.text) + '</p><ul class="sync-files"></ul></li>');
      var files = $('.sync-files', li);
      g.files.forEach(function (f) {
        var row = el('<li><span>' + esc(f.rel) + '</span>' + (f.local && f.rel ? btn('data-reveal aria-label="‘' + esc(base(f.rel)) + '’ 위치 열기"', '위치 열기', 'ghost') : '') + '</li>');
        var rv = $('[data-reveal]', row); if (rv) rv.onclick = function () { act('sync-reveal', f.rel); };
        files.appendChild(row);
      });
      if (g.more) files.appendChild(el('<li class="muted">외 ' + esc(Look.fmtNum(g.more)) + '개</li>'));
      ul.appendChild(li);
    });
    return d;
  }

  // ---------------------------------------------------------------- 대화상자 공통
  function dialogOpen(d, on) { act('sync-dialog', !!on); if (!on && d.open) d.close(); }

  // ---------------------------------------------------------------- 미리보기 (4장)
  function cancelPreview() {
    var d = $('#sync-preview');
    if (d.open) dialogOpen(d, false);
    flashText = '처음 맞추기를 취소했어요. 폴더는 저장하지 않았고 파일도 바꾸지 않았어요.';
    act('sync-cancel-preview');
  }

  function openPreview(sy) {
    var d = $('#sync-preview');
    drawn.preview = null;
    drawPreview(sy);
    if (!d.open) { d.showModal(); dialogOpen(d, true); var h = $('h3', d); if (h) h.focus(); }
  }

  function drawPreview(sy) {
    var d = $('#sync-preview');
    if (sy.state !== 'preview' || !sy.preview) { if (d.open) dialogOpen(d, false); drawn.preview = null; return; }
    var pv = sy.preview;
    section('preview', pv, function () {
      var p = pv.plan;
      var row = function (label, n, extra) { return '<tr><th scope="row">' + esc(label) + '</th><td>' + esc(n) + '</td><td class="muted">' + (extra || '') + '</td></tr>'; };
      var blocks = (p.blocks || []).map(function (b, i) {
        var t = Look.previewBlock(b);
        return '<div class="notice" data-tone="danger" data-preview-block="' + esc(b.kind) + '" id="sync-block-' + i + '" tabindex="-1">' + ICON_WARN + '<div><b>' + esc(t.title) + '</b> ' + esc(t.body) + '</div></div>';
      }).join('');
      var moved = p.movedCount ? '<fieldset class="sync-choice"><legend>위치가 다른 같은 파일 ' + esc(Look.fmtNum(p.movedCount)) + '개</legend>' +
        radio('local', '이 PC 정리를 따르기', '서재 논문을 이 PC 위치로 옮겨요', pv) + radio('library', '서재 정리를 따르기', '이 PC 파일을 서재 위치로 옮겨요', pv) +
        '<details><summary>목록 보기</summary><ul class="sync-file-list">' + p.moved.slice(0, 20).map(function (m) {
          return '<li>' + esc(m.local) + ' → 서재: ' + esc(m.library) + '</li>';
        }).join('') + (p.movedCount > 20 ? '<li class="muted">외 ' + esc(Look.fmtNum(p.movedCount - 20)) + '개</li>' : '') + '</ul></details></fieldset>' : '';
      var skipped = p.skippedCount ? '<details><summary>맞추지 않을 파일 ' + esc(Look.fmtNum(p.skippedCount)) + '개 보기</summary><ul class="sync-file-list">' +
        Look.groupProblems(p.skipped).map(function (g) { return '<li><b>' + esc(g.text) + '</b> ' + g.files.map(function (f) { return esc(f.rel); }).join(' · ') + (g.more ? ' 외 ' + g.more + '개' : '') + '</li>'; }).join('') + '</ul></details>' : '';
      var disk = p.disk && p.disk.free != null ? '디스크 여유 ' + Look.fmtBytes(p.disk.free) + (p.download ? ' (받은 뒤 ' + Look.fmtBytes(p.disk.after) + ')' : '') : '';
      var budget = p.budget && p.budget.bytes != null ? '올릴 수 있는 양 ' + Look.fmtBytes(p.budget.bytes) + (p.budget.limit === 'user' && p.budget.userCap ? ' (내 한도 ' + Look.fmtBytes(p.budget.userCap) + ' 기준)' : '') : '';
      var dbLine = p.db ? '서재 데이터베이스 ' + Look.fmtBytes(p.db.size) + ' / 한도 ' + Look.fmtBytes(p.db.limit) + ' · 올리면 약 +' + Look.fmtBytes(p.db.grow) : '';
      var blocked = (p.blocks || []).length > 0;
      var title = pv.changing ? '동기화 폴더를 바꾸기 전에 확인해 주세요' : '처음 맞추기 전에 확인해 주세요';
      var pathLine = pv.changing ? '지금: ' + pv.oldRoot + ' → 새 폴더: ' + pv.root : '고른 폴더: ' + pv.root + ' ↔ 서재 — 아직 저장하지 않았어요';
      d.innerHTML = '<div class="modal-head"><h3 id="sync-preview-title" tabindex="-1">' + esc(title) + '</h3><button type="button" class="icon-btn" data-x aria-label="취소">✕</button></div>' +
        '<div class="modal-body"><p class="sync-path">' + esc(pathLine) + '</p>' +
        (p.empty ? '<p>폴더와 서재가 모두 비어 있어요. 시작하면 이제부터 넣는 PDF를 맞춰요.</p>' :
          '<table class="sync-plan">' + row('이미 같은 파일 (연결만)', Look.fmtNum(p.link) + '개', '전송 없음') +
          row('서재로 올리기', Look.fmtNum(p.upload) + '개', p.upload ? esc(Look.fmtBytes(p.uploadBytes)) : '') +
          row('이 PC로 받기', Look.fmtNum(p.download) + '개', p.download ? esc(Look.fmtBytes(p.downloadBytes)) : '') +
          row('새로 만들 폴더', 'PC ' + p.foldersPc + ' · 서재 ' + p.foldersLibrary, '') +
          row('맞추지 않을 파일', Look.fmtNum(p.skippedCount) + '개', '') + '</table>') + skipped +
        (p.upload ? '<p class="sync-room">서재가 ' + esc(Look.fmtNum(p.upload)) + '편 늘어요.' + (p.restore ? ' ' + esc(p.restore) + '개는 서재 휴지통에서 되살려요.' : '') + '</p>' : '') +
        moved + (blocked ? blocks : '<div class="notice" data-tone="info">' + ICON_WARN + '<div>시작해도 이 PC 폴더의 파일은 지우지 않아요. 맞추는 동안 앱을 꺼도 다음에 켜면 이어서 해요.' +
          (pv.changing ? ' 지금 폴더의 파일은 그대로 남고, 더는 맞추지 않아요.' : '') + '</div></div>') +
        '<p class="sync-room">' + esc([disk, budget].filter(Boolean).join(' · ')) + (dbLine ? '<br />' + esc(dbLine) : '') + '</p>' +
        '<p class="small muted">[시작]을 누르면 이 폴더를 동기화 폴더로 저장하고 맞추기 시작해요.</p></div>' +
        '<div class="modal-foot"><span class="left">' + (blocked ? btn('data-recheck', '다시 살펴보기', 'ghost') : '') + '</span>' +
        '<button type="button" class="btn" data-cancel>취소</button><button type="button" class="btn primary" data-sync-start' +
        (blocked ? ' aria-disabled="true" aria-describedby="sync-block-0"' : '') + '>' + esc(pv.changing ? '이 폴더로 바꾸고 시작' : '시작') + '</button></div>';
      $('[data-x]', d).onclick = cancelPreview;
      $('[data-cancel]', d).onclick = cancelPreview;
      var rc = $('[data-recheck]', d);
      if (rc) rc.onclick = function (e) { e.currentTarget.disabled = true; e.currentTarget.textContent = '살펴보는 중…'; act('sync-preview-recheck'); };
      d.querySelectorAll('input[name=sync-place]').forEach(function (r) { r.onchange = function () { act('sync-preview-place', r.value); }; });
      $('[data-sync-start]', d).onclick = async function (e) {
        var b = e.currentTarget;
        if (b.getAttribute('aria-disabled') === 'true') { var first = $('#sync-block-0', d); if (first) first.focus(); return; }
        b.disabled = true;
        var r = await act('sync-start', { place: (d.querySelector('input[name=sync-place]:checked') || { value: pv.place }).value });
        b.disabled = false;
        if (r && r.ok) { flashText = ''; dialogOpen(d, false); }
        else if (r && r.code === 'not_writable') dialogOpen(d, false);
        else { var foot = $('.modal-foot .left', d); foot.textContent = '시작하지 못했어요 — 서버에 연결할 수 없어요. 잠시 뒤 다시 눌러 주세요.'; }
      };
    });
  }
  function radio(value, label, desc, pv) {
    var why = value === pv.defaultPlace ? (pv.otherDevices ? ' (이미 동기화하는 PC가 있어요)' : ' (동기화하는 다른 PC가 없어요)') : '';
    return '<label class="check"><input type="radio" name="sync-place" value="' + value + '"' + (pv.place === value ? ' checked' : '') + ' /> <span><b>' + esc(label) + '</b> — ' + esc(desc) + esc(why) + '</span></label>';
  }

  // ---------------------------------------------------------------- 대량 삭제 · 루트 이상 확인 (5장 · K-31 · K-32)
  function openConfirm(sy, force) {
    var d = $('#sync-confirm');
    if (!sy.confirm) return;
    drawn.confirm = null;
    drawConfirm(sy);
    if (!d.open && force) { d.showModal(); dialogOpen(d, true); openedBatch = sy.confirm.batch_id; var h = $('h3', d); if (h) h.focus(); }
  }

  function choose(choice, c) {
    var d = $('#sync-confirm');
    d.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
    dialogOpen(d, false);
    var look = Look.confirmLook(c);
    if (choice === 'continue' || choice === 'revert') flashText = look.done[choice];
    act('sync-confirm', { batch_id: c.batch_id, choice: choice });
  }

  function drawConfirm(sy) {
    var d = $('#sync-confirm');
    var c = sy.state === 'waiting_confirm' ? sy.confirm : null;
    if (!c) { if (d.open) dialogOpen(d, false); drawn.confirm = null; return; }
    section('confirm', c, function () {
      var look = Look.confirmLook(c);
      d.dataset.confirmKind = c.kind;
      d.innerHTML = '<div class="modal-head"><h3 id="sync-confirm-title" tabindex="-1">' + esc(look.title) + '</h3><button type="button" class="icon-btn" data-later-x aria-label="나중에">✕</button></div>' +
        '<div class="modal-body"><p>' + esc(look.body) + '</p><ul class="sync-file-list">' + c.files.slice(0, 5).map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') +
        (c.count > 5 ? '<li class="muted">외 ' + esc(Look.fmtNum(c.count - 5)) + '개</li>' : '') + '</ul>' +
        '<div class="notice" data-tone="info">' + ICON_WARN + '<div>' + esc(look.safety) + '</div></div></div>' +
        '<div class="modal-foot"><span class="left">' + btn('data-confirm-off', '동기화 끄기', 'ghost danger') + '</span>' +
        '<button type="button" class="btn" data-confirm-choice="later">나중에</button>' +
        '<button type="button" class="btn" data-confirm-choice="revert">' + esc(look.revert) + '</button>' +
        '<button type="button" class="btn" data-confirm-choice="continue">' + esc(look.cont) + '</button></div>';
      $('[data-later-x]', d).onclick = function () { choose('later', c); };
      $('[data-confirm-off]', d).onclick = function () { choose('off', c); };
      d.querySelectorAll('[data-confirm-choice]').forEach(function (b) { b.onclick = function () { choose(b.dataset.confirmChoice, c); }; });
    });
  }

  function init() {
    var pv = $('#sync-preview');
    pv.addEventListener('cancel', function (e) { e.preventDefault(); cancelPreview(); }); // Esc = [취소]
    var cf = $('#sync-confirm');
    cf.addEventListener('cancel', function (e) { // Esc = [나중에]
      e.preventDefault();
      var S = window.__paperlabSyncState;
      if (S && S.confirm) choose('later', S.confirm); else dialogOpen(cf, false);
    });
  }

  function draw(S) {
    var sy = S.sync;
    if (!sy) return;
    paired = !!S.paired;
    window.__paperlabSyncState = sy;
    drawSection(S, sy);
    drawPreview(sy);
    drawConfirm(sy);
    if (sy.state === 'preview' && !$('#sync-preview').open && (sy.focus === 'preview' || drawn.previewShown !== sy.preview.root)) {
      drawn.previewShown = sy.preview.root; // 미리보기가 준비되면 바로 엶(2.5-2)
      openPreview(sy);
    }
    if (sy.state === 'waiting_confirm' && sy.confirm && sy.focus === 'confirm' && openedBatch !== sy.confirm.batch_id) openConfirm(sy, true);
    if (sy.focus === 'sync') { var t = $('#sec-sync'); if (t) t.scrollIntoView(); }
    if (sy.state !== 'off' && flashText && /취소했어요/.test(flashText) && sy.state !== 'scanning') flashText = '';
  }

  init();
  window.PaperLabStatusSync = { draw: draw };
})();
