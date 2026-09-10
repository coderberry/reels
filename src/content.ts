import {
  BRIDGE_TAG,
  bestSource,
  formatTime,
  safeMediaUrl,
  sanitizeRecord,
  seekTime,
  type MediaRecord,
} from "./core";
import { matchMediaRecord, shortcodeFromPath } from "./matching";
import {
  defaults,
  normalizeSettings,
  readSettings,
  SETTINGS_KEY,
  updateSettings,
  type Settings,
} from "./settings";

type Entry = {
  mediaId?: string;
  originalLoop: boolean;
  originalControls: boolean;
  start?: number;
  end?: number;
  source: string;
  upgraded?: string;
  failedHD?: string;
  notHigherHD?: string;
  cancelQuality?: () => void;
  companion?: QualityCompanion;
  cleanup: () => void;
};
type SavedStyle = { value: string; priority: string };
type QualityCompanion = {
  container: HTMLDivElement;
  events: AbortController;
  originalPaused: boolean;
  originalStyles: Map<string, SavedStyle>;
  originalTime: number;
  owner: HTMLVideoElement;
  ownerHeight: number;
  ownerSource: string;
  ownerWidth: number;
  ready: boolean;
  source: string;
  video: HTMLVideoElement;
};
type FullscreenFit = {
  target: HTMLElement;
  video: HTMLVideoElement;
  targetStyles: Map<string, SavedStyle>;
  videoStyles: Map<string, SavedStyle>;
};
let settings: Settings = { ...defaults };
let ready = false;
let active: HTMLVideoElement | undefined;
let nativeFullscreenVideo: HTMLVideoElement | undefined;
let dragging = false;
let scheduled = false;
let frame = 0;
let statusTimer = 0;
let advancing = false;
let fullscreenFit: FullscreenFit | undefined;
const entries = new Map<HTMLVideoElement, Entry>();
const companionOwners = new WeakMap<HTMLVideoElement, HTMLVideoElement>();
const records = new Map<string, MediaRecord>();

