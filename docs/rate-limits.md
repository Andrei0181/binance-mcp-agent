# Лимиты и веса Spot REST (измерено)

Дата измерения: 2026-10-19T11:25:31.749Z
Хост: https://api.binance.com
Метод: разница заголовка x-mbx-used-weight-1m до и после запроса.

| Запрос | Вес |
|---|---|
| `/api/v3/ticker/price?symbol=BTCUSDT` | 2 |
| `/api/v3/ticker/24hr?symbol=BTCUSDT` | 2 |
| `/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=24` | 2 |
| `/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=100` | 2 |
| `/api/v3/depth?symbol=BTCUSDT&limit=10` | 5 |
| `/api/v3/depth?symbol=BTCUSDT&limit=50` | 5 |
| `/api/v3/depth?symbol=BTCUSDT&limit=100` | 5 |
| `/api/v3/avgPrice?symbol=BTCUSDT` | 2 |
| `/api/v3/time` | 1 |
| `/api/v3/exchangeInfo?symbol=BTCUSDT` | 20 |
| `/api/v3/trades?symbol=BTCUSDT&limit=10` | 25 |
| `/api/v3/ticker/bookTicker?symbol=BTCUSDT` | 2 |

## rateLimits из exchangeInfo

```json
[
  {
    "rateLimitType": "REQUEST_WEIGHT",
    "interval": "MINUTE",
    "intervalNum": 1,
    "limit": 6000
  },
  {
    "rateLimitType": "ORDERS",
    "interval": "SECOND",
    "intervalNum": 10,
    "limit": 100
  },
  {
    "rateLimitType": "ORDERS",
    "interval": "DAY",
    "intervalNum": 1,
    "limit": 200000
  },
  {
    "rateLimitType": "RAW_REQUESTS",
    "interval": "MINUTE",
    "intervalNum": 5,
    "limit": 300000
  }
]
```
