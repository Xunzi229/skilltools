export interface SentenceTranslation {
  original: string;
  translation: string | null;
  pending?: boolean;
  error?: string | null;
}

export type TransSegment =
  | { type: "text"; text: string }
  | {
      type: "sentence";
      original: string;
      translation: string | null;
      pending: boolean;
      error: string | null;
    };

/** Split into sentences. English periods only split when followed by space or end. */
export function splitSentences(text: string): string[] {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return [];
  if (!/[。！？….!?]/.test(trimmed)) {
    const lines = text
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean);
    return lines.length > 0 ? lines : [trimmed];
  }
  const parts = trimmed.split(/(?<=[。！？…])\s*|(?<=[.!?])(?=\s|$)\s*/);
  return parts.map((part) => part.trim()).filter(Boolean);
}

export function pairSentences(
  source: string,
  translated: string,
): Array<{ original: string; translation: string }> {
  const originals = splitSentences(source);
  const translations = splitSentences(translated);
  if (originals.length > 0 && originals.length === translations.length) {
    return originals.map((original, index) => ({
      original,
      translation: translations[index] ?? "",
    }));
  }
  const fallbackOriginal = source.replace(/\s+/g, " ").trim() || originals[0] || source;
  return [
    {
      original: fallbackOriginal,
      translation: translated.replace(/\s+/g, " ").trim(),
    },
  ];
}

export function findFlexibleRange(
  haystack: string,
  needle: string,
): { start: number; end: number } | null {
  if (!needle) return null;
  const exact = haystack.indexOf(needle);
  if (exact >= 0) {
    return { start: exact, end: exact + needle.length };
  }
  const normalized = needle.replace(/\s+/g, " ").trim();
  if (!normalized) return null;
  let needleIndex = 0;
  let start = -1;
  for (let index = 0; index < haystack.length; index += 1) {
    const char = haystack[index];
    if (/\s/.test(char)) {
      if (needleIndex < normalized.length && normalized[needleIndex] === " ") {
        if (start < 0) start = index;
        needleIndex += 1;
        while (index + 1 < haystack.length && /\s/.test(haystack[index + 1])) {
          index += 1;
        }
        if (needleIndex === normalized.length) {
          return { start, end: index + 1 };
        }
      }
      continue;
    }
    if (needleIndex < normalized.length && char === normalized[needleIndex]) {
      if (start < 0) start = index;
      needleIndex += 1;
      if (needleIndex === normalized.length) {
        return { start, end: index + 1 };
      }
      continue;
    }
    if (start >= 0) {
      index = start;
      start = -1;
      needleIndex = 0;
    }
  }
  return null;
}

function overlaps(
  start: number,
  end: number,
  used: Array<{ start: number; end: number }>,
): boolean {
  return used.some((range) => start < range.end && end > range.start);
}

/** Split `text` so each translated sentence is its own segment. Null = no hits. */
export function segmentWithTranslations(
  text: string,
  pairs: SentenceTranslation[],
): TransSegment[] | null {
  if (!text || pairs.length === 0) return null;
  const hits: Array<{
    start: number;
    end: number;
    original: string;
    translation: string | null;
    pending: boolean;
    error: string | null;
  }> = [];
  const used: Array<{ start: number; end: number }> = [];
  for (const pair of pairs) {
    const original = pair.original.trim();
    if (!original) continue;
    let from = 0;
    while (from < text.length) {
      const slice = text.slice(from);
      const found = findFlexibleRange(slice, original);
      if (!found) break;
      const start = from + found.start;
      const end = from + found.end;
      if (!overlaps(start, end, used)) {
        hits.push({
          start,
          end,
          original: text.slice(start, end),
          translation: pair.translation,
          pending: Boolean(pair.pending),
          error: pair.error ?? null,
        });
        used.push({ start, end });
      }
      from = end;
    }
  }
  if (hits.length === 0) return null;
  hits.sort((left, right) => left.start - right.start);
  const segments: TransSegment[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.start < cursor) continue;
    if (hit.start > cursor) {
      segments.push({ type: "text", text: text.slice(cursor, hit.start) });
    }
    segments.push({
      type: "sentence",
      original: hit.original,
      translation: hit.translation,
      pending: hit.pending,
      error: hit.error,
    });
    cursor = hit.end;
  }
  if (cursor < text.length) {
    segments.push({ type: "text", text: text.slice(cursor) });
  }
  return segments;
}
