import axios from "axios";
const BASE_URL = "https://api.binance.com";

describe("Валидация живого соединения с API Binance", () => {
  it("возвращает цену BTCUSDT", async () => {
    const r = await axios.get(`${BASE_URL}/api/v3/ticker/price`, { params: { symbol: "BTCUSDT" } });
    expect(r.data.symbol).toBe("BTCUSDT");
    expect(Number(r.data.price)).toBeGreaterThan(0);
  });

  it("ловит ошибку -1121 (Bad Symbol)", async () => {
    expect.assertions(2);
    try {
      await axios.get(`${BASE_URL}/api/v3/ticker/price`, { params: { symbol: "INVALIDCOIN" } });
    } catch (error: any) {
      expect(error.response.status).toBe(400);
      expect(error.response.data.code).toBe(-1121);
    }
  });

  it("обрывает запрос по таймауту", async () => {
    await expect(
      axios.get(`${BASE_URL}/api/v3/ticker/price`, { params: { symbol: "BTCUSDT" }, timeout: 1 })
    ).rejects.toThrow();
  });
});
