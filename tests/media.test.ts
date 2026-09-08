import assert from "node:assert/strict";
import test from "node:test";
import { extractMediaRecords, MEDIA_LIMITS } from "../src/media";

const cdn = (name: string) =>
  `https://scontent-den2-1.cdninstagram.com/${name}`;

test("extracts and merges normal Instagram media variants", () => {
  const records = extractMediaRecords({
    data: {
      pk: "123",
      id: "123",
      code: "Reel_code-1",
      video_versions: [
        { url: cdn("720.mp4"), width: 720, height: 1280 },
        { url: cdn("1080.mp4"), width: 1080, height: 1920 },
      ],
      video_url: cdn("720.mp4"),
      image_versions2: { candidates: [{ url: cdn("cover.jpg") }] },
      display_url: "https://instagram.com/not-an-approved-media-host.jpg",
    },
  });

  assert.deepEqual(records, [
    {
      id: "123",
      code: "Reel_code-1",
      posters: [cdn("cover.jpg")],
      sources: [
        { url: cdn("720.mp4"), width: 720, height: 1280 },
        { url: cdn("1080.mp4"), width: 1080, height: 1920 },
      ],
    },
  ]);
});

test("uses pk when Instagram id adds the owner suffix", () => {
  assert.deepEqual(
    extractMediaRecords({
      pk: "1234",
      id: "1234_5678",
      code: "OWNER_SUFFIX",
      video_url: cdn("owner-suffix.mp4"),
    }).map(({ id, code }) => ({ id, code })),
    [{ id: "1234", code: "OWNER_SUFFIX" }],
  );
});

test("keeps carousel children and their variants separate", () => {
  const records = extractMediaRecords({
    pk: "parent",
    code: "PARENT_CODE",
    carousel_media: [
      {
        pk: "child-1",
        code: "CHILD_ONE",
        video_versions: [
          { url: cdn("child-1-low.mp4"), width: 480, height: 854 },
          { url: cdn("child-1-high.mp4"), width: 1080, height: 1920 },
        ],
      },
      {
        id: "child-2",
        shortcode: "CHILD_TWO",
        video_url: "https://video.xx.fbcdn.net/child-2.mp4",
        thumbnail_src: cdn("child-2.jpg"),
      },
      {
        video_url: cdn("anonymous-child.mp4"),
      },
    ],
  });

  assert.deepEqual(
    records.map(({ id, code, sources }) => ({
      id,
      code,
      urls: sources.map((source) => source.url),
    })),
    [
      {
        id: "child-1",
        code: "CHILD_ONE",
        urls: [cdn("child-1-low.mp4"), cdn("child-1-high.mp4")],
      },
      {
        id: "child-2",
        code: "CHILD_TWO",
        urls: ["https://video.xx.fbcdn.net/child-2.mp4"],
      },
    ],
  );
});

test("extracts GraphQL progressive URLs from the media node", () => {
  assert.deepEqual(
    extractMediaRecords({
      id: "graphql-1",
      shortcode: "GRAPH_1",
      dimensions: { width: 1080, height: 1920 },
      videoDeliveryResponseResult: {
        progressive_urls: [
          cdn("graph-a.mp4"),
          { url: cdn("graph-b.mp4"), width: 720, height: 1280 },
        ],
      },
    }),
    [
      {
        id: "graphql-1",
        code: "GRAPH_1",
        posters: [],
        sources: [
          { url: cdn("graph-a.mp4"), width: 1080, height: 1920 },
          { url: cdn("graph-b.mp4"), width: 720, height: 1280 },
        ],
      },
    ],
  );
});

test("rejects unsafe URLs and ambiguous identity instead of guessing", () => {
  const records = extractMediaRecords([
    { pk: "one", id: "two", video_url: cdn("ambiguous.mp4") },
    { code: "ONLY_A_CODE", video_url: cdn("missing-id.mp4") },
    { id: "bad id", video_url: cdn("bad-id.mp4") },
    {
      id: "safe",
      video_versions: [
        { url: "javascript:alert(1)", width: 100, height: 100 },
        { url: "https://evil.example/video.mp4", width: 100, height: 100 },
        {
          url: "https://user:pass@video.xx.fbcdn.net/private.mp4",
          width: 100,
          height: 100,
        },
        { url: cdn("safe.mp4"), width: Number.POSITIVE_INFINITY, height: -1 },
      ],
      image_versions2: {
        candidates: [
          { url: "data:image/png;base64,AA==" },
          { url: cdn("safe.jpg") },
        ],
      },
    },
  ]);

  assert.deepEqual(records, [
    {
      id: "safe",
      code: undefined,
      posters: [cdn("safe.jpg")],
      sources: [{ url: cdn("safe.mp4"), width: 0, height: 0 }],
    },
  ]);
});

test("handles malformed, cyclic, accessor, depth, and input-size bounds", () => {
  assert.deepEqual(extractMediaRecords("{broken"), []);
  assert.deepEqual(
    extractMediaRecords(`"${"x".repeat(MEDIA_LIMITS.jsonCharacters)}"`),
    [],
  );

  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  Object.defineProperty(cyclic, "danger", {
    enumerable: true,
    get: () => {
      throw new Error("getter ran");
    },
  });
  cyclic.media = { id: "cycle-safe", video_url: cdn("cycle.mp4") };
  assert.deepEqual(
    extractMediaRecords(cyclic).map((record) => record.id),
    ["cycle-safe"],
  );

  let deep: Record<string, unknown> = {
    id: "too-deep",
    video_url: cdn("deep.mp4"),
  };
  for (let index = 0; index <= MEDIA_LIMITS.depth; index += 1)
    deep = { next: deep };
  assert.deepEqual(extractMediaRecords(deep), []);
});

test("drops a duplicated ID when its shortcode is inconsistent", () => {
  assert.deepEqual(
    extractMediaRecords([
      { id: "collision", code: "FIRST", video_url: cdn("first.mp4") },
      { id: "collision", code: "SECOND", video_url: cdn("second.mp4") },
    ]),
    [],
  );
});
