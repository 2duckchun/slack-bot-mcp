# slack-bot-mcp

Slack 봇의 Web API를 AI 에이전트가 쓸 수 있게 열어 주는 MCP 서버입니다. 봇이 할 수 있는 일 전부를 다루며, 보통의 Slack 연동이 손대지 않는 AI 메시지 스트리밍, 캔버스, 리스트, 어시스턴트 스레드 API까지 포함합니다.

**봇 토큰(`xoxb-`) 하나만 받습니다.** 유저 토큰(`xoxp-`)은 받지 않고, 넣을 자리도 없습니다. 봇으로 할 수 있는 일과 사람 계정을 빌려야 하는 일의 경계를 설정이 아니라 구조로 못박아 둔 것입니다.

Node.js 20 이상과 봇 토큰이 발급된 Slack 앱이 필요합니다.

구조는 두 층입니다.

- **전용 툴 62개**: 봇이 자주 쓰는 기능을 담당합니다. 인자에 타입이 있고, `#channel`·`@user`·이메일을 알아서 ID로 바꿔 주고, 응답을 필요한 만큼만 줄여서 돌려줍니다. 에러 메시지에는 다음에 뭘 해야 하는지 적혀 있습니다.
- **디스커버리 툴 3개**: `slack_list_api_methods`, `slack_describe_api_method`, `slack_call_api`로 나머지 메서드에 전부 접근합니다. Slack에 새 메서드가 생겨도 그대로 쓸 수 있습니다.

카탈로그에는 Slack Web API 메서드 298개가 들어 있고, 그중 **봇 토큰으로 도달 가능한 163개**를 실제로 호출합니다. 나머지 135개는 Slack이 유저 토큰이나 앱 레벨 토큰만 받는 것들이라(`admin.*` 96개, `search.*`, `reminders.*`, `oauth.*` 등) 호출 전에 이유를 붙여 거부합니다. 목록과 문서에서 사라지지는 않으니, 왜 못 쓰는지는 `slack_describe_api_method`로 확인할 수 있습니다.

## 공식 Slack MCP 서버와 뭐가 다른가요

Slack도 `mcp.slack.com`에 공식 서버를 운영합니다(2026년 2월 GA). 개인이 자기 AI 클라이언트로 워크스페이스를 검색하고 읽는 용도라면 그쪽이 맞습니다. OAuth로 **사용자** 자격을 받고, 읽기와 검색 위주의 툴만 제공합니다.

이 서버는 반대 경우를 위한 것입니다. 오직 봇 토큰으로 **봇 자격으로만** 동작하고, 봇이 할 수 있는 범위 전체를 다룹니다. 메시지 작성과 수정, 파일 업로드, 스트리밍, 채널 관리, 캔버스와 리스트 조작까지 가능합니다.

바꿔 말하면 두 서버는 겹치지 않습니다. 사람 자격으로 워크스페이스를 뒤지는 일은 공식 서버에, 봇 자격으로 일을 처리하는 것은 이 서버에 맡기면 됩니다.

## 카탈로그를 최신으로 유지하는 방법

Slack이 공개한 OpenAPI 스펙은 오래됐습니다. 메서드가 174개뿐이고 `chat.startStream`, `canvases.*`, `slackLists.*`, `assistant.*`, 최신 파일 업로드 플로우가 전부 빠져 있습니다. 그래서 메서드 카탈로그는 실제로 최신 상태를 따라가는 **`@slack/web-api`의 TypeScript 선언 파일에서 생성**합니다.

```bash
npm i @slack/web-api@latest   # SDK 업데이트
npm run gen:catalog           # src/generated/catalog.json 재생성
```

이것만 돌리면 새로 추가된 메서드와 인자, 문서 링크까지 서버가 전부 인식합니다. SDK 타입보다 Slack 문서가 먼저 나온 소수의 메서드(`assistant.search.context` 등)는 직접 관리하는 목록(`src/slack/extra-methods.ts`)으로 채웁니다. `slack_call_api`는 카탈로그에 없는 메서드도 일단 호출해 보기 때문에, 두 목록이 갱신되기 전에도 새 엔드포인트를 쓸 수 있습니다.

## 시작하기

### 1. Slack 앱 만들기

