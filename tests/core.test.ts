import assert from "node:assert/strict";
import test from "node:test";

import {
  bestSource,
  formatTime,
  safeMediaUrl,
  sanitizeRecord,
  seekTime,
  type VideoSource,
} from "../src/core";

test("safeMediaUrl accepts HTTPS URLs only on the approved CDN boundaries", () => {
  assert.equal(
    safeMediaUrl("https://cdninstagram.com/video.mp4"),
    "https://cdninstagram.com/video.mp4",
  );
  assert.equal(
    safeMediaUrl("https://scontent-lax3-2.cdninstagram.com/video.mp4?x=1"),
    "https://scontent-lax3-2.cdninstagram.com/video.mp4?x=1",
  );
  assert.equal(
    safeMediaUrl("https://video.xx.fbcdn.net/v/t42/video.mp4"),
    "https://video.xx.fbcdn.net/v/t42/video.mp4",
  );

  for (const value of [
    "http://cdninstagram.com/video.mp4",
    "https://cdninstagram.com.example/video.mp4",
    "https://notcdninstagram.com/video.mp4",
    "https://fbcdn.net.example/video.mp4",
    "data:video/mp4;base64,AAAA",
    "not a URL",
  ]) {
    assert.equal(safeMediaUrl(value), undefined, value);
  }
});

test("safeMediaUrl rejects userinfo and non-default ports", () => {
  for (const value of [
    "https://user@cdninstagram.com/video.mp4",
    "https://user:password@cdninstagram.com/video.mp4",
    "https://@cdninstagram.com/video.mp4",
    "https://cdninstagram.com:444/video.mp4",
  ]) {
    assert.equal(safeMediaUrl(value), undefined, value);
  }
});

test("safeMediaUrl rejects an explicit default port before URL normalization removes it", () => {
  assert.equal(
    safeMediaUrl("https://cdninstagram.com:443/video.mp4"),
    undefined,
  );
});

test("safeMediaUrl rejects non-strings and overlong input", () => {
  assert.equal(safeMediaUrl(undefined), undefined);
  assert.equal(
    safeMediaUrl({ toString: () => "https://cdninstagram.com/video.mp4" }),
    undefined,
  );
  assert.equal(
    safeMediaUrl(`https://cdninstagram.com/${"a".repeat(16_384)}`),
    undefined,
  );
});

test("sanitizeRecord rejects malformed records and records without a safe source", () => {
  for (const value of [
    undefined,
    null,
    "record",
    {},
    {
      id: 42,
      posters: [],
      sources: [
        { url: "https://cdninstagram.com/video.mp4", width: 1, height: 1 },
      ],
    },
    { id: "id", posters: "poster", sources: [] },
    { id: "id", posters: [], sources: "source" },
    {
      id: "id",
      posters: [],
      sources: [{ url: "https://example.com/video.mp4", width: 1, height: 1 }],
    },
  ]) {
    assert.equal(sanitizeRecord(value), undefined);
  }
});

test("sanitizeRecord bounds bridge data and strips unsafe source fields", () => {
  const id = "i".repeat(140);
  const code = "c".repeat(140);
  const record = sanitizeRecord({
    id,
    code,
    ignored: "hostile extra field",
    posters: [
      "https://images.example/poster.jpg",
      7,
      ...Array.from({ length: 25 }, (_, index) => `poster-${index}`),
    ],
    sources: [
      null,
      { url: "https://example.com/unsafe.mp4", width: 9999, height: 9999 },
      {
        url: "https://cdninstagram.com/negative.mp4",
        width: -10,
        height: Number.NaN,
      },
      { url: "https://media.fbcdn.net/good.mp4", width: 640, height: 360 },
      { url: 7, width: 1920, height: 1080 },
    ],
  });

  assert.deepEqual(record, {
    id: id.slice(0, 128),
    code: code.slice(0, 128),
    posters: [
      "https://images.example/poster.jpg",
      ...Array.from({ length: 18 }, (_, index) => `poster-${index}`),
    ],
    sources: [
      { url: "https://cdninstagram.com/negative.mp4", width: 0, height: 0 },
      { url: "https://media.fbcdn.net/good.mp4", width: 640, height: 360 },
    ],
  });
});

test("sanitizeRecord caps source processing before accepting bridge data", () => {
  const sources = Array.from({ length: 25 }, (_, index) => ({
    url: `https://cdninstagram.com/${index}.mp4`,
    width: index,
    height: index,
  }));

  assert.equal(
    sanitizeRecord({ id: "id", posters: [], sources })?.sources.length,
    20,
  );
});

test("bestSource selects the largest safe area without mutating the input", () => {
  const sources: VideoSource[] = [
    { url: "https://cdninstagram.com/portrait.mp4", width: 1080, height: 1920 },
    { url: "https://cdninstagram.com/wide.mp4", width: 2560, height: 720 },
    { url: "https://example.com/huge.mp4", width: 8000, height: 8000 },
    { url: "https://fbcdn.net/small.mp4", width: 640, height: 360 },
  ];
  const snapshot = structuredClone(sources);

  assert.deepEqual(bestSource(sources), sources[0]);
  assert.deepEqual(sources, snapshot);
  assert.equal(
    bestSource([{ url: "https://example.com/video.mp4", width: 1, height: 1 }]),
    undefined,
  );
  assert.equal(bestSource([]), undefined);
});

test("formatTime floors finite non-negative seconds and handles invalid boundaries", () => {
  assert.equal(formatTime(0), "0:00");
  assert.equal(formatTime(9.999), "0:09");
  assert.equal(formatTime(60), "1:00");
  assert.equal(formatTime(3_661.9), "61:01");
  assert.equal(formatTime(-0.01), "0:00");
  assert.equal(formatTime(Number.NaN), "0:00");
  assert.equal(formatTime(Number.POSITIVE_INFINITY), "0:00");
});

test("seekTime clamps finite media seeks and leaves live media without an upper bound", () => {
  assert.equal(seekTime(10, -20, 30), 0);
  assert.equal(seekTime(10, 30, 30), 29.95);
  assert.equal(seekTime(0, 1, 0.03), 0);
  assert.equal(seekTime(10, 5, Number.POSITIVE_INFINITY), 15);
  assert.equal(seekTime(10, 5, Number.NaN), 15);
});
