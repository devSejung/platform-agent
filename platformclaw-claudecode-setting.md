# PlatformClaw Claude Code 설정 가이드

## 개요

이 문서는 현재 PlatformClaw/OpenClaw를 Docker 기반으로 운영하면서 `Claude Code`를 연결하려는 경우를 기준으로 작성한 가이드다.

현재 전제는 다음과 같다.

- PlatformClaw는 하나의 Docker 컨테이너 안에서 여러 `agent`를 논리적으로 분리해 사용한다.
- Claude Code는 PlatformClaw 내부 모델이 아니라, 외부 CLI 런타임으로 연결한다.
- 회사에서는 `Claude Code`가 실제로는 사내 `anthropic-compatible` 또는 유사한 내부 모델 서버에 붙도록 구성할 수 있다.
- 민감한 인증값은 이미지에 넣지 않고, 회사 운영 환경에서 주입한다.

## 권장 경로

현재 구조에서는 `claude-agent-acp`보다 `claude` CLI 경로를 표준으로 두는 편이 낫다.

이유:

- OpenClaw에는 Claude CLI 전용 backend가 이미 있다.
- `session-id`, `resume`, `stream-json`, `partial messages` 같은 Claude Code 동작을 직접 다룬다.
- 나중에 Claude Code 뒤쪽 모델 서버를 바꿔도 OpenClaw 쪽 변경을 최소화할 수 있다.

권장 구조:

1. 사용자 요청이 OpenClaw 세션으로 들어온다.
2. OpenClaw가 `claude-cli` backend를 선택한다.
3. OpenClaw가 `claude` CLI를 실행한다.
4. `claude` CLI가 회사가 설정한 모델 서버에 붙는다.
5. 결과가 다시 원래 OpenClaw 세션으로 돌아온다.

## Docker에 들어가는 것

현재 `Dockerfile.jammy`에는 다음이 포함되도록 반영되어 있다.

- `claude`
- `claude-agent-acp`
- `codex-acp`

즉 이미지 안에는 Claude Code 런타임 자체가 들어간다.

중요:

- 이미지 안에 `claude` 실행파일이 들어가는 것과
- `claude`가 어느 서버에 붙을지 설정하는 것은 다른 문제다.

이미지에 들어가는 것은 런타임이고, 실제 URL/API 키/모델명은 운영 환경에서 넣는다.

## 설정 책임 분리

### 1. PlatformClaw/OpenClaw가 담당하는 것

- 어떤 세션에서 요청을 받았는지
- 어떤 agent가 처리할지
- Claude CLI를 어떤 command로 실행할지
- Claude CLI 결과를 어느 OpenClaw 세션으로 다시 붙일지

### 2. Claude Code CLI가 담당하는 것

- 실제 어떤 모델 서버에 붙을지
- 어떤 API 키를 쓸지
- 어떤 모델 이름을 쓸지
- 필요하면 회사 wrapper를 통해 내부 호환 서버를 호출할지

즉 `backend`라는 말은 결국 `Claude Code CLI가 실제로 붙는 모델 서버`를 뜻한다.

## 핵심 개념

### OpenClaw 세션과 Claude 세션은 다르다

사용자에게 보이는 주 세션은 OpenClaw 세션이다.

예:

- `agent:eon:main`
- `agent:eon:knox:dm:u123`

Claude Code는 이 세션을 직접 소유하지 않는다. OpenClaw가 현재 세션의 컨텍스트를 Claude CLI에 넘기고, 결과를 다시 같은 OpenClaw 세션으로 붙인다.

즉 결과는 항상 원래 요청한 OpenClaw 세션으로 돌아온다.

### Claude CLI 내부 세션은 OpenClaw가 바인딩만 관리한다

OpenClaw는 Claude CLI에 `--session-id`를 넘길 수 있다. 이건 Claude Code 내부에서 이어서 작업하기 위한 세션 식별자다.

하지만 사용자 기준 세션의 진짜 기준은 여전히 OpenClaw의 `sessionKey`다.

## 현재 OpenClaw의 Claude CLI 동작

Claude CLI backend의 기본 실행 형태는 다음과 같다.

- command: `claude`
- args:
  - `-p`
  - `--output-format stream-json`
  - `--include-partial-messages`
  - `--verbose`
  - `--setting-sources user`
  - `--permission-mode bypassPermissions`

중요한 점:

- OpenClaw는 Claude CLI를 실행할 때 `--setting-sources user`를 강제한다.
- 즉 repo-local 설정이나 예상치 못한 project 설정이 OpenClaw 런타임에 섞이지 않게 한다.

## Claude CLI 설정 파일 경로