[api.slack.com/apps](https://api.slack.com/apps)에서 **From an app manifest**를 고르고 아래 매니페스트를 붙여 넣으세요. 필요 없는 스코프는 지우는 게 좋습니다. 스코프 하나가 곧 권한 하나고, 나중에 전부 설명해야 합니다.

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

앱을 설치한 뒤 **Bot User OAuth Token**(`xoxb-`로 시작)을 복사합니다. 매니페스트에 `user:` 스코프 블록이 없으므로 유저 토큰은 애초에 발급되지 않습니다.

### 2. MCP 클라이언트에 등록하기

따로 설치할 건 없습니다. 클라이언트가 저장소에서 바로 실행하고, 처음 실행할 때 npm이 빌드합니다.

**Claude Code**

```bash
claude mcp add slack \
  --env SLACK_BOT_TOKEN=xoxb-your-token \
  -- npx -y github:2duckchun/slack-mcp
```

**Claude Desktop**(`claude_desktop_config.json`) **또는 다른 `mcp.json`**

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

태그나 브랜치는 `#`으로 고정합니다.

```bash
npx -y github:2duckchun/slack-mcp#v0.1.0 --help
```

> 로컬 클론을 쓰려면 `npm install && npm run build`를 먼저 하고, `"command"`를 `"node"`로, `"args"`를 `["/절대경로/slack-mcp/dist/index.js"]`로 바꾸면 됩니다.

등록하기 전에 실행이 되는지 먼저 확인해 보세요.

```bash
npx -y github:2duckchun/slack-mcp --help
```

## 설정

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `SLACK_BOT_TOKEN` | — | 봇 토큰(`xoxb-`). 필수이자, 이 서버가 받는 유일한 자격 증명입니다. |
| `SLACK_MCP_TOOLSETS` | `core,messaging,conversations,users,reactions,files,workspace` | 쉼표로 구분한 툴셋 목록 또는 `all`. `core`는 항상 포함됩니다. |
| `SLACK_MCP_READ_ONLY` | `false` | 쓰기 툴을 전부 감추고, `slack_call_api`로 들어오는 쓰기 메서드도 거부합니다. |
| `SLACK_MCP_ALLOWED_CHANNELS` | — | 쓰기를 지정한 채널(ID 또는 `#이름`)로만 제한합니다. |
| `SLACK_MCP_DENIED_METHODS` | `auth.revoke, apps.uninstall, tooling.tokens.rotate, oauth.*, openid.*, migration.exchange` | 거부할 메서드 패턴. 값을 지정하면 기본값을 대체합니다. |
| `SLACK_MCP_ALLOWED_METHODS` | — | 값을 지정하면 여기에 걸리는 메서드만 호출할 수 있습니다. |
| `SLACK_MCP_MAX_RESPONSE_CHARS` | `40000` | 툴 결과로 내보낼 JSON의 최대 길이. 넘으면 잘라 내고 안내 문구를 붙입니다. |
| `SLACK_MCP_TEAM_ID` | — | 조직 단위(org-wide) 설치에서 쓰는 팀 ID. |
| `SLACK_API_URL` | Slack 기본값 | API 주소를 바꿉니다(테스트용). |

**기본값에 대해.** 기본 설정에서는 쓰기가 켜져 있고 채널 제한도 없습니다. 메시지를 못 보내는 봇은 쓸모가 없으니까요. 다만 아직 검증되지 않은 에이전트에 붙일 거라면 `SLACK_MCP_ALLOWED_CHANNELS`에 테스트 채널만 지정하거나 `SLACK_MCP_READ_ONLY=true`로 시작하는 쪽을 권합니다.

## 툴셋

기본으로 켜지는 툴셋:

| 툴셋 | 툴 |
| --- | --- |
| `core` | `slack_auth_test`, `slack_list_api_methods`, `slack_describe_api_method`, `slack_call_api` |
| `messaging` | `slack_send_message`, `slack_update_message`, `slack_delete_message`, `slack_send_ephemeral`, `slack_schedule_message`, `slack_list_scheduled_messages`, `slack_delete_scheduled_message`, `slack_get_permalink`, `slack_start_stream`, `slack_append_stream`, `slack_stop_stream` |
| `conversations` | `slack_list_channels`, `slack_get_channel_info`, `slack_get_channel_history`, `slack_get_thread`, `slack_list_channel_members`, `slack_join_channel`, `slack_leave_channel`, `slack_create_channel`, `slack_invite_to_channel`, `slack_set_channel_topic`, `slack_archive_channel`, `slack_open_dm` |
| `users` | `slack_list_users`, `slack_get_user_info`, `slack_lookup_user_by_email`, `slack_get_user_conversations` |
| `reactions` | `slack_add_reaction`, `slack_remove_reaction`, `slack_get_reactions`, `slack_pin_message`, `slack_unpin_message`, `slack_list_pins`, `slack_manage_bookmarks` |
| `files` | `slack_upload_file`, `slack_get_file_info`, `slack_list_files`, `slack_delete_file` |
| `workspace` | `slack_get_team_info`, `slack_list_emoji`, `slack_list_usergroups` |

선택 툴셋(`SLACK_MCP_TOOLSETS`에 추가해야 켜집니다):

| 툴셋 | 툴 | 비고 |
| --- | --- | --- |
| `canvas` | `slack_create_canvas`, `slack_edit_canvas`, `slack_lookup_canvas_sections`, `slack_set_canvas_access`, `slack_delete_canvas` | Slack 유료 플랜 필요 |
| `lists` | `slack_create_list`, `slack_list_list_items`, `slack_create_list_item`, `slack_update_list_item` | Slack 유료 플랜 필요 |
| `assistant` | `slack_set_assistant_status`, `slack_set_assistant_title`, `slack_set_suggested_prompts` | 어시스턴트 기능을 켠 앱에서만 |
| `views` | `slack_validate_blocks`, `slack_publish_home_view`, `slack_open_modal`, `slack_push_modal`, `slack_update_modal` | 모달은 유효한 `trigger_id`가 있어야 동작 |

기본으로 꺼 둔 이유는 툴 목록을 짧게 유지하기 위해서입니다. 등록된 툴은 개수만큼 매 턴 호스트의 컨텍스트를 차지합니다.

## 나머지 API 쓰기

전용 툴이 있는 메서드는 60개 남짓이고, 봇 토큰으로 닿는 나머지도 호출 한 번이면 됩니다.

```
slack_list_api_methods    { query: "canvas" }
  → canvases.create, canvases.edit, canvases.delete, canvases.access.set, ...

slack_describe_api_method { method: "canvases.create" }
  → 인자, 타입, 필수 여부, 문서 링크

slack_call_api            { method: "canvases.create", params: { title: "회고" } }
```

봇 토큰으로 닿지 않는 메서드는 목록에 `unavailable` 사유가 함께 붙고, 호출하면 Slack까지 가기 전에 거부됩니다.

```
slack_describe_api_method { method: "search.messages" }
  → unavailable: "is a user-token (xoxp-...) method; this server
     authenticates as a bot and cannot call it"
```

`slack_call_api`도 다른 툴과 똑같은 제약을 받습니다. 읽기 전용 모드, 채널 허용 목록, 거부 목록이 전부 그대로 적용됩니다. `params`에 `token`을 넣으면 거부합니다. 자격 증명은 모델이 만든 값이 아니라 서버 설정에서만 가져옵니다.

## 설계 메모

**응답은 그대로 넘기지 않고 추립니다.** `users.list` 한 페이지에는 멤버마다 아이콘 URL이 여덟 개씩 들어 있고, `conversations.history`는 메시지마다 블록 전체를 반복해서 내려 줍니다. 각 툴은 호출한 쪽이 실제로 판단에 쓰는 필드만 골라 `structuredContent`와 읽기 좋은 JSON으로 돌려줍니다. 가공 전 원본이 필요하면 `slack_call_api`로 받으면 됩니다.

**식별자는 알아서 변환합니다.** ID가 들어갈 자리에 `#general`, `@sujin`, `sujin@example.com`을 그대로 넣어도 됩니다. 조회 결과는 10분간 캐시하고, 모르는 이름이 나올 때만 새로 조회합니다.

**에러는 해결 방법까지 알려줍니다.** `missing_scope`면 필요한 스코프와 현재 스코프를 같이 보여주면서 재설치를 안내합니다. `not_in_channel`이면 `slack_join_channel`을, `invalid_blocks`면 `slack_validate_blocks`를 가리킵니다. 레이트 리밋에 걸리면 얼마나 기다려야 하는지 함께 표시합니다.

**읽기/쓰기 판정은 보수적으로 합니다.** 분류에 없는 메서드는 쓰기로 간주합니다. 아직 등록되지 않은 메서드 때문에 읽기 전용 모드가 뚫리는 일은 없습니다.

**봇 전용은 설정이 아니라 구조입니다.** 유저 토큰을 읽는 코드가 아예 없으므로, 환경 변수를 잘못 넣어서 사람 권한으로 동작하는 사고가 일어날 수 없습니다. 유저 토큰이 필요한 메서드 목록은 `src/slack/unsupported.ts`에 있고, 호출 직전에 이 목록을 확인해 거부합니다.

## 개발

```bash
npm install
npm run gen:catalog   # @slack/web-api에서 API 카탈로그 재생성
npm run check         # 타입 체크 + 테스트 99개
npm run dev           # 소스를 stdio로 바로 실행 (.env가 있으면 읽음)
npm run build         # tsup -> dist/index.js
npm run smoke         # 빌드 후 실제 stdio MCP로 dist/index.js 구동
npm run inspect       # 빌드 후 MCP Inspector 실행
```

테스트는 `msw`로 Slack API를 모킹하고 MCP 인메모리 트랜스포트로 서버를 띄웁니다. 토큰 없이 돌아가고 실제 워크스페이스는 건드리지 않습니다. `npm run smoke`는 한 단계 더 나아가 빌드된 바이너리를 실제로 실행해서 프로토콜로 통신합니다. 여기에 진짜 `SLACK_BOT_TOKEN`을 넣으면 워크스페이스 채널 목록까지 가져옵니다.

**`npx -y github:…`로 실행되는 원리.** `tsup`이 전체를 `dist/index.js` 하나로 번들하면서 `#!/usr/bin/env node` 배너를 붙입니다. `package.json`의 `"prepare": "tsup"` 덕분에 git 소스로 설치할 때 npm이 이 빌드를 자동으로 돌립니다. API 카탈로그는 JSON import라 번들 안에 그대로 들어가서, 실행 시점에 따로 찾아야 할 데이터 파일이 없습니다. 그래서 `dist/`는 커밋하지 않고 설치하는 쪽에서 빌드합니다.

이 과정을 직접 확인하려면:

```bash
npm pack                                   # prepare가 실행되며 tarball 생성
npm i -g ./slack-bot-mcp-0.1.0.tgz
slack-bot-mcp --version
```

## 알려진 한계

- **stdio만 지원합니다.** `src/server.ts`의 `createServer()`는 트랜스포트와 분리돼 있어서, `src/index.ts` 옆에 Streamable HTTP 엔트리포인트를 추가하는 게 자연스러운 다음 단계입니다.
- **이벤트는 처리하지 않습니다.** MCP는 요청/응답 방식이라, Slack 이벤트를 받으려면 별도 프로세스에서 Socket Mode를 돌려야 합니다.
- **워크스페이스 하나만 지원합니다.** 토큰을 환경 변수에서 읽습니다. 여러 워크스페이스를 OAuth로 붙이려면 토큰 저장소가 필요하고, 손볼 지점은 `src/slack/client.ts`입니다.
- **검색이 없습니다.** Slack의 `search.*`는 봇 토큰을 받지 않습니다. 워크스페이스 전체 검색 대신, `slack_get_channel_history`에 `oldest`/`latest`를 주고 봇이 들어가 있는 채널을 훑는 방식으로 대체해야 합니다.
- **`admin.*`을 쓸 수 없습니다.** 조직 관리 API는 전부 관리자 유저 토큰을 요구합니다. 봇 토큰으로는 도달할 방법이 없습니다.
- **그 밖에 이 서버가 가질 수 없는 자격 증명을 요구하는 메서드들.** 앱 레벨 토큰(`apps.connections.open`), 앱 설정 토큰(`apps.manifest.*`), 클라이언트 시크릿(`oauth.*`) 같은 것들입니다. 이런 메서드는 Slack의 알아보기 어려운 에러를 그대로 보여주는 대신, 호출 전에 이유를 붙여 거부합니다.
