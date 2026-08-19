# МойСклад × «Честный знак»: техническая картина для глубокой интеграции

**Дата исследования:** 19.08.2026. Источники: официальная документация JSON API 1.2 (dev.moysklad.ru, репозиторий `moysklad/api-remap-1.2-doc`), Vendor API 1.0, support.moysklad.ru. Пометки: ✅ — по официальной документации; ⚠️ — по вторичным источникам.

---

## 1. Встроенные возможности МойСклад по маркировке ✅

Интеграция с ГИС МТ — предустановленное решение «Честный знак» (раздел **Решения → Честный знак**, там же «Журнал запросов в ИС МП»). Ошибка API 57002 = решение ЧЗ не подключено на аккаунте.

| Возможность | Документ в UI | Доступно в JSON API 1.2 |
|---|---|---|
| Заказ КМ, печать этикеток DataMatrix | `crptdemand` | ✅ `emissionorder` |
| Отчёт об использовании (нанесении) КМ | — | ❌ только UI |
| Ввод в оборот КМ | `enrollorder` | ❌ только UI |
| Возврат в оборот | `enrollreturn` | ❌ только UI |
| Вывод из оборота (поэкземплярный и ОСУ) | `retireorder` | ✅ `retireorder` |
| Списание кодов маркировки | `crptcancellation` | ❌ только UI |
| Перемаркировка | `remarkingorder` | ❌ только UI |
| Агрегация (КИТУ) | `crptpackage*` | ❌ только UI |
| Реестр «Коды маркировки» (статусы: Эмитирован, Нанесен, В обороте, Выбыл, Списан…) | — | ❌ только UI |
| Проверка КМ в ГИС МТ из Приёмки/Отгрузки, сверка комплектации | `checkequipment` | ❌ только UI |
| ОСУ: УПД без КМ (GTIN + КолВедМарк) | — | частично (`retireorder`) |
| Импорт/экспорт УПД (XML), ЭДО Лайт, 1С: Клиент ЭДО, Такском | `importedo` | ❌ только UI |

**Подключение ЧЗ к аккаунту:**
1. УКЭП под **КриптоПро CSP** (+ Browser plug-in); для УКЭП физлица — МЧД в ЛК ЧЗ.
2. ЛК ЧЗ: **Управление заказами → Устройства** → **OMS ID** и «Идентификатор соединения».
3. МойСклад: **Настройки → Юр. лица → карточка юрлица → «Маркировка»** → реквизиты → «Проверить соединение».
4. Для разрешительного режима — **«Токен для ККТ»** из ЛК ЧЗ (Маркировка → Данные участника; один токен на ИНН) в карточку юрлица.

**Тарифы:** маркировка — платная опция **«Маркировка»** (~700 ₽/мес) на любом платном тарифе.

**Ограничение** ✅: крипточасть КМ хранится максимум **120 дней** с получения (приказ Минпромторга № 1421); печать этикеток — только до этого срока и только для кодов, заказанных через МойСклад.

---

## 2. Касса МойСклад ✅

- Продажа: скан DataMatrix 2D-сканером; нужны ККТ+ФН с **ФФД 1.2**; чек → ОФД → ЧЗ, код выбывает. Возврат через кассу возвращает КМ в оборот.
- **Разрешительный режим** поддержан полностью. Включается токеном для ККТ. Настройки точки (Розница → Точки продаж → Маркировка): способ проверки, **Локальный модуль ЧЗ** (Windows/Android) для офлайна; поведение офлайн (запретить/разрешить), какие товары продавать («Только с правильными кодами» … «Все»). Попытки проверки — в «Журнале запросов в ИС МП».
- В API — сущность `retailstore`: `markingSellingMode` (`CORRECT_MARKS_ONLY`|`WITHOUT_ERRORS`|`ALL`), настройка проверки перед продажей (+`ALL_CHECKED`), `sendMarksForCheck`, `sendMarksToChestnyZnakOnCloud`.
- КМ позиции розничной продажи в API: `cis` (GS1) и `cis_1162` (формат тега 1162, RO).

---

## 3. JSON API 1.2 — сущности и поля маркировки ✅

Базовый URL: `https://api.moysklad.ru/api/remap/1.2`.

