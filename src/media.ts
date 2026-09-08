import {
  BRIDGE_TAG,
  safeMediaUrl,
  type MediaRecord,
  type VideoSource,
} from "./core";
import { identityFromProps } from "./identity";

export const MEDIA_LIMITS = {
  jsonCharacters: 4 * 1024 * 1024,
  jsonBytes: 4 * 1024 * 1024,
  depth: 32,
  nodes: 40_000,
  records: 100,
  urlsPerRecord: 20,
  cacheRecords: 300,
} as const;

type ObjectValue = Record<string, unknown>;

function objectValue(value: unknown): ObjectValue | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as ObjectValue)
    : undefined;
}

function own(value: ObjectValue, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function identifier(value: unknown): string | undefined {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return;
    value = String(value);
  }
  if (typeof value !== "string" || value.length < 1 || value.length > 128)
    return;
  return /^[A-Za-z0-9_.:-]+$/.test(value) ? value : undefined;
}

function dimensions(
  candidate: ObjectValue,
  media: ObjectValue,
): Pick<VideoSource, "width" | "height"> {
  const nested = objectValue(own(candidate, "dimensions"));
  const mediaDimensions = objectValue(own(media, "dimensions"));
  return {
    width: boundedDimension(
      own(candidate, "width") ??
        own(candidate, "config_width") ??
        (nested && own(nested, "width")) ??
        own(media, "original_width") ??
        (mediaDimensions && own(mediaDimensions, "width")),
    ),
    height: boundedDimension(
      own(candidate, "height") ??
        own(candidate, "config_height") ??
        (nested && own(nested, "height")) ??
        own(media, "original_height") ??
        (mediaDimensions && own(mediaDimensions, "height")),
    ),
  };
}

function boundedDimension(value: unknown): number {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= 100_000
    ? value
    : 0;
}

function appendUrl(values: string[], value: unknown): void {
  const url = safeMediaUrl(value);
  if (
    url &&
    !values.includes(url) &&
    values.length < MEDIA_LIMITS.urlsPerRecord
  )
    values.push(url);
}

function appendSource(
  sources: VideoSource[],
  value: unknown,
  media: ObjectValue,
): void {
  if (typeof value === "string") {
    const url = safeMediaUrl(value);
    if (
      url &&
      !sources.some((source) => source.url === url) &&
      sources.length < MEDIA_LIMITS.urlsPerRecord
    ) {
      sources.push({ url, ...dimensions({}, media) });
    }
    return;
  }
  const candidate = objectValue(value);
  if (!candidate) return;
  const url = safeMediaUrl(own(candidate, "url"));
  if (
    url &&
    !sources.some((source) => source.url === url) &&
    sources.length < MEDIA_LIMITS.urlsPerRecord
  ) {
    sources.push({ url, ...dimensions(candidate, media) });
  }
}

function appendSourceList(
  sources: VideoSource[],
  value: unknown,
  media: ObjectValue,
): void {
  if (!Array.isArray(value)) return;
  for (const candidate of value.slice(0, MEDIA_LIMITS.urlsPerRecord))
    appendSource(sources, candidate, media);
}

function progressiveUrls(value: unknown): unknown {
  const delivery = objectValue(value);
  if (!delivery) return;
  const direct = own(delivery, "progressive_urls");
  if (Array.isArray(direct)) return direct;
  for (const key of ["video_delivery_response", "videoDeliveryResponse"]) {
    const nested = objectValue(own(delivery, key));
    const urls = nested && own(nested, "progressive_urls");
    if (Array.isArray(urls)) return urls;
  }
}