const host = document.createElement("div");
host.id = "local-reel-controls";
const root = host.attachShadow({ mode: "open" });
root.innerHTML = `
<style>
  :host {
    all: initial;
    position: fixed;
    margin: 0;
    border: 0;
    padding: 0;
    inset: auto;
    background: transparent;
    z-index: 2147483647;
    display: none;
    color-scheme: dark;
    --accent: #30d158;
    --text: rgb(255 255 255 / 92%);
    --text-2: rgb(255 255 255 / 62%);
    --glass: rgb(255 255 255 / 10%);
    --rim: rgb(255 255 255 / 70%);
    --radius: 22px;
    --button: rgb(255 255 255 / 10%);
    --button-hover: rgb(255 255 255 / 16%);
    --track: rgb(255 255 255 / 22%);
    --opaque: rgb(28 28 30 / 94%);
    font: 13px/1.35 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif;
    color: var(--text);
    -webkit-font-smoothing: antialiased;
  }
  * { box-sizing: border-box; }
  .panel {
    position: relative;
    isolation: isolate;
    padding: 9px 11px;
    border-radius: var(--radius);
    text-shadow: 0 1px 2px rgb(0 0 0 / 35%);
  }
  .panel::before {
    position: absolute;
    z-index: -1;
    inset: 0;
    overflow: hidden;
    border-radius: var(--radius);
    background-color: var(--glass);
    box-shadow: 0 8px 32px rgb(0 0 0 / 32%), inset 2px 2px 0 -2px var(--rim), inset 0 0 3px 1px var(--rim);
    content: "";
    pointer-events: none;
  }
  .panel::after {
    position: absolute;
    z-index: -2;
    inset: 0;
    overflow: hidden;
    border-radius: var(--radius);
    backdrop-filter: blur(3px) saturate(1.2) brightness(0.72);
    -webkit-backdrop-filter: blur(3px) saturate(1.2) brightness(0.72);
    filter: url(#container-glass);
    isolation: isolate;
    content: "";
    pointer-events: none;
  }
  .row { display: flex; align-items: center; gap: 7px; }
  .heading { justify-content: space-between; margin-bottom: 6px; font-size: 10px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase; color: var(--text-2); }
  button, select { font: inherit; color: inherit; background: var(--button); border: 0; border-radius: 999px; box-shadow: inset 2px 2px 0 -2px var(--rim), inset 0 0 3px 1px var(--rim); min-height: 20px; cursor: pointer; transition: background 150ms ease, transform 120ms ease; }
  button { padding: 3px 10px; white-space: nowrap; }
  button:hover, select:hover { background: var(--button-hover); }
  button:active { transform: scale(.97); }
  button:focus-visible, input:focus-visible, select:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  button:disabled, input:disabled { opacity: .45; cursor: default; }
  input { accent-color: var(--accent); cursor: pointer; min-width: 0; }
  input[type=range] { appearance: none; -webkit-appearance: none; height: 20px; background: transparent; }
  input[type=range]::-webkit-slider-runnable-track { height: 5px; border-radius: 999px; background: linear-gradient(90deg, var(--accent) var(--fill, 0%), var(--track) var(--fill, 0%)); box-shadow: inset 0 1px 2px rgb(0 0 0 / 14%); }
  input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; width: 15px; height: 15px; margin-top: -5px; border: 0; border-radius: 50%; background: #fff; box-shadow: 0 1px 4px rgb(0 0 0 / 30%), 0 0 0 .5px rgb(0 0 0 / 8%); }
  input[type=range]:disabled::-webkit-slider-thumb { opacity: .5; }
  select { padding: 3px 8px; }
  #seek { flex: 1; width: 50px; }
  #volume { width: 62px; }
  #time { font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--text-2); }
  .actions { flex-wrap: wrap; margin-top: 7px; }
  #message { color: var(--accent); min-height: 0; font-size: 11px; padding-top: 4px; }
  #message:empty { display: none; }
  #loop-state { color: var(--text-2); font-size: 11px; }
  [hidden] { display: none !important; }
  .panel.collapsed { width: 40px; height: 40px; padding: 4px; }
  .panel.collapsed::before, .panel.collapsed::after { display: none; }
  .panel.collapsed .detail, .panel.collapsed .heading > span { display: none; }
  .panel.collapsed .heading { width: 100%; height: 100%; margin: 0; justify-content: center; }
  .panel.collapsed #collapse { width: 32px; min-height: 32px; padding: 0; font-size: 17px; line-height: 1; border-radius: 50%; background: rgb(0 0 0 / 45%); box-shadow: none; color: #fff; text-shadow: none; }
  .panel.collapsed #collapse:hover { background: rgb(0 0 0 / 55%); }
  @media (prefers-reduced-transparency: reduce) {
    .panel::before { background-color: var(--opaque); }
    .panel::after { backdrop-filter: none; -webkit-backdrop-filter: none; filter: none; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition-duration: .01ms !important; } }
</style>
<section class="panel" aria-label="Reels">
  <div class="row heading"><span>Reels</span><button id="collapse" title="Collapse controls" aria-label="Collapse controls" aria-expanded="true">−</button></div>
  <div class="detail">
    <div class="row"><button id="play" aria-label="Play">Play</button><input id="seek" type="range" min="0" max="100" step="0.05" value="0" aria-label="Seek video"><span id="time">0:00 / 0:00</span></div>
    <div class="row actions">
      <button id="mute" aria-label="Unmute">Unmute</button><input id="volume" type="range" min="0" max="1" step="0.05" aria-label="Volume">
      <select id="speed" aria-label="Playback speed">${[0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4].map((n) => `<option value="${n}">${n}×</option>`).join("")}</select>
      <button id="fullscreen" title="Fullscreen (F)" aria-label="Fullscreen">Full</button>
      <button id="download" aria-label="Download video">Save</button><button id="hd" title="Use the highest-resolution source supplied by Instagram" aria-label="Use highest quality">HD</button>
    </div>
    <div class="row actions" id="loop-controls"><button id="loop-start" title="Set loop start ([)">A [</button><button id="loop-end" title="Set loop end (])">B ]</button><button id="loop-clear" title="Clear loop (\\)">Clear</button><span id="loop-state">No section loop</span></div>
    <div id="message" role="status" aria-live="polite"></div>
  </div>
</section>
<svg style="display: none" aria-hidden="true">
  <filter id="container-glass" x="0%" y="0%" width="100%" height="100%">
    <feTurbulence type="fractalNoise" baseFrequency="0.008 0.008" numOctaves="2" seed="92" result="noise" />
    <feGaussianBlur in="noise" stdDeviation="0.02" result="blur" />
    <feDisplacementMap in="SourceGraphic" in2="blur" scale="77" xChannelSelector="R" yChannelSelector="G" />
  </filter>
</svg>`;
const ui = <T extends HTMLElement>(id: string) => root.getElementById(id) as T;
const seek = ui<HTMLInputElement>("seek");
const volume = ui<HTMLInputElement>("volume");
const speed = ui<HTMLSelectElement>("speed");

