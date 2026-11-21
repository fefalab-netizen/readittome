export const APP_VERSION = '2.0.0';

export function normalizeBook(book) {
  const segments = Array.isArray(book.segments) ? book.segments : [];
  const cursor = Math.max(0, Math.min(segments.length, Math.trunc(Number(book.cursor) || 0)));
  return { ...book, segments, cursor,
    offset: Math.max(0, Math.min(segments[cursor]?.text.length || 0, Math.trunc(Number(book.offset) || 0))),
    bookmarks: Array.isArray(book.bookmarks) ? book.bookmarks : [],
    lastListened: Number(book.lastListened) || 0,
  };
}

export function wordStart(text, offset) {
  let index = Math.max(0, Math.min(text.length, Math.trunc(offset) || 0));
  while (index > 0 && index < text.length && !/\s/u.test(text[index - 1]) && !/\s/u.test(text[index])) index--;
  return index;
}

export function movePassage(book, delta) {
  return { cursor: Math.max(0, Math.min(book.segments.length - 1, book.cursor + delta)), offset: 0 };
}

export function sortedBooks(books, query = '', order = 'recent') {
  const needle = query.trim().toLocaleLowerCase();
  return books.filter(book => book.title.toLocaleLowerCase().includes(needle)).sort((a, b) =>
    order === 'title' ? a.title.localeCompare(b.title) :
      order === 'added' ? b.added - a.added : (b.lastListened || b.added) - (a.lastListened || a.added));
}

export function bookmarkAt(book, label, id) {
  const segment = book.segments[book.cursor];
  if (!segment) return null;
  return { id, label: label.trim() || `Page ${segment.page}`, cursor: book.cursor, offset: book.offset || 0,
    page: segment.page, text: segment.text, created: Date.now() };
}

// Used when cleanup changes the passage count. Never retain stale array indices.
export function relocate(segments, location) {
  let cursor = segments.findIndex(s => s.page === location.page && s.text === location.text);
  if (cursor >= 0) return { cursor, offset: Math.min(location.offset || 0, segments[cursor].text.length) };
  cursor = segments.findIndex(s => s.page >= location.page);
  return { cursor: cursor < 0 ? segments.length : cursor, offset: 0 };
}