function recordFromNode(media: ObjectValue): MediaRecord | undefined {
  const pk = identifier(own(media, "pk"));
  const id = identifier(own(media, "id"));
  if (pk && id && pk !== id && !id.startsWith(`${pk}_`)) return;
  const mediaId = pk ?? id;
  if (!mediaId) return;

  const sources: VideoSource[] = [];
  appendSourceList(sources, own(media, "video_versions"), media);
  appendSource(sources, own(media, "video_url"), media);
  appendSourceList(sources, own(media, "progressive_urls"), media);
  appendSourceList(
    sources,
    progressiveUrls(own(media, "videoDeliveryResponseResult")),
    media,
  );
  if (!sources.length) return;

  const posters: string[] = [];
  const imageVersions = objectValue(own(media, "image_versions2"));
  const candidates = imageVersions && own(imageVersions, "candidates");
  if (Array.isArray(candidates)) {
    for (const value of candidates.slice(0, MEDIA_LIMITS.urlsPerRecord)) {
      const candidate = objectValue(value);
      if (candidate) appendUrl(posters, own(candidate, "url"));
    }
  }
  appendUrl(posters, own(media, "display_url"));
  appendUrl(posters, own(media, "thumbnail_src"));

  const code =
    identifier(own(media, "code")) ?? identifier(own(media, "shortcode"));
  return { id: mediaId, code, posters, sources };
}

function mergeRecords(
  current: MediaRecord,
  next: MediaRecord,
): MediaRecord | undefined {
  if (current.code && next.code && current.code !== next.code) return;
  const sources = [...current.sources];
  for (const source of next.sources) {
    if (
      !sources.some((candidate) => candidate.url === source.url) &&
      sources.length < MEDIA_LIMITS.urlsPerRecord
    ) {
      sources.push(source);
    }
  }
  const posters = [...current.posters];
  for (const poster of next.posters) {
    if (
      !posters.includes(poster) &&
      posters.length < MEDIA_LIMITS.urlsPerRecord
    )
      posters.push(poster);
  }
  return { id: current.id, code: current.code ?? next.code, posters, sources };
}

/** Extracts media metadata without inheriting identity or sources between nested objects. */
export function extractMediaRecords(input: unknown): MediaRecord[] {
  let root = input;
  if (typeof input === "string") {
    if (input.length > MEDIA_LIMITS.jsonCharacters) return [];
    try {
      root = JSON.parse(input) as unknown;
    } catch {
      return [];
    }
  }
  if (root === null || typeof root !== "object") return [];

  const records = new Map<string, MediaRecord>();
  const ambiguous = new Set<string>();
  const seen = new WeakSet<object>();
  const pending: Array<{ value: unknown; depth: number }> = [
    { value: root, depth: 0 },
  ];
  let discovered = 1;
  let visited = 0;

  while (
    pending.length &&
    visited < MEDIA_LIMITS.nodes &&
    records.size < MEDIA_LIMITS.records
  ) {
    const { value, depth } = pending.pop()!;
    if (value === null || typeof value !== "object" || seen.has(value))
      continue;
    seen.add(value);
    visited += 1;

    const node = objectValue(value);
    if (node) {
      const record = recordFromNode(node);
      if (record && !ambiguous.has(record.id)) {
        const existing = records.get(record.id);
        if (!existing) records.set(record.id, record);
        else {
          const merged = mergeRecords(existing, record);
          if (merged) records.set(record.id, merged);
          else {
            records.delete(record.id);
            ambiguous.add(record.id);
          }
        }
      }
    }

    if (depth >= MEDIA_LIMITS.depth) continue;
    const children = Array.isArray(value)
      ? value
      : Object.getOwnPropertyNames(value).flatMap((key) => {
          const descriptor = Object.getOwnPropertyDescriptor(value, key);
          return descriptor && "value" in descriptor ? [descriptor.value] : [];
        });
    for (
      let index = children.length - 1;
      index >= 0 && discovered < MEDIA_LIMITS.nodes;
      index -= 1
    ) {
      const child = children[index];
      if (child !== null && typeof child === "object") {
        pending.push({ value: child, depth: depth + 1 });
        discovered += 1;
      }
    }
  }

  return [...records.values()];
}

function isJsonContentType(value: string | null): boolean {
  return Boolean(value && /(?:^|\/)json(?:;|$)|\+json(?:;|$)/i.test(value));
}

function isSameOriginResponseUrl(value: string): boolean {
  try {
    return new URL(value).origin === location.origin;
  } catch {
    return false;
  }
}

