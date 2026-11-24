# binance-mcp-agent

Учебный MCP-сервер (TypeScript, stdio) для публичных рыночных данных Binance Spot.
API-ключи не нужны и не используются.

> Part of the **BERESTOV Web3 Tools** portfolio. See [Portfolio Overview](PORTFOLIO_OVERVIEW.md) for the wider project catalogue and potential ecosystem applications.

## Инструменты

| Инструмент | Назначение | Параметры |
|---|---|---|
| `get_market_price` | Текущая цена пары | `symbol` |
| `get_24h_stats` | Изменение за 24 часа, high/low, объёмы | `symbol` |
| `get_klines` | Свечи OHLCV | `symbol`, `interval` (по умолчанию 1h), `limit` (1-100, по умолчанию 24) |
| `get_order_book` | Стакан заявок | `symbol`, `limit` (1-50, по умолчанию 10) |
| `get_avg_price` | Средняя цена за последние минуты | `symbol` |
| `get_server_time` | Время сервера Binance и расхождение с локальными часами | нет |
| `check_symbol` | Существует ли пара, статус, базовый и котируемый активы | `symbol` |
| `get_recent_trades` | Последние сделки: время, сторона агрессора, объём, цена | `symbol`, `limit` (1-50, по умолчанию 10) |
| `validate_signal` | Свежесть сигнала: возраст, неблагоприятный дрейф цены (ask для buy, bid для sell), спред; ответ JSON, проценты в полях `*_pct` | `symbol`, `side`, `signal_price`, `signal_timestamp_ms`, необязательные `max_age_s` (60), `max_drift_pct` (0.1), `max_spread_pct` (0.1) |

Эндпоинты: `/api/v3/ticker/price`, `/api/v3/ticker/24hr`, `/api/v3/klines`, `/api/v3/depth`,
`/api/v3/avgPrice`, `/api/v3/time`, `/api/v3/exchangeInfo`, `/api/v3/trades`, `/api/v3/ticker/bookTicker` на `https://api.binance.com`. Адрес можно заменить переменной `BINANCE_BASE_URL`.

## Валидация и ошибки

- `symbol`: после trim и приведения к верхнему регистру должен соответствовать `^[A-Z0-9]{5,20}$`.
  Иначе запрос отклоняется до обращения к API.
- `interval` проверяется по списку допустимых значений, `limit` ограничивается диапазоном.
- Ошибка Binance `-1121` возвращается как «Пара ... не существует», прочие коды как
  `Ошибка Binance (код): сообщение`, сеть и таймаут (5 с) как отдельное сообщение.
  Во всех случаях `isError: true`.

## Запуск

```bash
npm install
npm run build
node build/index.js
```

Подключение к MCP-клиенту: команда `node`, аргумент `<путь>/build/index.js`, транспорт stdio.

## Проверка

```bash
npm test
node tests/tools.mjs
node tests/tools-extra.mjs
node tests/tools-trades.mjs
node tests/tools-cache.mjs
node tests/tools-guard.mjs
node tests/tools-validate.mjs
node scripts/check-readme.mjs
npm run measure
```

Назначение проверок:
- `npm test` — Jest: живые тесты против Binance (цена, -1121, таймаут).
- `tests/tools*.mjs` — офлайн-тесты инструментов и защитных механизмов.
- `scripts/check-readme.mjs` — сверка README с кодом.
- `npm run measure` — измерение весов запросов.

## Лимиты

Измерено 2026-11-24 на https://api.binance.com (скрипт scripts/measure-weights.mjs, полный результат в docs/rate-limits.md).

| Инструмент | Запрос | Вес |
|---|---|---|
| get_market_price | /api/v3/ticker/price | 2 |
| get_24h_stats | /api/v3/ticker/24hr | 2 |
| get_klines (limit 1-100) | /api/v3/klines | 2 |
| get_order_book (limit 1-50) | /api/v3/depth | 5 |
| get_avg_price | /api/v3/avgPrice | 2 |
| get_server_time | /api/v3/time | 1 |
| check_symbol | /api/v3/exchangeInfo (с параметром symbol) | 20 |
| get_recent_trades (limit 10) | /api/v3/trades | 25 |
| validate_signal | /api/v3/ticker/bookTicker | 2 |

Лимиты из exchangeInfo: REQUEST_WEIGHT 6000 в минуту; RAW_REQUESTS 300000 за 5 минут; ORDERS 100 за 10 секунд и 200000 в сутки (к публичным данным не относится).

Ёмкость при лимите 6000 в минуту (если IP не используется для других запросов): до 6000 вызовов в минуту для get_server_time (вес 1), до 3000 для инструментов с весом 2, до 1200 для get_order_book (вес 5), до 300 для check_symbol (вес 20), до 240 для get_recent_trades (вес 25). Вес get_recent_trades измерен только при limit=10. Ответы кешируются в памяти на 2 секунды (переменная окружения CACHE_TTL_MS, значение 0 отключает кеш); ошибки и get_server_time не кешируются, одинаковые одновременные запросы объединяются в один. Защита от лимитов: сервер читает заголовок x-mbx-used-weight-1m каждого ответа; если за последнюю минуту (WEIGHT_WINDOW_MS, по умолчанию 60000) вес достиг WEIGHT_GUARD_LIMIT (по умолчанию 5500, значение 0 отключает порог), инструменты возвращают ошибку без обращения к бирже. После HTTP 429 или 418 запросы блокируются на время из заголовка Retry-After (если его нет, на 60 секунд). Порог 5500 это рекомендация, а не значение из документации Binance.

## Вне рамок проекта

- Приватные эндпоинты (балансы, ордера) и любые API-ключи.
- Платежи и переводы, выполняемые ИИ-агентом (Binance Agentic Wallet, официальный Binance MCP
  Server). Для этого нужны авторизация и ограничения прав, которых здесь нет.
- Binance Pay Merchant (приём платежей).

## Ограничения среды

Claude Code и Claude Desktop из региона разработчика не подключаются к `api.anthropic.com`
(`ETIMEDOUT`). Сервер проверяется собственным клиентом на `@modelcontextprotocol/sdk`.
