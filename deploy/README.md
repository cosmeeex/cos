# Деплой «Стража маркировки» на сервер cosmex.ru

## Быстрый путь (5 минут, выполняет админ сервера)

```bash
git clone --branch claude/honest-sign-cosmex-integration-nukn89 https://github.com/cosmeeex/cos.git /opt/cosmex-chestny-znak
bash /opt/cosmex-chestny-znak/deploy/install.sh   # поставит Node 22, создаст .env и остановится
nano /opt/cosmex-chestny-znak/.env                # вписать MOYSKLAD_TOKEN, WEBHOOK_SECRET (любая случайная строка), TELEGRAM_*
bash /opt/cosmex-chestny-znak/deploy/install.sh   # второй запуск: тесты + systemd-сервис cosmex-guard
```

После запуска панель слушает `127.0.0.1:8787`.

## Публичный HTTPS-адрес для вебхуков (nginx)

Вебхукам МойСклад нужен публичный HTTPS-URL. На сервере cosmex.ru уже есть nginx — добавьте локацию на поддомен (пример: `guard.cosmex.ru`, А-запись на тот же IP, сертификат через certbot):

```nginx
server {
    listen 443 ssl;
    server_name guard.cosmex.ru;
    # ssl_certificate ... (certbot --nginx -d guard.cosmex.ru)

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host $host;
        proxy_read_timeout 30s;
    }
}
```

Панель менеджера по этому адресу стоит закрыть базовой аутентификацией (`auth_basic`), а путь `/webhook/` оставить открытым — МойСклад ходит туда с `?secret=` из `.env`.

## Включение вебхуков

```bash
cd /opt/cosmex-chestny-znak
DRY_RUN=false node src/cli.ts setup-webhooks https://guard.cosmex.ru
```

## Регулярные задачи (cron от root)

```cron
# сверка остатков — понедельник 07:00
0 7 * * 1  cd /opt/cosmex-chestny-znak && node src/cli.ts reconcile >> data/cron.log 2>&1
# контроль дистанционных продаж — ежедневно 09:00 и 15:00
0 9,15 * * *  cd /opt/cosmex-chestny-znak && node src/cli.ts distance >> data/cron.log 2>&1
# аудит новых карточек — 1-е число месяца
0 8 1 * *  cd /opt/cosmex-chestny-znak && node src/cli.ts audit >> data/cron.log 2>&1
```

## Обновление

```bash
bash /opt/cosmex-chestny-znak/deploy/install.sh   # подтянет свежий код, прогонит тесты, перезапустит сервис
```

## Проверка работы

- `systemctl status cosmex-guard` — сервис активен;
- `curl -s https://guard.cosmex.ru/health` — `{"ok":true,"moysklad":true,...}`;
- в МойСклад провести тестовый документ — в панели появится строка со светофором.
