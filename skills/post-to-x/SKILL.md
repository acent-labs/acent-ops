---
name: post-to-x
description: >
  Prepare an X (Twitter) post: write an editable draft document, raise an
  approval card for the product owner, and — only after the product owner
  approves — publish the (possibly edited) draft to X via the official `xurl`
  CLI. Use when an issue asks you to post/tweet/publish to X. Never post before
  approval.
---

# X 게시 — 편집 가능한 드래프트 + 승인 후 xurl 게시

흐름: **드래프트 문서 작성 → 승인 카드 → (제품 오너가 문서 수정 가능) → 승인 → 게시**.
승인 전에는 절대 게시하지 마라.

게시는 X 개발자 플랫폼 공식 CLI **`xurl`**로 한다. 인증은 운영자가 미리
`~/.xurl`(OAuth 2.0 토큰, 자동 갱신)에 설정해 두었다. 환경변수 자격증명은 쓰지 않는다.

## 자격증명 안전 규칙 (필수)

- `~/.xurl` 파일을 읽거나, 출력하거나, 대화/로그에 노출하지 마라.
- `--verbose` / `-v`, `--bearer-token`, `--client-id`, `--client-secret` 등
  인라인 시크릿 플래그를 쓰지 마라 — 인증 헤더가 새어나간다.
- 자격증명 등록·재인증은 운영자가 에이전트 세션 밖에서 직접 한다.
- 인증 존재 여부는 `xurl auth status`로만 확인한다.

---

## 0단계 — 사전 점검 (매 실행)

```sh
xurl auth status
```

기본 앱(`▸` 표시)에 oauth2 토큰이 있으면 진행한다. 토큰이 없거나
`oauth2: (none)`이면 게시 불가 — 이슈에 "xurl 인증 미설정: 운영자가
`xurl auth oauth2 --app <앱>` 후 `xurl auth default <앱>` 필요" 코멘트를
남기고 중단한다 (직접 앱 등록·인증 시도 금지).

---

## 1단계 — 첫 실행: 드래프트 문서 + 승인 카드

### 1-1. 게시 드래프트를 편집 가능한 문서로 저장
작업 중 이슈(`{issueId}`)에 `x-post` 문서를 만든다. 제품 오너는 이 문서를 직접 수정한다.

```
PUT {PAPERCLIP_API_URL}/api/issues/{issueId}/documents/x-post
Authorization: Bearer {PAPERCLIP_API_KEY}
Content-Type: application/json

{ "title": "X 게시 드래프트", "format": "markdown",
  "body": "<280자 이하의 최종 게시 문구>",
  "changeSummary": "X 게시 드래프트 작성" }
```

### 1-2. 승인 카드 생성
```
POST {PAPERCLIP_API_URL}/api/issues/{issueId}/interactions
Authorization: Bearer {PAPERCLIP_API_KEY}
Content-Type: application/json

{ "kind": "request_confirmation",
  "idempotencyKey": "post-to-x:{issueId}",
  "title": "X 게시 승인 요청",
  "continuationPolicy": "wake_assignee",
  "payload": {
    "version": 1,
    "prompt": "x-post 문서의 내용을 X에 게시할까요? 수정하려면 x-post 문서를 편집한 뒤 승인하세요.",
    "acceptLabel": "게시 승인",
    "rejectLabel": "게시 거부",
    "rejectRequiresReason": true,
    "rejectReasonLabel": "수정/거부 사유",
    "detailsMarkdown": "<현재 드래프트 문구>" } }
```

### 1-3. 대기 종료
이슈를 `in_review`로 바꾸고, "X 게시 드래프트 승인 대기 — x-post 문서를 수정 후 승인하세요"
코멘트를 남긴다. **실행 종료. 게시하지 마라.** 승인되면 `wake_assignee`로 다시 깨어난다.

---

## 2단계 — 승인 후: 편집본 게시

승인 카드가 `accepted`가 되어 깨어났다면:

### 2-1. 최종 문구 = x-post 문서의 현재 내용
```
GET {PAPERCLIP_API_URL}/api/issues/{issueId}/documents/x-post
Authorization: Bearer {PAPERCLIP_API_KEY}
```
응답의 `body`가 **제품 오너가 수정했을 수 있는 최종 문구**다. 이걸 게시한다 (드래프트 원본 아님).
280자를 넘으면 게시하지 말고 코멘트로 보고한다.

### 2-2. xurl로 게시
최종 문구를 파일에 저장한 뒤 xurl 원시 모드로 게시한다. `jq`로 JSON 바디를
안전하게 만들어 따옴표·줄바꿈·이모지를 그대로 보존한다:

```sh
# 최종 문구를 파일로 저장 (x-post 문서의 body)
printf '%s' "<x-post 문서의 body>" > /tmp/x-post.txt

# 280자 확인
test "$(wc -m < /tmp/x-post.txt)" -le 280 || { echo "280자 초과 — 게시 중단"; exit 1; }

# 게시
xurl -X POST /2/tweets -d "$(jq -Rs '{text: .}' < /tmp/x-post.txt)"
```

`xurl post "..."` 단축 명령도 있으나, 본문에 따옴표/줄바꿈이 섞이면 셸 인용이
깨지므로 위의 `jq` + 원시 모드를 기본으로 쓴다.

응답은 JSON이다. 성공: `{"data":{"id":"<tweet-id>","text":"..."}}`.
오류도 JSON: `{"errors":[{"message":"...","code":403}]}`.

### 2-3. 결과 보고
- 성공: tweet id를 이슈 코멘트로 남기고(`https://x.com/<handle>/status/<id>`) 이슈를 `done`으로.
- 오류: 응답 JSON의 `errors`를 코멘트로 남기고 중단(재시도 금지).
  - `429` → 레이트 리밋. 대기 후 재시도는 운영자 판단.
  - `403` / 스코프 오류 → 운영자가 `xurl auth oauth2` 재인증 필요.
  - `CreditsDepleted` → X API 잔액 부족, 운영자 결제 필요.
- 카드가 `rejected`였다면 게시하지 말고 사유대로 드래프트를 고쳐 1단계부터 다시.

---

## 참고 — xurl 기타 명령

게시 외 작업이 필요하면 (모두 JSON 반환):

| 작업 | 명령 |
| --- | --- |
| 게시 | `xurl post "text"` 또는 `xurl -X POST /2/tweets -d '{"text":"..."}'` |
| 답글 | `xurl reply POST_ID "text"` |
| 인용 | `xurl quote POST_ID "text"` |
| 삭제 | `xurl delete POST_ID` |
| 검색 | `xurl search "QUERY" -n 10` |
| 본인 확인 | `xurl whoami` |
| 미디어 업로드 | `xurl media upload path/to/file` → `xurl post "..." --media-id ID` |

쓰기 작업(게시/답글/인용/삭제) 전에는 대상과 의도를 반드시 이슈 맥락으로 확인한다.
이 스킬의 승인 게이트(1~2단계)는 게시에 한해 필수다.

업스트림: xurl — https://github.com/xdevplatform/xurl (X developer platform team)
