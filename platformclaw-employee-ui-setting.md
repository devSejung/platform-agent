# PlatformClaw Employee UI 별도 설정 가이드

## 개요

Employee UI에서 보이는 다음 정보는 OpenClaw 본체 설정과 분리해서 관리할 수 있습니다.

- 도움말 문서 링크
- 상단 공지사항 제목/본문
- 공지 링크 버튼 라벨/URL

이 문서는 왜 별도 파일로 분리했는지, 파일을 어디에 두는지, 어떻게 반영되는지, 운영 시 무엇을 주의해야 하는지 정리합니다.

## 왜 분리하는가

핵심 이유는 OpenClaw 본체 config schema와 UI 전용 운영 문구를 분리하기 위해서입니다.

- `openclaw.json`은 OpenClaw가 아는 공식 설정만 유지
- Employee UI 공지/문서 링크는 별도 파일에서 관리

이렇게 해야 다음 문제가 줄어듭니다.

- 본체가 모르는 커스텀 키 때문에 재시작 검증이 막히는 문제
- 공지 한 줄 바꾸려고 게이트웨이를 재시작해야 하는 문제
- UI 운영 문구 변경과 런타임 설정 변경이 뒤섞이는 문제

## 적용 대상

이 분리 방식은 Employee UI 표면 설정에만 적용됩니다.

별도 파일로 빼는 값:

- `docsUrl`
- `announcement.title`
- `announcement.body`
- `announcement.linkLabel`
- `announcement.linkUrl`

`openclaw.json`에 계속 남겨야 하는 값:

- 포트
- 인증
- agent 정의
- workspace 경로
- gateway endpoint 설정
- heartbeat, cron, session 정책

즉 런타임 동작을 바꾸는 값은 본체 config에 두고, UI에 보이는 운영 문구만 분리합니다.

## 파일 이름과 기본 경로

기본 파일명은 아래입니다.

`employee-ui.extra.json`

기본 탐색 규칙은 아래와 같습니다.

1. `OPENCLAW_EMPLOYEE_UI_EXTRA_PATH` 환경변수가 있으면 그 경로 사용
2. 없으면 현재 OpenClaw config 파일과 같은 디렉토리에서 `employee-ui.extra.json` 탐색

예시 1:

- config: `~/.openclaw/openclaw.json`
- extra: `~/.openclaw/employee-ui.extra.json`

예시 2:

- config: `/opt/platformclaw/exam_emp_openclaw.json`
- extra: `/opt/platformclaw/employee-ui.extra.json`

구현 기준:

- [employee-ui-surface-config.ts](/home/eon/work/open_claw/openclaw/src/gateway/employee-ui-surface-config.ts)

## 파일 형식

권장 형식은 아래와 같습니다.

```json
{
  "docsUrl": "https://intranet.company.example/platformclaw/help",
  "announcement": {
    "title": "Scheduled maintenance",
    "body": "PlatformClaw will be read-only on April 12 from 22:00 to 23:00 KST.",
    "linkLabel": "View notice",
    "linkUrl": "https://intranet.company.example/notices/platformclaw-maintenance"
  }
}
```

샘플 파일:

- [employee-ui.extra.json.example](/home/eon/work/open_claw/openclaw/employee-ui.extra.json.example)

## 지원 필드

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `docsUrl` | 아니오 | Employee UI 도움말/문서 링크 |
| `announcement.title` | 아니오 | 공지 제목 |
| `announcement.body` | 아니오 | 공지 본문 |
| `announcement.linkLabel` | 아니오 | 공지 링크 버튼 라벨 |
| `announcement.linkUrl` | 아니오 | 공지 링크 URL |

값이 비어 있으면 무시됩니다.

## 하위 호환 키

기존 flat 형태도 읽습니다.

- `announcementTitle`
- `announcementBody`
- `announcementLinkLabel`
- `announcementLinkUrl`

예:

```json
{
  "docsUrl": "https://intranet.company.example/platformclaw/help",
  "announcementTitle": "Scheduled maintenance",
  "announcementBody": "PlatformClaw will be read-only on April 12 from 22:00 to 23:00 KST.",
  "announcementLinkLabel": "View notice",
  "announcementLinkUrl": "https://intranet.company.example/notices/platformclaw-maintenance"
}
```

