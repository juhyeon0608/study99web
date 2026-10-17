// 폴더 동기화 문구 (디자인 docs/design/phase6-folder-sync-ui.md 2.3 · 2.4 · 3 · 4.2 · 5 · 6 · 7장) — 순수 함수 한 모듈.
// 이 PC 상태 창(window.PaperLabSyncLook)과 main 트레이 · 풍선(require)이 같이 쓴다. 15.6절 상태 값마다 문구가 있어야 함(AC-693).
// 파일 이름 · 경로는 부르는 쪽이 esc() · textContent 로만 넣는다.
(function (root) {
  'use strict';

  function fmtBytes(n) {
    n = Number(n) || 0;
    if (n < 1024 * 1024) return Math.max(0, Math.round(n / 1024)) + 'KB';
    if (n < 1024 * 1024 * 1024) { var m = n / (1024 * 1024); return (m < 100 ? m.toFixed(1).replace(/\.0$/, '') : Math.round(m)) + 'MB'; }
    return (n / (1024 * 1024 * 1024)).toFixed(1).replace(/\.0$/, '') + 'GB';
  }
  function fmtNum(n) { return String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function clock(ts) { return ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' }) : ''; }
  function tens(n) { return n >= 10 ? Math.floor(n / 10) * 10 : n; } // "{n}개 남음"은 10개 단위로만 바꿈(화면 읽기)

  var STATES = ['off', 'scanning', 'preview', 'syncing', 'idle', 'paused', 'waiting_confirm', 'root_missing', 'offline', 'storage_full',
    'update_required', 'account_mismatch', 'revoked'];

  /** s = 엔진 상태(state · reason · provisional · progress · counts · lastSyncAt · userCap · confirm) → {chip, chipClass, line, tone} */
  function syncLook(s) {
    s = s || {};
    var c = s.counts || {};
    var cap = s.userCap ? fmtBytes(s.userCap) : '한도';
    switch (s.state) {
      case 'off': return { chip: '○ 꺼짐', chipClass: '', line: '동기화 폴더를 고르지 않아 동기화하지 않고 있어요.', tone: 'bad' };
      case 'scanning':
        if (s.provisional) {
          var p = s.progress || {};
          return { chip: '↻ 살펴보는 중', chipClass: 'accent', tone: '',
            line: '고른 폴더를 살펴보는 중이에요' + (p.total ? ' — 파일 ' + fmtNum(p.total) + '개 중 ' + fmtNum(p.done) + '개' : '') +
              '. 아직 동기화를 시작하지 않았어요. 미리보기에서 [시작]을 눌러야 시작해요.' };
        }
        return { chip: '↻ 살펴보는 중', chipClass: 'accent', line: '바뀐 파일을 찾는 중이에요', tone: '' };
      case 'preview': return { chip: '! 확인 필요', chipClass: 'warn', line: '아직 동기화를 시작하지 않았어요. 미리보기를 확인하고 [시작]을 눌러 주세요.', tone: '' };
      case 'syncing': {
        var pr = s.progress || {};
        var left = Math.max(0, (pr.total || 0) - (pr.done || 0));
        var parts = [fmtNum(tens(left)) + '개 남음'];
        if (c.pending_up) parts.push('올리는 중 ' + fmtNum(c.pending_up));
        if (c.pending_down) parts.push('받는 중 ' + fmtNum(c.pending_down));
        return { chip: '↻ 맞추는 중', chipClass: 'accent', line: parts.join(' · '), tone: '' };
      }
      case 'idle': return { chip: '✓ 최신', chipClass: 'success', line: '마지막 동기화 ' + (clock(s.lastSyncAt) || '—') + ' · 서재와 같아요', tone: 'ok' };
      case 'paused': return { chip: '❙❙ 일시 중지', chipClass: 'warn', line: '일시 중지했어요. 다시 시작하면 그동안 바뀐 것을 맞춰요.', tone: '' };
      case 'waiting_confirm': return { chip: '! 멈춤', chipClass: 'warn', line: '파일 ' + fmtNum((s.confirm && s.confirm.count) || c.waiting_confirm) + '개를 지울지 정해 주세요. 다른 변경은 계속 맞춰요.', tone: 'bad' };
      case 'root_missing': return { chip: '! 멈춤', chipClass: 'warn', line: '동기화 폴더를 찾을 수 없어요', tone: 'bad' };
      case 'offline': return { chip: '서버 연결 끊김', chipClass: '', line: '서버에 연결할 수 없어 기다리는 중이에요. 바뀐 것은 모아 두었다가 연결되면 맞춰요.', tone: 'bad' };
      case 'storage_full':
        if (s.reason === 'sync_quota') return { chip: '! 올리기 멈춤', chipClass: 'warn', line: '내 올리기 한도(' + cap + ')에 닿아 파일 올리기를 멈췄어요. 받기 · 옮기기는 계속해요.', tone: 'bad' };
        if (s.reason === 'db') return { chip: '! 올리기 멈춤', chipClass: 'warn', line: '서재 데이터베이스 공간이 거의 차서 파일 올리기를 멈췄어요. 받기 · 옮기기는 계속해요.', tone: 'bad' };
        return { chip: '! 올리기 멈춤', chipClass: 'warn', line: '서재 저장 공간이 거의 차서 파일 올리기를 멈췄어요. 받기 · 옮기기는 계속해요.', tone: 'bad' };
      case 'update_required': return { chip: '업데이트 필요', chipClass: 'warn', line: '앱을 업데이트해야 동기화할 수 있어요. 아래 ‘앱’에서 새 버전을 받아 주세요.', tone: 'bad' };
      case 'account_mismatch': return { chip: '! 멈춤', chipClass: 'warn', line: '다른 계정의 동기화 폴더라 멈췄어요', tone: 'bad' };
      case 'revoked': return { chip: '멈춤', chipClass: '', line: '이 PC 연결이 해지돼 동기화를 멈췄어요. 파일은 그대로 있어요.', tone: 'bad' };
      default: return { chip: '', chipClass: '', line: '', tone: '' };
    }
  }

  /** 구역 맨 위 멈춤 상자(2.4) → {tone, title, body} | null */
  function syncBanner(s) {
    s = s || {};
    var cap = s.userCap ? fmtBytes(s.userCap) : '한도';
    var root = s.root || '';
    var up = (s.counts && s.counts.pending_up) || 0;
    if (s.state === 'waiting_confirm' && s.confirm) {
      if (s.confirm.kind === 'moved_local') {
        return { tone: 'warn', title: heldPc(s.confirm.labels) + '에만 두기로 한 파일 ' + fmtNum(s.confirm.count) + '개가 이 PC에 있어요.', body: '이 PC의 사본을 Windows 휴지통으로 옮길지 정해 주세요. 다른 변경은 계속 맞춰요.' };
      }
      var what = s.confirm.kind === 'remote_delete' ? '서재에서 논문 ' + fmtNum(s.confirm.count) + '편이 휴지통으로 갔어요' : '이 PC에서 파일 ' + fmtNum(s.confirm.count) + '개를 지웠어요';
      return { tone: 'warn', title: '파일을 한꺼번에 지우려 해서 멈췄어요.', body: what + '. 지울지 정해 주세요.' };
    }
    if (s.state === 'root_missing') {
      if (s.rootIssue === 'junction') return { tone: 'danger', title: '동기화 폴더가 바로 가기 연결(정션)로 바뀌어 멈췄어요.', body: '실제 폴더를 다시 골라 주세요. 서재와 다른 PC의 파일은 그대로예요.' };
      if (s.rootIssue === 'marker') return { tone: 'danger', title: '동기화 폴더가 바뀌어 멈췄어요.', body: root + '에 PaperLab 표식이 없거나 다른 폴더의 표식이에요. 같은 이름의 다른 폴더일 수 있어 맞추지 않았어요. 서재와 다른 PC의 파일은 그대로예요.' };
      if (s.rootIssue === 'drive') return { tone: 'danger', title: '동기화 폴더가 고정 디스크에 있지 않아 멈췄어요.', body: root + ' — USB · 네트워크 드라이브에서는 지운 파일이 Windows 휴지통에 남지 않을 수 있어요. 이 PC 디스크의 폴더를 골라 주세요.' };
      if (s.rootIssue === 'recycle_off') return { tone: 'danger', title: '이 드라이브는 지운 파일을 휴지통에 두지 않도록 설정돼 있어 멈췄어요.', body: '드라이브 휴지통 속성에서 "바로 삭제"를 끄거나 다른 드라이브의 폴더를 골라 주세요. 서재와 다른 PC의 파일은 그대로예요.' };
      return { tone: 'danger', title: '동기화 폴더를 찾을 수 없어 멈췄어요.', body: root + ' — 폴더를 옮기거나 이름을 바꿨다면 원래대로 되돌리거나 새 위치를 골라 주세요. 서재와 다른 PC의 파일은 그대로예요.' };
    }
    if (s.state === 'account_mismatch') return { tone: 'danger', title: '다른 계정의 동기화 폴더라 멈췄어요.', body: '지금 계정의 서재와 섞지 않으려고 멈췄어요. 새 폴더를 골라 다시 시작해 주세요.' };
    if (s.state === 'storage_full') {
      if (s.reason === 'sync_quota') return { tone: 'warn', title: '내 올리기 한도(' + cap + ')에 닿았어요.', body: '이 PC에서 새로 넣은 파일 ' + fmtNum(up) + '개를 올리지 못하고 기다리는 중이에요. 서재 휴지통을 비우면 한도가 늘어요(휴지통 파일도 한도에 들어가요). 더 필요하면 관리자에게 한도를 늘려 달라고 해 주세요.' };
      if (s.reason === 'db') return { tone: 'warn', title: '서재 데이터베이스 공간이 거의 찼어요.', body: '이 PC에서 새로 넣은 파일 ' + fmtNum(up) + '개를 올리지 못하고 기다리는 중이에요. 관리자에게 알려 주세요. 공간이 생기면 이어서 올려요.' };
      return { tone: 'warn', title: '서재 저장 공간이 거의 찼어요.', body: '이 PC에서 새로 넣은 파일 ' + fmtNum(up) + '개를 올리지 못하고 기다리는 중이에요. 관리자에게 알려 주세요. 공간이 생기면 이어서 올려요.' };
    }
    return null;
  }

  /** 개수 줄 덧붙임(선택 동기화 10.8): "이 PC에만: n개 · 바꾸는 중: n개" — 없으면 '' */
  function modeLine(c) {
    c = c || {};
    var parts = [];
    if (c.local) parts.push('이 PC에만: ' + fmtNum(c.local) + '개');
    if (c.pending_mode) parts.push('바꾸는 중: ' + fmtNum(c.pending_mode) + '개');
    return parts.join(' · ');
  }

  /** 트레이 메뉴 둘째 줄 · 툴팁 둘째 줄(7.2 · 7.3) */
  function syncTrayLine(s) {
    s = s || {};
    var short = {
      off: '꺼짐 (폴더를 고르지 않음)', scanning: '살펴보는 중', preview: '미리보기 확인 필요',
      syncing: fmtNum(Math.max(0, ((s.progress || {}).total || 0) - ((s.progress || {}).done || 0))) + '개 맞추는 중',
      idle: '최신' + (s.lastSyncAt ? ' (' + clock(s.lastSyncAt) + ')' : ''), paused: '일시 중지', waiting_confirm: '멈춤 — 확인 필요',
      root_missing: '폴더를 찾을 수 없어요', offline: '서버 연결 기다리는 중',
      storage_full: '올리기 멈춤 (' + (s.reason === 'sync_quota' ? '내 한도' : s.reason === 'db' ? '데이터베이스' : '저장 공간') + ')',
      update_required: '업데이트 필요', account_mismatch: '계정이 달라 멈춤', revoked: '연결 해지로 멈춤',
    }[s.state];
    return '폴더 동기화 · ' + (short || '꺼짐 (폴더를 고르지 않음)');
  }

  /** 트레이 아이콘에 동기화가 더하는 것(7.1): 'error' | 'running' | 'paused' | '' */
  function syncTrayIcon(s) {
    var st = (s || {}).state;
    if (['waiting_confirm', 'root_missing', 'account_mismatch', 'storage_full', 'update_required', 'preview'].indexOf(st) >= 0) return 'error';
    if (st === 'syncing' || st === 'scanning') return 'running';
    if (st === 'paused') return 'paused';
    return '';
  }

  /** 다른 PC에만 두기(moved_local · elsewhere_old)의 보관 PC: 이름이 하나로 같으면 ‘연구실 PC’, 모르거나 여럿이면 "다른 PC" */
  function heldPc(labels) {
    labels = (labels || []).filter(function (l) { return typeof l === 'string' && l; });
    return labels.length === 1 ? '‘' + labels[0] + '’' : '다른 PC';
  }

  function quote(names, n) {
    names = (names || []).filter(Boolean);
    if (!names.length) return '';
    if ((n || names.length) <= 1) return '‘' + names[0] + '’';
    return '‘' + names.slice(0, 2).join('’ · ‘') + '’' + ((n || 0) > 2 ? ' 외 ' + (n - 2) + '편' : '');
  }

  /** 풍선(7.4) → {title, content, always} | null. always = 끌 수 없는 알림 */
  function syncBalloon(m, extra) {
    m = m || {};
    extra = extra || {};
    var n = m.n || 0;
    var cap = extra.userCap ? fmtBytes(extra.userCap) : '한도';
    switch (m.kind) {
      case 'conflict': return n > 1 ? { title: '충돌이 있어 사본 ' + n + '개를 만들었어요', content: '두 곳에서 고친 파일 ' + n + '개를 사본으로 남겼어요. 이 PC 상태에서 확인해 주세요.' }
        : { title: '충돌이 있어 사본을 만들었어요', content: quote(m.names) + '을 두 곳에서 고쳐서, 나중에 고친 내용을 원래 이름에 두고 다른 내용은 사본으로 같은 폴더에 남겼어요.' };
      case 'rejected_delete': return { title: '지우지 않고 다시 받았어요', content: quote(m.names, n) + '은 다른 곳에서 고친 파일이라 지우지 않고 새 내용을 다시 받았어요.' };
      case 'translation_cleared': return n > 1 ? { title: '번역 ' + n + '편을 지웠어요', content: 'PDF가 바뀌어 번역 ' + n + '편을 지웠어요: ' + quote(m.names, n) + ' — 다시 번역하려면 서재에서 [전체 번역 시작…]을 눌러 주세요.' }
        : { title: 'PDF가 바뀌어 번역을 지웠어요', content: 'PDF가 바뀌어 번역을 지웠어요: ' + (m.names && m.names[0] ? m.names[0] : '') + ' — 다시 번역하려면 서재에서 [전체 번역 시작…]을 눌러 주세요.' };
      case 'local_delete': return { title: '동기화를 잠깐 멈췄어요', content: '이 PC에서 파일 ' + n + '개를 지웠어요. 서재에서도 지울지 정해 주세요.', always: true };
      case 'remote_delete': return { title: '동기화를 잠깐 멈췄어요', content: '서재에서 논문 ' + n + '편이 휴지통으로 갔어요. 이 PC 파일도 지울지 정해 주세요.', always: true };
      case 'moved_local': return { title: heldPc(m.label ? [m.label] : []) + '에만 두기로 한 파일 ' + n + '개가 이 PC에 있어요', content: heldPc(m.label ? [m.label] : []) + '에만 두기로 바꿔서 이 PC의 사본은 필요 없어요. 눌러서 Windows 휴지통으로 옮길지 정해 주세요.', always: true };
      case 'swap_rep': return { title: '문서를 원본 파일로 바꿨어요', content: '문서를 원본 파일로 바꿨어요: ' + quote(m.names, n) + ' — 전에 받은 PDF 변환본은 Windows 휴지통에 있어요.' };
      case 'local_kept_new': return { title: '고친 파일을 새 항목으로 남겼어요', content: '다른 PC에만 두기로 한 파일을 이 PC에서 고쳐서 새 항목으로 남겼어요: ' + quote(m.names, n) };
      case 'root_anomaly': return { title: '동기화를 멈췄어요', content: '동기화 폴더에서 파일이 한꺼번에 많이 사라졌어요(' + n + '개). 눌러서 확인해 주세요.', always: true };
      case 'root_missing': return { title: '동기화 폴더를 찾을 수 없어요', content: quote([m.name]) + ' 폴더를 찾을 수 없어 동기화를 멈췄어요. 서재와 다른 PC의 파일은 그대로예요.', always: true };
      case 'account_mismatch': return { title: '동기화를 멈췄어요', content: '다른 계정의 동기화 폴더라 맞추지 않았어요. 이 PC 상태에서 새 폴더를 골라 주세요.', always: true };
      case 'storage_full':
        if (m.reason === 'sync_quota') return { title: '파일 올리기를 멈췄어요', content: '내 올리기 한도(' + cap + ')에 닿았어요. 서재 휴지통을 비우거나 관리자에게 한도를 늘려 달라고 해 주세요.', always: true };
        if (m.reason === 'db') return { title: '파일 올리기를 멈췄어요', content: '서재 데이터베이스 공간이 거의 찼어요. 받기 · 옮기기는 계속해요. 관리자에게 알려 주세요.', always: true };
        return { title: '파일 올리기를 멈췄어요', content: '서재 저장 공간이 거의 찼어요. 받기 · 옮기기는 계속해요. 관리자에게 알려 주세요.', always: true };
      case 'archived': return { title: '보관함으로 옮겼어요', content: quote(m.names, n) + '을 Windows 휴지통으로 보내지 못해 보관함에 옮겨 두었어요. 이 PC 상태에서 열 수 있어요.' };
      case 'long_path': return { title: 'Windows 휴지통으로 보냈어요', content: quote(m.names, n) + ' — 경로가 길어 휴지통에서 원래 위치로 되살리지 못할 수 있어요. 서재 휴지통에는 30일 남아 있어요.' };
      case 'preview_ready': return { title: '처음 맞추기 미리보기가 준비됐어요', content: '눌러서 올리고 받을 파일을 확인해 주세요.', always: true };
      case 'first_done': { var k = m.counts || {}; return { title: '처음 맞추기를 마쳤어요', content: '연결 ' + fmtNum(k.link) + ' · 올림 ' + fmtNum(k.up) + ' · 받음 ' + fmtNum(k.down) }; }
      case 'problems': return { title: '맞추지 못한 파일이 있어요', content: '파일 ' + n + '개를 맞추지 못했어요. 이 PC 상태에서 이유를 확인해 주세요.' };
      default: return null;
    }
  }

  // 문제 목록 이유(6장) — 사용자가 고칠 수 있는 것 → 정보 → 재시도 순
  var PROBLEMS = [
    ['too_long_down', '경로가 너무 길어 이 PC에 만들지 못했어요(250자 넘음). 서재에는 그대로 있어요. 폴더 이름을 줄여 주세요.', false],
    ['too_long_local', '경로가 너무 길어 옮기거나 바꾸지 못해요(250자 넘음). 서재에는 올렸어요. 폴더 이름을 줄여 주세요.', true],
    ['folder_name_too_long', '폴더 이름이 100자를 넘어 이 폴더와 안의 파일은 맞추지 않아요. 이름을 줄여 주세요.', true],
    ['file_name_too_long', '파일 이름이 200자를 넘어 맞추지 않아요. 이름을 줄여 주세요.', true],
    ['bad_name_local', 'Windows나 서재에서 쓸 수 없는 이름이에요(예: CON · NUL, 끝의 점 · 공백, \\ / : * ? " < > |). 이름을 바꿔 주세요.', true],
    ['bad_name_server', '서재의 이름을 이 PC에서 쓸 수 없어 만들지 않았어요. 서재에는 그대로 있어요.', false],
    ['case_conflict', '같은 폴더에 대소문자만 다른 이름이 있어 하나만 맞췄어요. 한쪽 이름을 바꿔 주세요.', true],
    ['read_only', '읽기 전용 파일이라 바꾸거나 Windows 휴지통으로 보내지 않았어요. 파일 속성에서 읽기 전용을 풀어 주세요.', true],
    ['busy', '열려 있는 파일이라 나중에 바꿀게요. 다른 프로그램에서 닫아 주세요.', true],
    ['trash_aborted', 'Windows가 휴지통 보내기를 중단했어요 — 파일을 연 프로그램을 닫으면 다시 해요.', true],
    ['trash_timeout', 'Windows 휴지통이 2분 안에 답하지 않았어요 — 잠시 뒤 다시 해요.', true],
    ['trash_parse_failed', 'Windows 휴지통이 이 경로를 읽지 못해 보내지 못했어요. 파일은 그대로 있어요. 직접 지우거나 옮겨 주세요.', true],
    ['trash_failed', 'Windows 휴지통으로도, 보관함으로도 옮기지 못했어요. 파일은 그대로 있어요.', true],
    ['local_missing', '이 PC에만 두기로 한 파일을 찾지 못했어요 — Windows 휴지통에서 되살리거나 같은 파일을 다시 넣어 주세요.', false],
    ['mode_fail', '‘PC에만 두기’를 마치지 못했어요 — 이 PC에 파일이 없어요. 서재에서 [바꾸기 취소]를 누르거나 파일을 다시 받은 뒤 기다려 주세요.', false],
    ['local_elsewhere', '다른 PC에만 두기로 한 파일과 같은 파일이라 맞추지 않았어요. 그 PC에서 [동기화 켜기]를 하면 여기에도 내려와요.', true],
    ['elsewhere_old', '다른 PC에만 두기로 한 파일의 옛 판이라 지우지 않고 그대로 두었어요. 그 PC에서 고친 판과 달라요. 필요 없으면 직접 지워 주세요 — 서재에는 영향이 없어요.', true],
    ['ext_change', '파일 확장자를 바꾼 것은 서재에 반영하지 않아요. 원래 확장자로 되돌려 주세요. 다른 형식으로 쓰려면 새 파일로 저장해 넣어 주세요.', true],
    ['no_converter', '서버에 문서 변환기가 없어 이 파일은 올릴 수 없어요 — 폴더를 ‘PC에만 두기’로 바꾸면 맞출 수 있어요.', true],
    ['convert_failed', '서버가 이 문서를 PDF로 바꾸지 못했어요. 파일이 손상됐거나 암호가 걸려 있을 수 있어요. 파일을 고치면 다시 올려요.', true],
    ['bad_format', '확장자와 파일 내용이 맞지 않아요 — 올리지 않았어요.', true],
    ['not_pdf', '이름은 .pdf인데 PDF 파일이 아니에요.', true],
    ['empty_file', '빈 파일(0바이트)이에요.', true],
    ['too_big', '100MB를 넘는 파일은 서재에 올릴 수 없어요.', true],
    ['cloud_only', '클라우드 전용 파일이라 건너뛰었어요(내려받지 않음). 이 PC에 내려받은 뒤 맞춰요.', true],
    ['attr_unknown', '파일 속성을 읽지 못해 건너뛰었어요. 잠시 뒤 다시 확인해요.', true],
    ['hidden', '숨김 · 시스템 파일이라 맞추지 않아요.', true],
    ['temp_name', '임시 파일 이름이라 맞추지 않아요(점 · ~$로 시작하거나 .tmp · .part 등으로 끝남).', true],
    ['link', '바로 가기 연결(심볼릭 링크 · 정션)이라 따라가지 않아요. 안의 파일도 맞추지 않아요.', true],
    ['nested_root', '동기화 폴더 안에 다른 동기화 폴더 표식이 있어 그 안은 맞추지 않아요.', true],
    ['duplicate_copy', '이 PC에 같은 내용의 파일이 이미 있어 맞추지 않았어요. 필요 없으면 지워도 서재에는 영향이 없어요.', true],
    ['writing', '계속 바뀌고 있는 파일이라 다 쓰일 때까지 기다려요.', true],
    ['folder_kept', '서재에서 지운 폴더에 다른 파일이 남아 있어 폴더를 두었어요. 다시 서재 폴더로 만들지는 않아요.', true],
    ['disk_full', '이 PC 디스크 공간이 모자라 받지 못했어요. 공간을 비우면 이어서 받아요.', false],
    ['bad_url', '서버가 준 전송 주소가 안전하지 않아 주고받지 않았어요. 관리자에게 알려 주세요.', true],
    ['retrying', '잠시 실패해 다시 시도하는 중이에요.', true],
  ];
  var PROBLEM_TEXT = {};
  var PROBLEM_LOCAL = {};
  PROBLEMS.forEach(function (p) { PROBLEM_TEXT[p[0]] = p[1]; PROBLEM_LOCAL[p[0]] = p[2]; });
  function problemText(code, at, label) {
    if (code === 'retrying' && at) return '잠시 실패해 다시 시도하는 중이에요(다음 시도 ' + clock(at) + ').';
    if (code === 'local_elsewhere' && label) return '‘' + label + '’에만 두기로 한 파일과 같은 파일이라 맞추지 않았어요. 그 PC에서 [동기화 켜기]를 하면 여기에도 내려와요.';
    if (code === 'elsewhere_old' && label) return '‘' + label + '’에만 두기로 한 파일의 옛 판이라 지우지 않고 그대로 두었어요. 그 PC에서 고친 판과 달라요. 필요 없으면 직접 지워 주세요 — 서재에는 영향이 없어요.';
    return PROBLEM_TEXT[code] || '맞추지 못했어요. 로그 폴더를 관리자에게 보여 주세요.';
  }
  // 보관 PC 이름(label)을 문구에 넣는 이유 — 이름이 다르면 따로 묶음
  var LABELED = { local_elsewhere: true, elsewhere_old: true };
  /** 문제 목록 → 이유별 묶음 [{code, text, files: [{rel, local}], more}] (이유마다 5개 + "외 n개"). 보관 PC 이름(label)이 다르면 따로 묶음 */
  function groupProblems(list) {
    var by = {};
    var order = [];
    (list || []).forEach(function (p) {
      var label = LABELED[p.code] && typeof p.label === 'string' ? p.label : '';
      var k = p.code + '\n' + label;
      if (!by[k]) { by[k] = { code: p.code, text: problemText(p.code, p.at, label), files: [] }; order.push(k); }
      by[k].files.push({ rel: p.rel, local: PROBLEM_LOCAL[p.code] !== false });
    });
    var rank = function (k) { var c = by[k].code; return c in PROBLEM_TEXT ? PROBLEMS.findIndex(function (p) { return p[0] === c; }) : 999; };
    return order.sort(function (a, b) { return rank(a) - rank(b); }).map(function (c) {
      var g = by[c];
      return { code: g.code, text: g.text, files: g.files.slice(0, 5), more: Math.max(0, g.files.length - 5) };
    });
  }

  // 고르기 거부(3장) — {title, body}
  function pickError(code, info) {
    info = info || {};
    var p = info.path || '';
    var sug = info.suggested || '';
    var T = {
      onedrive: ['OneDrive 폴더 안은 쓸 수 없어요.', '두 프로그램이 같은 파일을 동시에 맞추면 파일이 내려받아지거나 사본이 늘 수 있어요. ' +
        (sug ? sug + ' 같은 OneDrive 밖 폴더를 골라 주세요. 지금 논문이 OneDrive 안에 있다면 그 폴더로 옮긴 뒤 시작해 주세요.' : '이 PC는 사용자 폴더도 OneDrive 안에 있어요. OneDrive 밖의 폴더(다른 드라이브 등)를 골라 주세요.')],
      drive_root: ['드라이브 전체는 고를 수 없어요.', (p || '드라이브') + ' 안에 논문 폴더를 하나 만들어 골라 주세요.'],
      user_home: ['사용자 폴더 전체는 고를 수 없어요.', (p || '사용자 폴더') + ' 안에 논문 폴더를 하나 만들어 골라 주세요.'],
      system: ['Windows · 프로그램 폴더는 고를 수 없어요.', '문서나 사용자 폴더 안의 논문 폴더를 골라 주세요.'],
      app_data: ['앱 데이터 폴더(AppData)는 고를 수 없어요.', 'PaperLab과 다른 프로그램이 쓰는 폴더예요. 다른 폴더를 골라 주세요.'],
      overlap: ['다른 동기화 폴더와 겹쳐요.', '이미 PaperLab이 맞추는 폴더의 안이나 위는 고를 수 없어요.'],
      other_device: ['다른 PC나 다른 Windows 계정이 쓰던 동기화 폴더예요.', '섞이지 않게 고를 수 없어요. 다른 폴더를 골라 주세요.'],
      link: ['바로 가기 연결(심볼릭 링크 · 정션)인 폴더는 고를 수 없어요.', '연결이 가리키는 실제 폴더를 골라 주세요.'],
      network: ['네트워크 드라이브는 고를 수 없어요.', '연결이 끊기면 파일이 지워진 것처럼 보일 수 있어요. 이 PC의 폴더를 골라 주세요.'],
      removable: ['USB · 외장 드라이브는 고를 수 없어요.', '뽑으면 파일이 지워진 것처럼 보이고, Windows 휴지통이 없는 드라이브도 있어요. 이 PC의 폴더를 골라 주세요.'],
      unknown_drive: ['이 드라이브는 고를 수 없어요.', '드라이브 종류를 확인하지 못했어요. 이 PC의 다른 폴더를 골라 주세요.'],
      not_fixed: ['이 드라이브는 고를 수 없어요.', '이 PC의 고정 디스크에 있는 폴더만 고를 수 있어요.'],
      not_writable: ['이 폴더에 쓸 수 없어요.', '권한이 없거나 읽기 전용이에요. 다른 폴더를 골라 주세요.'],
      recycle_off: ['이 드라이브는 지운 파일을 휴지통에 두지 않도록 설정돼 있어요.', '드라이브 휴지통 속성에서 "바로 삭제"를 끄거나 다른 드라이브의 폴더를 골라 주세요.'],
      missing: ['폴더를 찾을 수 없어요.', '다른 폴더를 골라 주세요.'],
      check_failed: ['전에 쓰던 폴더인지 서버에서 확인하지 못했어요.', '서버에 연결할 수 없어요. 잠시 뒤 다시 시도해 주세요.'],
      unpaired: ['이 PC가 연결되지 않았어요.', '위 ‘연결’에서 이 PC를 먼저 연결한 뒤 동기화 폴더를 골라 주세요.'],
      offline: ['서버에 연결할 수 없어요.', '잠시 뒤 다시 시도해 주세요. 폴더는 저장하지 않았고 파일도 바꾸지 않았어요.'],
    }[code] || ['이 폴더는 고를 수 없어요.', '다른 폴더를 골라 주세요.'];
    return { title: T[0], body: T[1] };
  }

  /** 미리보기 막힘(4.2 · K-46) → {title, body} */
  function previewBlock(b) {
    b = b || {};
    if (b.kind === 'disk') return { title: '이 PC 디스크 공간이 모자라요.', body: '받을 파일 ' + fmtBytes(b.need) + '와 여유 1GB가 필요한데 ' + fmtBytes(b.free) + '만 남았어요. 공간을 비운 뒤 [다시 살펴보기]를 누르거나, 다른 드라이브의 폴더를 골라 주세요.' };
    if (b.kind === 'user') return { title: '내 올리기 한도(' + fmtBytes(b.cap) + ')를 넘어요.', body: '올릴 파일 ' + fmtBytes(b.need) + ' · 남은 한도 ' + fmtBytes(b.left) + '. 올릴 파일을 줄이거나(동기화 폴더 밖으로 옮김 · 폴더를 ‘PC에만 두기’로) 관리자에게 한도를 늘려 달라고 해 주세요. ' + (b.trash ? '서재 휴지통(' + fmtBytes(b.trash) + ')을 비워도 한도가 늘어요.' : '서재 휴지통을 비워도 한도가 늘어요.') };
    if (b.kind === 'db') return { title: '서재 데이터베이스 공간이 모자라요.', body: '올릴 논문 ' + fmtNum(b.n) + '편 · 예상 ' + fmtBytes(b.need) + ' · 남은 공간 ' + fmtBytes(b.left) + '. 모든 사용자가 함께 쓰는 공간이라 관리자에게 알려 주세요.' };
    return { title: '서재 저장 공간이 모자라요.', body: '올릴 파일 ' + fmtBytes(b.need) + ' · 남은 공간 ' + fmtBytes(b.left) + '. 모든 사용자가 함께 쓰는 공간이라 관리자에게 알려 주세요.' };
  }

  /** 대량 삭제 · 루트 이상 · 다른 PC에만 두기 확인 창(5장 · K-31 · K-32 · 선택 동기화 10.9). revert 가 '' 면 그 단추를 그리지 않음 */
  function confirmLook(c) {
    c = c || {};
    var n = fmtNum(c.count);
    var pct = c.base ? Math.max(1, Math.round((c.count / c.base) * 100)) : 0;
    if (c.kind === 'moved_local') {
      var pc = heldPc(c.labels); // 보관 PC가 둘 이상이면 이름 없이 "다른 PC"
      return { title: '다른 PC에만 두기로 한 파일 ' + n + '개가 이 PC에 있어요',
        body: pc + '에만 두기로 바꿔서 이 PC의 사본은 필요 없어요. Windows 휴지통으로 옮길까요?',
        safety: '서재의 정보 · 노트 · 하이라이트는 그대로예요. 파일은 ' + pc + '에 남아 있고, 이 PC의 사본은 Windows 휴지통에서 되살릴 수 있어요.',
        cont: '이 PC에서 지우기(Windows 휴지통으로)', revert: '',
        done: { continue: '이 PC 사본 ' + n + '개를 Windows 휴지통으로 보내는 중이에요' } };
    }
    if (c.kind === 'remote_delete') {
      return { title: '서재에서 논문 ' + n + '편이 휴지통으로 갔어요',
        body: '이 PC의 파일도 Windows 휴지통으로 보낼까요?' + (c.labels && c.labels.length ? ' 지운 곳: ' + c.labels.join(' · ') + '.' : '') + ' 실수로 여러 편을 지웠을 수 있어 이 PC 파일은 아직 그대로 두었어요.',
        safety: '이 PC에서 지우면 Windows 휴지통으로 가요. 서재에 되살리면 이 PC 파일은 그대로 두고 서재 휴지통에서 되살려요.',
        cont: '이 PC에서도 지우기(Windows 휴지통으로)', revert: '서재에 되살리기',
        done: { continue: '이 PC 파일 ' + n + '개를 Windows 휴지통으로 보내는 중이에요', revert: '서재에서 ' + n + '편을 되살리는 중이에요' } };
    }
    var common = { safety: '서재에서 지우면 휴지통에 30일 남아 되살릴 수 있어요. 다른 PC의 파일은 Windows 휴지통으로 가요.',
      cont: '서재에서도 지우기(휴지통으로)', revert: '되돌리기',
      done: { continue: '서재 휴지통으로 옮기는 중이에요 (' + n + '개)', revert: n + '개를 되돌리는 중이에요' } };
    if (c.kind === 'root_anomaly') {
      return Object.assign({ title: '파일이 한꺼번에 많이 사라졌어요 (' + fmtNum(c.base) + '개 중 ' + n + '개)',
        body: '폴더를 옮겼거나 드라이브에 문제가 있을 수 있어 동기화를 멈췄어요. 직접 지운 게 맞으면 서재에서도 지울 수 있어요.' }, common);
    }
    return Object.assign({ title: '파일 ' + n + '개를 지웠어요 — 서재에서도 지울까요?',
      body: '이 PC 동기화 폴더에서 30초 사이에 파일 ' + n + '개가 사라졌어요' + (pct ? '(맞추던 파일의 ' + pct + '%)' : '') + '. 실수일 수 있어 지우기만 잠깐 멈췄어요. 다른 변경은 계속 맞춰요.' }, common);
  }

  var api = { STATES: STATES, fmtBytes: fmtBytes, fmtNum: fmtNum, syncLook: syncLook, syncBanner: syncBanner, syncTrayLine: syncTrayLine,
    syncTrayIcon: syncTrayIcon, syncBalloon: syncBalloon, problemText: problemText, groupProblems: groupProblems, PROBLEM_TEXT: PROBLEM_TEXT,
    pickError: pickError, previewBlock: previewBlock, confirmLook: confirmLook, modeLine: modeLine };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PaperLabSyncLook = api;
})(typeof window !== 'undefined' ? window : this);
