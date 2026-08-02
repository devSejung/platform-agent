# PlatformClaw 사용자별 MCP 관리 분석

## 조사 범위

이 문서는 `platformclaw/upstream-forward-port-2026-06`의 MCP 실행 경계와 PlatformClaw 사용자 소유권 경계를 조사한 Phase 0 결과다. OpenClaw MCP 프로토콜과 transport를 다시 구현하지 않고, 사용자 소유 설정을 기존 embedded Pi MCP runtime에 주입하는 것을 기준으로 한다.

## 기존 구조

- MCP config는 `src/config/types.mcp.ts`의 전역 `mcp.servers`이며 `src/config/mcp-config.ts`가 단일 OpenClaw config 파일을 읽고 쓴다. Agent별 또는 사용자별 저장 기능은 없다.
- `src/agents/embedded-pi-mcp.ts`는 workspace bundle의 `.mcp.json`과 전역 `mcp.servers`를 병합한다. 전역 config가 bundle 기본값을 덮어쓴다.
- `src/agents/pi-bundle-mcp-runtime.ts`는 Pi `sessionId`별 runtime을 캐시한다. config JSON fingerprint와 workspace가 바뀌면 해당 session runtime을 dispose하고 다시 만든다.
- stdio, SSE, Streamable HTTP transport는 각각 MCP SDK의 `StdioClientTransport`, `SSEClientTransport`, `StreamableHTTPClientTransport`를 사용한다. child process와 원격 연결은 catalog를 처음 읽을 때 만들어진다.
- Tool catalog는 session runtime 내부에 캐시된다. `src/agents/pi-bundle-mcp-materialize.ts`가 catalog를 provider-safe namespace의 Pi tool로 변환하며, 그 tool의 `execute`가 같은 runtime의 `callTool`을 호출한다.
- session reset/rotation과 one-shot run cleanup은 `src/auto-reply/reply/session.ts` 및 `src/agents/pi-embedded-runner/run.ts`에서 session runtime dispose API를 호출한다. Gateway 종료 시 전체 runtime dispose API가 있다.
- PlatformClaw 사용자 source of truth는 `src/accounts/db.ts`의 SQLite다. `accounts`, `workspaces(account_id, agent_id, workspace_path)`, `sessions(account_id, agent_id, workspace_id)`가 사용자, Agent, session 소유권을 기록한다. 로그인 Gateway 연결의 사용자 ID는 payload가 아니라 `GatewayClient.internal.employee`에서 온다.
- Web UI chat은 인증된 employee를 `MsgContext.AccountId`에 넣고 `ChatType: direct`로 실행한다. 실행 파라미터에는 `agentAccountId`, `senderId`, provider, session/agent ID가 전달된다.
- Knox adapter `main`은 inbound의 `conversation.type`을 `dm | room`으로 검증하고 `originatingTo`를 `dm:<id>` 또는 `room:<id>`로 Gateway에 전달하며, 검증된 발화자 employee ID를 trusted `senderId`로 보낸다. Adapter는 MCP 저장/runtime을 소유하지 않는다.
- 안전한 사용자별 VM/runner 또는 관리자 승인 stdio template runtime은 현재 저장소에서 확인되지 않았다. 중앙 Gateway의 기존 stdio transport는 임의 executable을 직접 spawn할 수 있으므로 사용자 입력을 그대로 연결할 수 없다.

## 변경 분류

- 그대로 재사용: MCP SDK client, 세 transport 구현, catalog pagination, namespace, materialization, invocation adapter, session dispose, config fingerprint 기반 재연결.
- 사용자 scope adapter 추가: SQLite 사용자 MCP 저장, 인증 사용자 API, 개인 session 판정, 사용자 config 병합, runtime scope identity, catalog/tool policy, invocation 재검증, 사용자별 invalidation.
- 최소 backport: 사용자 URL에만 적용되는 DNS pinning/SSRF fetch, Knox trusted origin metadata의 DM/room 보존, server 단위 상태/감사 정보.
- 이번 범위에서 제외: Credential/Passkey 연동, 인증 header/env/args 주입, OAuth, 공유/조직/그룹 MCP, MCP Apps.

