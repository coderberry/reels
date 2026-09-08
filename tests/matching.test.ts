import assert from "node:assert/strict";
import test from "node:test";

import type { MediaRecord } from "../src/core";
import { matchMediaRecord, shortcodeFromPath } from "../src/matching";

const cdn = (name: string, query = "") =>
  `https://scontent-den2-1.cdninstagram.com/media/${name}${query}`;

function record(
  id: string,
  code: string,
  source: string,
  poster?: string,
): MediaRecord {
  return {
    id,
    code,
    posters: poster ? [poster] : [],
    sources: [{ url: source, width: 1080, height: 1920 }],
  };
}

test("extracts exact shortcodes from reel, reels, and post pathnames", () => {
  for (const [pathname, expected] of [
    ["/reel/AbC_123-/", "AbC_123-"],
    ["/reels/AbC_123-", "AbC_123-"],
    ["/p/AbC_123-/", "AbC_123-"],
  ] as const) {
    assert.equal(shortcodeFromPath(pathname), expected);
  }
});

test("rejects unrelated, malformed, and full URL shortcode input", () => {
  for (const pathname of [
    "/stories/AbC_123-/",
    "/reels/",
    "/reels/AbC.123/",
    "/reels/AbC_123-/comments/",
    "/reels/AbC_123-/?next=1",
    "https://www.instagram.com/reels/AbC_123-/",
  ]) {
    assert.equal(shortcodeFromPath(pathname), undefined, pathname);
  }
});

test("matches a blob-backed reels video by its unique shortcode", () => {
  const reel = record("180001", "C_reel-42", cdn("reel.mp4"));
  const code = shortcodeFromPath("/reels/C_reel-42/");

  assert.equal(
    matchMediaRecord([reel], {
      source: "blob:https://www.instagram.com/25e66cb0-4b26-4d83",
      poster: "",
      code,
    }),
    reel,
  );
});

test("matches source paths across CDN and query variations", () => {
  const reel = record(
    "180002",
    "SOURCE_MATCH",
    cdn("shared.mp4", "?token=old"),
  );

  assert.equal(
    matchMediaRecord([reel], {
      source: "https://video.xx.fbcdn.net/media/shared.mp4?token=new",
      poster: "",
    }),
    reel,
  );
});

test("prefers a source match over a stale poster match", () => {
  const sourceMatch = record(
    "180003",
    "SOURCE",
    cdn("current.mp4"),
    cdn("source-poster.jpg"),
  );
  const stalePosterMatch = record(
    "180004",
    "STALE",
    cdn("other.mp4"),
    cdn("stale.jpg"),
  );

  assert.equal(
    matchMediaRecord([stalePosterMatch, sourceMatch], {
      source: cdn("current.mp4", "?fresh=1"),
      poster: cdn("stale.jpg", "?stale=1"),
      code: "STALE",
      mediaId: "180004",
    }),
    sourceMatch,
  );
});

test("normalizes a numeric media ID with an optional owner suffix", () => {
  const reel = record("180005", "MEDIA_ID", cdn("id.mp4"));

  assert.equal(
    matchMediaRecord([reel], {
      source: "blob:https://www.instagram.com/id-source",
      poster: "",
      mediaId: "180005_91234",
    }),
    reel,
  );
  assert.equal(
    matchMediaRecord(
      [record("180006_91234", "SUFFIXED", cdn("suffixed.mp4"))],
      { source: "", poster: "", mediaId: "180006" },
    )?.code,
    "SUFFIXED",
  );
});

test("does not strip nonnumeric underscore suffixes from media IDs", () => {
  const reel = record("clip", "NONNUMERIC", cdn("nonnumeric.mp4"));

  assert.equal(
    matchMediaRecord([reel], {
      source: "",
      poster: "",
      mediaId: "clip_91234",
    }),
    undefined,
  );
});

test("rejects a shortcode shared by multiple carousel children", () => {
  const children = [
    record("180007", "CAROUSEL", cdn("child-one.mp4")),
    record("180008", "CAROUSEL", cdn("child-two.mp4")),
  ];

  assert.equal(
    matchMediaRecord(children, {
      source: "blob:https://www.instagram.com/carousel",
      poster: "",
      code: shortcodeFromPath("/p/CAROUSEL/"),
    }),
    undefined,
  );
});

test("does not use a unique shortcode when a concrete media ID disagrees", () => {
  const reel = record("180009", "RIGHT_CODE", cdn("right-code.mp4"));

  assert.equal(
    matchMediaRecord([reel], {
      source: "blob:https://www.instagram.com/wrong-id",
      poster: "",
      code: shortcodeFromPath("/reel/RIGHT_CODE/"),
      mediaId: "999999_42",
    }),
    undefined,
  );
});

test("rejects ambiguity at a stronger matching tier", () => {
  const records = [
    record("180010", "ONE", cdn("duplicate.mp4")),
    record("180011", "TWO", cdn("duplicate.mp4", "?variant=2")),
  ];

  assert.equal(
    matchMediaRecord(records, {
      source: cdn("duplicate.mp4", "?current=1"),
      poster: "",
      code: "ONE",
      mediaId: "180010",
    }),
    undefined,
  );
});
