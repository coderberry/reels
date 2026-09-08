import {
  test as base,
  expect,
  chromium,
  type BrowserContext,
  type Worker,
  type Page,
} from "@playwright/test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { defaults } from "../src/settings";

const media = "https://scontent.cdninstagram.com/fixture.mp4";
const highMedia = "https://scontent.cdninstagram.com/fixture-hd.mp4";
const poster = "https://scontent.cdninstagram.com/fixture.jpg";
const metadata = {
  pk: "101",
  code: "fixture",
  image_versions2: { candidates: [{ url: poster }] },
  video_versions: [
    { url: media, width: 360, height: 640 },
    { url: highMedia, width: 720, height: 1280 },
  ],
};
const test = base.extend<{
  context: BrowserContext;
  worker: Worker;
  page: Page;
  popup: Page;
}>({
  // Playwright requires destructuring for fixtures with no dependencies.
  // eslint-disable-next-line no-empty-pattern
  context: async ({}, use) => {
    const profile = await mkdtemp(path.join(tmpdir(), "local-reels-e2e-"));
    const extension = path.resolve("dist");
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: true,
      viewport: { width: 1100, height: 850 },
      acceptDownloads: true,
      args: [
        `--disable-extensions-except=${extension}`,
        `--load-extension=${extension}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    const lowVideo = await readFile("tests/fixtures/video.mp4");
    const highVideo = await readFile("tests/fixtures/video-hd.mp4");
    const mseVideo = await readFile("tests/fixtures/video-mse.mp4");
    await context.route(
      "https://scontent.cdninstagram.com/**",
      async (route) => {
        if (route.request().url().includes(".mp4")) {
          const video = route.request().url().includes("fixture-mse.mp4")
            ? mseVideo
            : /(?:fixture-hd|other-reel)\.mp4/.test(route.request().url())
              ? highVideo
              : lowVideo;
          const range = route
            .request()
            .headers()
            .range?.match(/bytes=(\d+)-(\d*)/);
          const start = range ? Number(range[1]) : 0;
          const end = range?.[2]
            ? Math.min(Number(range[2]), video.length - 1)
            : video.length - 1;
          await route.fulfill({
            status: range ? 206 : 200,
            headers: {
              "Content-Type": "video/mp4",
              "Access-Control-Allow-Origin": "*",
              "Accept-Ranges": "bytes",
              "Content-Length": String(end - start + 1),
              ...(range
                ? { "Content-Range": `bytes ${start}-${end}/${video.length}` }
                : {}),
            },
            body: video.subarray(start, end + 1),
          });
        } else await route.fulfill({ status: 204 });
      },
    );
    await context.route("https://www.instagram.com/**", async (route) => {
      if (route.request().resourceType() === "document")
        await route.fulfill({
          contentType: "text/html",
          body: `<!doctype html><html><head><meta charset="utf-8"><title>Reels fixture</title><style>body{margin:0;background:#111820;color:#fff;font:16px system-ui} article{height:900px;display:flex;justify-content:center;position:relative} video{width:360px;height:640px;margin:30px;object-fit:cover} input{position:fixed;left:8px;top:8px;width:160px} </style></head><body><input aria-label="Comment" placeholder="Write a comment"><article><video id="first" loop preload="auto" src="${media}" poster="${poster}"></video></article><article><video id="second" loop preload="auto" src="${media}?second=1"></video></article></body></html>`,
        });
      else
        await route.fulfill({
          contentType: "application/json",
          body: JSON.stringify({ items: [metadata] }),
        });
    });
    await use(context);
    await context.close();
    await rm(profile, { recursive: true, force: true });
  },
  worker: async ({ context }, use) => {
    const worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    await worker.evaluate(
      (settings) => chrome.storage.local.set({ settings }),
      { ...defaults, preferHD: false },
    );
    await use(worker);
  },
  page: async ({ context, worker }, use) => {
    void worker;
    const page = await context.newPage();
    await page.goto("https://www.instagram.com/reels/fixture/");
    await expect(page.locator("#local-reel-controls")).toBeVisible();
    await page.waitForFunction(
      () => document.querySelector("video")!.readyState >= 1,
    );
    await use(page);
  },
  popup: async ({ context, worker }, use) => {
    const page = await context.newPage();
    const id = new URL(worker.url()).host;
    await page.goto(`chrome-extension://${id}/popup.html`);
    await expect(page.locator("#settings")).toBeEnabled();
    await use(page);
  },
});

