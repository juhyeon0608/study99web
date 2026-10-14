; PaperLab NSIS 추가 스크립트 (electron-builder nsis.include) — 6단계 폴더 동기화 설치 ID (명세 7.3 K-33 · S-5 f)
; 설치 ID 는 앱이 HKCU\Software\PaperLab\InstallId 에 처음 실행 때 만든다(main/sync-host.js).
; 제거할 때만 지운다 — 자동 업데이트 설치(--updated)에서 도는 옛 버전 제거기는 지우지 않음.
; 그래서 업데이트 뒤에는 같은 값, 제거 후 새로 설치하면 새 값 → 저장된 동기화 폴더가 있어도 꺼짐으로 시작.
; paperlab:// 등록(HKCU\Software\Classes\paperlab)은 앱이 시작할 때 만든다(main/auth-bridge.js registerProtocol — NSIS 는 protocols 를
; 등록하지 않음). 제거할 때만 지운다(업데이트 때 지우면 새 버전이 시작하기 전까지 로그인 콜백이 앱으로 오지 않음).
!macro customUnInstall
  ${ifNot} ${isUpdated}
    DeleteRegValue HKCU "Software\PaperLab" "InstallId"
    DeleteRegKey /ifempty HKCU "Software\PaperLab"
    DeleteRegKey HKCU "Software\Classes\paperlab"
  ${endIf}
!macroend
