// 화면 코드 검사 도우미 (graph.test.mjs · refquote.test.mjs 공용): 템플릿 문자열 ${…} 식 중 esc() 없이 HTML에 들어가는 값 찾기

// 템플릿 문자열의 ${…} 식을 (안쪽 템플릿까지) 모두 뽑는다
export function templateExprs(src) {
  const out = [];
  for (let i = 0; i < src.length - 1; i++) {
    if (src[i] === "$" && src[i + 1] === "{") {
      let depth = 1;
      let j = i + 2;
      while (j < src.length && depth) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      out.push(src.slice(i + 2, j - 1).trim());
    }
  }
  return out;
}

// 식에서 안쪽 템플릿 문자열 · 따옴표 문자열 · esc(…) 호출을 지우고 남은 부분(= HTML에 그대로 들어가는 값)
export function bare(expr) {
  let s = "";
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] !== "`") { s += expr[i]; continue; }
    let depth = 0;
    i++;
    for (; i < expr.length; i++) {
      if (expr[i] === "\\") { i++; continue; }
      if (expr[i] === "$" && expr[i + 1] === "{") { depth++; i++; continue; }
      if (depth && expr[i] === "}") { depth--; continue; }
      if (!depth && expr[i] === "`") break;
    }
    s += "``";
  }
  s = s.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""');
  let prev;
  do { prev = s; s = s.replace(/esc\([^()]*(?:\([^()]*\)[^()]*)*\)/g, "E"); } while (s !== prev);
  return s.replace(/^[^?:`"]*\?/, ""); // 조건식 cond ? A : B 의 cond는 화면에 나가지 않음
}
