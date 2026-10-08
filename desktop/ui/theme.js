'use strict';
// 로컬 화면 테마: Windows 설정(prefers-color-scheme)을 따른다 (디자인 11.1)
(function () {
  var mq = matchMedia('(prefers-color-scheme: dark)');
  var apply = function () { document.documentElement.dataset.theme = mq.matches ? 'dark' : 'light'; };
  apply();
  mq.addEventListener('change', apply);
})();