test("popup saves local settings and handles quick independent updates", async ({
  popup,
  worker,
}) => {
  await popup.locator("#speed").selectOption("1.5");
  await popup.locator("#autoScroll").check();
  await expect
    .poll(async () =>
      worker.evaluate(
        async () => (await chrome.storage.local.get("settings")).settings,
      ),
    )
    .toMatchObject({ speed: 1.5, autoScroll: true });
  await popup.reload();
  await expect(popup.locator("#speed")).toHaveValue("1.5");
  await expect(popup.locator("#autoScroll")).toBeChecked();
  await popup.screenshot({ path: "artifacts/popup.png", fullPage: true });
});

test("real video controls seek, play, set speed and remember volume", async ({
  page,
  worker,
}) => {
  const panel = page.locator("#local-reel-controls");
  await panel.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(false);
  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  await panel
    .getByRole("slider", { name: "Seek video" })
    .evaluate((input: HTMLInputElement) => {
      input.value = "6";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(6, 0);
  await panel.getByLabel("Playback speed").selectOption("2");
  await panel
    .getByRole("slider", { name: "Volume", exact: true })
    .evaluate((input: HTMLInputElement) => {
      input.value = "0.4";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await expect
    .poll(async () =>
      worker.evaluate(
        async () => (await chrome.storage.local.get("settings")).settings,
      ),
    )
    .toMatchObject({ speed: 2, volume: 0.4, muted: false });
  await page.locator("#second").scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      page.locator("#second").evaluate((v: HTMLVideoElement) => ({
        speed: v.playbackRate,
        volume: v.volume,
        muted: v.muted,
      })),
    )
    .toEqual({ speed: 2, volume: 0.4, muted: false });
  await page.screenshot({ path: "artifacts/controls.png" });
});

test("shortcuts seek and mute but leave text fields unchanged", async ({
  page,
}) => {
  await page.locator("#first").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 6;
  });
  await page.keyboard.press("d");
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(11, 0);
  await page.keyboard.press("a");
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(6, 0);
  await page.getByRole("textbox", { name: "Comment" }).fill("");
  await page.keyboard.type("asdfm[]");
  await expect(page.getByRole("textbox")).toHaveValue("asdfm[]");
  expect(
    await page
      .locator("#first")
      .evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBeCloseTo(6, 0);
});

test("section loops set boundaries, repeat, and clear", async ({ page }) => {
  await page.locator("#first").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 2;
  });
  await page.keyboard.press("[");
  await page.locator("#first").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 4;
  });
  await page.keyboard.press("]");
  await expect(page.locator("#local-reel-controls #loop-state")).toHaveText(
    "0:02 → 0:04",
  );
  await page.locator("#first").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 4.5;
  });
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(2, 0);
  await page.keyboard.press("\\");
  await expect(page.locator("#local-reel-controls #loop-state")).toHaveText(
    "No section loop",
  );
});

test("auto-scroll advances reels and disabling restores native looping", async ({
  page,
  popup,
}) => {
  await popup.locator("#autoScroll").check();
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.loop),
    )
    .toBe(false);
  await page
    .locator("#first")
    .evaluate((v: HTMLVideoElement) => v.dispatchEvent(new Event("ended")));
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBeGreaterThan(600);
  await popup.locator("#enabled").uncheck();
  await expect(page.locator("#local-reel-controls")).toHaveCount(0);
  expect(
    await page.locator("#first").evaluate((v: HTMLVideoElement) => v.loop),
  ).toBe(true);
  await popup.locator("#enabled").check();
  await expect(page.locator("#local-reel-controls")).toBeVisible();
});

