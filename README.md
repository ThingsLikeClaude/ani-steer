# ani-steer

Claude Code 모드(플러그인). 사용자가 Claude를 교정한 말을 사례로 쌓고, 사다리로 올립니다.

사례 → 판단 → 교훈(판단 2개) → 규칙(3회) → 원칙(규칙 2개) → 근원 욕구(원칙 2개, 사용자가 확정)

- 판단(예/아니오)은 Jev(TypeSafe), 문장 정리는 Haiku가 합니다.
- 요청을 보낼 때 Jev가 해당되는 교훈을 골라(최대 2개) 그 요청에만 붙입니다. 규칙·원칙·확정된 근원 욕구는 항상 붙습니다.
- 프롬프트 위 한 줄 상태 표시, 오른쪽 패널(`/ani`), 승격 확인 카드.
- 교훈·규칙·지시는 말한 프로젝트에서만 붙습니다. 패널은 모든 프로젝트의 것을 보여 주고, 다른 프로젝트의 것은 그 프로젝트 이름을 달고 `여기에도 붙이기` / `안 붙임`을 기다립니다. 붙인 것은 `○○에서`로 표시되고 `여기서 떼기`로 뗄 수 있습니다. 프로젝트 기록이 생기기 전에 저장된 지시는 `출처 모름`으로 보이며, 붙인 프로젝트에서만 붙습니다.

## 설치

```
/plugin marketplace add ThingsLikeClaude/ani-steer
/plugin install jev-steer@ani-steer
```

Jev(TypeSafe) 키가 필요합니다. 키가 없으면 첫 실행 때 프롬프트 위에 안내 카드가 뜨고, `키 설정하기`를 누르면 `/jev-steer:ani-key`가 숨김 입력창으로 키를 받아 `~/.claude/settings.json`의 `env.TYPESAFE_API_KEY`에 저장합니다. 키는 채팅에 남지 않습니다. macOS · Linux · Windows 모두 지원하며 jq 같은 외부 도구는 필요 없습니다.

## 저장

`$.store` (Claude Code 플러그인 저장소, JSON). 교훈 `cards`, 사례 `feedbackLog`, 지시 `requirements`, 원칙 `principles`, 근원 욕구 `needs`.
