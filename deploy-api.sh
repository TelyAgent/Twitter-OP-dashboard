#!/usr/bin/env bash
# 部署 apps/api/ 后端到 server:/root/pallax-api/
# 用法: ./deploy-api.sh
#   首次会自动 npm install + 创建 systemd unit + 创建 placeholder .env
#   之后只同步代码 + systemctl restart

set -euo pipefail

SSH_KEY="$HOME/.ssh/tokyo_server"
SSH_USER="root"
SSH_HOST="43.163.198.237"
REMOTE_DIR="/root/pallax-api"
SERVICE="pallax-api.service"

SSH_OPTS=(
  -i "$SSH_KEY"
  -o PubkeyAuthentication=yes
  -o PreferredAuthentications=publickey
  -o BatchMode=yes
  -o StrictHostKeyChecking=accept-new
  -o ConnectTimeout=10
)

REMOTE="${SSH_USER}@${SSH_HOST}"
cd "$(dirname "${BASH_SOURCE[0]}")"

[[ -f "apps/api/server.js" ]]    || { echo "✗ 缺 apps/api/server.js"; exit 1; }
[[ -f "apps/api/package.json" ]] || { echo "✗ 缺 apps/api/package.json"; exit 1; }
[[ -f "$SSH_KEY" ]]              || { echo "✗ SSH key 缺: $SSH_KEY"; exit 1; }

echo "→ 确保远程目录与 systemd unit 存在"
ssh "${SSH_OPTS[@]}" "$REMOTE" "
  set -e
  mkdir -p $REMOTE_DIR

  # placeholder .env 只在不存在时创建
  if [[ ! -f $REMOTE_DIR/.env ]]; then
    cat > $REMOTE_DIR/.env <<'ENV'
TWITTER_BEARER_TOKEN=PLACEHOLDER_paste_your_x_bearer_token_here
PORT=8081
HOST=0.0.0.0
ENV
    chmod 600 $REMOTE_DIR/.env
    echo '  ✓ 新建 placeholder .env (你 SSH 进去替换真实 token)'
  fi

  # systemd unit
  cat > /etc/systemd/system/$SERVICE <<'UNIT'
[Unit]
Description=Pallax API (Fastify + X v2 client)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/root/pallax-api
EnvironmentFile=/root/pallax-api/.env
ExecStart=/usr/bin/node /root/pallax-api/server.js
Restart=on-failure
RestartSec=5
StandardOutput=append:/var/log/pallax-api.log
StandardError=append:/var/log/pallax-api.log

[Install]
WantedBy=multi-user.target
UNIT
  systemctl daemon-reload
"

echo "→ 上传代码 (server.js / package.json / package-lock.json 如果有)"
scp "${SSH_OPTS[@]}" apps/api/server.js     "$REMOTE:$REMOTE_DIR/server.js"
scp "${SSH_OPTS[@]}" apps/api/package.json  "$REMOTE:$REMOTE_DIR/package.json"
[[ -f apps/api/package-lock.json ]] && scp "${SSH_OPTS[@]}" apps/api/package-lock.json "$REMOTE:$REMOTE_DIR/package-lock.json"

echo "→ 远程: 装依赖 (首次或 package.json 变了)"
ssh "${SSH_OPTS[@]}" "$REMOTE" "
  cd $REMOTE_DIR
  # 检查 node 是否存在
  which node >/dev/null 2>&1 || { echo '✗ 服务器无 node, 请先 apt install nodejs npm'; exit 2; }
  npm install --omit=dev --silent
  systemctl enable --now $SERVICE
  systemctl restart $SERVICE
  sleep 1
  systemctl is-active $SERVICE
"

echo "→ 健康检查"
sleep 1
curl -s -m 5 "http://${SSH_HOST}:8081/api/health" | head -1 || echo "(health endpoint 未响应)"

echo ""
echo "✓ 部署完成"
echo "  service:  $SERVICE  (logs: /var/log/pallax-api.log)"
echo "  health:   http://${SSH_HOST}:8081/api/health"
echo "  endpoint: POST http://${SSH_HOST}:8081/api/twitter/tweet  body={url|id}"
echo ""
echo "  下一步: 替换 placeholder token →"
echo "    ssh polymarket-server"
echo "    nano $REMOTE_DIR/.env"
echo "    systemctl restart $SERVICE"