test("quality detection preserves normal fetch response and selects matching source", async ({
  page,
  popup,
}) => {
  await page.locator("#first").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 5;
  });
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(5, 0);
  const result = await page.evaluate(async () =>
    (await fetch("/api/v1/feed/fixture/")).json(),
  );
  expect(result.items[0].pk).toBe("101");
  await popup.locator("#preferHD").check();
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.currentSrc),
    )
    .toBe(highMedia);
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(5, 0);
  expect(
    await page.locator("#first").evaluate((v: HTMLVideoElement) => v.paused),
  ).toBe(true);
});

test("ambiguous carousel metadata does not replace the visible video", async ({
  page,
  popup,
}) => {
  await page.evaluate(() => {
    const data = document.createElement("script");
    data.type = "application/json";
    data.textContent = JSON.stringify({
      code: "fixture",
      carousel_media: [
        {
          pk: "201",
          video_versions: [
            {
              url: "https://scontent.cdninstagram.com/other-a.mp4",
              width: 1080,
              height: 1920,
            },
          ],
        },
        {
          pk: "202",
          video_versions: [
            {
              url: "https://scontent.cdninstagram.com/other-b.mp4",
              width: 1080,
              height: 1920,
            },
          ],
        },
      ],
    });
    document.body.append(data);
  });
  await popup.locator("#preferHD").check();
  await page
    .locator("#local-reel-controls")
    .getByRole("button", { name: "Use highest quality" })
    .click();
  await expect(page.locator("#local-reel-controls #message")).toContainText(
    "No alternate quality",
  );
  expect(
    await page
      .locator("#first")
      .evaluate((v: HTMLVideoElement) => v.currentSrc),
  ).toBe(media);
});

test("detached video nodes are cleaned up and new ones get controls", async ({
  page,
}) => {
  await page.locator("#first").evaluate((v: HTMLVideoElement) => v.remove());
  await page.evaluate((source) => {
    const v = document.createElement("video");
    v.id = "new-video";
    v.src = source;
    document.querySelector("article")!.append(v);
  }, media);
  await expect(page.locator("#local-reel-controls")).toBeVisible();
  await page.waitForFunction(
    () =>
      (document.getElementById("new-video") as HTMLVideoElement).readyState >=
      1,
  );
  await page
    .locator("#local-reel-controls")
    .getByLabel("Playback speed")
    .selectOption("1.5");
  await expect
    .poll(() =>
      page
        .locator("#new-video")
        .evaluate((v: HTMLVideoElement) => v.playbackRate),
    )
    .toBe(1.5);
});

test("fullscreen keeps controls accessible", async ({ page }) => {
  await page
    .locator("#local-reel-controls")
    .getByRole("button", { name: "Fullscreen", exact: true })
    .click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Boolean(
          document.fullscreenElement?.contains(
            document.getElementById("local-reel-controls"),
          ),
        ),
      ),
    )
    .toBe(true);
  await expect(page.locator("#local-reel-controls")).toBeVisible();
});

