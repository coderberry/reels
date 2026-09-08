export interface VideoSource {
  url: string;
  width: number;
  height: number;
}
export interface MediaRecord {
  id: string;
  code?: string;
  posters: string[];
  sources: VideoSource[];
}
export const BRIDGE_TAG = "local-reel-controls:media:v1";
export function safeMediaUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 16384) return;
  // URL() discards empty userinfo and a default :443 port. Reject them before normalization.
  const authority = value.match(/^https:\/\/([^/?#]+)/i)?.[1];
  if (!authority || /[@:\\\s]/.test(authority)) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port)
      return;
    if (
      !["cdninstagram.com", "fbcdn.net"].some(
        (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
      )
    )
      return;
    return url.href;
  } catch {
    return;
  }
}
export function mediaPath(value: string): string {
  try {
    return new URL(value).pathname;
  } catch {
    return "";
  }
}
export function bestSource(sources: VideoSource[]): VideoSource | undefined {
  return sources
    .filter((s) => safeMediaUrl(s.url))
    .sort((a, b) => b.width * b.height - a.width * a.height)[0];
}
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
export function seekTime(
  current: number,
  delta: number,
  duration: number,
): number {
  return Math.max(
    0,
    Math.min(
      Number.isFinite(duration) ? Math.max(0, duration - 0.05) : Infinity,
      current + delta,
    ),
  );
}
export function sanitizeRecord(value: unknown): MediaRecord | undefined {
  if (!value || typeof value !== "object") return;
  const data = value as Partial<MediaRecord>;
  if (
    typeof data.id !== "string" ||
    !Array.isArray(data.sources) ||
    !Array.isArray(data.posters)
  )
    return;
  const sources = data.sources.slice(0, 20).flatMap((s) => {
    if (!s || typeof s !== "object") return [];
    const url = safeMediaUrl(s.url);
    return url
      ? [
          {
            url,
            width: Number.isFinite(s.width) ? Math.max(0, s.width) : 0,
            height: Number.isFinite(s.height) ? Math.max(0, s.height) : 0,
          },
        ]
      : [];
  });
  if (!sources.length) return;
  return {
    id: data.id.slice(0, 128),
    code: typeof data.code === "string" ? data.code.slice(0, 128) : undefined,
    posters: data.posters
      .slice(0, 20)
      .filter((p): p is string => typeof p === "string" && p.length < 16384),
    sources,
  };
}
