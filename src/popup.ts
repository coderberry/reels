import {
  normalizeSettings,
  readSettings,
  SETTINGS_KEY,
  type Settings,
  updateSettings,
} from "./settings";

type BooleanSetting = {
  [Key in keyof Settings]: Settings[Key] extends boolean ? Key : never;
}[keyof Settings];

const booleanSettings: readonly BooleanSetting[] = [
  "enabled",
  "rememberMute",
  "rememberVolume",
  "rememberSpeed",
  "shortcuts",
  "autoScroll",
  "loopSections",
  "preferHD",
  "muted",
];

const settingsFieldset = requireElement<HTMLFieldSetElement>("settings");
const status = requireElement<HTMLParagraphElement>("status");
const volume = requireElement<HTMLInputElement>("volume");
const volumeValue = requireElement<HTMLOutputElement>("volumeValue");
const speed = requireElement<HTMLSelectElement>("speed");
const booleanInputs = new Map(
  booleanSettings.map((key) => [key, requireElement<HTMLInputElement>(key)]),
);

let currentSettings: Settings | undefined;
let saveQueue: Promise<void> = Promise.resolve();
let statusSequence = 0;

function requireElement<ElementType extends HTMLElement>(
  id: string,
): ElementType {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing popup element: ${id}`);
  return element as ElementType;
}

function showStatus(
  message: string,
  tone: "normal" | "error" = "normal",
): void {
  statusSequence += 1;
  status.textContent = message;
  if (tone === "error") status.dataset.tone = "error";
  else delete status.dataset.tone;
}

function showTemporaryStatus(message: string): void {
  showStatus(message);
  const sequence = statusSequence;
  window.setTimeout(() => {
    if (statusSequence === sequence) showStatus("");
  }, 1400);
}

function render(settings: Settings): void {
  currentSettings = settings;
  for (const [key, input] of booleanInputs) input.checked = settings[key];
  volume.value = String(settings.volume);
  volumeValue.value = `${Math.round(settings.volume * 100)}%`;
  speed.value = String(settings.speed);
}

function queueUpdate(patch: Partial<Settings>): void {
  if (!currentSettings) return;

  currentSettings = { ...currentSettings, ...patch };
  saveQueue = saveQueue
    .catch(() => undefined)
    .then(async () => {
      showStatus("Saving…");
      try {
        render(await updateSettings(patch));
        showTemporaryStatus("Saved");
      } catch (error) {
        showStatus(
          error instanceof Error ? error.message : "Could not save settings.",
          "error",
        );
        try {
          render(await readSettings());
        } catch {
          // Keep the attempted values visible when settings cannot be read either.
        }
      }
    });
}

for (const [key, input] of booleanInputs) {
  input.addEventListener("change", () => queueUpdate({ [key]: input.checked }));
}

volume.addEventListener("input", () => {
  volumeValue.value = `${Math.round(Number(volume.value) * 100)}%`;
});

volume.addEventListener("change", () => {
  queueUpdate({ volume: Number(volume.value) });
});

speed.addEventListener("change", () => {
  queueUpdate({ speed: Number(speed.value) });
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes[SETTINGS_KEY]) return;
  render(normalizeSettings(changes[SETTINGS_KEY].newValue));
});

async function initialize(): Promise<void> {
  try {
    render(await readSettings());
    settingsFieldset.disabled = false;
    showStatus("");
  } catch (error) {
    showStatus(
      error instanceof Error ? error.message : "Could not load settings.",
      "error",
    );
  }
}

void initialize();
