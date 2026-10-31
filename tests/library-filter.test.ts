import { describe, expect, it } from 'vitest';
import { filterBooks, type Book } from '../src/domain/library';

function book(path: string, title: string, author?: string): Book {
  return Object.freeze({ path, name: path, title, author, size: 1, mtime: 1, metadataStatus: 'ready' });
}

describe('library search and sorting', () => {
  const books = Object.freeze([
    book('c.epub', 'Ёжик в тумане', 'Сергей Козлов'),
    book('b.epub', 'Йога', 'Автор'),
    book('a.epub', 'Книга 10'),
    book('d.epub', 'Книга 2', 'Другой автор'),
  ]);

  it('matches Cyrillic case, ё/е, surrounding whitespace and canonical Unicode', () => {
    expect(filterBooks(books, '  ЕЖИК  ', 'title').map(b => b.path)).toEqual(['c.epub']);
    expect(filterBooks(books, 'КОЗЛОВ', 'title').map(b => b.path)).toEqual(['c.epub']);
    expect(filterBooks(books, 'И\u0306ОГА', 'title').map(b => b.path)).toEqual(['b.epub']);
  });

  it('returns a sorted copy with numeric titles without mutating frozen source or records', () => {
    const result = filterBooks(books, 'книга', 'title');
    expect(result.map(b => b.title)).toEqual(['Книга 2', 'Книга 10']);
    expect(books.map(b => b.path)).toEqual(['c.epub', 'b.epub', 'a.epub', 'd.epub']);
    expect(result[0]).toBe(books[3]);
    expect(filterBooks(books, ' ', 'title')).not.toBe(books);
    expect(filterBooks(books, '').map(b => b.path)).toEqual(['c.epub', 'b.epub', 'a.epub', 'd.epub']);
  });

  it('sorts authors and handles missing metadata', () => {
    expect(filterBooks(books, '', 'author').map(b => b.author)).toEqual([undefined, 'Автор', 'Другой автор', 'Сергей Козлов']);
    expect(filterBooks(books, 'missing', 'author')).toEqual([]);
    expect(filterBooks([], '', 'title')).toEqual([]);
  });

  it('uses the exact path as a deterministic tie-break for equal normalized sort keys', () => {
    const tied = [book('Books/b.epub', 'Ёж', 'Автор'), book('Books/a.epub', 'Еж', 'АВТОР')];
    for (const sort of ['title', 'author'] as const) {
      expect(filterBooks(tied, '', sort).map(b => b.path)).toEqual(['Books/a.epub', 'Books/b.epub']);
      expect(filterBooks([...tied].reverse(), '', sort).map(b => b.path)).toEqual(['Books/a.epub', 'Books/b.epub']);
    }
  });
});