다만 새 파일은 `announcement` 객체 형태를 권장합니다.

## 우선순위

Employee UI 표면 설정은 아래 순서로 적용됩니다.

1. `openclaw.json`의 `gateway.controlUi.*`
2. `employee-ui.extra.json`

즉 별도 파일에 같은 값이 있으면 별도 파일이 우선합니다.

예:

`openclaw.json`

```json
{
  "gateway": {
    "controlUi": {
      "docsUrl": "https://old.example/help"
    }
  }
}
```

`employee-ui.extra.json`

```json
{
  "docsUrl": "https://new.example/help"
}
```

이 경우 Employee UI에는 `https://new.example/help`가 노출됩니다.

## 재시작 필요 여부

공지사항/문서 링크 수정만으로는 게이트웨이 재시작이 필요 없습니다.

동작 방식:

- 서버는 extra 파일을 읽을 때 파일 상태(`mtime`, `size`)를 기준으로 캐시를 갱신합니다.
- Employee UI는 bootstrap을 주기적으로 다시 읽습니다.
- 현재 구현 기준 UI 반영 주기는 약 60초입니다.

정리:

- 공지 수정: 재시작 불필요
- 문서 링크 변경: 재시작 불필요
- 반영 시점: 다음 bootstrap polling 주기

주의:

- 포트, auth, agent, heartbeat 같은 본체 설정은 여전히 재시작이 필요할 수 있습니다.
- 이 문서는 UI 운영 문구 분리에 대한 가이드입니다.

## 장애 허용 동작

운영 중 파일을 잘못 저장했을 때도 UI가 바로 깨지지 않도록 아래처럼 동작합니다.

- 파일이 정상 JSON/JSON5면 즉시 반영
- 파일이 일시적으로 깨졌으면 마지막 정상값 유지
- 파일이 삭제되면 별도 파일 오버라이드는 제거되고 본체 config 값만 사용

즉 잘못된 저장 한 번으로 Employee UI가 공백이나 에러 화면으로 바뀌지 않게 설계돼 있습니다.

## Docker 운영 예시

### 기본 경로 사용

config와 extra 파일을 같은 디렉토리에 두면 환경변수 없이 운영할 수 있습니다.

예:

```bash
docker run -d \
  --name platformclaw \
  -p 19001:19001 \
  -e OPENCLAW_CONFIG_PATH=/config/exam_emp_openclaw.json \
  -v /opt/platformclaw:/config \
  platformclaw:latest
```

호스트 디렉토리:

- `/opt/platformclaw/exam_emp_openclaw.json`
- `/opt/platformclaw/employee-ui.extra.json`

### 별도 경로 지정

extra 파일을 다른 디렉토리에 두려면 아래 환경변수를 사용합니다.

```bash
docker run -d \
  --name platformclaw \
  -p 19001:19001 \
  -e OPENCLAW_CONFIG_PATH=/config/exam_emp_openclaw.json \
  -e OPENCLAW_EMPLOYEE_UI_EXTRA_PATH=/config/ui/employee-ui.extra.json \
  -v /opt/platformclaw:/config \
  platformclaw:latest
```

## 운영 권장안

권장 구조는 아래와 같습니다.

`exam_emp_openclaw.json`

- gateway/auth/agents/session/heartbeat 등 런타임 설정

`employee-ui.extra.json`

- 문서 링크
- 공지 제목
- 공지 본문
- 공지 링크

이렇게 나누면:

- 본체 config schema 충돌을 줄일 수 있고
- 공지 수정 시 재시작이 필요 없고
- 운영 담당자와 개발 담당자의 수정 범위를 분리할 수 있습니다

## 체크리스트

- `openclaw.json`에는 공식 설정만 넣었는가
- 공지/문서 링크는 `employee-ui.extra.json`으로 옮겼는가
- extra 파일 경로가 config 옆이거나 `OPENCLAW_EMPLOYEE_UI_EXTRA_PATH`로 지정됐는가
- 공지 수정 후 60초 내 반영되는지 확인했는가
- 런타임 설정 변경과 UI 문구 변경을 구분해서 운영하고 있는가
