import type { RatingWeather } from "./rating-engine.js";

export type WeatherLocation = {
  readonly lat: number;
  readonly lng: number;
  readonly label: string | null;
};

export type WeatherCondition = {
  readonly source: "open-meteo";
  readonly observedAt: string;
  readonly fetchedAt: string;
  readonly temperatureF: number | null;
  readonly apparentTemperatureF: number | null;
  readonly relativeHumidity: number | null;
  readonly precipitationIn: number | null;
  readonly rainIn: number | null;
  readonly showersIn: number | null;
  readonly snowfallIn: number | null;
  readonly weatherCode: number | null;
  readonly cloudCover: number | null;
  readonly windSpeedMph: number | null;
  readonly windDirectionDeg: number | null;
  readonly windGustMph: number | null;
  readonly isDay: boolean | null;
};

export type WeatherState = {
  readonly location: WeatherLocation;
  readonly current: WeatherCondition | null;
  readonly history: readonly WeatherCondition[];
  readonly updatedAt: string | null;
  readonly nextRefreshAt: string | null;
  readonly error: string | null;
};

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
type LatLng = { readonly lat: number; readonly lng: number };

export const WEATHER_REFRESH_MS = 5 * 60 * 1000;
const WEATHER_FETCH_TIMEOUT_MS = 3500;
const WEATHER_HISTORY_LIMIT = 72;
const OPEN_METEO_CURRENT_FIELDS = [
  "temperature_2m",
  "relative_humidity_2m",
  "apparent_temperature",
  "precipitation",
  "rain",
  "showers",
  "snowfall",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_direction_10m",
  "wind_gusts_10m",
  "is_day",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function asNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function round1(value: number | null): number | null {
  return value == null ? null : Math.round(value * 10) / 10;
}

function round2(value: number | null): number | null {
  return value == null ? null : Math.round(value * 100) / 100;
}

function coordFrom(value: unknown): LatLng | null {
  if (!isRecord(value)) return null;
  const lat = asNumber(value["lat"]) ?? asNumber(value["latitude"]);
  const lng = asNumber(value["lng"]) ?? asNumber(value["lon"]) ?? asNumber(value["longitude"]);
  if (lat == null || lng == null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function labelFrom(course: unknown): string | null {
  if (!isRecord(course)) return null;
  const name = asString(course["name"]);
  const location = asString(course["location"]);
  if (name && location) return `${name} - ${location}`;
  return name ?? location;
}

function parsedLayoutHoles(layout: unknown): readonly unknown[] {
  if (!isRecord(layout)) return [];
  const holes = layout["holes"];
  if (Array.isArray(holes)) return holes;
  if (typeof holes !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(holes);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error instanceof Error) return [];
    throw error;
  }
}

function layoutCoords(layout: unknown): readonly LatLng[] {
  const coords: LatLng[] = [];
  for (const hole of parsedLayoutHoles(layout)) {
    if (!isRecord(hole)) continue;
    const tee = coordFrom(hole["tee"]);
    const target = coordFrom(hole["target"]);
    if (tee) coords.push(tee);
    if (target) coords.push(target);
  }
  return coords;
}

function centroid(coords: readonly LatLng[]): LatLng | null {
  if (!coords.length) return null;
  const sum = coords.reduce((acc, c) => ({ lat: acc.lat + c.lat, lng: acc.lng + c.lng }), { lat: 0, lng: 0 });
  return { lat: sum.lat / coords.length, lng: sum.lng / coords.length };
}

export function weatherLocationForCourse(course: unknown, layout: unknown): WeatherLocation | null {
  const label = labelFrom(course);
  if (isRecord(course)) {
    const lat = asNumber(course["lat"]);
    const lng = asNumber(course["lng"]);
    if (lat != null && lng != null && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) return { lat, lng, label };
  }
  const fromLayout = centroid(layoutCoords(layout));
  return fromLayout ? { ...fromLayout, label } : null;
}

export function createWeatherState(location: WeatherLocation | null, nowMs = Date.now()): WeatherState | null {
  if (!location) return null;
  return {
    location,
    current: null,
    history: [],
    updatedAt: null,
    nextRefreshAt: new Date(nowMs).toISOString(),
    error: null,
  };
}

export function weatherRefreshDue(weather: WeatherState | null | undefined, nowMs = Date.now()): boolean {
  if (!weather) return false;
  // Drive purely off nextRefreshAt — createWeatherState/refreshWeatherState always set it. A freshly
  // created state has nextRefreshAt=now (due immediately); a failed fetch pushes it out by the refresh
  // interval. Do NOT force a refresh just because `current` is null, or a failed/empty fetch would be
  // retried on every single request, ignoring the backoff and hammering Open-Meteo.
  if (!weather.nextRefreshAt) return true;
  const nextRefreshMs = Date.parse(weather.nextRefreshAt);
  return !Number.isFinite(nextRefreshMs) || nextRefreshMs <= nowMs;
}

function openMeteoUrl(location: WeatherLocation): URL {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", location.lat.toFixed(6));
  url.searchParams.set("longitude", location.lng.toFixed(6));
  url.searchParams.set("current", OPEN_METEO_CURRENT_FIELDS.join(","));
  url.searchParams.set("temperature_unit", "fahrenheit");
  url.searchParams.set("wind_speed_unit", "mph");
  url.searchParams.set("precipitation_unit", "inch");
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "1");
  return url;
}

export function parseOpenMeteoCurrent(payload: unknown, fetchedAt: string): WeatherCondition | null {
  if (!isRecord(payload) || !isRecord(payload["current"])) return null;
  const current = payload["current"];
  const isDay = asNumber(current["is_day"]);
  return {
    source: "open-meteo",
    observedAt: asString(current["time"]) ?? fetchedAt,
    fetchedAt,
    temperatureF: round1(asNumber(current["temperature_2m"])),
    apparentTemperatureF: round1(asNumber(current["apparent_temperature"])),
    relativeHumidity: round1(asNumber(current["relative_humidity_2m"])),
    precipitationIn: round2(asNumber(current["precipitation"])),
    rainIn: round2(asNumber(current["rain"])),
    showersIn: round2(asNumber(current["showers"])),
    snowfallIn: round2(asNumber(current["snowfall"])),
    weatherCode: asNumber(current["weather_code"]),
    cloudCover: round1(asNumber(current["cloud_cover"])),
    windSpeedMph: round1(asNumber(current["wind_speed_10m"])),
    windDirectionDeg: round1(asNumber(current["wind_direction_10m"])),
    windGustMph: round1(asNumber(current["wind_gusts_10m"])),
    isDay: isDay == null ? null : isDay > 0,
  };
}

export function ratingWeatherFromJson(weatherJson: string | null | undefined): RatingWeather {
  if (!weatherJson) return { windGustMph: null };
  try {
    const parsed: unknown = JSON.parse(weatherJson);
    return ratingWeatherFromUnknown(parsed);
  } catch (error) {
    if (error instanceof SyntaxError) return { windGustMph: null };
    throw error;
  }
}

export async function fetchCurrentWeather(
  location: WeatherLocation,
  doFetch: FetchLike = fetch,
  fetchedAt = new Date().toISOString(),
): Promise<WeatherCondition | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), WEATHER_FETCH_TIMEOUT_MS);
  try {
    const response = await doFetch(openMeteoUrl(location), {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return parseOpenMeteoCurrent(payload, fetchedAt);
  } catch {
    // Weather is best-effort: swallow EVERYTHING, including a non-Error abort DOMException on timeout
    // (which is not always `instanceof Error` in workerd) — never let a weather fetch throw, or the DO
    // alarm that awaits it crashes and wedges the Durable Object.
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function sampleChanged(previous: WeatherCondition | undefined, next: WeatherCondition): boolean {
  return !previous ||
    previous.observedAt !== next.observedAt ||
    previous.precipitationIn !== next.precipitationIn ||
    previous.rainIn !== next.rainIn ||
    previous.windSpeedMph !== next.windSpeedMph ||
    previous.windGustMph !== next.windGustMph ||
    previous.windDirectionDeg !== next.windDirectionDeg ||
    previous.weatherCode !== next.weatherCode;
}

function appendSample(history: readonly WeatherCondition[], sample: WeatherCondition): readonly WeatherCondition[] {
  const previous = history[history.length - 1];
  if (!sampleChanged(previous, sample)) return history;
  return [...history, sample].slice(-WEATHER_HISTORY_LIMIT);
}

function ratingWeatherFromUnknown(value: unknown): RatingWeather {
  if (!isRecord(value)) return { windGustMph: null };
  const currentGust = conditionWindGust(value["current"]);
  const historyGusts = Array.isArray(value["history"]) ? value["history"].map((sample) => conditionWindGust(sample)) : [];
  return { windGustMph: round1(maxFinite([currentGust, ...historyGusts])) };
}

function conditionWindGust(value: unknown): number | null {
  if (!isRecord(value)) return null;
  return asNumber(value["windGustMph"]) ?? asNumber(value["wind_gust_mph"]) ?? asNumber(value["wind_gusts_10m"]);
}

function maxFinite(values: readonly (number | null)[]): number | null {
  let max: number | null = null;
  for (const value of values) {
    if (value == null || !Number.isFinite(value)) continue;
    max = max == null ? value : Math.max(max, value);
  }
  return max;
}

export async function refreshWeatherState(
  weather: WeatherState,
  doFetch: FetchLike = fetch,
  nowMs = Date.now(),
): Promise<WeatherState> {
  const fetchedAt = new Date(nowMs).toISOString();
  const nextRefreshAt = new Date(nowMs + WEATHER_REFRESH_MS).toISOString();
  const sample = await fetchCurrentWeather(weather.location, doFetch, fetchedAt);
  if (!sample) return { ...weather, nextRefreshAt, error: "weather_unavailable" };
  return {
    ...weather,
    current: sample,
    history: appendSample(weather.history, sample),
    updatedAt: sample.fetchedAt,
    nextRefreshAt,
    error: null,
  };
}
