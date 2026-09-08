import { mediaPath, type MediaRecord } from "./core";

export interface MediaIdentity {
  source: string;
  poster: string;
  code?: string;
  mediaId?: string;
}

type Match =
  | { kind: "none" }
  | { kind: "unique"; record: MediaRecord }
  | { kind: "ambiguous" };

function uniqueMatch(
  records: readonly MediaRecord[],
  predicate: (record: MediaRecord) => boolean,
): Match {
  let match: MediaRecord | undefined;
  for (const record of records) {
    if (!predicate(record)) continue;
    if (match) return { kind: "ambiguous" };
    match = record;
  }
  return match ? { kind: "unique", record: match } : { kind: "none" };
}

function comparablePath(value: string): string | undefined {
  const path = mediaPath(value);
  return path.startsWith("/") ? path : undefined;
}

function normalizedMediaId(value: string): string {
  return value.match(/^(\d+)(?:_\d+)?$/)?.[1] ?? value;
}

export function shortcodeFromPath(pathname: string): string | undefined {
  return pathname.match(/^\/(?:reel|reels|p)\/([A-Za-z0-9_-]+)\/?$/)?.[1];
}

export function matchMediaRecord(
  records: Iterable<MediaRecord>,
  identity: MediaIdentity,
): MediaRecord | undefined {
  const candidates = [...records];
  const source = comparablePath(identity.source);
  if (source) {
    const match = uniqueMatch(candidates, (record) =>
      record.sources.some(
        (candidate) => comparablePath(candidate.url) === source,
      ),
    );
    if (match.kind === "unique") return match.record;
    if (match.kind === "ambiguous") return;
  }

  const poster = comparablePath(identity.poster);
  if (poster) {
    const match = uniqueMatch(candidates, (record) =>
      record.posters.some((candidate) => comparablePath(candidate) === poster),
    );
    if (match.kind === "unique") return match.record;
    if (match.kind === "ambiguous") return;
  }

  if (identity.mediaId) {
    const mediaId = normalizedMediaId(identity.mediaId);
    const match = uniqueMatch(
      candidates,
      (record) => normalizedMediaId(record.id) === mediaId,
    );
    if (match.kind === "unique") return match.record;
    return;
  }

  if (!identity.code) return;
  const match = uniqueMatch(
    candidates,
    (record) => record.code === identity.code,
  );
  return match.kind === "unique" ? match.record : undefined;
}
