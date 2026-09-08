import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  defaults,
  normalizeSettings,
  readSettings,
  SETTINGS_KEY,
  updateSettings,
} from "../src/settings";

const originalChrome = globalThis.chrome;

afterEach(() => {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: originalChrome,
    writable: true,
  });
});

function setChrome(mock: unknown): void {
  Object.defineProperty(globalThis, "chrome", {
    configurable: true,
    value: mock,
    writable: true,
  });
}

test("normalizeSettings returns defaults for malformed storage values", () => {
  for (const value of [undefined, null, false, 0, "", "settings"]) {
    assert.deepEqual(normalizeSettings(value), defaults);
  }
  assert.notEqual(normalizeSettings(undefined), defaults);
});

test("normalizeSettings accepts strict booleans and ignores coercible or unknown values", () => {
  const normalized = normalizeSettings({
    enabled: false,
    rememberMute: true,
    rememberVolume: 0,
    rememberSpeed: "false",
    shortcuts: null,
    autoScroll: true,
    loopSections: undefined,
    preferHD: false,
    muted: "true",
    unexpected: "preserve me",
  });

  assert.deepEqual(normalized, {
    ...defaults,
    enabled: false,
    rememberMute: true,
    autoScroll: true,
    preferHD: false,
  });
  assert.equal("unexpected" in normalized, false);
});

test("normalizeSettings clamps numeric settings and rejects non-finite or coercible numbers", () => {
  assert.deepEqual(normalizeSettings({ volume: -1, speed: 100 }), {
    ...defaults,
    volume: 0,
    speed: 4,
  });
  assert.deepEqual(normalizeSettings({ volume: 2, speed: 0 }), {
    ...defaults,
    volume: 1,
    speed: 0.25,
  });
  assert.deepEqual(normalizeSettings({ volume: 0.35, speed: 1.75 }), {
    ...defaults,
    volume: 0.35,
    speed: 1.75,
  });
  assert.deepEqual(normalizeSettings({ volume: "0.5", speed: "2" }), defaults);
  assert.deepEqual(
    normalizeSettings({ volume: Number.NaN, speed: Number.POSITIVE_INFINITY }),
    defaults,
  );
});

test("readSettings requests the settings key and normalizes malformed stored data", async () => {
  const requested: string[] = [];
  setChrome({
    storage: {
      local: {
        get: async (key: string) => {
          requested.push(key);
          return {
            [SETTINGS_KEY]: {
              enabled: "false",
              volume: -5,
              speed: Number.NaN,
              shortcuts: false,
            },
          };
        },
      },
    },
  });

  assert.deepEqual(await readSettings(), {
    ...defaults,
    volume: 0,
    shortcuts: false,
  });
  assert.deepEqual(requested, [SETTINGS_KEY]);
});

test("readSettings uses defaults when the settings key is absent", async () => {
  setChrome({ storage: { local: { get: async () => ({ unrelated: true }) } } });
  assert.deepEqual(await readSettings(), defaults);
});

test("updateSettings sends the patch and normalizes the background reply", async () => {
  const patch = { enabled: false, volume: 0.4 };
  let sent: unknown;
  setChrome({
    runtime: {
      sendMessage: async (message: unknown) => {
        sent = message;
        return {
          ok: true,
          settings: { ...patch, speed: 99, muted: "false", unknown: true },
        };
      },
    },
  });

  assert.deepEqual(await updateSettings(patch), {
    ...defaults,
    enabled: false,
    volume: 0.4,
    speed: 4,
  });
  assert.deepEqual(sent, { type: "settings:update", patch });
});

test("updateSettings surfaces background errors and a stable fallback", async () => {
  setChrome({
    runtime: {
      sendMessage: async () => ({ ok: false, error: "Storage failed." }),
    },
  });
  await assert.rejects(updateSettings({ enabled: false }), /Storage failed\./);

  setChrome({ runtime: { sendMessage: async () => undefined } });
  await assert.rejects(
    updateSettings({ enabled: false }),
    /Could not save settings\./,
  );
});
