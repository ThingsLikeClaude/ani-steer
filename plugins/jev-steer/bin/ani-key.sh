#!/bin/bash
# ani(jev-steer)용 Jev(TypeSafe) API 키 설정 — macOS / Linux.
# 숨김 입력으로 받아 ~/.claude/settings.json 의 env.TYPESAFE_API_KEY 에 저장한다.
# 키는 화면·터미널·로그 어디에도 출력하지 않는다. (Windows는 ani-key.ps1)
set -euo pipefail
SETTINGS="$HOME/.claude/settings.json"
mkdir -p "$HOME/.claude"; [ -f "$SETTINGS" ] || echo '{}' > "$SETTINGS"

# JSON 편집기: macOS는 JXA(기본 내장), 그 밖엔 node 또는 python3.
edit() { # $1 = get|del|set ; 키는 ANI_KEY 환경변수로만 넘긴다
  if command -v node >/dev/null; then
    ANI_OP="$1" ANI_FILE="$SETTINGS" node -e '
      const fs=require("fs"),f=process.env.ANI_FILE,op=process.env.ANI_OP;
      const j=JSON.parse(fs.readFileSync(f,"utf8")||"{}");
      if(op==="get"){const k=(j.env||{}).TYPESAFE_API_KEY;process.stdout.write(k?k.slice(-4):"");process.exit(0)}
      j.env=j.env||{}; if(op==="del")delete j.env.TYPESAFE_API_KEY; else j.env.TYPESAFE_API_KEY=process.env.ANI_KEY;
      fs.writeFileSync(f,JSON.stringify(j,null,2)+"\n")'
  elif command -v python3 >/dev/null; then
    ANI_OP="$1" ANI_FILE="$SETTINGS" python3 -c '
import json,os
f=os.environ["ANI_FILE"];op=os.environ["ANI_OP"];j=json.load(open(f)) or {}
if op=="get":
  k=(j.get("env") or {}).get("TYPESAFE_API_KEY");print(k[-4:] if k else "",end="");raise SystemExit
j.setdefault("env",{})
if op=="del": j["env"].pop("TYPESAFE_API_KEY",None)
else: j["env"]["TYPESAFE_API_KEY"]=os.environ["ANI_KEY"]
open(f,"w").write(json.dumps(j,indent=2,ensure_ascii=False)+"\n")'
  elif command -v osascript >/dev/null; then
    ANI_OP="$1" ANI_FILE="$SETTINGS" osascript -l JavaScript -e '
      ObjC.import("Foundation"); const env=$.NSProcessInfo.processInfo.environment;
      const g=n=>ObjC.unwrap(env.objectForKey(n)); const f=g("ANI_FILE"),op=g("ANI_OP");
      const txt=ObjC.unwrap($.NSString.stringWithContentsOfFileEncodingError(f,$.NSUTF8StringEncoding,null))||"{}";
      const j=JSON.parse(txt); if(op==="get"){const k=(j.env||{}).TYPESAFE_API_KEY; k?k.slice(-4):""} else {
      j.env=j.env||{}; if(op==="del")delete j.env.TYPESAFE_API_KEY; else j.env.TYPESAFE_API_KEY=g("ANI_KEY");
      $(JSON.stringify(j,null,2)+"\n").writeToFileAtomicallyEncodingError(f,true,$.NSUTF8StringEncoding,null); ""}'
  else
    echo "node, python3 중 하나가 필요합니다" >&2; exit 1
  fi
}

if [ "${1:-}" = "--status" ]; then
  tail4=$(edit get); [ -n "$tail4" ] && echo "TYPESAFE_API_KEY 설정됨 (끝 4자리: $tail4)" || echo "TYPESAFE_API_KEY 미설정"; exit 0
fi
if [ "${1:-}" = "--remove" ]; then
  cp "$SETTINGS" "$SETTINGS.bak-anikey"; edit del; echo "TYPESAFE_API_KEY 삭제됨"; exit 0
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
elif command -v zenity >/dev/null; then
  KEY=$(zenity --password --title="ani · Jev(TypeSafe) API 키" 2>/dev/null || true)
fi
if [ -z "$KEY" ] && [ -t 0 ]; then
  read -r -s -p "Jev(TypeSafe) API 키 (입력은 보이지 않음): " KEY; echo
fi
KEY=$(printf '%s' "$KEY" | tr -d '[:space:]')
[ -n "$KEY" ] || { echo "취소됨 · 변경 없음"; exit 1; }
cp "$SETTINGS" "$SETTINGS.bak-anikey"
ANI_KEY="$KEY" edit set
chmod 600 "$SETTINGS"
unset KEY
echo "키 저장 완료. /reload-plugins 하거나 새 세션을 여세요."