test("fullscreen fits portrait and landscape video without changing its aspect ratio", async ({
  page,
}) => {
  await page.locator("#first").evaluate((video: HTMLVideoElement) => {
    const parent = video.parentElement!;
    parent.style.cssText =
      "display:grid;transform:scale(.72);overflow:clip;margin:13px";
    video.style.cssText =
      "width:223px!important;height:321px;max-width:188px;object-fit:cover;transform:scale(.8)";
  });
  const originalStyles = await page.locator("#first").evaluate((video) => ({
    parent: video.parentElement!.getAttribute("style"),
    video: video.getAttribute("style"),
  }));

  const fullscreen = page
    .locator("#local-reel-controls")
    .getByRole("button", { name: "Fullscreen", exact: true });
  await fullscreen.click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  const portrait = await page
    .locator("#first")
    .evaluate((video: HTMLVideoElement) => {
      const rect = video.getBoundingClientRect();
      return {
        height: rect.height,
        ratio: rect.width / rect.height,
        sourceRatio: video.videoWidth / video.videoHeight,
        viewportHeight: innerHeight,
        xCenter: rect.left + rect.width / 2,
        viewportXCenter: innerWidth / 2,
      };
    });
  expect(portrait.sourceRatio).toBeLessThan(1);
  expect(portrait.ratio).toBeCloseTo(portrait.sourceRatio, 2);
  expect(portrait.height).toBeCloseTo(portrait.viewportHeight, 0);
  expect(portrait.xCenter).toBeCloseTo(portrait.viewportXCenter, 0);

  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await expect
    .poll(() =>
      page.locator("#first").evaluate((video) => ({
        parent: video.parentElement!.getAttribute("style"),
        video: video.getAttribute("style"),
      })),
    )
    .toEqual(originalStyles);

  await page.locator("#first").evaluate((video: HTMLVideoElement) => {
    video.removeAttribute("src");
    video.load();
    video.style.setProperty("width", "480px", "important");
    video.style.height = "270px";
    video.style.maxWidth = "none";
  });
  await expect
    .poll(() =>
      page
        .locator("#first")
        .evaluate((video: HTMLVideoElement) => video.videoWidth),
    )
    .toBe(0);
  await fullscreen.click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  const landscape = await page
    .locator("#first")
    .evaluate((video: HTMLVideoElement) => {
      const rect = video.getBoundingClientRect();
      return {
        ratio: rect.width / rect.height,
        sourceRatio:
          video.videoWidth && video.videoHeight
            ? video.videoWidth / video.videoHeight
            : 480 / 270,
        viewportWidth: innerWidth,
        width: rect.width,
        yCenter: rect.top + rect.height / 2,
        viewportYCenter: innerHeight / 2,
      };
    });
  expect(landscape.sourceRatio).toBeGreaterThan(1);
  expect(landscape.ratio).toBeCloseTo(landscape.sourceRatio, 2);
  expect(landscape.width).toBeCloseTo(landscape.viewportWidth, 0);
  expect(landscape.yCenter).toBeCloseTo(landscape.viewportYCenter, 0);
  await page.evaluate(() => document.exitFullscreen());
});

test("disabling while fullscreen exits and restores site styles", async ({
  page,
  worker,
}) => {
  const original = await page.locator("#first").evaluate((video) => {
    video.parentElement!.style.cssText =
      "display:grid;overflow:clip;transform:translateX(7px)";
    video.style.cssText = "width:222px;height:333px;object-fit:cover";
    return {
      parent: video.parentElement!.getAttribute("style"),
      video: video.getAttribute("style"),
    };
  });
  await page
    .locator("#local-reel-controls")
    .getByRole("button", { name: "Fullscreen", exact: true })
    .click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await worker.evaluate(async () => {
    const stored = await chrome.storage.local.get("settings");
    await chrome.storage.local.set({
      settings: {
        ...(stored.settings as Record<string, unknown>),
        enabled: false,
      },
    });
  });
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await expect(page.locator("#local-reel-controls")).toHaveCount(0);
  expect(
    await page.locator("#first").evaluate((video) => ({
      parent: video.parentElement!.getAttribute("style"),
      video: video.getAttribute("style"),
    })),
  ).toEqual(original);
});