| 기능                 | 현재 구현 위치                                                  | 현재 scope         | 목표 scope    | 필요한 최소 변경                                             |
| -------------------- | --------------------------------------------------------------- | ------------------ | ------------- | ------------------------------------------------------------ |
| MCP config           | `src/config/mcp-config.ts`, `src/config/types.mcp.ts`           | global             | user          | SQLite owner 레코드와 runtime adapter 추가                   |
| stdio transport      | `src/agents/mcp-stdio.ts`, `src/agents/mcp-transport.ts`        | session process    | user          | 설정 저장은 허용하되 승인 template/runner 전에는 실행 차단   |
| Streamable HTTP      | `src/agents/mcp-http.ts`, `src/agents/mcp-transport.ts`         | session connection | user          | 사용자 URL 전용 SSRF/DNS pinning fetch 적용                  |
| SSE                  | `src/agents/mcp-http.ts`, `src/agents/mcp-transport.ts`         | session connection | user          | 기존 SDK transport 재사용, 동일 SSRF 정책 적용               |
| MCP Client cache     | `src/agents/pi-bundle-mcp-runtime.ts`                           | sessionId          | user/agent    | owner, agent, fingerprint scope identity 추가                |
| stdio process        | MCP SDK `StdioClientTransport`                                  | sessionId/server   | user/agent    | 정책 승인 전 생성 금지, dispose 재사용                       |
| Tool catalog         | `src/agents/pi-bundle-mcp-runtime.ts`                           | session            | user/server   | user server 정책 필터와 상태 저장                            |
| Tool materialization | `src/agents/pi-bundle-mcp-materialize.ts`                       | run/session        | user/session  | 검증된 access context에서만 user config 병합                 |
| Tool invocation      | materialized tool `execute` → runtime `callTool`                | run/session        | user/session  | owner/enabled/tool policy 재검증                             |
| runtime dispose      | `SessionMcpRuntimeManager`                                      | sessionId          | user/server   | 사용자/server와 일치하는 runtime만 invalidate                |
| Agent ownership      | SQLite `workspaces`, agent alias                                | account            | authoritative | agent ID의 단일 owner 검증 helper 사용                       |
| session ownership    | SQLite `sessions`; authenticated Gateway context                | account            | authoritative | requester, owner, conversation metadata를 run context로 전달 |
| Knox DM 판별         | adapter `conversation.type`, trusted `originatingTo`/`senderId` | adapter request    | personal      | PlatformClaw에서 trusted Knox DM metadata와 owner를 재검증   |
| Knox room 판별       | adapter `conversation.type`, trusted `originatingTo`            | adapter request    | blocked       | materialization과 invocation 모두 차단                       |

## 최소 구현 계획

1. PlatformClaw SQLite에 owner가 명시된 MCP server, policy, status/audit 테이블을 추가한다.
2. employee session에서 owner를 결정하는 REST API를 추가한다. body와 URL에서 owner ID를 받지 않는다.
3. requester, conversation type, Agent owner를 검증하는 순수 access decision을 실행 경계에 추가한다.
4. 허용된 개인 run에서만 사용자 MCP 설정을 기존 embedded Pi MCP config에 병합한다. runtime identity에는 owner와 agent를 포함한다.
5. user remote MCP는 기존 SDK transport에 strict DNS-pinned fetch를 주입한다. redirect는 자동 추적하지 않는다.
6. stdio는 승인 template/사용자 runner가 없는 현재 상태에서 `blocked_by_policy`로 저장·표시하고 process를 만들지 않는다.
7. 사용자 UI는 설정/Skills navigation 패턴 안에 MCP 목록·편집·테스트·tool policy를 제공하고, 관리자는 같은 영역의 별도 정책 패널만 사용한다.

## Blocker와 안전한 기본값

- 사용자별 stdio runner와 승인 executable template source of truth가 없다. 따라서 중앙 Gateway arbitrary command 실행은 구현하지 않는다. template 관리/runtime 계약이 추가될 때만 기존 stdio transport로 연결한다.
- MCP SDK transport가 자체 redirect를 따르도록 두면 SSRF 정책 우회 위험이 있다. 사용자 MCP의 custom fetch는 DNS를 pin하고 redirect 응답을 그대로 반환해 우회를 차단한다.
- Knox adapter의 websocket 요청은 `conversation.type` 자체를 RPC 필드로 보내지 않지만 trusted `originatingTo`에 `dm:`/`room:`을 보존한다. PlatformClaw는 이 trusted channel metadata를 conversation type으로 정규화하며 sessionKey 문자열만으로 판정하지 않는다.
