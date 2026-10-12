#!/bin/bash
# ani(jev-steer)용 TypeSafe API 키 입력/변경/확인/삭제.
# macOS 숨김 입력창으로 받아 ~/.claude/settings.json 의 env.TYPESAFE_API_KEY 에 저장한다.
# 키는 화면·터미널·로그 어디에도 출력하지 않는다.
set -euo pipefail

SETTINGS="$HOME/.claude/settings.json"
command -v jq >/dev/null || { echo "jq가 필요합니다 (brew install jq)"; exit 1; }
[ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

if [ "${1:-}" = "--status" ]; then
  if jq -e '.env.TYPESAFE_API_KEY // empty' "$SETTINGS" >/dev/null; then
    echo "TYPESAFE_API_KEY 설정됨 (끝 4자리: $(jq -r '.env.TYPESAFE_API_KEY' "$SETTINGS" | tail -c 5))"
  else
    echo "TYPESAFE_API_KEY 미설정"
  fi
  exit 0
fi

if [ "${1:-}" = "--remove" ]; then
  tmp=$(mktemp); jq 'del(.env.TYPESAFE_API_KEY)' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
  echo "TYPESAFE_API_KEY 삭제됨"; exit 0
fi

KEY=""
if command -v osascript >/dev/null; then
  KEY=$(osascript <<'OSA' 2>/dev/null || true
try
  set r to display dialog "Jev(TypeSafe) API 키를 붙여넣으세요." & return & "(https://typesafe.ai 에서 발급)" default answer "" with hidden answer with title "ani" buttons {"취소", "저장"} default button "저장"
  return text returned of r
on error
  return ""
end try
OSA
)
fi
if [ -z "$KEY" ] && [ -t 0 ]; then
  read -r -s -p "Jev(TypeSafe) API 키 (입력은 보이지 않음): " KEY; echo
fi
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
[ -n "$KEY" ] || { echo "취소됨 · 변경 없음"; exit 1; }

cp "$SETTINGS" "$SETTINGS.bak-anikey"
tmp=$(mktemp)
jq --arg k "$KEY" '.env = ((.env // {}) + {TYPESAFE_API_KEY: $k})' "$SETTINGS" > "$tmp" && mv "$tmp" "$SETTINGS"
chmod 600 "$SETTINGS"
unset KEY
echo "키 저장 완료. /reload-plugins 하거나 새 세션을 여세요."