test("collapsed controls become a bounded bottom-left expand icon", async ({
  page,
}) => {
  await page.locator("#first").evaluate((video) => {
    video.style.width = "96px";
    scrollTo(0, 100);
  });
  const panel = page.locator("#local-reel-controls");
  await panel
    .getByRole("button", { name: "Collapse controls", exact: true })
    .click();
  const expand = panel.getByRole("button", {
    name: "Expand controls",
    exact: true,
  });
  await expect(expand).toBeVisible();
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeCloseTo(40, 0);
  const bounds = await page.evaluate(() => {
    const video = document.getElementById("first")!.getBoundingClientRect();
    const panel = document
      .getElementById("local-reel-controls")!
      .getBoundingClientRect();
    return {
      panel: {
        bottom: panel.bottom,
        height: panel.height,
        left: panel.left,
        top: panel.top,
        width: panel.width,
      },
      video: {
        bottom: Math.min(innerHeight, video.bottom),
        left: Math.max(0, video.left),
        top: Math.max(0, video.top),
      },
    };
  });
  expect(bounds.panel.width).toBeCloseTo(40, 0);
  expect(bounds.panel.height).toBeCloseTo(40, 0);
  expect(bounds.panel.left).toBeGreaterThanOrEqual(bounds.video.left);
  expect(bounds.panel.top).toBeGreaterThanOrEqual(bounds.video.top);
  expect(bounds.panel.bottom).toBeLessThanOrEqual(bounds.video.bottom);
  expect(bounds.panel.left - bounds.video.left).toBeLessThanOrEqual(9);

  await expand.click();
  await expect(
    panel.getByRole("button", { name: "Collapse controls", exact: true }),
  ).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Play", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () => (await panel.boundingBox())!.width)
    .toBeGreaterThanOrEqual(300);
});

test("downloads use the browser API and unsupported sources fail visibly", async ({
  page,
  worker,
}) => {
  // Replace only the OS file picker in this test, retain the service-worker message/URL validation path.
  await worker.evaluate(() => {
    chrome.downloads.download = ((
      options: chrome.downloads.DownloadOptions,
      callback: (id: number) => void,
    ) => {
      void chrome.storage.local
        .set({ testDownload: options })
        .then(() => callback(17));
    }) as typeof chrome.downloads.download;
  });
  await page
    .locator("#local-reel-controls")
    .getByRole("button", { name: "Download video" })
    .click();
  await expect(page.locator("#local-reel-controls #message")).toContainText(
    "Download requested",
  );
  expect(
    await worker.evaluate(
      async () => (await chrome.storage.local.get("testDownload")).testDownload,
    ),
  ).toMatchObject({ url: media, saveAs: true });
  await page.locator("#first").evaluate((v: HTMLVideoElement) => {
    v.src = "blob:https://www.instagram.com/no-direct-source";
  });
  await page
    .locator("#local-reel-controls")
    .getByRole("button", { name: "Download video" })
    .click();
  await expect(page.locator("#local-reel-controls #message")).toContainText(
    "No direct download source",
  );
});

test("native video fullscreen exposes browser controls and restores them on exit", async ({
  page,
}) => {
  await page
    .locator("#first")
    .evaluate((v: HTMLVideoElement) => v.requestFullscreen());
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.controls),
    )
    .toBe(true);
  const panel = page.locator("#local-reel-controls");
  await page.keyboard.press("s");
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.paused),
    )
    .toBe(false);
  await page.evaluate(() => document.exitFullscreen());
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.controls),
    )
    .toBe(false);
});

test("failed quality recovery cannot seek a recycled video", async ({
  page,
  context,
}) => {
  await page.locator("#first").evaluate((v: HTMLVideoElement) => {
    v.currentTime = 7;
  });
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.currentTime),
    )
    .toBeCloseTo(7, 0);
  await context.route(media, (route) => route.fulfill({ status: 404 }));
  await context.route(highMedia, (route) => route.fulfill({ status: 404 }));
  await page.evaluate(async () => {
    await (await fetch("/api/v1/feed/fixture/")).json();
  });
  await page
    .locator("#local-reel-controls")
    .getByRole("button", { name: "Use highest quality" })
    .click();
  await expect(page.locator("#local-reel-controls #message")).toContainText(
    "quality source failed",
  );
  await page.locator("#first").evaluate((v: HTMLVideoElement) => {
    v.removeAttribute("poster");
    v.src = "https://scontent.cdninstagram.com/recycled.mp4";
  });
  await page.waitForFunction(
    () => document.querySelector("video")!.readyState >= 2,
  );
  expect(
    await page
      .locator("#first")
      .evaluate((v: HTMLVideoElement) => v.currentTime),
  ).toBe(0);
  expect(
    await page.locator("#first").evaluate((v: HTMLVideoElement) => v.paused),
  ).toBe(true);
});

