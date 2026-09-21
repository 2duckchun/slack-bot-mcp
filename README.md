# slack-bot-mcp

Slack 봇 토큰으로 Slack Web API를 사용하는 MCP(Model Context Protocol) 서버입니다. AI 에이전트가 메시지 전송, 채널 관리, 파일 업로드, 캔버스·리스트 조작 등 봇 권한으로 가능한 작업을 수행할 수 있습니다.

인증은 봇 토큰(`xoxb-`)만 사용합니다. 유저 토큰(`xoxp-`)은 지원하지 않으며, 설정 항목 자체가 없습니다.

## 무엇을 할 수 있나요

에이전트가 봇 계정으로 Slack에서 직접 일을 처리합니다.

**메시지 주고받기**

- 채널·스레드·DM에 메시지를 보내고, 나중에 수정하거나 삭제합니다.
- 특정 사용자에게만 보이는 임시 메시지(ephemeral)로 확인이나 오류를 전달합니다.
- 원하는 시각에 메시지를 예약하고, 예약 목록을 확인하거나 취소합니다.
- 답변을 한 글자씩 렌더링하는 스트리밍 메시지를 보냅니다. 어시스턴트 응답처럼 보입니다.

**대화 읽고 파악하기**

- 채널 목록과 상세 정보를 조회하고, 최근 메시지 히스토리를 가져옵니다.
- 스레드 전체를 읽어 맥락을 파악합니다.
- 채널 멤버, 사용자 프로필, 이메일 기반 사용자 조회를 수행합니다.
- 리액션과 핀 목록을 읽어 반응을 확인합니다.

**채널 운영**

- 채널을 만들고, 사용자를 초대하고, 토픽과 설명을 설정합니다.
- 봇이 채널에 참여하거나 나가고, 오래된 채널을 아카이브합니다.
- DM 대화를 엽니다.
- 리액션을 달거나 지우고, 메시지를 핀으로 고정하고, 채널 북마크를 관리합니다.

**파일 다루기**

- 생성한 텍스트(로그, 스니펫, CSV)나 로컬 파일을 업로드하고 채널·스레드에 공유합니다.
- 파일 목록과 상세 정보를 조회하고 삭제합니다.

**문서와 데이터 정리** (Slack 유료 플랜 필요, 선택 툴셋)

- 캔버스를 만들어 회의록이나 정리 문서를 작성하고 편집합니다.
- Slack 리스트를 만들어 항목을 추가하고 상태를 갱신합니다.

**AI 어시스턴트 연동** (선택 툴셋)

- 어시스턴트 스레드에 "핸드북 검색 중…" 같은 진행 상태를 표시합니다.
- 스레드 제목과 추천 질문을 설정합니다.

**그 밖의 API**

전용 툴이 없는 기능도 `slack_call_api`로 호출합니다. 봇 토큰으로 접근 가능한 163개 메서드가 모두 대상입니다.

### 활용 예시

- CI가 실패하면 담당 채널에 알리고, 같은 스레드에 실패 로그를 파일로 첨부합니다.
- 매일 아침 지정한 시각에 전날 지표 요약을 예약 발송합니다.
- 채널 히스토리를 읽어 주간 회고를 정리하고 캔버스로 남깁니다.
- 배포 승인 요청을 보내고, 리액션을 확인해 승인 여부를 판단합니다.
- 문의 스레드를 읽고 답변을 스트리밍으로 작성합니다.

