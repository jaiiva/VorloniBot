import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";

interface WeatherPlugin {
  command: string;
  execute(context: { signal: AbortSignal }): Promise<string>;
}

const weather = require(resolve(__dirname, "../plugins/weather.cjs")) as WeatherPlugin;

test("sääplugin hakee Kuopion tämänhetkiset tiedot", async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl: URL | undefined;
  globalThis.fetch = async (input) => {
    requestedUrl = new URL(String(input));
    return new Response(JSON.stringify({
      current: {
        temperature_2m: -3,
        apparent_temperature: -7,
        weather_code: 71,
        wind_speed_10m: 12,
      },
    }), { status: 200 });
  };
  try {
    const reply = await weather.execute({ signal: AbortSignal.timeout(2000) });
    assert.equal(weather.command, "!sää");
    assert.equal(requestedUrl?.hostname, "api.open-meteo.com");
    assert.equal(requestedUrl?.searchParams.get("latitude"), "62.8924");
    assert.equal(requestedUrl?.searchParams.get("timezone"), "Europe/Helsinki");
    assert.match(reply, /Kuopio: heikkoa lumisadetta, -3 °C \(tuntuu kuin -7 °C\), tuuli 12 km\/h/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
