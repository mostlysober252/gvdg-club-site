import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import test from 'node:test';

let importCounter = 0;

async function loadWeatherDisplay() {
  return import(new URL(`../src/shared/weather-model.js?test=${importCounter++}`, import.meta.url));
}

test('formats current round weather with wind, precipitation, humidity, and update time', async () => {
  const weather = await loadWeatherDisplay();
  const state = {
    location: { lat: 35.6, lng: -77.4, label: 'Course - Greenville, NC' },
    current: {
      observedAt: '2026-07-01T16:20:00.000Z',
      fetchedAt: '2026-07-01T16:20:10.000Z',
      temperatureF: 82.4,
      apparentTemperatureF: 88.2,
      precipitationIn: 0.03,
      rainIn: 0.03,
      showersIn: 0,
      snowfallIn: 0,
      relativeHumidity: 72,
      weatherCode: 61,
      windSpeedMph: 8.4,
      windDirectionDeg: 225,
      windGustMph: 18.1,
    },
    history: [],
    updatedAt: '2026-07-01T16:20:10.000Z',
  };

  const labels = Array.from(weather.weatherChips(state).map((chip) => chip.label));
  assert.deepEqual(labels, ['Conditions', 'Wind', 'Precip', 'Humidity', 'Updated']);
  assert.match(weather.formatLiveWeather(state), /Conditions: Rain 82 F feels 88 F/);
  assert.match(weather.formatLiveWeather(state), /Wind: SW 8 mph gust 18/);
  assert.match(weather.formatLiveWeather(state), /Precip: Rain 0\.03 in/);
});

test('maps open-meteo weather codes to accessible condition graphics', async () => {
  const weather = await loadWeatherDisplay();
  const cases = [
    [{ weatherCode: 0, isDay: true }, '☀️', 'Clear'],
    [{ weatherCode: 0, isDay: false }, '🌙', 'Clear'],
    [{ weatherCode: 2 }, '⛅', 'Partly cloudy'],
    [{ weatherCode: 45 }, '🌫️', 'Fog'],
    [{ weatherCode: 63 }, '🌧️', 'Rain'],
    [{ weatherCode: 71 }, '❄️', 'Light snow'],
    [{ weatherCode: 85 }, '🌨️', 'Snow showers'],
    [{ weatherCode: 95 }, '⛈️', 'Thunderstorm'],
    [{ weatherCode: null, precipitationIn: 0.03 }, '🌧️', 'Rain'],
    [{ weatherCode: 2, precipitationIn: 0.03 }, '🌧️', 'Rain'],
  ];
  for (const [input, icon, label] of cases) {
    const graphic = weather.conditionGraphic(input);
    assert.equal(graphic.icon, icon);
    assert.equal(graphic.label, label);
  }
});

test('current weather summary promotes condition, wind, and secondary meta without chip clutter', async () => {
  const weather = await loadWeatherDisplay();
  const state = {
    location: { label: 'Course - Greenville, NC' },
    current: {
      observedAt: '2026-07-01T16:20:00.000Z',
      fetchedAt: '2026-07-01T16:20:10.000Z',
      temperatureF: 82.4,
      apparentTemperatureF: 88.2,
      precipitationIn: 0.03,
      rainIn: 0.03,
      relativeHumidity: 72,
      weatherCode: 61,
      windSpeedMph: 8.4,
      windDirectionDeg: 225,
      windGustMph: 18.1,
    },
    history: [],
    updatedAt: '2026-07-01T16:20:10.000Z',
  };

  const summary = weather.currentWeatherSummary(state);
  assert.equal(summary.tempText, '82°');
  assert.equal(summary.condition, 'Rain');
  assert.equal(summary.feelsText, 'Feels 88°');
  assert.equal(summary.graphic.icon, '🌧️');
  assert.equal(summary.graphic.label, 'Light rain');
  assert.equal(summary.windText, 'SW 8 mph');
  assert.equal(summary.gustText, 'gust 18');
  assert.equal(summary.humidityText, 'Humidity 72%');
  assert.equal(summary.precipText, 'Rain 0.03 in');
  assert.match(summary.updatedText, /^Updated /);
});

test('wind control includes a direction arrow pointing where the wind blows north-up until compass enabled', async () => {
  const weather = await loadWeatherDisplay();
  const model = weather.windArrowModel(225);
  assert.equal(model.blowTo, 45);
  assert.equal(model.compassStatus, 'off');
  assert.equal(model.label, 'Wind blowing this way. Tap to orient it to your phone heading.');
  assert.equal(model.modeText, 'North-up');
  assert.equal(model.relative, 'north');
  assert.equal(model.rotationDeg, 45);
});