### product
- **`trackingType`** (31 значение): `NOT_TRACKED`, `PERFUMERY`, **`CHEMISTRY` (косметика и бытовая химия)**, `SANITIZER`, `MILK`, `WATER`, `SHOES`, `TOBACCO`, `TOYS`, `MEDICAL_DEVICES`, `FOOD_SUPPLEMENT`, `GROCERY`, `CONSERVE`, `SEAFOOD`, `PET_FOOD`, `SOFT_DRINKS`, `NABEER`, `BEER_ALCOHOL`, `VEGETABLE_OIL`, `AUTO_FLUIDS`, `TIRES`, `ELECTRONICS`, `RADIO`, `GADGETS`, `BICYCLE`, `CONSTRUCTION`, `LP_CLOTHES`, `LP_LINENS`, `FURSLP`, `NCP`, `OTP`, `VETPHARMA`.
- Несочетаемость: c `isSerialTrackable`, `ppeType`; `weighed` — только MILK; `onTap` — только MILK, PERFUMERY.
- `partialDisposal` (частичное выбытие), `tnved`, `barcodes` (`{ean13|ean8|code128|gtin|upc}`, gtin валидируется по GS1, обновление — полной заменой), `packs` (упаковки, ≤1 штрихкод у упаковки).

### trackingCodes на позициях документов
Есть **только** у `demand`, `retaildemand`, `supply`, `retireorder`. В `enter`, `loss`, `customerorder`, возвратах — нет.

```json
"trackingCodes": [
  { "cis": "01...21...", "type": "trackingcode" },
  { "cis": "(00)...", "type": "transportpack",
    "trackingCodes": [ { "cis": "01...21...", "type": "trackingcode" } ] }
]
```
- `type`: `trackingcode` | `consumerpack` | `transportpack`. `trackingCodes_1162`/`cis_1162` — RO.
- Количество КМ не обязано совпадать с `quantity`. Дубли внутри документа недопустимы. Если товар немаркируемый — КМ не сохраняются.
- **Субресурс**: `GET/POST /entity/{type}/{id}/positions/{posId}/trackingCodes` (limit ≤100, `codetype=gs1|tag_1162|all`), `POST .../trackingCodes/delete` — массовое удаление.

---

## 4. Документы маркировки в API ✅

### `emissionorder` — Заказ кодов маркировки
- CRUD + metadata + позиции (`emissionorderposition`). Обязательные: `organization`, `trackingType`, `emissionType`.
- **`emissionType`**: `LOCAL` (произведён в РФ), `FOREIGN` (ввезён), **`REMAINS` (маркировка остатков)**, `COMMISSION`, `REAPPLY` (перемаркировка/повторное нанесение).
- `documentState` (RO): `CREATED` → `SUZ_CREATED` → `SUZ_SEND` → `SUZ_COMPLETED`. Статусы позиций: `EMISSION_NOT_SEND` … `EMISSION_COMPLETED`.
- Лимиты: ≤10 позиций, quantity ≤1000. **Кнопки «Заказ кодов»/«Получить коды»/«Печать» — только UI.**

### `retireorder` — Вывод из оборота
- CRUD + позиции (полный CRUD). Обязательные: `organization`, `retireOrderType`, `trackingType`; в позициях **`trackingCodes` обязательны при создании**.
- `documentState` (RO): `CREATED`, `SEND`, `IN_PROGRESS`, `WAIT_FOR_CONTINUATION`, `CHECKED_OK`, `CHECKED_NOT_OK`, `PROCESSING_ERROR`, `UNDEFINED`. Менять можно в `CREATED`, `CHECKED_NOT_OK`, `PROCESSING_ERROR`.
- **`retireOrderType`** (22): `RETAIL_SALE`, **`DISTANCE`** (дистанционная продажа), `EXPIRATION`, `DAMAGE_AND_LOSS`, `OWN_USE`, `DESTRUCTION`, `RECALL`, `MISMATCH`, `OTHER_TYPE` и др. + `supportingTransaction` (`UTD`, `RECEIPT`, …), `supportingTransactionDate/Number`, `reasonDescription`.

### Только UI (нет в API): ввод в оборот, возврат в оборот, списание КМ, перемаркировка, отчёт о нанесении, агрегация, реестр КМ, журнал ИС МП. JSON API 1.3 не планируется.

---

## 5. Вебхуки ✅

- `/entity/webhook`: `entityType`, `action` (`CREATE`|`UPDATE`|`DELETE`|`PROCESSED`), `url`, `diffType` (`FIELDS` → `updatedFields`). Все сущности кроме `webhook`, `discount`, `notes` — т.е. `demand`, `retaildemand`, `supply`, `emissionorder`, `retireorder`, `product` доступны.
- Payload: `POST {url}?requestId=...`, тело `{auditContext, events:[{meta, action, accountId, updatedFields?}]}`.
- Доставка: ответ 200/204 **за 1500 мс**; при неуспехе 3 повтора подряд; повтор идентифицируется по `requestId`. Лимит: ≤5 вебхуков на сочетание entityType+action (1 для решения). Только платные тарифы. Автоотключение при хронических ошибках получателя.
- **`webhookstock`** — вебхук на изменение остатков (раз в 1–5 мин, отдаёт `reportUrl` на `report/stock/.../current?changedSince=...`).