function tell(message: string) {
  ui("message").textContent = message;
  clearTimeout(statusTimer);
  statusTimer = window.setTimeout(() => {
    ui("message").textContent = "";
  }, 5000);
}
async function save(patch: Partial<Settings>) {
  settings = normalizeSettings({ ...settings, ...patch });
  try {
    await updateSettings(patch);
  } catch {
    tell(
      "Could not save preferences. Reload this tab after reloading the extension.",
    );
  }
  applyAll();
}
function ownerFor(video: HTMLVideoElement) {
  return companionOwners.get(video) || video;
}
function entryFor(video: HTMLVideoElement) {
  return entries.get(ownerFor(video));
}
function playbackFor(video: HTMLVideoElement, entry = entries.get(video)) {
  return entry?.companion?.video || video;
}
function apply(video: HTMLVideoElement) {
  const entry = entryFor(video);
  if (!entry || !settings.enabled) return;
  if (settings.rememberMute && video.muted !== settings.muted)
    video.muted = settings.muted;
  if (
    settings.rememberVolume &&
    Math.abs(video.volume - settings.volume) > 0.001
  )
    video.volume = settings.volume;
  if (settings.rememberSpeed && video.playbackRate !== settings.speed)
    video.playbackRate = settings.speed;
  const desiredLoop =
    settings.autoScroll && isReelPage() ? false : entry.originalLoop;
  if (video.loop !== desiredLoop) video.loop = desiredLoop;
}
function applyAll() {
  for (const [video, entry] of entries) apply(playbackFor(video, entry));
  schedule();
}
function isReelPage() {
  return /^\/reels?\//.test(location.pathname);
}
function updateEntry(video: HTMLVideoElement, entry: Entry) {
  // During `emptied`, currentSrc can still name the previous resource.
  const source =
    video.readyState === HTMLMediaElement.HAVE_NOTHING
      ? video.src
      : video.currentSrc || video.src;
  const mediaId = video.getAttribute("data-lrc-media-id") || undefined;
  if (
    (entry.source && source && entry.source !== source) ||
    (entry.mediaId && mediaId && entry.mediaId !== mediaId)
  ) {
    entry.cancelQuality?.();
    removeCompanion(entry, { restorePosition: false, resume: false });
    entry.start = undefined;
    entry.end = undefined;
    entry.upgraded = undefined;
    entry.failedHD = undefined;
    entry.notHigherHD = undefined;
  }
  if (source) entry.source = source;
  if (mediaId) entry.mediaId = mediaId;
}
function addVideo(video: HTMLVideoElement) {
  if (entries.has(video)) return;
  const events = new AbortController();
  const entry: Entry = {
    mediaId: video.getAttribute("data-lrc-media-id") || undefined,
    source: video.currentSrc || video.src,
    originalLoop: video.loop,
    originalControls: video.controls,
    cleanup: () => {
      events.abort();
      entry.cancelQuality?.();
      removeCompanion(entry, {
        restorePosition: video.isConnected,
        resume: video.isConnected,
      });
      if (nativeFullscreenVideo === video) {
        video.controls = entry.originalControls;
        nativeFullscreenVideo = undefined;
      }
    },
  };
  entries.set(video, entry);
  const options = { signal: events.signal };
  video.addEventListener(
    "loadedmetadata",
    () => {
      updateEntry(video, entry);
      apply(video);
      schedule();
    },
    options,
  );
  video.addEventListener(
    "emptied",
    () => {
      updateEntry(video, entry);
      schedule();
    },
    options,
  );
  video.addEventListener(
    "play",
    () => {
      if (entry.companion) {
        video.pause();
        return;
      }
      apply(video);
      schedule();
    },
    options,
  );
  video.addEventListener(
    "ratechange",
    () => {
      apply(video);
    },
    options,
  );
  video.addEventListener(
    "volumechange",
    () => {
      apply(video);
      render();
    },
    options,
  );
  video.addEventListener(
    "timeupdate",
    () => {
      enforceLoop(video, entry);
      if (video === active) render();
    },
    options,
  );
  video.addEventListener(
    "ended",
    () => {
      if (
        settings.loopSections &&
        entry.start !== undefined &&
        entry.end !== undefined
      ) {
        video.currentTime = entry.start;
        void video.play().catch(() => {});
      } else if (video === active && settings.autoScroll && isReelPage())
        nextReel(video);
    },
    options,
  );
  video.addEventListener("pause", render, options);
  apply(video);
}
function enforceLoop(video: HTMLVideoElement, entry: Entry) {
  if (
    settings.enabled &&
    settings.loopSections &&
    entry.start !== undefined &&
    entry.end !== undefined &&
    !video.seeking &&
    (video.currentTime >= entry.end || video.currentTime < entry.start - 0.2)
  )
    video.currentTime = entry.start;
}
function nextReel(video: HTMLVideoElement) {
  if (advancing) return;
  advancing = true;
  const bounds = video.getBoundingClientRect();
  const owner = ownerFor(video);
  const next = [...entries]
    .filter(([candidate]) => candidate !== owner && candidate.isConnected)
    .map(([candidate, entry]) => ({
      owner: candidate,
      rect: playbackFor(candidate, entry).getBoundingClientRect(),
    }))
    .filter(
      ({ rect }) =>
        rect.width > 100 &&
        rect.height > 100 &&
        rect.top > bounds.top + bounds.height / 2,
    )
    .sort((a, b) => a.rect.top - b.rect.top)[0];
  if (next) next.owner.scrollIntoView({ behavior: "smooth", block: "center" });
  else {
    const button = [
      ...document.querySelectorAll<HTMLElement>('button, [role="button"]'),
    ].find(
      (el) =>
        /^(next|next reel)$/i.test(el.getAttribute("aria-label") || "") &&
        el.getBoundingClientRect().width > 0,
    );
    if (button) button.click();
    else {
      let parent = video.parentElement;
      while (
        parent &&
        !(
          parent.scrollHeight > parent.clientHeight + 100 &&
          /auto|scroll/.test(getComputedStyle(parent).overflowY)
        )
      )
        parent = parent.parentElement;
      if (parent)
        parent.scrollBy({
          top: Math.max(parent.clientHeight, bounds.height),
          behavior: "smooth",
        });
      else
        window.scrollBy({
          top: Math.max(innerHeight, bounds.height),
          behavior: "smooth",
        });
    }
  }
  window.setTimeout(() => {
    advancing = false;
    schedule();
  }, 1000);
}
function scan() {
  if (!ready || !settings.enabled) return;
  for (const video of document.querySelectorAll<HTMLVideoElement>(
    "video:not([data-lrc-companion])",
  ))
    addVideo(video);
  for (const [video, entry] of entries)
    if (!video.isConnected) {
      entry.cleanup();
      entries.delete(video);
    } else updateEntry(video, entry);
  selectActive();
}
function visibleScore(video: HTMLVideoElement) {
  const rect = video.getBoundingClientRect();
  if (
    rect.width < 90 ||
    rect.height < 90 ||
    getComputedStyle(video).visibility === "hidden" ||
    getComputedStyle(video).display === "none"
  )
    return 0;
  const width = Math.max(
    0,
    Math.min(innerWidth, rect.right) - Math.max(0, rect.left),
  );
  const height = Math.max(
    0,
    Math.min(innerHeight, rect.bottom) - Math.max(0, rect.top),
  );
  if (width * height < rect.width * rect.height * 0.15) return 0;
  return width * height * (video.paused ? 1 : 1.3);
}
function selectActive() {
  for (const entry of entries.values()) positionCompanion(entry);
  const videos = [...entries].map(([video, entry]) =>
    playbackFor(video, entry),
  );
  const full = document.fullscreenElement;
  if (nativeFullscreenVideo && nativeFullscreenVideo !== full) {
    nativeFullscreenVideo.controls =
      entryFor(nativeFullscreenVideo)?.originalControls ?? false;
    nativeFullscreenVideo = undefined;
  }
  const selected = videos
    .map((video) => ({
      video,
      score:
        !full || full === video || full.contains(video)
          ? visibleScore(video)
          : 0,
    }))
    .filter((v) => v.score > 0)
    .sort((a, b) => b.score - a.score)[0]?.video;
  if (selected !== active) {
    const oldEntry = active && entryFor(active);
    if (oldEntry?.companion && active === oldEntry.companion.video)
      removeCompanion(oldEntry, { restorePosition: true, resume: false });
    active = selected;
    dragging = false;
    ui("message").textContent = "";
  }
  if (!active || !settings.enabled) {
    host.style.display = "none";
    return;
  }
  // A native video fullscreen surface excludes sibling DOM controls.
  // Keep native controls available; our Full button uses a container instead.
  if (full instanceof HTMLVideoElement) {
    nativeFullscreenVideo = full;
    full.controls = true;
    host.style.display = "none";
    return;
  }
  const mount =
    full && !(full instanceof HTMLVideoElement)
      ? full
      : document.documentElement;
  if (host.parentNode !== mount) mount.append(host);
  const rect = active.getBoundingClientRect();
  const collapsed = root
    .querySelector(".panel")!
    .classList.contains("collapsed");
  const width = collapsed
    ? 40
    : Math.max(0, Math.min(460, Math.max(300, rect.width), innerWidth - 16));
  host.style.width = `${width}px`;
  const visibleLeft = Math.max(0, rect.left);
  const visibleRight = Math.min(innerWidth, rect.right);
  const left = collapsed
    ? visibleLeft +
      Math.max(0, Math.min(8, (visibleRight - visibleLeft - width) / 2))
    : rect.left + (rect.width - width) / 2;
  host.style.left = `${Math.max(8, Math.min(innerWidth - width - 8, left))}px`;
  host.style.display = "block";
  const panelHeight = host.getBoundingClientRect().height;
  const visibleTop = Math.max(0, rect.top);
  const visibleBottom = Math.min(innerHeight, rect.bottom);
  const top = collapsed
    ? visibleBottom - panelHeight - 8 >= visibleTop
      ? visibleBottom - panelHeight - 8
      : visibleTop + Math.max(0, (visibleBottom - visibleTop - panelHeight) / 2)
    : rect.bottom - panelHeight - 12;
  host.style.top = `${Math.max(8, Math.min(innerHeight - panelHeight - 8, top))}px`;
  if (fullscreenFit && full === fullscreenFit.target) fitFullscreenVideo();
  render();
  if (settings.preferHD) void upgradeQuality(false);
}
function qualityMessage(video: HTMLVideoElement, current = false) {
  const dimensions =
    video.videoWidth > 0 && video.videoHeight > 0
      ? `${video.videoWidth}×${video.videoHeight}`
      : "";
  if (current)
    return dimensions
      ? `Current video is already ${dimensions}.`
      : "Current video is already the best available quality.";
  return dimensions
    ? `Using ${dimensions}.`
    : "Using the best available source.";
}
function positionCompanion(entry: Entry) {
  const companion = entry.companion;
  if (
    !companion ||
    document.fullscreenElement === companion.container ||
    !companion.owner.isConnected
  )
    return;
  const full = document.fullscreenElement;
  const mount =
    full && (full === companion.owner || full.contains(companion.owner))
      ? full
      : document.documentElement;
  if (companion.container.parentNode !== mount)
    mount.append(companion.container);
  const rect = companion.owner.getBoundingClientRect();
  Object.assign(companion.container.style, {
    display: rect.width > 0 && rect.height > 0 ? "block" : "none",
    height: `${rect.height}px`,
    left: `${rect.left}px`,
    top: `${rect.top}px`,
    width: `${rect.width}px`,
  });
}
function removeCompanion(
  entry: Entry,
  options: { restorePosition: boolean; resume: boolean },
) {
  const companion = entry.companion;
  if (!companion) return;
  const cancel = entry.cancelQuality;
  entry.cancelQuality = undefined;
  cancel?.();
  const time = companion.ready
    ? companion.video.currentTime
    : companion.originalTime;
  const shouldResume =
    options.resume &&
    !(companion.ready ? companion.video.paused : companion.originalPaused);
  const currentOwnerSource =
    companion.owner.readyState === HTMLMediaElement.HAVE_NOTHING
      ? companion.owner.src
      : companion.owner.currentSrc || companion.owner.src;
  const sameSource = currentOwnerSource === companion.ownerSource;
  const ownsFullscreen = document.fullscreenElement === companion.container;
  if (fullscreenFit?.video === companion.video) clearFullscreenFit();
  if (ownsFullscreen) void document.exitFullscreen().catch(() => {});
  companion.events.abort();
  companion.video.pause();
  companion.video.removeAttribute("src");
  companion.video.load();
  companion.container.remove();
  restoreStyles(companion.owner, companion.originalStyles);
  companionOwners.delete(companion.video);
  entry.companion = undefined;
  entry.upgraded = undefined;
  if (active === companion.video) active = companion.owner;
  if (options.restorePosition && sameSource && companion.owner.isConnected) {
    try {
      companion.owner.currentTime = seekTime(time, 0, companion.owner.duration);
    } catch {
      // Some MSE players reject a seek while their source is being rebuilt.
    }
    apply(companion.owner);
    if (shouldResume) void companion.owner.play().catch(() => {});
    else companion.owner.pause();
  }
}
function bindCompanionEvents(companion: QualityCompanion, entry: Entry) {
  const video = companion.video;
  const options = { signal: companion.events.signal };
  video.addEventListener(
    "play",
    () => {
      apply(video);
      schedule();
    },
    options,
  );
  video.addEventListener("ratechange", () => apply(video), options);
  video.addEventListener(
    "volumechange",
    () => {
      apply(video);
      render();
    },
    options,
  );
  video.addEventListener(
    "timeupdate",
    () => {
      enforceLoop(video, entry);
      if (video === active) render();
    },
    options,
  );
  video.addEventListener(
    "ended",
    () => {
      if (
        settings.loopSections &&
        entry.start !== undefined &&
        entry.end !== undefined
      ) {
        video.currentTime = entry.start;
        void video.play().catch(() => {});
      } else if (video === active && settings.autoScroll && isReelPage())
        nextReel(video);
    },
    options,
  );
  video.addEventListener("pause", render, options);
}
function createQualityCompanion(
  owner: HTMLVideoElement,
  entry: Entry,
  source: string,
  manual: boolean,
) {
  for (const other of entries.values())
    if (other !== entry && other.companion)
      removeCompanion(other, { restorePosition: true, resume: false });
  removeCompanion(entry, { restorePosition: true, resume: false });
  const container = document.createElement("div");
  container.setAttribute("data-lrc-quality-companion", "");
  Object.assign(container.style, {
    background: "#000",
    margin: "0",
    overflow: "hidden",
    padding: "0",
    pointerEvents: "auto",
    position: "fixed",
    zIndex: "2147483645",
  });
  const video = document.createElement("video");
  video.setAttribute("data-lrc-companion", "");
  video.setAttribute(
    "aria-label",
    owner.getAttribute("aria-label") || "HD video playback",
  );
  video.playsInline = true;
  video.preload = "auto";
  video.muted = owner.muted;
  video.volume = owner.volume;
  video.playbackRate = owner.playbackRate;
  Object.assign(video.style, {
    display: "block",
    height: "100%",
    margin: "0",
    objectFit: getComputedStyle(owner).objectFit || "contain",
    width: "100%",
  });
  container.style.borderRadius = getComputedStyle(owner).borderRadius;
  container.append(video);
  const originalStyles = new Map<string, SavedStyle>();
  const companion: QualityCompanion = {
    container,
    events: new AbortController(),
    originalPaused: owner.paused,
    originalStyles,
    originalTime: owner.currentTime,
    owner,
    ownerHeight: owner.videoHeight,
    ownerSource:
      owner.readyState === HTMLMediaElement.HAVE_NOTHING
        ? owner.src
        : owner.currentSrc || owner.src,
    ownerWidth: owner.videoWidth,
    ready: false,
    source,
    video,
  };
  entry.companion = companion;
  entry.upgraded = source;
  companionOwners.set(video, owner);
  bindCompanionEvents(companion, entry);
  const full = document.fullscreenElement;
  const mount = full && full.contains(owner) ? full : document.documentElement;
  mount.append(container);
  positionCompanion(entry);
  owner.pause();
  setTemporaryStyle(owner, originalStyles, "visibility", "hidden");
  setTemporaryStyle(owner, originalStyles, "pointer-events", "none");
  active = video;
  let timer = 0;
  const settle = () => {
    clearTimeout(timer);
    if (entry.cancelQuality === settle) entry.cancelQuality = undefined;
  };
  const failed = () => {
    if (entry.companion !== companion) return;
    settle();
    entry.failedHD = source;
    removeCompanion(entry, { restorePosition: true, resume: true });
    if (manual)
      tell("The quality source failed. Restored the previous video source.");
    schedule();
  };
  video.addEventListener("error", failed, { signal: companion.events.signal });
  video.addEventListener(
    "loadedmetadata",
    () => {
      if (entry.companion !== companion) return;
      settle();
      const ownerArea = Math.max(
        companion.ownerWidth * companion.ownerHeight,
        owner.videoWidth * owner.videoHeight,
      );
      const companionArea = video.videoWidth * video.videoHeight;
      if (ownerArea > 0 && companionArea > 0 && companionArea <= ownerArea) {
        entry.notHigherHD = source;
        removeCompanion(entry, { restorePosition: true, resume: true });
        if (manual) tell(qualityMessage(owner, true));
        schedule();
        return;
      }
      video.currentTime = seekTime(companion.originalTime, 0, video.duration);
      companion.ready = true;
      apply(video);
      if (!companion.originalPaused) void video.play().catch(() => {});
      if (manual) tell(qualityMessage(video));
      schedule();
    },
    { once: true, signal: companion.events.signal },
  );
  entry.cancelQuality = settle;
  timer = window.setTimeout(failed, 12000);
  video.src = source;
}
function matchRecord(video: HTMLVideoElement): MediaRecord | undefined {
  const container =
    video.closest("article") || video.parentElement?.parentElement;
  const link = container?.querySelector<HTMLAnchorElement>(
    'a[href*="/reel/"], a[href*="/reels/"], a[href*="/p/"]',
  )?.pathname;
  return matchMediaRecord(records.values(), {
    source:
      video.readyState === HTMLMediaElement.HAVE_NOTHING
        ? video.src
        : video.currentSrc || video.src,
    poster: video.poster,
    mediaId: video.getAttribute("data-lrc-media-id") || undefined,
    code:
      video.getAttribute("data-lrc-media-code") ||
      shortcodeFromPath(link || location.pathname),
  });
}
async function upgradeQuality(manual: boolean) {
  if (!active) return;
  const owner = ownerFor(active);
  const entry = entries.get(owner);
  if (!entry) return;
  const video = playbackFor(owner, entry);
  const source = bestSource(matchRecord(owner)?.sources || []);
  if (!source) {
    if (manual)
      tell(
        "No alternate quality source is available yet. Reload the page to capture video metadata.",
      );
    return;
  }
  if (source.url === video.currentSrc || entry.upgraded === source.url) {
    if (manual) tell(qualityMessage(video));
    return;
  }
  if (entry.notHigherHD === source.url) {
    if (manual) tell(qualityMessage(owner, true));
    return;
  }
  if (!manual && entry.failedHD === source.url) return;
  const oldSource = owner.currentSrc || owner.src;
  if (oldSource.startsWith("blob:")) {
    if (
      owner.readyState < HTMLMediaElement.HAVE_METADATA ||
      !owner.videoWidth ||
      !owner.videoHeight
    ) {
      if (manual) tell("Waiting for video quality information.");
      return;
    }
    createQualityCompanion(owner, entry, source.url, manual);
    return;
  }
  const time = owner.currentTime;
  const wasPaused = owner.paused;
  const loopStart = entry.start,
    loopEnd = entry.end;
  entry.cancelQuality?.();
  entry.upgraded = source.url;
  entry.source = source.url;
  owner.src = source.url;
  let timer = 0;
  const settle = () => {
    clearTimeout(timer);
    owner.removeEventListener("loadedmetadata", loaded);
    owner.removeEventListener("error", failed);
    owner.removeEventListener("loadedmetadata", restored);
    entry.cancelQuality = undefined;
  };
  const restored = () => {
    settle();
    if (!settings.enabled || !owner.isConnected || owner.src !== oldSource)
      return;
    owner.currentTime = seekTime(time, 0, owner.duration);
    apply(owner);
    if (!wasPaused) void owner.play().catch(() => {});
  };
  const loaded = () => {
    settle();
    if (!settings.enabled || !owner.isConnected || owner.src !== source.url)
      return;
    owner.currentTime = seekTime(time, 0, owner.duration);
    entry.start = loopStart;
    entry.end = loopEnd;
    apply(owner);
    if (!wasPaused) void owner.play().catch(() => {});
    if (manual) tell(qualityMessage(owner));
  };
  const failed = () => {
    settle();
    entry.failedHD = source.url;
    entry.upgraded = undefined;
    if (!settings.enabled || !owner.isConnected || owner.src !== source.url)
      return;
    entry.source = oldSource;
    owner.src = oldSource;
    owner.addEventListener("loadedmetadata", restored, { once: true });
    entry.cancelQuality = settle;
    timer = window.setTimeout(settle, 12000);
    if (manual)
      tell("The quality source failed. Restored the previous video source.");
  };
  owner.addEventListener("loadedmetadata", loaded, { once: true });
  owner.addEventListener("error", failed, { once: true });
  entry.cancelQuality = settle;
  timer = window.setTimeout(failed, 12000);
}
function setRangeFill(input: HTMLInputElement, ratio: number): void {
  const value = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0;
  input.style.setProperty("--fill", `${value * 100}%`);
}
function render() {
  const video = active;
  if (!video) return;
  const entry = entryFor(video);
  if (!entry) return;
  const duration = video.duration;
  seek.disabled = !Number.isFinite(duration) || duration <= 0;
  seek.max = String(Number.isFinite(duration) ? duration : 0);
  if (!dragging) seek.value = String(video.currentTime || 0);
  const seekMax = Number(seek.max);
  setRangeFill(seek, seekMax > 0 ? Number(seek.value) / seekMax : 0);
  ui("time").textContent =
    `${formatTime(video.currentTime)} / ${formatTime(duration)}`;
  ui("play").textContent = video.paused ? "Play" : "Pause";
  ui("play").setAttribute("aria-label", video.paused ? "Play" : "Pause");
  ui("mute").textContent = video.muted ? "Unmute" : "Mute";
  ui("mute").setAttribute("aria-label", video.muted ? "Unmute" : "Mute");
  volume.value = String(video.volume);
  setRangeFill(volume, video.volume);
  speed.value = String(video.playbackRate);
  ui("loop-controls").hidden = !settings.loopSections;
  ui("loop-state").textContent =
    entry.start === undefined
      ? "No section loop"
      : `${formatTime(entry.start)} → ${entry.end === undefined ? "set B" : formatTime(entry.end)}`;
}
function loopPoint(which: "start" | "end" | "clear") {
  if (!active || !settings.loopSections) return;
  const entry = entryFor(active)!;
  if (which === "clear") {
    entry.start = undefined;
    entry.end = undefined;
  } else if (which === "start") {
    entry.start = active.currentTime;
    entry.end = undefined;
  } else if (
    entry.start === undefined ||
    active.currentTime <= entry.start + 0.15
  ) {
    tell("Set A first, then set B at least 0.15 seconds later.");
    return;
  } else entry.end = active.currentTime;
  render();
}
function togglePlay() {
  if (active?.paused)
    void active
      .play()
      .catch(() => tell("Click the video once to allow playback."));
  else active?.pause();
}
function toggleMute() {
  if (!active) return;
  const muted = !active.muted;
  active.muted = muted;
  void save({ muted });
  render();
}
function setTemporaryStyle(
  element: HTMLElement,
  saved: Map<string, SavedStyle>,
  property: string,
  value: string,
) {
  if (!saved.has(property))
    saved.set(property, {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    });
  element.style.setProperty(property, value, "important");
}
function restoreStyles(element: HTMLElement, saved: Map<string, SavedStyle>) {
  for (const [property, previous] of saved) {
    if (previous.value)
      element.style.setProperty(property, previous.value, previous.priority);
    else element.style.removeProperty(property);
  }
}
function clearFullscreenFit() {
  if (!fullscreenFit) return;
  restoreStyles(fullscreenFit.target, fullscreenFit.targetStyles);
  restoreStyles(fullscreenFit.video, fullscreenFit.videoStyles);
  fullscreenFit = undefined;
}
function fitFullscreenVideo() {
  const fit = fullscreenFit;
  if (!fit || document.fullscreenElement !== fit.target) return;
  const targetStyles: Record<string, string> = {
    "align-items": "center",
    background: "#000",
    border: "0",
    "box-sizing": "border-box",
    display: "flex",
    height: "100vh",
    "justify-content": "center",
    margin: "0",
    "max-height": "none",
    "max-width": "none",
    "min-height": "0",
    "min-width": "0",
    overflow: "hidden",
    padding: "0",
    transform: "none",
    width: "100vw",
  };
  for (const [property, value] of Object.entries(targetStyles))
    setTemporaryStyle(fit.target, fit.targetStyles, property, value);
  const viewportWidth = Math.max(1, fit.target.clientWidth || innerWidth);
  const viewportHeight = Math.max(1, fit.target.clientHeight || innerHeight);
  const current = fit.video.getBoundingClientRect();
  const sourceWidth = fit.video.videoWidth || current.width || 1;
  const sourceHeight = fit.video.videoHeight || current.height || 1;
  const ratio = sourceWidth / sourceHeight;
  const width = Math.min(viewportWidth, viewportHeight * ratio);
  const height = width / ratio;
  const videoStyles: Record<string, string> = {
    "box-sizing": "border-box",
    display: "block",
    flex: "0 0 auto",
    height: `${height}px`,
    inset: "auto",
    margin: "0",
    "max-height": "none",
    "max-width": "none",
    "min-height": "0",
    "min-width": "0",
    "object-fit": "contain",
    position: "relative",
    transform: "none",
    width: `${width}px`,
  };
  for (const [property, value] of Object.entries(videoStyles))
    setTemporaryStyle(fit.video, fit.videoStyles, property, value);
}
function fullscreen() {
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
    return;
  }
  const video = active;
  const target = video?.parentElement;
  if (!video || !target) return;
  clearFullscreenFit();
  const fit: FullscreenFit = {
    target,
    video,
    targetStyles: new Map(),
    videoStyles: new Map(),
  };
  fullscreenFit = fit;
  void target
    .requestFullscreen()
    .then(() => {
      if (fullscreenFit === fit) fitFullscreenVideo();
    })
    .catch(() => {
      if (fullscreenFit === fit) clearFullscreenFit();
      tell("Fullscreen is unavailable for this video.");
    });
}
async function download() {
  if (!active) return;
  const owner = ownerFor(active);
  const record = matchRecord(owner);
  const url =
    bestSource(record?.sources || [])?.url ||
    safeMediaUrl(active.currentSrc || active.src) ||
    safeMediaUrl(owner.currentSrc || owner.src);
  if (!url) {
    tell(
      "No direct download source is available. Reload the page and play this video once.",
    );
    return;
  }
  try {
    const reply = await chrome.runtime.sendMessage({
      type: "video:download",
      url,
      id: record?.code || record?.id,
    });
    tell(
      reply?.ok
        ? "Download requested. Check your browser downloads."
        : reply?.error || "The download did not start.",
    );
  } catch {
    tell("The download did not start. Reload the extension and try again.");
  }
}
function schedule() {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    scan();
  });
}
ui("play").addEventListener("click", togglePlay);
ui("mute").addEventListener("click", toggleMute);
ui("fullscreen").addEventListener("click", fullscreen);
ui("download").addEventListener("click", () => {
  void download();
});
ui("hd").addEventListener("click", () => {
  void upgradeQuality(true);
});
ui("loop-start").addEventListener("click", () => loopPoint("start"));
ui("loop-end").addEventListener("click", () => loopPoint("end"));
ui("loop-clear").addEventListener("click", () => loopPoint("clear"));
ui("collapse").addEventListener("click", () => {
  const collapsed = root.querySelector(".panel")!.classList.toggle("collapsed");
  const label = collapsed ? "Expand controls" : "Collapse controls";
  ui("collapse").textContent = collapsed ? "☰" : "−";
  ui("collapse").setAttribute("aria-label", label);
  ui("collapse").setAttribute("title", label);
  ui("collapse").setAttribute("aria-expanded", String(!collapsed));
  schedule();
});
seek.addEventListener("pointerdown", () => {
  dragging = true;
});
seek.addEventListener("input", () => {
  if (active) active.currentTime = Number(seek.value);
  const seekMax = Number(seek.max);
  setRangeFill(seek, seekMax > 0 ? Number(seek.value) / seekMax : 0);
});
for (const event of ["pointerup", "pointercancel", "change", "blur"])
  seek.addEventListener(event, () => {
    dragging = false;
  });