현재 코드와 Docker live 테스트 스크립트 기준으로 Claude 관련 주요 파일은 다음이다.

- `~/.claude.json`
- `~/.claude/.credentials.json`
- `~/.claude/settings.json`
- `~/.claude/settings.local.json`

실무적으로는 아래처럼 이해하면 된다.

- `.credentials.json`
  - 로그인/OAuth/토큰 상태
- `settings.json`, `settings.local.json`
  - Claude CLI 설정
- `.claude.json`
  - 일부 환경에서 사용하는 루트 설정 파일

## 가장 중요한 운영 포인트

OpenClaw는 Claude CLI 실행 시 일부 환경변수를 의도적으로 지운다.

대표적으로 다음 계열을 정리한다.

- `ANTHROPIC_API_KEY`
- `ANTHROPIC_BASE_URL`
- `CLAUDE_CONFIG_DIR`
- `CLAUDE_CODE_*`
- OTEL 관련 변수들

이유:

- OpenClaw가 실행한 Claude CLI가 우연히 다른 쉘 환경을 따라가서
- 다른 인증 상태
- 다른 config root
- 다른 plugin tree
- 다른 provider 라우팅
으로 새어나가지 않게 하기 위해서다.

이 말은 곧:

### 단순히 OpenClaw 프로세스에 `ANTHROPIC_API_KEY`만 넣는 방식은 운영상 불안정하다

권장 방식은 둘 중 하나다.

1. Claude CLI가 읽는 사용자 설정 파일을 준비한다.
2. 회사용 wrapper command를 만들고, OpenClaw가 그 command를 실행하게 한다.

## 권장 방식 1: Claude CLI 사용자 설정 파일 사용

가장 단순한 방식이다.

회사에서 다음을 준비한다.

- `/home/node/.claude/settings.json`
- `/home/node/.claude/settings.local.json`
- 필요 시 `/home/node/.claude/.credentials.json`

이 안에 회사가 쓰는 `anthropic-compatible` 또는 내부 호환 서버 설정을 넣는다.

이 방식의 장점:

- OpenClaw 수정이 거의 필요 없다.
- `claude` 커맨드를 그대로 쓴다.
- 운영 표준화가 쉽다.

주의:

- 실제 Claude CLI가 그 호환 서버 설정 방식을 지원해야 한다.
- 사내 모델 게이트웨이 설정 구조는 회사 정책에 맞춰 별도 검증해야 한다.

## 권장 방식 2: 회사용 wrapper command 사용

가장 안전한 방식이다.

예:

- `/usr/local/bin/company-claude`

이 wrapper가 하는 일:

1. 회사 환경변수 읽기
2. 내부 URL/API 키/모델명 설정
3. 필요 시 변환 로직 적용
4. 마지막에 실제 `claude` 실행

OpenClaw는 이 wrapper만 실행하면 된다.

예시 개념:

```json
{
  "agents": {
    "defaults": {
      "cliBackends": {
        "claude-cli": {
          "command": "/usr/local/bin/company-claude"
        }
      }
    }
  }
}
```

이 방식의 장점:

- OpenClaw와 회사 설정 책임이 깔끔하게 분리된다.
- 민감한 운영 로직을 wrapper에 숨길 수 있다.
- 나중에 모델 서버가 바뀌어도 OpenClaw config를 거의 안 건드린다.

현재 상황에선 이 방식이 가장 안정적이다.

## OpenClaw 설정 예시

### 1. Claude CLI를 기본 모델 경로로 쓰는 예시

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "claude-cli/claude-sonnet-4-6"
      },
      "models": {
        "claude-cli/claude-sonnet-4-6": {},
        "claude-cli/claude-opus-4-6": {}
      }
    }
  }
}
```

### 2. Claude CLI command를 회사 wrapper로 바꾸는 예시

```json
{
  "agents": {
    "defaults": {
      "cliBackends": {
        "claude-cli": {
          "command": "/usr/local/bin/company-claude"
        }
      }
    }
  }
}
```

### 3. command와 추가 env를 같이 주는 예시

```json
{
  "agents": {
    "defaults": {
      "cliBackends": {
        "claude-cli": {
          "command": "/usr/local/bin/company-claude",
          "env": {
            "COMPANY_CLAUDE_BASE_URL": "${COMPANY_CLAUDE_BASE_URL}",
            "COMPANY_CLAUDE_MODEL": "${COMPANY_CLAUDE_MODEL}"
          }
        }
      }
    }
  }
}
```

설명:

- `command`
  - OpenClaw가 실제 실행할 프로그램
- `env`
  - 그 프로그램에 명시적으로 넘길 환경변수

이 방식은 OpenClaw가 Claude 실행 시 shell 환경을 비우더라도, backend command에 필요한 값을 안전하게 다시 넣을 수 있다.

## Docker 운영에서 해야 할 일

### 방법 A: Claude 설정 파일을 컨테이너에 넣기

예:

```bash
docker run -d \
  --name platformclaw \
  -v /srv/platformclaw/.claude:/home/node/.claude \
  -v /srv/platformclaw/.claude.json:/home/node/.claude.json \
  openclaw:jammy