async function responseTextWithinLimit(
  response: Response,
): Promise<string | undefined> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MEDIA_LIMITS.jsonBytes
  )
    return;
  const body = response.body;
  if (!body) {
    const text = await response.text();
    return text.length <= MEDIA_LIMITS.jsonCharacters ? text : undefined;
  }
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MEDIA_LIMITS.jsonBytes) {
        await reader.cancel();
        return;
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    const text = chunks.join("");
    return text.length <= MEDIA_LIMITS.jsonCharacters ? text : undefined;
  } finally {
    reader.releaseLock();
  }
}

function installBridge(): void {
  const cache = new Map<string, MediaRecord>();
  const parsedScripts = new WeakSet<HTMLScriptElement>();
  type ReactPropsEntry = { key: string; value: unknown };
  type ReactPropsSnapshot = { node: Element; entries: ReactPropsEntry[] };
  const identified = new WeakMap<
    HTMLVideoElement,
    {
      source: string;
      parent: Element | null;
      mediaId: string;
      code?: string;
      path: ReactPropsSnapshot[];
    }
  >();
  let identityTimer = 0;

  const reactPropsEntries = (node: Element): ReactPropsEntry[] =>
    Object.getOwnPropertyNames(node).flatMap((key) => {
      if (!key.startsWith("__reactProps$")) return [];
      const descriptor = Object.getOwnPropertyDescriptor(node, key);
      return descriptor && "value" in descriptor
        ? [{ key, value: descriptor.value }]
        : [];
    });
  const sameReactProps = (
    expected: ReactPropsEntry[],
    current: ReactPropsEntry[],
  ) =>
    expected.length === current.length &&
    expected.every(
      (entry, index) =>
        entry.key === current[index].key &&
        entry.value === current[index].value,
    );
  const identityIsCurrent = (
    video: HTMLVideoElement,
    source: string,
    previous: NonNullable<ReturnType<typeof identified.get>>,
  ) => {
    if (
      previous.source !== source ||
      previous.parent !== video.parentElement ||
      video.getAttribute("data-lrc-media-id") !== previous.mediaId ||
      video.getAttribute("data-lrc-media-code") !== (previous.code ?? null)
    )
      return false;
    let node: Element | null = video;
    for (const snapshot of previous.path) {
      if (
        snapshot.node !== node ||
        !sameReactProps(snapshot.entries, reactPropsEntries(snapshot.node))
      )
        return false;
      node = node.parentElement;
    }
    return true;
  };

  const mirrorVideoIdentities = () => {
    identityTimer = 0;
    for (const video of document.querySelectorAll("video")) {
      const source = video.getAttribute("src") || "";
      const previous = identified.get(video);
      if (previous && identityIsCurrent(video, source, previous)) continue;
      let node: Element | null = video;
      let result: ReturnType<typeof identityFromProps>;
      const path: ReactPropsSnapshot[] = [];
      let ambiguous = false;
      for (
        let level = 0;
        node && level < 16;
        level++, node = node.parentElement
      ) {
        if (node !== video && node.querySelectorAll("video").length !== 1)
          break;
        const entries = reactPropsEntries(node);
        path.push({ node, entries });
        let nodeResult: ReturnType<typeof identityFromProps>;
        for (const entry of entries) {
          const candidate = identityFromProps(entry.value);
          if (!candidate?.mediaId) continue;
          if (
            nodeResult?.mediaId &&
            (nodeResult.mediaId !== candidate.mediaId ||
              (nodeResult.code &&
                candidate.code &&
                nodeResult.code !== candidate.code))
          ) {
            ambiguous = true;
            break;
          }
          nodeResult = {
            mediaId: candidate.mediaId,
            code: nodeResult?.code ?? candidate.code,
          };
        }
        if (ambiguous) break;
        if (nodeResult?.mediaId) {
          result = nodeResult;
          break;
        }
      }
      if (!ambiguous && result?.mediaId) {
        video.setAttribute("data-lrc-media-id", result.mediaId);
        if (result.code) video.setAttribute("data-lrc-media-code", result.code);
        else video.removeAttribute("data-lrc-media-code");
        identified.set(video, {
          source,
          parent: video.parentElement,
          mediaId: result.mediaId,
          code: result.code,
          path,
        });
      } else {
        video.removeAttribute("data-lrc-media-id");
        video.removeAttribute("data-lrc-media-code");
        identified.delete(video);
      }
    }
  };
  const scheduleIdentities = () => {
    if (!identityTimer)
      identityTimer = window.setTimeout(mirrorVideoIdentities, 100);
  };

  const publish = (records: MediaRecord[]) => {
    const output: MediaRecord[] = [];
    for (const record of records) {
      const existing = cache.get(record.id);
      const merged = existing ? mergeRecords(existing, record) : record;
      if (!merged) continue;
      cache.delete(record.id);
      cache.set(record.id, merged);
      output.push(merged);
    }
    while (cache.size > MEDIA_LIMITS.cacheRecords)
      cache.delete(cache.keys().next().value!);
    if (output.length)
      window.postMessage({ tag: BRIDGE_TAG, records: output }, location.origin);
  };

  const inspect = (value: unknown) => publish(extractMediaRecords(value));
  const inspectResponse = async (response: Response) => {
    if (
      !isSameOriginResponseUrl(response.url) ||
      !isJsonContentType(response.headers.get("content-type"))
    )
      return;
    try {
      const text = await responseTextWithinLimit(response.clone());
      if (text !== undefined) inspect(text);
    } catch {
      // Observing metadata must never affect the page's request result.
    }
  };

  const nativeFetch = window.fetch;
  window.fetch = function (
    this: Window,
    ...args: Parameters<typeof nativeFetch>
  ) {
    const result = nativeFetch.apply(this, args);
    void result.then(inspectResponse).catch(() => {});
    return result;
  };

  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (
    this: XMLHttpRequest,
    ...args: Parameters<typeof nativeSend>
  ) {
    this.addEventListener(
      "load",
      () => {
        try {
          if (
            !isSameOriginResponseUrl(this.responseURL) ||
            !isJsonContentType(this.getResponseHeader("content-type"))
          )
            return;
          const declaredLength = Number(
            this.getResponseHeader("content-length"),
          );
          if (
            Number.isFinite(declaredLength) &&
            declaredLength > MEDIA_LIMITS.jsonBytes
          )
            return;
          if (this.responseType === "json") inspect(this.response);
          else if (this.responseType === "" || this.responseType === "text") {
            const text = this.responseText;
            if (text.length <= MEDIA_LIMITS.jsonCharacters) inspect(text);
          }
        } catch {
          // Some response modes make responseText unavailable.
        }
      },
      { once: true },
    );
    return nativeSend.apply(this, args);
  };

  const inspectScript = (script: HTMLScriptElement) => {
    if (
      parsedScripts.has(script) ||
      script.type.toLowerCase() !== "application/json"
    )
      return;
    const text = script.textContent;
    if (!text) return;
    parsedScripts.add(script);
    if (text.length <= MEDIA_LIMITS.jsonCharacters) inspect(text);
  };
  const scanScripts = (root: ParentNode) => {
    if (root instanceof HTMLScriptElement) inspectScript(root);
    for (const script of root.querySelectorAll<HTMLScriptElement>(
      'script[type="application/json"]',
    ))
      inspectScript(script);
  };
  scanScripts(document);
  scheduleIdentities();
  new MutationObserver((mutations) => {
    scheduleIdentities();
    for (const mutation of mutations) {
      for (const added of mutation.addedNodes) {
        if (added instanceof HTMLScriptElement) inspectScript(added);
        else if (added instanceof Element || added instanceof DocumentFragment)
          scanScripts(added);
        else if (added.parentElement instanceof HTMLScriptElement)
          inspectScript(added.parentElement);
      }
    }
  }).observe(document, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["src"],
  });

  window.addEventListener("message", (event) => {
    if (
      event.source === window &&
      event.origin === location.origin &&
      event.data?.tag === BRIDGE_TAG &&
      event.data?.type === "request"
    ) {
      mirrorVideoIdentities();
      const records = [...cache.values()];
      if (records.length)
        window.postMessage({ tag: BRIDGE_TAG, records }, location.origin);
    }
  });
}

if (typeof window !== "undefined" && typeof document !== "undefined")
  installBridge();
