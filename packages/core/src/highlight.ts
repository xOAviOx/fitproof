/**
 * Finds `quote` in `text` under the same rules as `quoteExists` (NFKC, case-insensitive, any run of
 * whitespace equal to one space) and returns its range in the original text.
 */
export function locateQuote(text: string, quote: string): { start: number; end: number } | null {
  const needle = normalizeForSearch(quote).value.trim();
  if (!needle) return null;
  const haystack = normalizeForSearch(text);
  const index = haystack.value.indexOf(needle);
  if (index < 0) return null;
  const start = haystack.origins[index];
  const last = haystack.origins[index + needle.length - 1];
  return start === undefined || last === undefined ? null : { start, end: last + 1 };
}

/** Normalized text plus, for every normalized character, the index it came from. */
function normalizeForSearch(text: string) {
  let value = "";
  const origins: number[] = [];
  let index = 0;
  for (const character of text) {
    if (/\s/u.test(character)) {
      if (value.length > 0 && !value.endsWith(" ")) {
        value += " ";
        origins.push(index);
      }
    } else {
      for (const part of character.normalize("NFKC").toLocaleLowerCase("en")) {
        value += part;
        origins.push(index);
      }
    }
    index += character.length;
  }
  return { value, origins };
}

export type HighlightSegment = { text: string; ids: string[] };

/** Splits `text` into plain and highlighted runs. A run can belong to several marks. */
export function highlightSegments(
  text: string,
  marks: readonly { id: string; quote: string }[],
): HighlightSegment[] {
  const ranges = marks
    .map((mark) => ({ id: mark.id, range: locateQuote(text, mark.quote) }))
    .filter((mark): mark is { id: string; range: { start: number; end: number } } => mark.range !== null);
  const cuts = [
    ...new Set([0, text.length, ...ranges.flatMap(({ range }) => [range.start, range.end])]),
  ].sort((a, b) => a - b);
  const segments: HighlightSegment[] = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const start = cuts[i] ?? 0;
    const end = cuts[i + 1] ?? text.length;
    if (end <= start) continue;
    const ids = ranges.filter(({ range }) => range.start <= start && range.end >= end).map(({ id }) => id);
    const previous = segments.at(-1);
    if (previous && previous.ids.join() === ids.join()) previous.text += text.slice(start, end);
    else segments.push({ text: text.slice(start, end), ids });
  }
  return segments;
}