test("XHR observation preserves the response and exposes video quality", async ({
  page,
}) => {
  const result = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("GET", "/api/v1/feed/fixture/");
        xhr.responseType = "json";
        xhr.onload = () => resolve(xhr.response);
        xhr.onerror = reject;
        xhr.send();
      }),
  );
  expect(result).toEqual({ items: [metadata] });
  await page
    .locator("#local-reel-controls")
    .getByRole("button", { name: "Use highest quality" })
    .click();
  await expect
    .poll(() =>
      page.locator("#first").evaluate((v: HTMLVideoElement) => v.currentSrc),
    )
    .toBe(highMedia);
});

test("plural Reel URLs match blob playback without a poster for Save and HD", async ({
  page,
  worker,
}) => {
  await worker.evaluate(() => {
    chrome.downloads.download = ((
      options: chrome.downloads.DownloadOptions,
      callback: (id: number) => void,
    ) => {
      void chrome.storage.local
        .set({ testDownload: options })
        .then(() => callback(18));
    }) as typeof chrome.downloads.download;
  });
  await page.evaluate(
    async ({ media, metadata }) => {
      const video = document.querySelector("video")!;
      const blob = await (await fetch(media)).blob();
      video.removeAttribute("poster");
      video.src = URL.createObjectURL(blob);
      const data = document.createElement("script");
      data.type = "application/json";
      data.textContent = JSON.stringify({ items: [metadata] });
      document.body.append(data);
    },
    { media, metadata },
  );
  await page.waitForFunction(
    () => document.querySelector("video")!.readyState >= 2,
  );
  expect(
    await page
      .locator("#first")
      .evaluate((video: HTMLVideoElement) => video.currentSrc),
  ).toMatch(/^blob:/);
  const panel = page.locator("#local-reel-controls");
  await panel.getByRole("button", { name: "Download video" }).click();
  await expect(panel.locator("#message")).toContainText("Download requested");
  expect(
    await worker.evaluate(
      async () => (await chrome.storage.local.get("testDownload")).testDownload,
    ),
  ).toMatchObject({ url: highMedia, saveAs: true });
  const originalSource = await page.locator("#first").getAttribute("src");
  await panel.getByRole("button", { name: "Use highest quality" }).click();
  await expect
    .poll(() =>
      page
        .locator("video[data-lrc-companion]")
        .evaluate((video: HTMLVideoElement) => video.currentSrc),
    )
    .toBe(highMedia);
  await expect(page.locator("#first")).toHaveAttribute("src", originalSource!);
  await expect(panel.locator("#message")).toContainText("720×1280");
});

