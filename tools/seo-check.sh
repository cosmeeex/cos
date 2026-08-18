#!/usr/bin/env bash
# Регрессионная проверка находок из docs/seo-audit.md.
# Каждый тест воспроизводит конкретную находку и печатает PASS/FAIL.
#
#   ./tools/seo-check.sh              # против продакшена
#   BASE=https://staging.cosmex.ru ./tools/seo-check.sh
#
# Код возврата: 0 — все проверки прошли, 1 — есть FAIL.

set -uo pipefail

BASE="${BASE:-https://cosmex.ru}"
UA_BOT="Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)"
UA_BROWSER="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
PRODUCT="${PRODUCT:-/product/cosmex-holodnyy-krem-parafin-smorodina-50-ml-92226549-91bf-11ef-0a80-158d000444e6}"
CATEGORY="${CATEGORY:-/catalog/produktsiya-cosmex}"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

fails=0; passes=0
pass(){ printf '  \033[32mPASS\033[0m %s\n' "$1"; passes=$((passes+1)); }
fail(){ printf '  \033[31mFAIL\033[0m %s\n' "$1"; fails=$((fails+1)); }
head_of(){ curl -sS -L --max-time 60 -A "$1" "$2" -o "$TMP/p.html" 2>/dev/null; }
code_of(){ curl -sS -o /dev/null -L --max-time 60 -A "$UA_BOT" -w '%{http_code}' "$1"; }

