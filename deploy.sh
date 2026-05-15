#!/usr/bin/env bash
# Pallax 数据复盘 Dashboard 部署脚本
# 用法: ./deploy.sh
#   pallax_weekly_dashboard.html         → server:/root/pallax-dashboard/index.html
#   pallax_weekly_dashboard_preview.html  → server:/root/pallax-dashboard/preview.html
#   weeklyreport/*.{html,css}             → server:/root/pallax-dashboard/weeklyreport/
#
# 用 rsync 单连接传输 (比 scp 多连接稳, 只传 diff), 再 md5 校验落盘一致.
# 推送前服务器自己存 index.html.bak-$TS.

set -euo pipefail

# ─── 配置 ───────────────────────────────────────────────────────────────
SSH_KEY="$HOME/.ssh/tokyo_server"
SSH_USER="root"
SSH_HOST="43.163.198.237"
SSH_PORT="22"
REMOTE_DIR="/root/pallax-dashboard"

LOCAL_MAIN="pallax_weekly_dashboard.html"
LOCAL_PREVIEW="pallax_weekly_dashboard_preview.html"
LOCAL_FACTORY_DIR="weeklyreport"

# rsync / ssh 共享的 transport 参数 — 单行 (macOS rsync 2.6.9 对多行敏感)
SSH_CMD="ssh -i $SSH_KEY -p $SSH_PORT -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -o ServerAliveInterval=10"

REMOTE="${SSH_USER}@${SSH_HOST}"

# ─── 切到脚本所在目录 ─────────────────────────────────────────────────────
cd "$(dirname "${BASH_SOURCE[0]}")"

# ─── 前置检查 ─────────────────────────────────────────────────────────────
[[ -f "$LOCAL_MAIN" ]]        || { echo "✗ 缺文件: $LOCAL_MAIN";        exit 1; }
[[ -f "$LOCAL_PREVIEW" ]]     || { echo "✗ 缺文件: $LOCAL_PREVIEW";     exit 1; }
[[ -d "$LOCAL_FACTORY_DIR" ]] || { echo "✗ 缺目录: $LOCAL_FACTORY_DIR"; exit 1; }
[[ -f "$SSH_KEY" ]]           || { echo "✗ SSH key: $SSH_KEY";          exit 1; }
command -v rsync >/dev/null   || { echo "✗ 需要 rsync (brew install rsync)"; exit 1; }

# md5 兼容 macOS 与 Linux
md5_of() {
  if command -v md5sum >/dev/null 2>&1; then md5sum "$1" | awk '{print $1}'
  else md5 -q "$1"
  fi
}

LOCAL_MAIN_MD5=$(md5_of "$LOCAL_MAIN")
LOCAL_PREVIEW_MD5=$(md5_of "$LOCAL_PREVIEW")

echo "→ 本地 index    md5: $LOCAL_MAIN_MD5  ($LOCAL_MAIN)"
echo "→ 本地 preview  md5: $LOCAL_PREVIEW_MD5  ($LOCAL_PREVIEW)"

# ─── 1. 服务器备份当前 index.html (单 ssh) ─────────────────────────────────
TS=$(date +%Y%m%d-%H%M%S)
echo "→ 服务器备份 → index.html.bak-$TS · 同时 mkdir factory dir"
$SSH_CMD "$REMOTE" "
  set -e
  mkdir -p $REMOTE_DIR/$LOCAL_FACTORY_DIR
  if [ -f $REMOTE_DIR/index.html ]; then cp $REMOTE_DIR/index.html $REMOTE_DIR/index.html.bak-$TS; fi
"

# ─── 2. rsync 上传 ────────────────────────────────────────────────────────
echo "→ rsync index.html + preview.html"
rsync -az -e "$SSH_CMD" \
  "$LOCAL_MAIN"    "$REMOTE:$REMOTE_DIR/index.html"
rsync -az -e "$SSH_CMD" \
  "$LOCAL_PREVIEW" "$REMOTE:$REMOTE_DIR/preview.html"

echo "→ rsync $LOCAL_FACTORY_DIR/ (只传 diff)"
rsync -az --delete --info=stats0,name1 -e "$SSH_CMD" \
  --include='*.html' --include='*.css' --exclude='*' \
  "$LOCAL_FACTORY_DIR/" "$REMOTE:$REMOTE_DIR/$LOCAL_FACTORY_DIR/"

# ─── 3. 校验 (单 ssh) ─────────────────────────────────────────────────────
REMOTE_MD5=$($SSH_CMD "$REMOTE" "
  md5sum $REMOTE_DIR/index.html $REMOTE_DIR/preview.html $REMOTE_DIR/$LOCAL_FACTORY_DIR/*.html $REMOTE_DIR/$LOCAL_FACTORY_DIR/*.css
")

check_md5() {
  local local_path="$1" remote_path="$2"
  local lmd5; lmd5=$(md5_of "$local_path")
  local rmd5; rmd5=$(echo "$REMOTE_MD5" | awk -v p="$remote_path" '$2==p{print $1}')
  if [[ "$lmd5" == "$rmd5" && -n "$rmd5" ]]; then
    printf "  ✓ %s\n" "$remote_path"
  else
    printf "  ✗ %s  local=%s remote=%s\n" "$remote_path" "$lmd5" "$rmd5"
    return 1
  fi
}

echo "→ 校验 md5"
ok=1
check_md5 "$LOCAL_MAIN"    "$REMOTE_DIR/index.html"   || ok=0
check_md5 "$LOCAL_PREVIEW" "$REMOTE_DIR/preview.html" || ok=0
for f in "$LOCAL_FACTORY_DIR"/*.html "$LOCAL_FACTORY_DIR"/*.css; do
  check_md5 "$f" "$REMOTE_DIR/$f" || ok=0
done

if [[ $ok -eq 1 ]]; then
  echo
  echo "✓ 推送成功  $TS"
  echo "  → http://${SSH_HOST}:8080/"
  echo "  → http://${SSH_HOST}:8080/preview.html"
  echo "  → http://${SSH_HOST}:8080/$LOCAL_FACTORY_DIR/02-radar.html"
  echo "  → http://${SSH_HOST}:8080/$LOCAL_FACTORY_DIR/07-templates.html"
  echo "  → http://${SSH_HOST}:8080/$LOCAL_FACTORY_DIR/08-sources.html"
else
  echo
  echo "✗ MD5 不一致 — 推送失败"
  exit 1
fi
