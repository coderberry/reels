# Reels

Reels adds playback controls to Instagram videos in Chrome, Brave, and other Chromium browsers. All features are available without an account, subscription, license check, or telemetry service. The extension stores preferences on this device.

This is a separate implementation with its own interface and source code. It does not include Reels Scrubber code, icons, branding, payment code, or license data.

## Install

The `dist` folder contains the extension. It needs no build tools to run.

1. Open `chrome://extensions` in Chrome, or `brave://extensions` in Brave.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select `/Users/eberry/Code/github.com/coderberry/reels/dist`.
5. Reload your Instagram tab and open a video.

If Reels Scrubber is active in the same browser, turn it off before testing these controls. Two extensions can change the same video preferences.

The ZIP file in `artifacts` contains the same extension files. To install it elsewhere, extract it and select the extracted folder with **Load unpacked**.

## Use the controls

The control panel follows the largest visible video. It supports Reels, stories, feed videos, and post videos. Click the minus button to collapse the panel into a 40-pixel icon at the bottom-left of the video. Click the icon to expand it.

Use the slider to seek. Use **Play**, **Mute**, the volume slider, and the speed menu to control playback. **Full** opens fullscreen mode. **Save** opens a browser download request when a direct video source is available.

The **Full** button keeps the extension panel visible and preserves the video shape. Portrait videos fit the screen height. Landscape videos fit the screen width when width limits the available space. The original page layout returns when fullscreen closes. If Instagram puts the video itself into fullscreen, the browser controls appear instead. The extension panel returns when you exit fullscreen.

The extension popup lets you change each feature. Speed and volume preferences apply to new videos when their memory switches are on. Mute memory is on by default. Automatic scrolling is off by default.

| Key             | Action                                     |
| --------------- | ------------------------------------------ |
| `A` / `D`       | Seek backward / forward five seconds       |
| `S`             | Play or pause                              |
| `M`             | Mute or unmute                             |
| `F`             | Enter or exit fullscreen                   |
| `[` / `]` / `\` | Set loop start / set loop end / clear loop |

Keyboard shortcuts do not run while you type in a text field. To create a section loop, set the start first. Set the end at least 0.15 seconds later. A section loop takes priority over automatic scrolling.

Automatic scrolling applies to Reel pages. It advances to the next visible video, a Next button, or the next position in the scroll container. It does not advance stories or feed posts automatically.

## Quality and download limits

**Prefer HD** looks for the largest video source that Instagram supplies in detected page metadata. Metadata is information about each video. The extension observes normal page responses and embedded data. It does not request private APIs or force Instagram to disable its streaming player.

HD is available only when Instagram supplies a suitable direct video source. For streaming playback, the extension loads that source in a separate video player. It leaves the original streaming source intact. The extension keeps the original video when its resolution equals or exceeds the loaded source. Reload the page if its metadata arrived before the extension loaded. The **HD** button reports when no alternate source is available. The HD result reports the actual video dimensions. A failed quality change returns to the previous player when it remains playable.

Downloads also need a direct video source. Browser streaming URLs that start with `blob:` are not downloadable unless matching metadata supplies a direct source. Signed media URLs can expire. An available source can have a lower resolution than the original upload.

The extension matches metadata by video URL, poster image, player video ID, or an unambiguous post code. It recognizes `/reel/`, `/reels/`, and `/p/` links. Player IDs keep preloaded Reels separate when the page address still names the previous Reel. It keeps carousel clips separate. It does not select the first carousel clip as a fallback.

Instagram can change its player, page structure, and metadata format. Live behavior needs another test after those changes. The extension cannot make unavailable footage available.

## Privacy and permissions

The extension uses `storage` to save preferences and `downloads` to request a file save. Content scripts run only on `https://www.instagram.com/*`.

The extension has no login, subscription service, remote configuration, analytics, automatic update endpoint, or scheduled license request. Video playback and requested downloads still use Instagram media servers. Downloads accept HTTPS URLs only on `cdninstagram.com`, `fbcdn.net`, and their subdomains.

Detected media information stays in page memory and is limited to 300 records. It is not saved in extension storage or sent to another service.

## Development

Use Node.js 22 or later.

```sh
npm ci
npx playwright install chromium
npm run check
```

`npm run check` runs TypeScript, lint, formatting, unit tests, the build, and Chromium browser tests. Browser tests use an isolated temporary profile and synthetic video fixtures. They do not use your Instagram account.

```sh
npm run build
npm run package
```

The build writes `dist`. Packaging runs all checks and creates a ZIP file and SHA-256 checksum in `artifacts`. After a rebuild, click **Reload** on the extension card and reload Instagram.

| File                              | Purpose                                                            |
| --------------------------------- | ------------------------------------------------------------------ |
| `src/content.ts`                  | Video controls, shortcuts, loops, scrolling, and quality selection |
| `src/media.ts`, `src/identity.ts` | Passive observation of video metadata and player IDs               |
| `src/matching.ts`                 | Matching each player to its video sources                          |
| `src/background.ts`               | Serialized preference updates and download requests                |
| `src/settings.ts`, `src/core.ts`  | Preference validation and shared media helpers                     |
| `src/popup.ts`, `static/popup.*`  | Extension popup                                                    |

The CI workflow runs the same checks on Linux. CI means automated repository checks.

Chrome references: [content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), [local storage](https://developer.chrome.com/docs/extensions/reference/api/storage), and [downloads](https://developer.chrome.com/docs/extensions/reference/api/downloads).