test("per-player identity beats a stale page shortcode and updates on recycled players", async ({
  page,
  worker,
}) => {
  await worker.evaluate(() => {
    chrome.downloads.download = ((
      options: chrome.downloads.DownloadOptions,
      callback: (id: number) => void,
    ) => {
      void chrome.storage.local
        .set({ testDownload: options })
        .then(() => callback(19));
    }) as typeof chrome.downloads.download;
  });
  const otherMedia = "https://scontent.cdninstagram.com/other-reel.mp4";
  await page.evaluate(
    async ({ media, metadata, otherMedia }) => {
      const video = document.querySelector("video")!;
      Object.defineProperty(video.parentElement!, "__reactProps$fixture", {
        configurable: true,
        value: { children: { props: { queryReference: { id: "202_55" } } } },
      });
      video.removeAttribute("poster");
      video.src = URL.createObjectURL(await (await fetch(media)).blob());
      const data = document.createElement("script");
      data.type = "application/json";
      data.textContent = JSON.stringify({
        items: [
          metadata,
          {
            pk: "202",
            code: "other",
            video_versions: [{ url: otherMedia, width: 720, height: 1280 }],
          },
        ],
      });
      document.body.append(data);
    },
    { media, metadata, otherMedia },
  );
  await expect(page.locator("#first")).toHaveAttribute(
    "data-lrc-media-id",
    "202_55",
  );
  await page.waitForFunction(
    () => document.querySelector("video")!.readyState >= 2,
  );
  const panel = page.locator("#local-reel-controls");
  await panel.getByRole("button", { name: "Download video" }).click();
  await expect(panel.locator("#message")).toContainText("Download requested");
  expect(
    await worker.evaluate(
      async () => (await chrome.storage.local.get("testDownload")).testDownload,
    ),
  ).toMatchObject({ url: otherMedia });
  await panel.getByRole("button", { name: "Use highest quality" }).click();
  await expect
    .poll(() =>
      page
        .locator("video[data-lrc-companion]")
        .evaluate((video: HTMLVideoElement) => video.currentSrc),
    )
    .toBe(otherMedia);
  await page.evaluate(async (media) => {
    const video = document.querySelector("video")!;
    Object.defineProperty(video.parentElement!, "__reactProps$fixture", {
      configurable: true,
      value: { children: { props: { mediaId: "999_55" } } },
    });
    video.src = URL.createObjectURL(await (await fetch(media)).blob());
  }, media);
  await expect(page.locator("#first")).toHaveAttribute(
    "data-lrc-media-id",
    "999_55",
  );
  await expect(page.locator("video[data-lrc-companion]")).toHaveCount(0);
  await page.waitForFunction(
    () => document.querySelector("video")!.readyState >= 2,
  );
  await panel.getByRole("button", { name: "Download video" }).click();
  await expect(panel.locator("#message")).toContainText(
    "No direct download source",
  );
});

async function prepareBlobPlayer(page: Page, record = metadata) {
  await page.evaluate(
    async ({ media, record }) => {
      const video = document.querySelector<HTMLVideoElement>("#first")!;
      video.removeAttribute("poster");
      video.src = URL.createObjectURL(await (await fetch(media)).blob());
      const script = document.createElement("script");
      script.type = "application/json";
      script.textContent = JSON.stringify({ items: [record] });
      document.body.append(script);
    },
    { media, record },
  );
  await page.waitForFunction(
    () => document.querySelector<HTMLVideoElement>("#first")!.readyState >= 2,
  );
}

