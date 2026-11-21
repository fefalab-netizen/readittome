import { chunks } from './text.js';

const signature = line => line.trim().toLocaleLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ');
const pageNumber = line => /^(?:page\s+)?\d{1,5}(?:\s*(?:of|\/)\s*\d{1,5})?$/i.test(line.trim());

export function cleanPages(pages, { margins = true, numbers = true } = {}) {
  // Limit removal to short lines at page edges, repeated across distinct pages.
  const edgeCounts = new Map();
  const lines = pages.map(page => page.text.split(/\n+/).map(s => s.trim()).filter(Boolean));
  lines.forEach(rows => {
    const edges = [...rows.slice(0, 2), ...rows.slice(-2)].filter(s => s.length <= 100);
    for (const key of new Set(edges.map(signature))) edgeCounts.set(key, (edgeCounts.get(key) || 0) + 1);
  });
  const threshold = Math.max(3, Math.ceil(pages.length * 0.6));
  let removed = 0;
  const cleaned = pages.map((page, pageIndex) => {
    const rows = lines[pageIndex];
    const kept = rows.filter((line, index) => {
      const atEdge = index < 2 || index >= rows.length - 2;
      const drop = atEdge && ((numbers && pageNumber(line)) ||
        (margins && line.length <= 100 && (edgeCounts.get(signature(line)) || 0) >= threshold));
      if (drop) removed++;
      return !drop;
    });
    return { page: page.page, text: kept.join('\n') };
  });
  return { pages: cleaned, removed };
}

export function buildSegments(pages, options) {
  const result = cleanPages(pages, options);
  return { removed: result.removed, segments: result.pages.flatMap(page => chunks(page.text).map(text => ({ page: page.page, text }))) };
}
