import { describe, expect, it } from "vitest";
import { parseOpenMeteoCurrent, ratingWeatherFromJson, weatherLocationForCourse } from "../src/weather.js";

describe("live round weather", () => {
  it("parses current rain and wind conditions from Open-Meteo", () => {
    const parsed = parseOpenMeteoCurrent({
      current: {
        time: "2026-07-01T08:00",
        temperature_2m: 84.24,
        apparent_temperature: 91.11,
        relative_humidity_2m: 79,
        precipitation: 0.03,
        rain: 0.02,
        showers: 0.01,
        snowfall: 0,
        weather_code: 61,
        cloud_cover: 88,
        wind_speed_10m: 12.34,
        wind_direction_10m: 203,
        wind_gusts_10m: 21.98,
        is_day: 1,
      },
    }, "2026-07-01T12:00:00.000Z");

    expect(parsed).toMatchObject({
      observedAt: "2026-07-01T08:00",
      fetchedAt: "2026-07-01T12:00:00.000Z",
      temperatureF: 84.2,
      apparentTemperatureF: 91.1,
      precipitationIn: 0.03,
      rainIn: 0.02,
      windSpeedMph: 12.3,
      windGustMph: 22,
      weatherCode: 61,
      isDay: true,
    });
  });

  it("resolves weather coordinates from course GPS or layout hole GPS", () => {
    expect(weatherLocationForCourse(
      { name: "North Rec", location: "Greenville, NC", lat: 35.631092, lng: -77.319923 },
      { holes: "[]" },
    )).toEqual({ lat: 35.631092, lng: -77.319923, label: "North Rec - Greenville, NC" });

    expect(weatherLocationForCourse(
      { name: "Imported Layout" },
      { holes: JSON.stringify([{ tee: { lat: 35, lng: -77 }, target: { lat: 36, lng: -78 } }]) },
    )).toEqual({ lat: 35.5, lng: -77.5, label: "Imported Layout" });
  });

  it("extracts the peak recorded gust from stored round weather", () => {
    expect(ratingWeatherFromJson(null)).toEqual({ windGustMph: null });
    expect(ratingWeatherFromJson(JSON.stringify({
      current: { windGustMph: 18.4 },
      history: [{ windGustMph: 19.1 }, { wind_gusts_10m: 25.24 }],
    }))).toEqual({ windGustMph: 25.2 });
  });
});
