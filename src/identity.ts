type ObjectValue = Record<string, unknown>;

const MAX_DEPTH = 24;
const MAX_NODES = 2_000;
const MAX_CHILDREN = 100;

function own(value: ObjectValue, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function mediaId(value: unknown): string | undefined {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return;
    value = String(value);
  }
  if (typeof value !== "string" || value.length > 128) return;
  return /^\d+(?:_\d+)?$/.test(value) ? value : undefined;
}

function shortcode(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 128) return;
  return /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

export function identityFromProps(
  value: unknown,
): { mediaId?: string; code?: string } | undefined {
  const pending: Array<{
    value: unknown;
    depth: number;
    queryReference: boolean;
  }> = [{ value, depth: 0, queryReference: false }];
  const seen = new WeakSet<object>();
  let foundMediaId: string | undefined;
  let foundCode: string | undefined;
  let visited = 0;

  const addMediaId = (candidate: unknown): boolean => {
    const next = mediaId(candidate);
    if (!next) return true;
    if (foundMediaId && foundMediaId !== next) return false;
    foundMediaId = next;
    return true;
  };
  const addCode = (candidate: unknown): boolean => {
    const next = shortcode(candidate);
    if (!next) return true;
    if (foundCode && foundCode !== next) return false;
    foundCode = next;
    return true;
  };

  while (pending.length && visited < MAX_NODES) {
    const current = pending.pop()!;
    if (
      current.value === null ||
      typeof current.value !== "object" ||
      seen.has(current.value)
    )
      continue;
    seen.add(current.value);
    visited += 1;

    if (Array.isArray(current.value)) {
      if (current.value.length > MAX_CHILDREN) return;
      if (current.depth >= MAX_DEPTH) {
        if (current.value.length) return;
        continue;
      }
      for (let index = current.value.length - 1; index >= 0; index -= 1) {
        const descriptor = Object.getOwnPropertyDescriptor(
          current.value,
          index,
        );
        if (descriptor && "value" in descriptor)
          pending.push({
            value: descriptor.value,
            depth: current.depth + 1,
            queryReference: current.queryReference,
          });
      }
      continue;
    }

    const object = current.value as ObjectValue;
    if (
      !addMediaId(own(object, "mediaId")) ||
      !addMediaId(own(object, "videoID")) ||
      (current.queryReference && !addMediaId(own(object, "id"))) ||
      !addCode(own(object, "code")) ||
      !addCode(own(object, "shortcode"))
    )
      return;

    if (current.depth >= MAX_DEPTH) {
      if (
        ["queryReference", "children", "props"].some((key) => {
          const child = own(object, key);
          return child !== null && typeof child === "object";
        })
      )
        return;
      continue;
    }
    for (const key of ["queryReference", "children", "props"] as const) {
      const child = own(object, key);
      if (child !== null && typeof child === "object")
        pending.push({
          value: child,
          depth: current.depth + 1,
          queryReference: key === "queryReference",
        });
    }
  }

  if (pending.length) return;
  return foundMediaId || foundCode
    ? { mediaId: foundMediaId, code: foundCode }
    : undefined;
}