---

## 6. Лимиты API и аутентификация ✅

- Аутентификация: Basic; **токен пользователя** (`POST /security/token`; новый токен отзывает старые!); **токен решения** (Vendor API).
- С 16.02.2026 лимит на пользователя/решение: база 45 запросов/3 с с «весом»: токен решения ×1 (45/3с); логин/пароль и токен пользователя ×2 с 12.05.2026 (22/3с), **×3 с 01.09.2026 (15/3с)**, ×4 с 01.12.2026 (11/3с). `report/stock/all|bystore` — вес 5.
- ≤5 параллельных на пользователя, ≤20 на аккаунт; тело ≤20 МБ; ≤1000 элементов в массиве; **обязателен `Accept-Encoding: gzip`** (иначе 415); 429 + заголовки `X-Lognex-Retry-After` и др. Автобан: >200 одинаковых ошибок/мин, >100 PUT к одной сущности/мин.
- Пагинация: `limit` ≤1000 (trackingCodes ≤100), `offset`, `expand` (глубина ≤3, при expand limit ≤100), `filter`, `order`, `search`.

---

## 7. Отчёты по остаткам ✅

- Расширенный: `GET /report/stock/all`, `/bystore` — фильтры `store`, `product`, `productFolder(+withSubFolders)`, `moment`, `stockMode`/`quantityMode`, `archived` и др. Вес 5 — для редких полных синхронизаций.
- Краткий: `/report/stock/all/current` (+`/bystore/current`) — только id и число, параметры `changedSince` (≤24 ч; рекомендация: каждые 30 мин за 35 мин + полная синхронизация раз в сутки), `stockType=stock|freeStock|quantity|reserve|inTransit`.

---

## 8. Vendor API / решения и виджеты ✅

- **Серверные решения**: дескриптор XML, обмен подписан JWT HS256; при активации МойСклад передаёт вендору **бессрочный токен JSON API**. **Приватные решения** — без публикации в каталоге, 1300 ₽/мес с аккаунта, расширенные лимиты.
- **Виджеты**: iframe 400px в точках `document.supply.edit`, `document.demand.edit`, `document.retaildemand.edit`, `document.customerorder.*`, **`document.emissionorder.edit`**, `entity.product.edit` и др. Протоколы postMessage: `change-handler` (состояние документа при каждом изменении), **`validation-feedback` (запрет сохранения!)**, `update-provider` (виджет меняет поля документа), `save-handler`, стандартные диалоги; SDK: `moysklad/js-widget-sdk`.
- После отправки Заказа КМ в ЧЗ документ read-only (виджет получает Change без Save).

---

## 9. ЭДО и входящие УПД с КМ ✅

- Встроенного оператора ЭДО нет — импорт/экспорт XML УПД + интеграции: **ЭДО Лайт** (бесплатный кабинет ЧЗ), 1С: Клиент ЭДО, Такском. Нужны опция «Маркировка» и право «Обмен данными».
- Приёмка: Закупки → Приемки → ЭДО → импорт → категория маркированной продукции → Приёмка **с КМ на позициях** (потом читаются через API). Затем: проверка КМ в ГИС МТ из Приёмки (цветовая индикация), сверка комплектации («Не хватает/Лишнее/Сошлось») → подписание УПД у оператора ЭДО.
- Через API импорт УПД недоступен — только чтение/дозапись созданных Приёмок и их trackingCodes.

---

## Ключевые выводы для архитектуры

1. **Полный цикл «поэкземплярки» через чистый API МойСклад невозможен**: отправка в СУЗ, ввод в оборот, отчёт о нанесении, перемаркировка, списание КМ — кнопки UI. Интеграция = «подготовка документов по API + короткие действия оператора в UI» либо прямая интеграция с True API/СУЗ ЧЗ (наш путь для сверки и контроля).
2. Для подсказок менеджерам — **виджеты приватного серверного решения** в `document.supply.edit`/`document.demand.edit`/`document.emissionorder.edit` с `validation-feedback` (можно блокировать сохранение документа с ошибками маркировки).
3. Аутентификация — на **токене решения** (45/3с); логин/пароль деградирует к 11/3с к декабрю 2026.
4. События: вебхуки CREATE/UPDATE на `demand`/`retaildemand`/`supply`/`retireorder` + `webhookstock`; отвечать 200 мгновенно, обрабатывать асинхронно (таймаут 1500 мс).
