#!/usr/bin/env bash
# Включает автообновление стража. Идемпотентен.
# Запуск: bash deploy/install-auto-update.sh
set -euo pipefail

APP=/opt/cosmex-chestny-znak
cd "$APP"

cp deploy/cosmex-update.service /etc/systemd/system/cosmex-update.service
cp deploy/cosmex-update.timer /etc/systemd/system/cosmex-update.timer
systemctl daemon-reload
systemctl enable --now cosmex-update.timer

# Первый прогон сразу, чтобы убедиться, что всё работает.
systemctl start cosmex-update.service || true
sleep 1
echo "---"
systemctl status cosmex-update.timer --no-pager | head -5
echo "---"
echo -n "health: " && curl -s http://127.0.0.1:8788/health && echo
echo "Автообновление включено: сервер проверяет GitHub каждые 5 минут."
