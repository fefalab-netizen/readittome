export function chunks(text, limit = 230) {
  const clean = text.replace(/(\p{L})-\s*\n\s*(\p{L})/gu, '$1$2').replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const sentences = typeof Intl.Segmenter === 'function' ? [...new Intl.Segmenter(undefined, { granularity: 'sentence' }).segment(clean)].map(x => x.segment) : clean.match(/[^.!?]+[.!?]*\s*/g) || [clean];
  const result = [];
  for (const sentence of sentences) {
    let part = '';
    for (const word of sentence.trim().split(/\s+/)) {
      if (part && part.length + word.length + 1 > limit) { result.push(part); part = ''; }
      part += (part ? ' ' : '') + word;
    }
    if (part) result.push(part);
  }
  return result;
}
export function extractLines(items) {
  let text = '', lastY = null;
  for (const item of items) {
    if (typeof item.str !== 'string') continue;
    const y = item.transform?.[5];
    if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 3) text += '\n';
    text += item.str + (item.hasEOL ? '\n' : ' ');
    lastY = y ?? lastY;
  }
  return text;
}