test('wind arrow rotates relative to device heading after compass permission', async () => {
  const listeners = {};
  let requestedAbsolute = null;
  let clearedTimer = false;
  const fakeWindow = {
    DeviceOrientationEvent: {
      requestPermission(absolute) {
        requestedAbsolute = absolute;
        return Promise.resolve('granted');
      },
    },
    addEventListener(type, handler) {
      listeners[type] = handler;
    },
    setTimeout() { return 1; },
    clearTimeout() { clearedTimer = true; },
  };
  const previousWindow = globalThis.window;
  globalThis.window = fakeWindow;
  try {
    const weather = await loadWeatherDisplay();
    const compassEvents = [];
    const unsubscribe = weather.subscribeCompass((state) => compassEvents.push(state));

    assert.equal(await weather.enableCompass(), true);
    assert.equal(requestedAbsolute, true);
    assert.equal(typeof listeners.deviceorientationabsolute, 'function');
    assert.equal(typeof listeners.deviceorientation, 'function');
    assert.equal(weather.windArrowModel(225).rotationDeg, 45);
    assert.equal(compassEvents[compassEvents.length - 1].status, 'starting');

    listeners.deviceorientation({ absolute: true, alpha: 90 });
    assert.equal(clearedTimer, true);
    assert.equal(weather.compassState().status, 'active');
    assert.equal(weather.compassState().modeText, 'Phone-relative');
    const model = weather.windArrowModel(225);
    assert.equal(model.blowTo, 45);
    assert.equal(model.compassStatus, 'active');
    assert.equal(model.label, "Wind blowing this way, relative to the way you're facing");
    assert.equal(model.modeText, 'Phone-relative');
    assert.equal(model.relative, 'facing');
    assert.equal(model.rotationDeg, 135);
    assert.equal(compassEvents[compassEvents.length - 1].relative, 'facing');
    unsubscribe();
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});

test('current weather summary is exported for React weather surfaces', async () => {
  const weather = await loadWeatherDisplay();
  const summary = weather.currentWeatherSummary({
    current: {
      fetchedAt: '2026-07-01T16:20:10.000Z',
      temperatureF: 74.2,
      apparentTemperatureF: 80.2,
      relativeHumidity: 68,
      weatherCode: 0,
      windSpeedMph: 6.8,
      windDirectionDeg: 154,
      windGustMph: 11.1,
    },
    history: [],
  });

  assert.equal(summary.condition, 'Clear');
  assert.equal(summary.tempText, '74°');
  assert.equal(summary.feelsText, 'Feels 80°');
  assert.equal(summary.windText, 'SSE 7 mph');
  assert.equal(summary.gustText, 'gust 11');
  assert.equal(summary.humidityText, 'Humidity 68%');
});

test('no wind arrow when direction is unknown', async () => {
  const weather = await loadWeatherDisplay();
  assert.equal(weather.windArrowModel(null), null);
});

test('surfaces material weather changes during a round', async () => {
  const weather = await loadWeatherDisplay();
  const previous = {
    observedAt: '2026-07-01T16:10:00.000Z',
    fetchedAt: '2026-07-01T16:10:10.000Z',
    precipitationIn: 0,
    rainIn: 0,
    windSpeedMph: 4,
    windGustMph: 8,
    weatherCode: 2,
  };
  const current = {
    observedAt: '2026-07-01T16:20:00.000Z',
    fetchedAt: '2026-07-01T16:20:10.000Z',
    precipitationIn: 0.02,
    rainIn: 0.02,
    windSpeedMph: 9,
    windGustMph: 17,
    weatherCode: 61,
  };

  assert.deepEqual(
    Array.from(weather.weatherChanges({ current, history: [previous, current] })),
    ['Wind +5 mph', 'Gust +9 mph', 'Rain started'],
  );
});

test('shared weather helper exports no standalone DOM renderer', async () => {
  const weather = await loadWeatherDisplay();
  const source = await readFile(new URL('../src/shared/weather-model.js', import.meta.url), 'utf8');
  assert.equal(weather.buildWeatherStrip, undefined);
  assert.equal(weather.renderWeather, undefined);
  assert.doesNotMatch(source, /GVDGWeather|window\.GVDGWeather|root\.GVDGWeather/);
  assert.doesNotMatch(source, /createElement|createElementNS|appendChild|replaceChildren|querySelectorAll/);
});

test('React weather surfaces import the module instead of loading a global script', async () => {
  const scoreHtml = await readFile(new URL('../score.html', import.meta.url), 'utf8');
  const eventsHtml = await readFile(new URL('../events.html', import.meta.url), 'utf8');
  const strip = await readFile(new URL('../src/score-app/weather-strip.js', import.meta.url), 'utf8');
  await assert.rejects(access(new URL('../weather-display.js', import.meta.url)));
  assert.doesNotMatch(scoreHtml, /<script src="weather-display\.js"/);
  assert.doesNotMatch(eventsHtml, /<script src="weather-display\.js"/);
  assert.match(strip, /from "\.\.\/shared\/weather-model\.js"/);
  assert.doesNotMatch(strip, /weatherApi|GVDGWeather/);
});