봇 토큰으로 할 수 없는 작업(워크스페이스 전체 검색, `admin.*` 조직 관리 등)은 [제한 사항](#제한-사항)을 참고하세요.

## 구성

- **전용 툴 62개** — 자주 쓰는 기능을 툴셋 단위로 제공합니다. 인자에 타입이 정의돼 있고, `#channel`·`@user`·이메일을 ID로 자동 변환하며, 응답은 필요한 필드만 추려서 반환합니다.
- **디스커버리 툴** — `slack_list_api_methods`, `slack_describe_api_method`, `slack_call_api` 세 가지로 전용 툴이 없는 메서드까지 호출합니다.
- **메서드 카탈로그 298개** — 이 중 봇 토큰으로 호출 가능한 163개를 지원합니다. 나머지 135개(`admin.*` 96개, `search.*`, `reminders.*`, `oauth.*` 등)는 Slack이 유저 토큰이나 앱 레벨 토큰을 요구하므로 호출 전에 사유와 함께 거부합니다.
- **접근 제어** — 읽기 전용 모드, 채널 허용 목록, 메서드 허용·거부 목록, 응답 길이 제한을 환경 변수로 설정합니다.
- **AI 관련 API 지원** — 메시지 스트리밍(`chat.startStream`), 캔버스, 리스트, 어시스턴트 스레드 API를 포함합니다.

## 요구 사항

- Node.js 20 이상
- 봇 토큰이 발급된 Slack 앱

## 설치

별도 설치 과정은 없습니다. MCP 클라이언트가 `npx`로 저장소에서 직접 실행하며, 최초 실행 시 npm이 빌드합니다.

먼저 실행되는지 확인합니다.

```bash
npx -y github:2duckchun/slack-mcp --help
```

## Slack 앱 설정

[api.slack.com/apps](https://api.slack.com/apps)에서 **From an app manifest**를 선택하고 아래 매니페스트를 붙여 넣습니다. 사용하지 않을 스코프는 삭제하는 것을 권장합니다.

```yaml
display_information:
  name: MCP Bot
features:
  bot_user:
    display_name: MCP Bot
oauth_config:
  scopes:
    bot:
      # 메시징
      - chat:write
      - chat:write.public      # 채널에 참여하지 않고 공개 채널에 게시
      - chat:write.customize   # icon_emoji / username 덮어쓰기
      # 채널
      - channels:read
      - groups:read
      - im:read
      - mpim:read
      - channels:history
      - groups:history
      - im:history
      - mpim:history
      - channels:join
      - channels:manage
      - groups:write
      - im:write
      # 사용자
      - users:read
      - users:read.email
      # 리액션, 핀, 북마크
      - reactions:read
      - reactions:write
      - pins:read
      - pins:write
      - bookmarks:read
      - bookmarks:write
      # 파일
      - files:read
      - files:write
      # 워크스페이스
      - emoji:read
      - team:read
      - usergroups:read
      # 선택 툴셋
      - canvases:read
      - canvases:write
      - lists:read
      - lists:write
      - assistant:write
settings:
  org_deploy_enabled: false
  socket_mode_enabled: false
```

앱을 설치한 뒤 **Bot User OAuth Token**(`xoxb-`로 시작)을 복사합니다. 매니페스트에 `user:` 스코프 블록이 없으므로 유저 토큰은 발급되지 않습니다.

## MCP 클라이언트 등록

### Claude Code

```bash
claude mcp add slack \
  --env SLACK_BOT_TOKEN=xoxb-your-token \
  -- npx -y github:2duckchun/slack-mcp
```

### Claude Desktop 등 `mcp.json` 기반 클라이언트

```json
{
  "mcpServers": {
    "slack": {
      "command": "npx",
      "args": ["-y", "github:2duckchun/slack-mcp"],
      "env": {
        "SLACK_BOT_TOKEN": "xoxb-your-token",
        "SLACK_MCP_ALLOWED_CHANNELS": "#bot-playground"
      }
    }
  }
}
```

특정 태그나 브랜치로 고정하려면 `#`을 붙입니다.

```bash
npx -y github:2duckchun/slack-mcp#v0.1.0 --help
```

로컬 클론을 사용하려면 `npm install && npm run build`를 먼저 실행한 뒤, `command`를 `node`로, `args`를 `["/절대경로/slack-mcp/dist/index.js"]`로 지정합니다.

## 환경 변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | — | 봇 토큰(`xoxb-`). 필수이며, 이 서버가 사용하는 유일한 자격 증명입니다. |
| `SLACK_MCP_TOOLSETS` | `core,messaging,conversations,users,reactions,files,workspace` | 등록할 툴셋 목록(쉼표 구분) 또는 `all`. `core`는 항상 포함됩니다. |
| `SLACK_MCP_READ_ONLY` | `false` | `true`이면 쓰기 툴을 등록하지 않고, `slack_call_api`의 쓰기 메서드도 거부합니다. |
| `SLACK_MCP_ALLOWED_CHANNELS` | — | 쓰기를 지정한 채널(ID 또는 `#이름`)로만 제한합니다. |
| `SLACK_MCP_DENIED_METHODS` | `auth.revoke, apps.uninstall, tooling.tokens.rotate, oauth.*, openid.*, migration.exchange` | 거부할 메서드 패턴. 값을 지정하면 기본값을 대체합니다. |
| `SLACK_MCP_ALLOWED_METHODS` | — | 값을 지정하면 여기에 해당하는 메서드만 호출할 수 있습니다. |
| `SLACK_MCP_MAX_RESPONSE_CHARS` | `40000` | 툴 결과 JSON의 최대 길이. 초과분은 잘라내고 안내 문구를 붙입니다. |
| `SLACK_MCP_TEAM_ID` | — | 조직 단위(org-wide) 설치에서 사용할 팀 ID. |
| `SLACK_API_URL` | Slack 기본값 | API 엔드포인트를 변경합니다(테스트용). |

메서드 패턴에는 `chat.*`처럼 `*` 와일드카드를 쓸 수 있습니다.

기본 설정은 쓰기가 켜져 있고 채널 제한이 없습니다. 검증되지 않은 에이전트에 연결할 때는 `SLACK_MCP_ALLOWED_CHANNELS`로 테스트 채널만 지정하거나 `SLACK_MCP_READ_ONLY=true`로 시작하는 것을 권장합니다.

## 툴셋

기본으로 등록되는 툴셋입니다.

| 툴셋 | 툴 |
| --- | --- |
| `core` | `slack_auth_test`, `slack_list_api_methods`, `slack_describe_api_method`, `slack_call_api` |
| `messaging` | `slack_send_message`, `slack_update_message`, `slack_delete_message`, `slack_send_ephemeral`, `slack_schedule_message`, `slack_list_scheduled_messages`, `slack_delete_scheduled_message`, `slack_get_permalink`, `slack_start_stream`, `slack_append_stream`, `slack_stop_stream` |
| `conversations` | `slack_list_channels`, `slack_get_channel_info`, `slack_get_channel_history`, `slack_get_thread`, `slack_list_channel_members`, `slack_join_channel`, `slack_leave_channel`, `slack_create_channel`, `slack_invite_to_channel`, `slack_set_channel_topic`, `slack_archive_channel`, `slack_open_dm` |
| `users` | `slack_list_users`, `slack_get_user_info`, `slack_lookup_user_by_email`, `slack_get_user_conversations` |
| `reactions` | `slack_add_reaction`, `slack_remove_reaction`, `slack_get_reactions`, `slack_pin_message`, `slack_unpin_message`, `slack_list_pins`, `slack_manage_bookmarks` |
| `files` | `slack_upload_file`, `slack_get_file_info`, `slack_list_files`, `slack_delete_file` |
| `workspace` | `slack_get_team_info`, `slack_list_emoji`, `slack_list_usergroups` |

`SLACK_MCP_TOOLSETS`에 추가해야 등록되는 선택 툴셋입니다.

| 툴셋 | 툴 | 비고 |
| --- | --- | --- |
| `canvas` | `slack_create_canvas`, `slack_edit_canvas`, `slack_lookup_canvas_sections`, `slack_set_canvas_access`, `slack_delete_canvas` | Slack 유료 플랜 필요 |
| `lists` | `slack_create_list`, `slack_list_list_items`, `slack_create_list_item`, `slack_update_list_item` | Slack 유료 플랜 필요 |
| `assistant` | `slack_set_assistant_status`, `slack_set_assistant_title`, `slack_set_suggested_prompts` | 어시스턴트 기능이 활성화된 앱에서만 동작 |
| `views` | `slack_validate_blocks`, `slack_publish_home_view`, `slack_open_modal`, `slack_push_modal`, `slack_update_modal` | 모달은 유효한 `trigger_id` 필요 |

선택 툴셋을 기본에서 제외한 이유는 툴 목록을 짧게 유지하기 위해서입니다. 등록된 툴은 개수만큼 매 턴 호스트의 컨텍스트를 차지합니다.

## 카탈로그 기반 API 호출

전용 툴이 없는 메서드는 디스커버리 툴 세 개로 호출합니다.

```
slack_list_api_methods    { query: "canvas" }
  → canvases.create, canvases.edit, canvases.delete, canvases.access.set, ...

slack_describe_api_method { method: "canvases.create" }
  → 인자, 타입, 필수 여부, 문서 링크

slack_call_api            { method: "canvases.create", params: { title: "회고" } }
```

봇 토큰으로 호출할 수 없는 메서드는 목록에 `unavailable` 사유가 함께 표시되고, 호출하면 Slack에 요청을 보내기 전에 거부됩니다.

```
slack_describe_api_method { method: "search.messages" }
  → unavailable: "is a user-token (xoxp-...) method; this server
     authenticates as a bot and cannot call it"
```

`slack_call_api`에도 읽기 전용 모드, 채널 허용 목록, 메서드 거부 목록이 동일하게 적용됩니다. `params`에 `token`을 넣으면 거부합니다. 자격 증명은 서버 설정에서만 가져옵니다.

## 동작 방식

- **응답 축약** — `users.list`는 멤버마다 아이콘 URL을 여덟 개씩, `conversations.history`는 메시지마다 블록 전체를 반환합니다. 각 툴은 판단에 필요한 필드만 골라 `structuredContent`와 JSON으로 돌려줍니다. 가공 전 원본이 필요하면 `slack_call_api`를 사용합니다.
- **식별자 자동 변환** — ID 자리에 `#general`, `@sujin`, `sujin@example.com`을 그대로 넣을 수 있습니다. 조회 결과는 10분간 캐시합니다.
- **에러 안내** — `missing_scope`는 필요한 스코프와 현재 스코프를 함께 표시하며 재설치를 안내합니다. `not_in_channel`은 `slack_join_channel`을, `invalid_blocks`는 `slack_validate_blocks`를 안내합니다. 레이트 리밋에 걸리면 대기 시간을 함께 표시합니다.
- **보수적인 읽기·쓰기 판정** — 분류되지 않은 메서드는 쓰기로 간주합니다. 미등록 메서드로 읽기 전용 모드가 우회되지 않습니다.
- **봇 전용** — 유저 토큰을 읽는 코드가 없습니다. 유저 토큰이 필요한 메서드 목록은 `src/slack/unsupported.ts`에 있으며, 호출 직전에 확인합니다.

## 공식 Slack MCP 서버와의 차이

Slack은 `mcp.slack.com`에서 공식 MCP 서버를 운영합니다(2026년 2월 GA). 두 서버는 용도가 다릅니다.

| | 공식 서버 | slack-bot-mcp |
| --- | --- | --- |
| 자격 | OAuth 사용자 자격 | 봇 토큰 |
| 범위 | 읽기·검색 위주 | 봇 권한으로 가능한 전 범위 |
| 용도 | 개인이 AI 클라이언트로 워크스페이스 조회 | 봇 자격으로 메시지 작성·파일 업로드·채널 관리 등 수행 |

사람 자격으로 워크스페이스를 검색하는 작업은 공식 서버가, 봇 자격으로 작업을 처리하는 것은 이 서버가 적합합니다.

## 제한 사항

- **stdio 전송만 지원합니다.** `src/server.ts`의 `createServer()`가 전송 계층과 분리돼 있으므로, `src/index.ts` 옆에 Streamable HTTP 엔트리포인트를 추가할 수 있습니다.
- **이벤트를 처리하지 않습니다.** MCP는 요청·응답 방식이므로, Slack 이벤트를 받으려면 별도 프로세스에서 Socket Mode를 실행해야 합니다.
- **워크스페이스 하나만 지원합니다.** 토큰을 환경 변수에서 읽습니다. 여러 워크스페이스를 OAuth로 연결하려면 토큰 저장소가 필요하며, 수정 지점은 `src/slack/client.ts`입니다.
- **검색 기능이 없습니다.** Slack의 `search.*`는 봇 토큰을 받지 않습니다. 대신 `slack_get_channel_history`에 `oldest`/`latest`를 지정해 봇이 참여한 채널을 조회해야 합니다.
- **`admin.*`을 사용할 수 없습니다.** 조직 관리 API는 관리자 유저 토큰을 요구합니다.
- **앱 레벨 토큰·앱 설정 토큰·클라이언트 시크릿이 필요한 메서드를 사용할 수 없습니다.** `apps.connections.open`, `apps.manifest.*`, `oauth.*` 등이 해당합니다. 이런 메서드는 호출 전에 사유와 함께 거부합니다.

## 개발

```bash
npm install
npm run gen:catalog   # @slack/web-api에서 API 카탈로그 재생성
npm run check         # 타입 체크 + 테스트 99개
npm run dev           # 소스를 stdio로 실행 (.env가 있으면 로드)
npm run build         # tsup -> dist/index.js
npm run smoke         # 빌드 후 dist/index.js를 실제 stdio MCP로 구동
npm run inspect       # 빌드 후 MCP Inspector 실행
```

테스트는 `msw`로 Slack API를 모킹하고 MCP 인메모리 트랜스포트로 서버를 띄웁니다. 토큰 없이 실행되며 실제 워크스페이스에 영향을 주지 않습니다. `npm run smoke`는 빌드된 결과물을 실행해 프로토콜로 통신하며, `SLACK_BOT_TOKEN`을 지정하면 실제 워크스페이스의 채널 목록까지 조회합니다.

### 카탈로그 갱신

Slack이 공개한 OpenAPI 스펙은 메서드가 174개뿐이고 `chat.startStream`, `canvases.*`, `slackLists.*`, `assistant.*`, 최신 파일 업로드 플로우가 빠져 있습니다. 그래서 메서드 카탈로그는 `@slack/web-api`의 TypeScript 선언 파일에서 생성합니다.

```bash
npm i @slack/web-api@latest   # SDK 업데이트
npm run gen:catalog           # src/generated/catalog.json 재생성
```

새로 추가된 메서드와 인자, 문서 링크를 서버가 인식합니다. SDK 타입보다 Slack 문서가 먼저 나온 메서드(`assistant.search.context` 등)는 `src/slack/extra-methods.ts`에서 직접 관리합니다. `slack_call_api`는 카탈로그에 없는 메서드도 호출을 시도하므로, 두 목록이 갱신되기 전에도 새 엔드포인트를 사용할 수 있습니다.

### npx 실행 방식

`tsup`이 전체를 `dist/index.js` 하나로 번들하면서 `#!/usr/bin/env node` 배너를 붙입니다. `package.json`의 `"prepare": "tsup"` 설정으로 git 소스에서 설치할 때 npm이 이 빌드를 자동 실행합니다. API 카탈로그는 JSON import이므로 번들에 포함되며, 실행 시점에 별도 데이터 파일이 필요하지 않습니다. `dist/`를 커밋하지 않는 이유입니다.

직접 확인하려면 다음과 같이 실행합니다.

```bash
npm pack                                   # prepare가 실행되며 tarball 생성
npm i -g ./slack-bot-mcp-0.1.0.tgz
slack-bot-mcp --version
```

## 라이선스

MIT
