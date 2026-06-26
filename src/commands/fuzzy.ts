/**
 * Small subsequence fuzzy matcher used by the command palette (and reusable for
 * quick-open). Returns a score (higher = better) or null when the query is not a
 * subsequence of the text. Rewards contiguous runs and early/boundary matches.
 */
export function fuzzyScore(text: string, query: string): number | null {
  if (!query) return 0;
  const t = text.toLowerCase();
  const q = query.toLowerCase();
  let ti = 0;
  let score = 0;
  let prevMatch = -2;
  for (let qi = 0; qi < q.length; qi++) {
    const ch = q[qi];
    let found = -1;
    for (; ti < t.length; ti++) {
      if (t[ti] === ch) {
        found = ti;
        break;
      }
    }
    if (found === -1) return null;
    score += 1;
    if (found === prevMatch + 1) score += 2; // contiguous run
    if (found === 0 || /[\s/\\._-]/.test(t[found - 1] ?? "")) score += 2; // boundary
    prevMatch = found;
    ti = found + 1;
  }
  return score;
}

export function fuzzyFilter<T>(
  items: T[],
  query: string,
  key: (item: T) => string,
): T[] {
  if (!query) return items;
  const scored: { item: T; score: number }[] = [];
  for (const item of items) {
    const s = fuzzyScore(key(item), query);
    if (s !== null) scored.push({ item, score: s });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}
