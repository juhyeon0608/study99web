// 개발 서버 전용: 테스트 프로젝트의 이메일 · 비밀번호 로그인 (테스트 프로젝트는 구글 공급자가 꺼져 있음)
// public-config.dev_email_login 이 true일 때만 app.js가 불러온다. 운영 서버는 이 파일을 내보내지 않는다(404).
import { signInWithPassword } from "./auth.js";
import { $, el } from "./ui.js";

export function mountDevLogin(gate, onSignedIn) {
  const actions = $('.gate-pane[data-pane="login"] .gate-actions', gate);
  if (!actions || $("[data-dev-login]", gate)) return;
  const form = el(`<form data-dev-login style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
    <p class="small" style="color:var(--text-2);margin:0">개발 서버 · 테스트 프로젝트 계정</p>
    <input class="input" type="email" name="email" autocomplete="username" placeholder="이메일" required>
    <input class="input" type="password" name="password" autocomplete="current-password" placeholder="비밀번호" required>
    <button type="submit" class="btn">이메일로 로그인 (개발용)</button>
    <p class="small hidden" data-dev-error role="alert" style="color:var(--danger);margin:0"></p>
  </form>`);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $("button", form);
    const err = $("[data-dev-error]", form);
    btn.disabled = true;
    err.classList.add("hidden");
    try {
      await signInWithPassword(form.email.value.trim(), form.password.value);
      form.password.value = "";
      await onSignedIn();
    } catch (x) {
      err.textContent = (x && x.message) || "로그인하지 못했어요";
      err.classList.remove("hidden");
    } finally {
      btn.disabled = false;
    }
  };
  actions.after(form);
}
