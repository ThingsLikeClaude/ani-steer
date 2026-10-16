---
name: ani-key
description: ani(jev-steer)가 쓰는 Jev API 키(TypeSafe 또는 OpenRouter)를 설정·변경·확인·삭제한다. "ani 키", "jev 키 설정", "typesafe 키", "openrouter 키" 요청이나 ani 패널의 "키 설정하기" 버튼에서 실행된다.
---

# ani-key

키 값은 절대 채팅으로 받거나 출력하지 않는다. 사용자가 가려진 입력창에 직접 붙여넣는다.

Jev는 두 곳에서 쓸 수 있다. 둘 중 하나만 있으면 된다.

| 키 | 발급 | 스크립트 옵션 |
|---|---|---|
| `TYPESAFE_API_KEY` | https://typesafe.ai | (기본) |
| `OPENROUTER_API_KEY` | https://openrouter.ai | macOS/Linux `--openrouter`, Windows `-OpenRouter` |

사용자가 어느 키인지 말하지 않았으면 어느 쪽 키를 가지고 있는지 한 번 묻는다. 그다음 "화면에 키 입력창이 뜹니다. 발급한 키를 붙여넣으세요"라고 안내하고 실행한다.

운영체제에 맞는 스크립트를 쓴다.

| 작업 | macOS / Linux | Windows |
|---|---|---|
| 설정·변경 | `bash "${CLAUDE_PLUGIN_ROOT}/bin/ani-key.sh"` | `powershell -NoProfile -ExecutionPolicy Bypass -File "${CLAUDE_PLUGIN_ROOT}/bin/ani-key.ps1"` |
| 상태 확인 | `… ani-key.sh --status` | `… ani-key.ps1 -Status` |
| 삭제 (실행 전 사용자 확인) | `… ani-key.sh --remove` | `… ani-key.ps1 -Remove` |

- macOS는 시스템 입력창, Windows는 가려진 입력창(Windows Forms), Linux는 zenity가 있으면 입력창, 없으면 터미널 숨김 입력.
- Linux에 zenity가 없으면 Bash 도구로는 입력을 받을 수 없으니, 사용자에게 터미널에서 직접 위 명령을 실행하라고 안내한다.
- 외부 도구(jq) 없이 동작한다. macOS/Linux는 node·python3·osascript 중 있는 것으로 JSON을 고친다.
- 키는 Claude 설정 폴더의 `settings.json`(`CLAUDE_CONFIG_DIR`이 있으면 그 폴더, 없으면 `~/.claude`)의 `env`에 저장된다.
- 두 키가 모두 있으면 요청마다 하는 판정은 TypeSafe로, 지난 대화 찾기 같은 백그라운드 작업은 OpenRouter로 보낸다.

저장 후 "`/reload-plugins` 하거나 새 세션을 열면 ani 패널의 Jev 연결 점이 초록색이 된다"고 알린다.
