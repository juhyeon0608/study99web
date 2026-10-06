"""원고 템플릿.

원고는 마크다운으로 쓴다: `#` 논문 제목, `##` 장(1수준), `###` 절(2수준), `####` 항(3수준).
인용은 [@인용키], 참고문헌 자리는 [참고문헌] 한 줄.
"""

TEMPLATES = {
    "blank": {
        "name": "빈 원고",
        "description": "제목만 있는 빈 문서",
        "content": "# 제목을 입력하세요\n\n",
    },
    "kr_journal": {
        "name": "국내 학술지 논문",
        "description": "국문초록 · 서론 · 이론적 배경 · 연구방법 · 연구결과 · 결론",
        "content": """# 논문 제목

**국문초록**

연구의 목적, 방법, 주요 결과, 시사점을 300~500자로 요약합니다.

**주제어**: 키워드1, 키워드2, 키워드3

## 1. 서론

연구의 배경과 필요성을 쓰고, 선행연구를 인용합니다 [@인용키].

## 2. 이론적 배경

### 2.1 핵심 개념

### 2.2 선행연구 검토

## 3. 연구 방법

### 3.1 연구 대상

### 3.2 분석 방법

## 4. 연구 결과

## 5. 결론 및 논의

[참고문헌]
""",
    },
    "thesis": {
        "name": "학위논문",
        "description": "장·절 구성 (제1장 서론 ~ 제5장 결론)",
        "content": """# 학위논문 제목

## 제1장 서론

### 제1절 연구의 배경 및 필요성

### 제2절 연구의 목적

### 제3절 논문의 구성

## 제2장 이론적 배경

### 제1절

### 제2절 선행연구

## 제3장 연구 방법

### 제1절 연구 설계

### 제2절 자료 수집 및 분석

## 제4장 연구 결과

## 제5장 결론

### 제1절 연구 결과 요약

### 제2절 연구의 한계 및 후속 연구 제언

[참고문헌]
""",
    },
    "imrad": {
        "name": "영문 저널 (IMRaD)",
        "description": "Abstract · Introduction · Methods · Results · Discussion",
        "content": """# Paper Title

**Abstract** — State the problem, approach, key results and implications in 150–250 words.

**Keywords**: keyword1, keyword2, keyword3

## 1 Introduction

Motivate the problem and summarize prior work [@citekey].

## 2 Related Work

## 3 Methods

## 4 Results

## 5 Discussion

## 6 Conclusion

[References]
""",
    },
    "review": {
        "name": "문헌 리뷰",
        "description": "주제별로 선행연구를 정리하는 리뷰 논문",
        "content": """# 문헌 리뷰 제목

## 1. 서론

리뷰의 범위와 문헌 선정 기준을 밝힙니다.

## 2. 주제별 선행연구

### 2.1 주제 A

### 2.2 주제 B

## 3. 종합 및 연구 공백

## 4. 결론

[참고문헌]
""",
    },
}
