import assert from "node:assert/strict";
import test from "node:test";

import { identityFromProps } from "../src/identity";

test("extracts the media ID from the observed nested query reference", () => {
  assert.deepEqual(
    identityFromProps({
      props: {
        children: {
          props: {
            children: {
              props: {
                code: "C_observed-1",
                queryReference: { id: "3942320962228334015_6752726415" },
              },
            },
          },
        },
      },
    }),
    {
      mediaId: "3942320962228334015_6752726415",
      code: "C_observed-1",
    },
  );
});

test("extracts mediaId through a React children array", () => {
  assert.deepEqual(
    identityFromProps({
      props: {
        children: [
          { props: { children: "caption" } },
          {
            props: {
              children: {
                props: { mediaId: "3942320962228334015_6752726415" },
              },
            },
          },
        ],
      },
    }),
    { mediaId: "3942320962228334015_6752726415", code: undefined },
  );
});

test("accepts videoID and safe integer media IDs", () => {
  assert.deepEqual(identityFromProps({ props: { videoID: "12345_67890" } }), {
    mediaId: "12345_67890",
    code: undefined,
  });
  assert.deepEqual(identityFromProps({ mediaId: 12345 }), {
    mediaId: "12345",
    code: undefined,
  });
});

test("does not treat a generic id as a media identity", () => {
  assert.equal(
    identityFromProps({
      id: "11111_22222",
      props: { id: "33333_44444", children: { id: "55555_66666" } },
    }),
    undefined,
  );
});

test("ignores invalid media IDs and shortcodes", () => {
  for (const value of [
    { mediaId: "123_bad" },
    { videoID: "1_2_3" },
    { queryReference: { id: "not-a-numeric-id" } },
    { code: "bad.code" },
    { shortcode: "bad/code" },
    { mediaId: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.equal(identityFromProps(value), undefined);
  }
});

test("rejects conflicting media IDs", () => {
  assert.equal(
    identityFromProps({
      props: {
        mediaId: "11111_22222",
        children: { props: { videoID: "33333_44444" } },
      },
    }),
    undefined,
  );
});

test("rejects conflicting shortcodes", () => {
  assert.equal(
    identityFromProps({
      code: "FIRST_CODE",
      props: { children: { props: { shortcode: "SECOND_CODE" } } },
    }),
    undefined,
  );
});

test("follows only props, children, and queryReference", () => {
  assert.equal(
    identityFromProps({
      arbitrary: {
        props: {
          mediaId: "11111_22222",
          code: "HIDDEN_CODE",
        },
      },
    }),
    undefined,
  );
});

test("bounds traversal and does not invoke accessors", () => {
  const shallow: Record<string, unknown> = {};
  Object.defineProperty(shallow, "mediaId", {
    enumerable: true,
    get: () => {
      throw new Error("getter ran");
    },
  });
  shallow.children = shallow;
  assert.equal(identityFromProps(shallow), undefined);

  let deep: Record<string, unknown> = { mediaId: "11111_22222" };
  for (let index = 0; index < 30; index += 1) deep = { props: deep };
  assert.equal(identityFromProps(deep), undefined);

  let hiddenConflict: Record<string, unknown> = {
    mediaId: "33333_44444",
  };
  for (let index = 0; index < 30; index += 1)
    hiddenConflict = { props: hiddenConflict };
  assert.equal(
    identityFromProps({
      mediaId: "11111_22222",
      props: hiddenConflict,
    }),
    undefined,
  );

  assert.equal(
    identityFromProps({
      mediaId: "11111_22222",
      children: [
        ...Array.from({ length: 100 }, () => null),
        { mediaId: "33333_44444" },
      ],
    }),
    undefined,
  );
});
