#!/bin/bash
# ani(jev-steer)용 Jev API 키 설정 — macOS / Linux.
# 숨김 입력으로 받아 Claude 설정 파일(settings.json)의 env 에 저장한다.
#   기본: TYPESAFE_API_KEY (typesafe.ai) · --openrouter: OPENROUTER_API_KEY (openrouter.ai)
# 키는 화면·터미널·로그 어디에도 출력하지 않는다. (Windows는 ani-key.ps1)
set -euo pipefail
CONF="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
SETTINGS="$CONF/settings.json"
mkdir -p "$CONF"; [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

NAME=TYPESAFE_API_KEY; SITE=typesafe.ai; LABEL="Jev(TypeSafe)"; MODE=set
for a in "$@"; do
  case "$a" in
    --openrouter) NAME=OPENROUTER_API_KEY; SITE=openrouter.ai; LABEL="OpenRouter" ;;
    --status) MODE=status ;;
    --remove) MODE=remove ;;
    *) echo "알 수 없는 옵션: $a (--openrouter, --status, --remove)" >&2; exit 2 ;;
  esac
done
export ANI_NAME="$NAME"

# JSON 편집기: macOS는 JXA(기본 내장), 그 밖엔 node 또는 python3.
edit() { # $1 = get|del|set ; 키는 ANI_KEY 환경변수로만 넘긴다
  if command -v node >/dev/null; then
    ANI_OP="$1" ANI_FILE="$SETTINGS" node -e '
      const fs=require("fs"),f=process.env.ANI_FILE,op=process.env.ANI_OP;
      const j=JSON.parse(fs.readFileSync(f,"utf8")||"{}");
      const n=process.env.ANI_NAME;
      if(op==="get"){const k=(j.env||{})[n];process.stdout.write(k?k.slice(-4):"");process.exit(0)}
      j.env=j.env||{}; if(op==="del")delete j.env[n]; else j.env[n]=process.env.ANI_KEY;
      fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")'
  elif command -v python3 >/dev/null; then
    ANI_OP="$1" ANI_FILE="$SETTINGS" python3 -c '
import json,os
f=os.environ["ANI_FILE"];op=os.environ["ANI_OP"];n=os.environ["ANI_NAME"];j=json.load(open(f,encoding="utf-8")) or {}
if op=="get":
  k=(j.get("env") or {}).get(n);print(k[-4:] if k else "",end="");raise SystemExit
j.setdefault("env",{})
if op=="del": j["env"].pop(n,None)
else: j["env"][n]=os.environ["ANI_KEY"]
open(f,"w",encoding="utf-8").write(json.dumps(j,indent=2,ensure_ascii=False)+"\n")'
  elif command -v osascript >/dev/null; then
    ANI_OP="$1" ANI_FILE="$SETTINGS" osascript -l JavaScript -e '
      ObjC.import("Foundation"); const env=$.NSProcessInfo.processInfo.environment;
      const g=n=>ObjC.unwrap(env.objectForKey(n)); const f=g("ANI_FILE"),op=g("ANI_OP"),n=g("ANI_NAME");
      const txt=ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(f,$.NSUTF8StringEncoding,null))||"{}";
      const j=JSON.parse(txt); if(op==="get"){const k=(j.env||{})[n]; k?k.slice(-4):""} else {
      j.env=j.env||{}; if(op==="del")delete j.env[n]; else j.env[n]=g("ANI_KEY");
      $(JSON.stringify(j,null,2)+"\n").writeToFileAtomicallyEncodingError(f,true,$.NSUTF8StringEncoding,null); ""}'
  else
    echo "node, python3 중 하나가 필요합니다" >&2; exit 1
  fi
}

if [ "$MODE" = status ]; then
  tail4=$(edit get); [ -n "$tail4" ] && echo "$NAME 설정됨 (끝 4자리: $tail4)" || echo "$NAME 미설정"; exit 0
fi
if [ "$MODE" = remove ]; then
  cp "$SETTINGS" "$SETTINGS.bak-anikey"; edit del; echo "$NAME 삭제됨"; exit 0
fi

KEY=""
if command -v osascript >/dev/null; then
  KEY=$(ANI_LABEL="$LABEL" ANI_SITE="$SITE" osascript <<'OSA' 2>/dev/null || true
try
  set lbl to system attribute "ANI_LABEL"
  set site to system attribute "ANI_SITE"
  set r to display dialog (lbl & " API 키를 붙여넣으세요.") & return & ("(https://" & site & " 에서 발급)") default answer "" with hidden answer with title "ani" buttons {"취소", "저장"} default button "저장"
  return text returned of r
on error
  return ""
end try
OSA
)
elif command -v zenity >/dev/null; then
  KEY=$(zenity --password --title="ani · $LABEL API 키" 2>/dev/null || true)
fi
if [ -z "$KEY" ] && [ -t 0 ]; then
  read -r -s -p "$LABEL API 키 (https://$SITE · 입력은 보이지 않음): " KEY; echo
fi
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
[ -n "$KEY" ] || { echo "취소됨 · 변경 없음"; exit 1; }
cp "$SETTINGS" "$SETTINGS.bak-anikey"
ANI_KEY="$KEY" edit set
chmod 600 "$SETTINGS"
unset KEY
echo "키 저장 완료. /reload-plugins 하거나 새 세션을 여세요."
