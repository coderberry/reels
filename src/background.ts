import { normalizeSettings, SETTINGS_KEY } from "./settings";
import { safeMediaUrl } from "./core";

let writes = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === "settings:update") {
    writes = writes
      .then(async () => {
        const stored = await chrome.storage.local.get(SETTINGS_KEY);
        const current = normalizeSettings(stored[SETTINGS_KEY]);
        const settings = normalizeSettings({ ...current, ...message.patch });
        await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
        respond({ ok: true, settings });
      })
      .catch(() => {
        respond({
          ok: false,
          error: "Could not save settings. Reload the extension and try again.",
        });
      });
    return true;
  }
  if (message?.type === "video:download") {
    const url = safeMediaUrl(message.url);
    if (
      !url ||
      !sender.tab ||
      !sender.url?.startsWith("https://www.instagram.com/")
    ) {
      respond({
        ok: false,
        error: "This video does not have a supported download URL.",
      });
      return;
    }
    const id =
      typeof message.id === "string"
        ? message.id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)
        : "";
    chrome.downloads.download(
      { url, filename: `instagram-${id || Date.now()}.mp4`, saveAs: true },
      (downloadId) => {
        const error = chrome.runtime.lastError;
        respond(
          error
            ? { ok: false, error: error.message }
            : { ok: true, downloadId },
        );
      },
    );
    return true;
  }
});