test("HD preserves the streaming player through fullscreen, controls, and disable", async ({
  page,
  popup,
}) => {
  await prepareBlobPlayer(page);
  await page.bringToFront();
  const owner = page.locator("#first");
  const original = await owner.getAttribute("src");
  const panel = page.locator("#local-reel-controls");
  await panel.getByRole("button", { name: "Fullscreen", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await panel.getByRole("button", { name: "Use highest quality" }).click();
  const companion = page.locator("video[data-lrc-companion]");
  await expect(companion).toBeVisible();
  await page.waitForFunction(
    () =>
      document.querySelector<HTMLVideoElement>("video[data-lrc-companion]")!
        .readyState >= 2,
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.fullscreenElement?.contains(
          document.querySelector("video[data-lrc-companion]"),
        ),
      ),
    )
    .toBe(true);
  await panel.getByRole("button", { name: "Play", exact: true }).click();
  await expect
    .poll(() => companion.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  await owner.evaluate((v: HTMLVideoElement) => {
    void v.play().catch(() => {});
  });
  await expect
    .poll(() => owner.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
  await expect
    .poll(() => companion.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(false);
  await panel.getByRole("button", { name: "Pause", exact: true }).click();
  await panel
    .getByRole("slider", { name: "Seek video" })
    .evaluate((s: HTMLInputElement) => {
      s.value = "4";
      s.dispatchEvent(new Event("input", { bubbles: true }));
    });
  await expect
    .poll(() => companion.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(4, 0);
  await expect(owner).toHaveAttribute("src", original!);
  await popup.locator("#enabled").uncheck();
  await expect(companion).toHaveCount(0);
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await expect(owner).toBeVisible();
  await expect(owner).toHaveAttribute("src", original!);
  await expect
    .poll(() => owner.evaluate((v: HTMLVideoElement) => v.currentTime))
    .toBeCloseTo(4, 0);
  await expect
    .poll(() => owner.evaluate((v: HTMLVideoElement) => v.paused))
    .toBe(true);
});

test("automatic HD waits for native dimensions and rejects an overstated equal-quality source", async ({
  page,
  popup,
  context,
}) => {
  const probe = media + "?quality-probe=1";
  await page.evaluate(
    async (record) => {
      const source = new MediaSource();
      (window as typeof window & { testSource: MediaSource }).testSource =
        source;
      const video = document.querySelector<HTMLVideoElement>("#first")!;
      video.removeAttribute("poster");
      const opened = new Promise<void>((resolve) =>
        source.addEventListener("sourceopen", () => resolve(), { once: true }),
      );
      video.src = URL.createObjectURL(source);
      const data = document.createElement("script");
      data.type = "application/json";
      data.textContent = JSON.stringify({ items: [record] });
      document.body.append(data);
      await opened;
    },
    {
      ...metadata,
      video_versions: [{ url: probe, width: 1080, height: 1920 }],
    },
  );
  let probes = 0;
  context.on("request", (request) => {
    if (request.url() === probe) probes += 1;
  });
  const owner = page.locator("#first");
  const original = await owner.getAttribute("src");
  expect(await owner.evaluate((v: HTMLVideoElement) => v.videoWidth)).toBe(0);
  await popup.locator("#preferHD").check();
  const panel = page.locator("#local-reel-controls");
  await panel.getByRole("button", { name: "Use highest quality" }).click();
  await expect(panel.locator("#message")).toContainText(
    "Waiting for video quality information",
  );
  await expect(page.locator("video[data-lrc-companion]")).toHaveCount(0);
  expect(probes).toBe(0);
  await page.evaluate(async () => {
    const source = (window as typeof window & { testSource: MediaSource })
      .testSource;
    const buffer = source.addSourceBuffer('video/mp4; codecs="avc1.42C01E"');
    const data = await (
      await fetch("https://scontent.cdninstagram.com/fixture-mse.mp4")
    ).arrayBuffer();
    const updated = new Promise<void>((resolve) =>
      buffer.addEventListener("updateend", () => resolve(), { once: true }),
    );
    buffer.appendBuffer(data);
    await updated;
    source.endOfStream();
  });
  await expect.poll(() => probes).toBe(1);
  await expect(page.locator("video[data-lrc-companion]")).toHaveCount(0);
  await panel.getByRole("button", { name: "Use highest quality" }).click();
  await expect(panel.locator("#message")).toHaveText(
    "Current video is already 360×640.",
  );
  await expect(owner).toHaveAttribute("src", original!);
  await expect(owner).toBeVisible();
  expect(probes).toBe(1);
});

test("scrolling away removes the HD companion and restores its owner", async ({
  page,
}) => {
  await prepareBlobPlayer(page);
  const panel = page.locator("#local-reel-controls");
  await panel.getByRole("button", { name: "Use highest quality" }).click();
  await expect(page.locator("video[data-lrc-companion]")).toBeVisible();
  await page.locator("#second").scrollIntoViewIfNeeded();
  await expect(page.locator("video[data-lrc-companion]")).toHaveCount(0);
  await expect(page.locator("#first")).toHaveCSS("visibility", "visible");
  await expect(panel).toBeVisible();
  await panel.getByLabel("Playback speed").selectOption("1.5");
  await expect
    .poll(() =>
      page.locator("#second").evaluate((v: HTMLVideoElement) => v.playbackRate),
    )
    .toBe(1.5);
});
