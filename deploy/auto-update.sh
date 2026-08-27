#!/usr/bin/env bash
# Автообновление стража: подтягивает ветку из GitHub и перезапускает сервис,
# только если появились новые коммиты. Запускается таймером cosmex-update.timer.
set -euo pipefail

APP=/opt/cosmex-chestny-znak
PORT=8788
cd "$APP"
BRANCH=$(git rev-parse --abbrev-ref HEAD)

git fetch origin "$BRANCH" --quiet
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse "origin/$BRANCH")
# Сверяем не только git, но и версию работающего процесса: файлы могли
# обновить вручную (git pull) без перезапуска сервиса.
RUNNING=$(curl -sf -m 5 "http://127.0.0.1:$PORT/health" | grep -o '"version":"[a-f0-9]*"' | cut -d'"' -f4 || true)
[ "$LOCAL" = "$REMOTE" ] && [ "$RUNNING" = "${REMOTE:0:7}" ] && exit 0

notify_fail() {
  # В Telegram — только при неудаче, чтобы не шуметь в группе сотрудников.
  local token chat
  token=$(grep '^TELEGRAM_BOT_TOKEN=' .env 2>/dev/null | cut -d= -f2- || true)
  chat=$(grep '^TELEGRAM_CHAT_ID=' .env 2>/dev/null | cut -d= -f2- || true)
  [ -n "$token" ] && [ -n "$chat" ] && curl -s -m 10 \
    "https://api.telegram.org/bot$token/sendMessage" \
    --data-urlencode "chat_id=$chat" \
    --data-urlencode "text=⚠️ Страж: автообновление не удалось ($1). Сервис работает на прежней версии." \
    >/dev/null || true
}

if ! git merge --ff-only "origin/$BRANCH" --quiet; then
  echo "ОШИБКА: локальная история разошлась с origin/$BRANCH — обновите вручную" >&2
  notify_fail "конфликт git"
  exit 1
fi

systemctl restart cosmex-guard
sleep 3
if ! curl -sf "http://127.0.0.1:$PORT/health" >/dev/null; then
  echo "ОШИБКА: страж не отвечает после обновления — откат на $LOCAL" >&2
  git reset --hard "$LOCAL" --quiet
  systemctl restart cosmex-guard
  notify_fail "сервис не поднялся, выполнен откат"
  exit 1
fi

echo "Обновлено: ${LOCAL:0:7} → ${REMOTE:0:7}"
