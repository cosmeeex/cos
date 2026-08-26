#!/usr/bin/env bash
# Установка «Стража маркировки» на сервер (Ubuntu/Debian, root или sudo).
# Использование:  bash deploy/install.sh
# Скрипт идемпотентен: повторный запуск обновляет код и перезапускает сервис.
set -euo pipefail

APP_DIR=/opt/cosmex-chestny-znak
REPO=https://github.com/cosmeeex/cos.git
BRANCH=claude/honest-sign-cosmex-integration-nukn89
SERVICE=cosmex-guard

echo "== 1/5 Node.js ≥22.18 =="
if ! command -v node >/dev/null || [ "$(node -e 'const [a,b]=process.versions.node.split(".").map(Number); console.log(a>22||(a===22&&b>=18)?1:0)')" != "1" ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
node --version

echo "== 2/5 Код =="
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$BRANCH" && git -C "$APP_DIR" checkout "$BRANCH" && git -C "$APP_DIR" pull origin "$BRANCH"
else
  git clone --branch "$BRANCH" "$REPO" "$APP_DIR"
fi

echo "== 3/5 Конфиг =="
if [ ! -f "$APP_DIR/.env" ]; then
  cp "$APP_DIR/.env.example" "$APP_DIR/.env"
  chmod 600 "$APP_DIR/.env"
  echo "!!! Заполните $APP_DIR/.env (MOYSKLAD_TOKEN, WEBHOOK_SECRET, TELEGRAM_*) и запустите скрипт снова."
  exit 0
fi

echo "== 4/5 Тесты =="
cd "$APP_DIR" && node --test 'tests/*.test.ts' >/dev/null && echo "тесты ок"

echo "== 5/5 systemd =="
cp "$APP_DIR/deploy/cosmex-guard.service" /etc/systemd/system/$SERVICE.service
systemctl daemon-reload
systemctl enable --now $SERVICE
sleep 1
systemctl --no-pager status $SERVICE | head -8
echo
echo "Готово. Панель: http://127.0.0.1:8787 (проксируйте через nginx с HTTPS, см. deploy/README.md)."
echo "Дальше: node $APP_DIR/src/cli.ts setup-webhooks https://<публичный-домен-стража>"