volume.addEventListener("input", () => {
  setRangeFill(volume, Number(volume.value));
  if (active) {
    active.volume = Number(volume.value);
    active.muted = active.volume === 0;
    void save({ volume: active.volume, muted: active.muted });
  }
});
speed.addEventListener("change", () => {
  if (active) {
    active.playbackRate = Number(speed.value);
    void save({ speed: active.playbackRate });
  }
});
for (const event of [
  "click",
  "dblclick",
  "pointerdown",
  "pointerup",
  "keydown",
])
  host.addEventListener(event, (e) => e.stopPropagation());
document.addEventListener(
  "keydown",
  (event) => {
    if (
      !settings.enabled ||
      !active ||
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      event.isComposing ||
      event.defaultPrevented
    )
      return;
    const target = event.composedPath()[0];
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable ||
        target.closest(
          'input, textarea, select, [role="textbox"], [contenteditable]:not([contenteditable="false"])',
        ) ||
        root.contains(target as Node))
    )
      return;
    const key = event.key.toLowerCase();
    const loop = settings.loopSections && ["[", "]", "\\"].includes(key);
    if (
      !loop &&
      (!settings.shortcuts || !["a", "s", "d", "m", "f"].includes(key))
    )
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (key === "a" || key === "d") {
      active.currentTime = seekTime(
        active.currentTime,
        key === "a" ? -5 : 5,
        active.duration,
      );
    }
    if (key === "s" && !event.repeat) togglePlay();
    if (key === "m" && !event.repeat) toggleMute();
    if (key === "f" && !event.repeat) fullscreen();
    if (key === "[") loopPoint("start");
    if (key === "]") loopPoint("end");
    if (key === "\\") loopPoint("clear");
  },
  true,
);
const observer = new MutationObserver((mutations) => {
  if (mutations.some((m) => m.target !== host && !host.contains(m.target)))
    schedule();
});
function configure() {
  observer.disconnect();
  if (settings.enabled) {
    observer.observe(document, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "src",
        "poster",
        "loop",
        "data-lrc-media-id",
        "data-lrc-media-code",
      ],
    });
    applyAll();
  } else {
    const ownFullscreen = document.fullscreenElement === fullscreenFit?.target;
    clearFullscreenFit();
    if (ownFullscreen) void document.exitFullscreen().catch(() => {});
    for (const [video, entry] of entries) {
      entry.cleanup();
      video.loop = entry.originalLoop;
    }
    entries.clear();
    active = undefined;
    host.remove();
  }
}
window.addEventListener("message", (event) => {
  if (
    event.source !== window ||
    event.origin !== location.origin ||
    event.data?.tag !== BRIDGE_TAG ||
    !Array.isArray(event.data.records)
  )
    return;
  for (const value of event.data.records.slice(0, 100)) {
    const record = sanitizeRecord(value);
    if (record) {
      records.delete(record.id);
      records.set(record.id, record);
    }
  }
  while (records.size > 300) records.delete(records.keys().next().value!);
  schedule();
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes[SETTINGS_KEY]) {
    settings = normalizeSettings(changes[SETTINGS_KEY].newValue);
    configure();
  }
});
for (const event of [
  "scroll",
  "resize",
  "fullscreenchange",
  "popstate",
  "visibilitychange",
])
  window.addEventListener(event, schedule, { capture: true, passive: true });
document.addEventListener("fullscreenchange", () => {
  if (fullscreenFit) {
    if (document.fullscreenElement === fullscreenFit.target)
      fitFullscreenVideo();
    else clearFullscreenFit();
  }
  schedule();
});
function tick() {
  if (settings.enabled && active && !document.hidden) {
    const entry = entryFor(active);
    if (entry) enforceLoop(active, entry);
  }
  frame = requestAnimationFrame(tick);
}
window.addEventListener("pagehide", () => {
  cancelAnimationFrame(frame);
  observer.disconnect();
});
window.addEventListener("pageshow", () => {
  cancelAnimationFrame(frame);
  tick();
  if (ready) configure();
});
void readSettings()
  .then((value) => {
    settings = value;
  })
  .catch(() => {})
  .finally(() => {
    ready = true;
    configure();
    window.postMessage({ tag: BRIDGE_TAG, type: "request" }, location.origin);
    cancelAnimationFrame(frame);
    tick();
  });