```

이 방식은 Claude CLI가 사용자 설정 파일을 직접 읽게 하는 방식이다.

### 방법 B: wrapper와 운영 env를 같이 넣기

예:

```bash
docker run -d \
  --name platformclaw \
  -e COMPANY_CLAUDE_BASE_URL=https://llm.company.internal \
  -e COMPANY_CLAUDE_MODEL=claude-sonnet-compatible \
  -e COMPANY_CLAUDE_API_KEY=... \
  openclaw:jammy
```

그리고 이미지 안의 `/usr/local/bin/company-claude`가 이 env를 읽도록 만든다.

## 어떤 방식이 더 낫나

현재 상황에서는 wrapper 방식이 더 낫다.

이유:

- 회사 호환 서버 설정을 OpenClaw와 분리할 수 있다.
- 나중에 OpenAI-compatible이든 anthropic-compatible이든 교체가 쉽다.
- OpenClaw가 정리하는 환경변수 정책과 충돌을 줄이기 쉽다.

즉 권장 우선순위는:

1. `claude-cli` backend 사용
2. `claude` CLI를 직접 쓰되, 가능하면 회사 wrapper command로 감싼다
3. 민감한 API 설정은 이미지가 아니라 운영 env 또는 mounted config로 넣는다

## 지금 바로 필요한 최소 준비물

### 필수

1. Docker 이미지 안에 `claude`가 있어야 함
2. OpenClaw 모델 기본값 또는 사용 모델에 `claude-cli/...`가 있어야 함
3. `agents.defaults.cliBackends.claude-cli.command`가 필요하면 회사 wrapper로 지정돼 있어야 함
4. Claude CLI가 실제로 붙을 모델 서버 정보가 준비돼 있어야 함

### 권장

1. 회사 wrapper 사용
2. API 키는 env로 주입
3. 모델명과 base URL도 env로 주입
4. `/home/node/.claude` 계열은 운영 표준 경로를 명확히 정리

## 피해야 하는 방식

다음은 권장하지 않는다.

1. 컨테이너 기동 후 `npx`로 Claude 런타임 설치
2. OpenClaw shell env에만 `ANTHROPIC_API_KEY` 넣고 잘 되길 기대
3. project-local `.claude` 설정에 의존
4. `claude-agent-acp`와 `claude` CLI를 동시에 기본 경로로 섞어 운영

## 세션 관점에서의 동작

사용자가 employee UI나 채널에서 요청하면 결과는 항상 원래 OpenClaw 세션으로 돌아온다.

예:

- 사용 세션: `agent:eon:main`
- 내부 실행: `claude` CLI
- 결과 저장 위치: 다시 `agent:eon:main`

즉 Claude Code 세션이 사용자 세션을 대체하지 않는다.

## 운영 체크리스트

### 이미지

- `claude --help` 실행 가능
- `claude-agent-acp --help` 실행 가능
- 필요한 회사 wrapper가 이미지에 포함됨

### OpenClaw 설정

- `claude-cli/...` 모델이 허용 모델에 포함됨
- `agents.defaults.cliBackends.claude-cli.command`가 기대값과 일치함

### 회사 설정

- 실제 모델 서버 URL 준비
- API key 준비
- 모델명 준비
- wrapper 또는 Claude 설정 파일 반영 완료

### 런타임

- `/home/node/.claude` 또는 wrapper env가 실제로 들어감
- workspace mount 정상
- Claude CLI 실행 시 파일 수정/명령 실행이 가능한 권한 상태

## 권장 결론

현재 상황에서는 아래가 가장 실용적이다.

1. Docker 이미지에 `claude` CLI를 포함한다.
2. OpenClaw는 `claude-cli` backend를 사용한다.
3. 회사는 `company-claude` wrapper 또는 `/home/node/.claude` 설정 파일로 실제 모델 서버 연결을 제어한다.
4. 민감한 설정은 회사 운영 환경에서 주입한다.

이렇게 하면 PlatformClaw는 세션과 런타임 orchestration만 담당하고, Claude Code의 실제 모델 연결 정책은 회사가 별도로 통제할 수 있다.
