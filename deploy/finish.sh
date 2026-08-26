#!/usr/bin/env bash
# Финальная настройка стража: порт, systemd, nginx+HTTPS, вебхуки МойСклад.
# Идемпотентен. Запуск: bash deploy/finish.sh [домен]
# По умолчанию домен guard.<ip>.sslip.io — резолвится сам, DNS не нужен.
set -euo pipefail

APP=/opt/cosmex-chestny-znak
DOMAIN="${1:-guard.89-167-54-69.sslip.io}"
PORT=8788 # 8787 на этом сервере занят другим сервисом

[ -d "$APP/.git" ] || { echo "Сначала базовая установка: deploy/install.sh"; exit 1; }
git -C "$APP" pull --ff-only >/dev/null 2>&1 || true
mkdir -p "$APP/data" "$APP/reports"

echo "== 1/4 Порт $PORT и сервис =="
if grep -q '^PORT=' "$APP/.env"; then
  sed -i "s/^PORT=.*/PORT=$PORT/" "$APP/.env"
else
  echo "PORT=$PORT" >> "$APP/.env"
fi
if ! grep -q '^SIGNER_SECRET=' "$APP/.env"; then
  echo "SIGNER_SECRET=$(openssl rand -hex 16)" >> "$APP/.env"
fi
cp "$APP/deploy/cosmex-guard.service" /etc/systemd/system/cosmex-guard.service
systemctl daemon-reload
systemctl enable cosmex-guard >/dev/null 2>&1 || true
systemctl restart cosmex-guard
sleep 2
HEALTH=$(curl -s "http://127.0.0.1:$PORT/health" || true)
echo "health: $HEALTH"
if ! echo "$HEALTH" | grep -q '"moysklad"'; then
  echo "ОШИБКА: страж не отвечает на порту $PORT. Последние логи:"
  journalctl -u cosmex-guard -n 25 --no-pager
  exit 1
fi

echo "== 2/4 nginx (HTTP) =="
if [ -f /etc/nginx/.cosmex-guard.htpasswd ]; then
  DASH_PASS="(прежний — не менялся)"
else
  DASH_PASS=$(openssl rand -hex 8)
  printf 'cosmex:%s\n' "$(openssl passwd -apr1 "$DASH_PASS")" > /etc/nginx/.cosmex-guard.htpasswd
fi
cat > /etc/nginx/sites-available/cosmex-guard <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    location / { proxy_pass http://127.0.0.1:$PORT; proxy_set_header Host \$host; }
}
NGINX
ln -sf /etc/nginx/sites-available/cosmex-guard /etc/nginx/sites-enabled/cosmex-guard
nginx -t && systemctl reload nginx

echo "== 3/4 Сертификат HTTPS =="
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m cosmex.ae@gmail.com --redirect

# Финальный конфиг: наружу открыты только вебхуки и health,
# панель менеджера — под базовой аутентификацией.
cat > /etc/nginx/sites-available/cosmex-guard <<NGINX
server {
    listen 80;
    server_name $DOMAIN;
    return 301 https://\$host\$request_uri;
}
server {
    listen 443 ssl http2;
    server_name $DOMAIN;
    ssl_certificate     /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    location /webhook/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
        proxy_read_timeout 10s;
    }
    location = /health {
        proxy_pass http://127.0.0.1:$PORT;
    }
    location /sign/ {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_read_timeout 60s;
    }
    location / {
        auth_basic "Cosmex guard";
        auth_basic_user_file /etc/nginx/.cosmex-guard.htpasswd;
        proxy_pass http://127.0.0.1:$PORT;
        proxy_set_header Host \$host;
    }
}
NGINX
nginx -t && systemctl reload nginx

echo "== 4/4 Вебхуки МойСклад =="
cd "$APP"
DRY_RUN=false node src/cli.ts setup-webhooks "https://$DOMAIN"

echo "=================================================================="
echo "ГОТОВО."
echo "Панель менеджера: https://$DOMAIN  логин: cosmex  пароль: $DASH_PASS"
SIGNER=$(grep '^SIGNER_SECRET=' "$APP/.env" | cut -d= -f2)
echo "Секрет офисного подписанта (в agent.ps1): $SIGNER"
echo -n "Проверка снаружи: " && curl -s "https://$DOMAIN/health" && echo
