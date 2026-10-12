# ani(jev-steer)용 Jev(TypeSafe) API 키 설정 — Windows.
# 가려진 입력창으로 키를 받아 %USERPROFILE%\.claude\settings.json 의 env.TYPESAFE_API_KEY 에 저장한다.
# 키는 화면·콘솔·로그 어디에도 출력하지 않는다. jq 등 외부 도구 불필요.
param([switch]$Status, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$settings = Join-Path $env:USERPROFILE '.claude\settings.json'
if (-not (Test-Path $settings)) { New-Item -ItemType Directory -Force -Path (Split-Path $settings) | Out-Null; '{}' | Set-Content -Encoding UTF8 $settings }
$json = Get-Content -Raw -Encoding UTF8 $settings | ConvertFrom-Json
if (-not $json) { $json = [pscustomobject]@{} }

function Save($obj) {
  Copy-Item $settings "$settings.bak-anikey" -Force
  $obj | ConvertTo-Json -Depth 32 | Set-Content -Encoding UTF8 $settings
}

$hasEnv = $json.PSObject.Properties.Name -contains 'env'
if ($Status) {
  if ($hasEnv -and $json.env.TYPESAFE_API_KEY) { $k = [string]$json.env.TYPESAFE_API_KEY; "TYPESAFE_API_KEY 설정됨 (끝 4자리: $($k.Substring([Math]::Max(0, $k.Length - 4))))" } else { 'TYPESAFE_API_KEY 미설정' }
  exit 0
}
if ($Remove) {
  if ($hasEnv) { $json.env.PSObject.Properties.Remove('TYPESAFE_API_KEY'); Save $json }
  'TYPESAFE_API_KEY 삭제됨'; exit 0
}

Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form -Property @{ Text = 'ani'; Width = 420; Height = 170; StartPosition = 'CenterScreen'; TopMost = $true; FormBorderStyle = 'FixedDialog'; MaximizeBox = $false; MinimizeBox = $false }
$label = New-Object System.Windows.Forms.Label -Property @{ Text = "Jev(TypeSafe) API 키를 붙여넣으세요.`n(https://typesafe.ai 에서 발급)"; Left = 12; Top = 10; Width = 380; Height = 36 }
$box = New-Object System.Windows.Forms.TextBox -Property @{ Left = 12; Top = 50; Width = 380; UseSystemPasswordChar = $true }
$ok = New-Object System.Windows.Forms.Button -Property @{ Text = '저장'; Left = 236; Top = 84; Width = 75; DialogResult = 'OK' }
$cancel = New-Object System.Windows.Forms.Button -Property @{ Text = '취소'; Left = 317; Top = 84; Width = 75; DialogResult = 'Cancel' }
$form.Controls.AddRange(@($label, $box, $ok, $cancel)); $form.AcceptButton = $ok; $form.CancelButton = $cancel
if ($form.ShowDialog() -ne 'OK') { '취소됨 · 변경 없음'; exit 1 }
$key = ($box.Text -replace '\s', '')
$box.Text = ''
if (-not $key) { '취소됨 · 변경 없음'; exit 1 }
if (-not $hasEnv) { $json | Add-Member -NotePropertyName env -NotePropertyValue ([pscustomobject]@{}) }
if ($json.env.PSObject.Properties.Name -contains 'TYPESAFE_API_KEY') { $json.env.TYPESAFE_API_KEY = $key } else { $json.env | Add-Member -NotePropertyName TYPESAFE_API_KEY -NotePropertyValue $key }
Save $json
Remove-Variable key
'키 저장 완료. /reload-plugins 하거나 새 세션을 여세요.'
