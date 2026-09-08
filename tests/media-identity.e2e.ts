import { chromium, expect, test } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const firstId = "1000000000000000001_2000000001";
const secondId = "1000000000000000002_2000000001";
const conflictId = "1000000000000000003_2000000001";
const stableSource = "blob:https://www.instagram.com/stable-fixture";

test("refreshes mirrored identity when React recycles a video", async () => {
  const profile = await mkdtemp(path.join(tmpdir(), "local-reels-identity-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${path.resolve("dist")}`,
      `--load-extension=${path.resolve("dist")}`,
    ],
  });

  try {
    await context.route("https://www.instagram.com/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<!doctype html>
          <html>
            <body>
              <main><video id="player" src="${stableSource}"></video></main>
              <script>
                const player = document.querySelector("#player");
                const props = {
                  props: {
                    children: {
                      props: {
                        code: "FIRST_CODE",
                        queryReference: { id: "${firstId}" }
                      }
                    }
                  }
                };
                window.fixtureProps = props;
                Object.defineProperty(player, "__reactProps$fixture", {
                  configurable: true,
                  writable: true,
                  value: props
                });
              </script>
            </body>
          </html>`,
      }),
    );

    const page = await context.newPage();
    await page.goto("https://www.instagram.com/reels/identity-fixture/");
    const player = page.locator("#player");
    await expect(player).toHaveAttribute("data-lrc-media-id", firstId);
    await expect(player).toHaveAttribute("data-lrc-media-code", "FIRST_CODE");

    await page.evaluate(
      ({ mediaId }) => {
        const video = document.querySelector<HTMLVideoElement>("#player")!;
        const props = {
          props: {
            children: {
              props: {
                mediaId,
                code: "SECOND_CODE",
              },
            },
          },
        };
        (window as typeof window & { fixtureProps?: unknown }).fixtureProps =
          props;
        (video as HTMLVideoElement & Record<string, unknown>)[
          "__reactProps$fixture"
        ] = props;
        window.postMessage(
          { tag: "local-reel-controls:media:v1", type: "request" },
          location.origin,
        );
      },
      { mediaId: secondId },
    );
    await expect(player).toHaveAttribute("data-lrc-media-id", secondId);
    await expect(player).toHaveAttribute("data-lrc-media-code", "SECOND_CODE");

    await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>("#player")!;
      video.setAttribute(
        "src",
        "blob:https://www.instagram.com/temporary-fixture",
      );
      (video as HTMLVideoElement & Record<string, unknown>)[
        "__reactProps$fixture"
      ] = { props: { children: "identity unavailable" } };
      window.postMessage(
        { tag: "local-reel-controls:media:v1", type: "request" },
        location.origin,
      );
    });
    await expect(player).not.toHaveAttribute("data-lrc-media-id");
    await expect(player).not.toHaveAttribute("data-lrc-media-code");

    await page.evaluate(
      ({ source }) => {
        const video = document.querySelector<HTMLVideoElement>("#player")!;
        video.setAttribute("src", source);
        (video as HTMLVideoElement & Record<string, unknown>)[
          "__reactProps$fixture"
        ] = (window as typeof window & { fixtureProps: unknown }).fixtureProps;
        window.postMessage(
          { tag: "local-reel-controls:media:v1", type: "request" },
          location.origin,
        );
      },
      { source: stableSource },
    );
    await expect(player).toHaveAttribute("data-lrc-media-id", secondId);
    await expect(player).toHaveAttribute("data-lrc-media-code", "SECOND_CODE");

    await page.evaluate(
      ({ mediaId }) => {
        const video = document.querySelector<HTMLVideoElement>("#player")!;
        (video as HTMLVideoElement & Record<string, unknown>)[
          "__reactProps$conflict"
        ] = { props: { mediaId } };
        window.postMessage(
          { tag: "local-reel-controls:media:v1", type: "request" },
          location.origin,
        );
      },
      { mediaId: conflictId },
    );
    await expect(player).not.toHaveAttribute("data-lrc-media-id");

    await page.evaluate(() => {
      const video = document.querySelector<HTMLVideoElement>("#player")!;
      delete (video as HTMLVideoElement & Record<string, unknown>)[
        "__reactProps$conflict"
      ];
      window.postMessage(
        { tag: "local-reel-controls:media:v1", type: "request" },
        location.origin,
      );
    });
    await expect(player).toHaveAttribute("data-lrc-media-id", secondId);
  } finally {
    await context.close();
    await rm(profile, { recursive: true, force: true });
  }
});