# Печатает HEAD / BODY / ABSENT — где в $TMP/p.html лежит подстрока.
where(){ DOC="$TMP/p.html" TAG="$1" python3 -c '
import os
h = open(os.environ["DOC"], encoding="utf-8", errors="replace").read()
hd = h.find("</head>")
p = h.find(os.environ["TAG"])
print("ABSENT" if p < 0 else ("HEAD" if 0 <= p < hd else "BODY"))
'; }

echo
echo "SEO-регрессия для $BASE"
echo "─────────────────────────────────────────────────────────────"

# ── P0-1. Метаданные должны быть в <head> для краулеров ──────────────────────
echo
echo "P0-1  метаданные в <head> на карточке товара (закэшированный ответ)"
head_of "$UA_BOT" "$BASE$PRODUCT"
for tag in '<title>' 'rel="canonical"' 'og:title'; do
  loc="$(where "$tag")"
  [ "$loc" = "HEAD" ] && pass "$tag в <head> (UA: YandexBot)" || fail "$tag → $loc, ожидался HEAD (UA: YandexBot)"
done

echo
echo "P0-1b оба варианта кэша отдают метаданные в <head>"
head_of "$UA_BROWSER" "$BASE$PRODUCT?cachebust=$RANDOM$RANDOM"
loc="$(where '<title>')"
if [ "$loc" = "HEAD" ]; then
  pass "браузерный вариант тоже блокирующий (streamingMetadata отключён)"
else
  # Это нормально при варианте А — важно лишь, чтобы ботам доставался их вариант.
  printf '  \033[33mINFO\033[0m браузерный вариант стримовый (title → %s). Норма, если кэш разведён по User-Agent.\n' "$loc"
fi

# ── P0-2. Пагинация за пределом диапазона ────────────────────────────────────
echo
echo "P0-2  пагинация за пределом диапазона отдаёт 404"
for p in 999 99999; do
  c="$(code_of "$BASE$CATEGORY?page=$p")"
  [ "$c" = "404" ] && pass "?page=$p → 404" || fail "?page=$p → $c, ожидался 404 (бесконечное краулинговое пространство)"
done
c="$(code_of "$BASE$CATEGORY?page=2")"
[ "$c" = "200" ] && pass "?page=2 → 200 (валидная страница не сломана)" || fail "?page=2 → $c, ожидался 200"

# ── P1-3. Кэш статических изображений ────────────────────────────────────────
echo
echo "P1-3  /images/* кэшируется браузером"
cc="$(curl -sSI --max-time 30 "$BASE/images/logo.png" | tr -d '\r' | grep -i '^cache-control:' | head -1)"
if echo "$cc" | grep -qE 'max-age=([1-9][0-9]{3,})'; then
  pass "/images/logo.png → $cc"
else
  fail "/images/logo.png → ${cc:-нет заголовка} (ожидался большой max-age)"
fi

# ── P1-4. Один Cache-Control на прокси изображений ───────────────────────────
echo
echo "P1-4  /api/image/proxy отдаёт ровно один Cache-Control"
IMG="$BASE/api/image/proxy?url=https%3A%2F%2Fapi.moysklad.ru%2Fapi%2Fremap%2F1.2%2Fdownload%2F95c8eecb-642f-4cf8-9eb2-e6a9fa786105&s=1200"
n="$(curl -sSI --max-time 30 "$IMG" | tr -d '\r' | grep -ci '^cache-control:')"
[ "$n" = "1" ] && pass "Cache-Control: 1 заголовок" || fail "Cache-Control: $n заголовка(ов) — конфликтующие директивы max-age"
if curl -sSI --max-time 30 "$IMG" | tr -d '\r' | grep -qi '^vary:.*next-router'; then
  fail "Vary содержит RSC-заголовки на бинарной картинке — дробит кэш CDN"
else
  pass "Vary не содержит RSC-заголовков"
fi

# ── P1-5. Ссылки в robots-заглушки ───────────────────────────────────────────
echo
echo "P1-5  нет внутренних ссылок на закрытые в robots.txt URL"
curl -sS -L --max-time 60 -A "$UA_BOT" "$BASE/catalog/gel-laki" -o "$TMP/cat.html"
blocked="$(grep -o 'href="[^"]*"' "$TMP/cat.html" | grep -cE '\?[^"]*(brand=|search=|sort=|priceMin=|priceMax=|instock=)' || true)"
[ "$blocked" = "0" ] && pass "/catalog/gel-laki: 0 ссылок в robots-заглушки" \
                     || fail "/catalog/gel-laki: $blocked ссылок на закрытые URL (вес уходит в никуда)"

# ── P1-7. Хаб брендов ────────────────────────────────────────────────────────
echo
echo "P1-7  хаб брендов существует"
c="$(code_of "$BASE/brand")"
[ "$c" = "200" ] && pass "/brand → 200" || fail "/brand → $c (страницы брендов остаются сиротами)"

# ── P1-6. Пагинация лендинга остаётся на своём пути ──────────────────────────
echo
echo "P1-6  пагинация категории не уводит на другой URL"
if grep -o 'href="/catalog/[^"]*page=2[^"]*"' "$TMP/cat.html" | head -1 | grep -q 'gel-laki'; then
  pass "пагинация /catalog/gel-laki остаётся на /catalog/gel-laki"
else
  found="$(grep -o 'href="/catalog/[^"]*page=2[^"]*"' "$TMP/cat.html" | head -1)"
  fail "пагинация уводит на другой URL: ${found:-не найдена}"
fi

# ── P2-8. Единое кодирование sub= ────────────────────────────────────────────
echo
echo "P2-8  sub= кодируется единообразно"
pct="$(grep -o 'href="[^"]*sub=[^"]*"' "$TMP/cat.html" | grep -c '%20' || true)"
[ "$pct" = "0" ] && pass "нет ссылок с %20 в sub= (canonical нормализует к '+')" \
                 || fail "$pct ссылок кодируют sub= через %20 — ведут на неканонический URL"

# ── P2-9. /catalog/aktsii в sitemap ──────────────────────────────────────────
echo
echo "P2-9  /catalog/aktsii присутствует в sitemap.xml"
curl -sS -L --max-time 120 "$BASE/sitemap.xml" -o "$TMP/sitemap.xml"
grep -q "<loc>$BASE/catalog/aktsii</loc>" "$TMP/sitemap.xml" \
  && pass "/catalog/aktsii в sitemap" || fail "/catalog/aktsii отдаёт 200, но отсутствует в sitemap"

# ── P2-10. Полнота Product-разметки ──────────────────────────────────────────
echo
echo "P2-10 Product-разметка: доставка и возврат"
head_of "$UA_BOT" "$BASE$PRODUCT?cachebust=$RANDOM"
for f in shippingDetails hasMerchantReturnPolicy itemCondition; do
  grep -q "\"$f\"" "$TMP/p.html" && pass "offers.$f присутствует" \
    || fail "offers.$f отсутствует (блокирует merchant-сниппеты Google)"
done

# ── Базовая гигиена: редиректы ───────────────────────────────────────────────
echo
echo "БАЗА  редиректы в один хоп"
for u in "http://cosmex.ru/" "https://www.cosmex.ru/" "$BASE/catalog/"; do
  r="$(curl -sS -o /dev/null -L --max-time 30 -w '%{num_redirects}:%{http_code}' "$u")"
  [ "$r" = "1:200" ] && pass "$u → $r" || fail "$u → $r (ожидалось 1:200)"
done

echo
echo "─────────────────────────────────────────────────────────────"
printf 'Итог: \033[32m%d PASS\033[0m, \033[31m%d FAIL\033[0m\n\n' "$passes" "$fails"
[ "$fails" -eq 0 ]
