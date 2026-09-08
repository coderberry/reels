export interface Settings {
  enabled: boolean;
  rememberMute: boolean;
  rememberVolume: boolean;
  rememberSpeed: boolean;
  shortcuts: boolean;
  autoScroll: boolean;
  loopSections: boolean;
  preferHD: boolean;
  muted: boolean;
  volume: number;
  speed: number;
}

export const SETTINGS_KEY = "settings";
export const defaults: Readonly<Settings> = Object.freeze({
  enabled: true,
  rememberMute: true,
  rememberVolume: true,
  rememberSpeed: true,
  shortcuts: true,
  autoScroll: false,
  loopSections: true,
  preferHD: true,
  muted: true,
  volume: 1,
  speed: 1,
});

export function normalizeSettings(value: unknown): Settings {
  const result = { ...defaults };
  if (!value || typeof value !== "object") return result;
  const data = value as Record<string, unknown>;
  for (const key of Object.keys(defaults) as (keyof Settings)[]) {
    if (typeof defaults[key] === "boolean" && typeof data[key] === "boolean") {
      (result as unknown as Record<string, unknown>)[key] = data[key];
    }
  }
  for (const [key, min, max] of [
    ["volume", 0, 1],
    ["speed", 0.25, 4],
  ] as const) {
    const candidate = data[key];
    if (typeof candidate === "number" && Number.isFinite(candidate))
      result[key] = Math.min(max, Math.max(min, candidate));
  }
  return result;
}

export async function readSettings(): Promise<Settings> {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return normalizeSettings(data[SETTINGS_KEY]);
}

export async function updateSettings(
  patch: Partial<Settings>,
): Promise<Settings> {
  const reply = await chrome.runtime.sendMessage({
    type: "settings:update",
    patch,
  });
  if (!reply?.ok) throw new Error(reply?.error || "Could not save settings.");
  return normalizeSettings(reply.settings);
}
