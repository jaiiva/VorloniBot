"use strict";

const descriptions = new Map([
  [0, "selkeää"], [1, "lähes selkeää"], [2, "puolipilvistä"], [3, "pilvistä"],
  [45, "sumua"], [48, "jäätävää sumua"],
  [51, "heikkoa tihkusadetta"], [53, "tihkusadetta"], [55, "voimakasta tihkusadetta"],
  [56, "jäätävää tihkusadetta"], [57, "voimakasta jäätävää tihkusadetta"],
  [61, "heikkoa sadetta"], [63, "sadetta"], [65, "voimakasta sadetta"],
  [66, "jäätävää sadetta"], [67, "voimakasta jäätävää sadetta"],
  [71, "heikkoa lumisadetta"], [73, "lumisadetta"], [75, "voimakasta lumisadetta"],
  [77, "lumijyväsiä"], [80, "heikkoja sadekuuroja"], [81, "sadekuuroja"],
  [82, "voimakkaita sadekuuroja"], [85, "lumikuuroja"], [86, "voimakkaita lumikuuroja"],
  [95, "ukkosta"], [96, "ukkosta ja rakeita"], [99, "voimakasta ukkosta ja rakeita"],
]);

module.exports = {
  command: "!sää",
  async execute({ signal }) {
    const url = new URL("https://api.open-meteo.com/v1/forecast");
    url.searchParams.set("latitude", "62.8924");
    url.searchParams.set("longitude", "27.6770");
    url.searchParams.set("current", "temperature_2m,apparent_temperature,weather_code,wind_speed_10m");
    url.searchParams.set("timezone", "Europe/Helsinki");

    const response = await fetch(url, { signal });
    if (!response.ok) throw new Error(`Open-Meteo vastasi ${response.status}`);
    const data = await response.json();
    const current = data.current;
    if (!current || !Number.isFinite(current.temperature_2m) ||
        !Number.isFinite(current.apparent_temperature) ||
        !Number.isFinite(current.wind_speed_10m)) {
      throw new Error("Säävastauksesta puuttuu tietoja.");
    }
    const condition = descriptions.get(current.weather_code) ?? "säätilaa ei tunneta";
    return `Kuopio: ${condition}, ${current.temperature_2m} °C ` +
      `(tuntuu kuin ${current.apparent_temperature} °C), tuuli ${current.wind_speed_10m} km/h.`;
  },
};
