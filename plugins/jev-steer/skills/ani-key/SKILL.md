---
name: ani-key
description: ani(jev-steer)가 쓰는 Jev(TypeSafe) API 키를 설정·변경·확인·삭제한다. "ani 키", "jev 키 설정", "typesafe 키" 요청이나 ani 패널의 "키 설정하기" 버튼에서 실행된다.
---

# ani-key

키 값은 절대 채팅으로 받거나 출력하지 않는다. 사용자가 숨김 입력창에 직접 붙여넣는다.

- 설정/변경: `bash "${CLAUDE_PLUGIN_ROOT}/bin/ani-key.sh"` 실행. 실행 전에 "화면에 키 입력창이 뜹니다. https://typesafe.ai 에서 발급한 키를 붙여넣으세요"라고 안내한다.
- 상태 확인: `bash "${CLAUDE_PLUGIN_ROOT}/bin/ani-key.sh" --status`
- 삭제: `bash "${CLAUDE_PLUGIN_ROOT}/bin/ani-key.sh" --remove` (실행 전 사용자 확인)

macOS가 아니면 입력창 대신 터미널 숨김 입력을 쓴다. 이 경우 사용자에게 터미널에서 직접 위 명령을 실행하라고 안내한다.

저장 후 "`/reload-plugins` 하거나 새 세션을 열면 ani 패널의 Jev 연결 점이 초록색이 된다"고 알린다. jq가 없다는 오류가 나면 `brew install jq`를 안내한다.
