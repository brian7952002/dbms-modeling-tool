import { describe, expect, it } from 'vitest';
import { measureText, wrapText } from './measure';

// Headless measurement is the deterministic fallback: 7.2px per character.
const width = (s: string) => measureText(s);

describe('wrapText', () => {
  it('wraps on word boundaries', () => {
    const lines = wrapText('one two three four five', width('one two'));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(width(line)).toBeLessThanOrEqual(width('one two'));
    expect(lines.join(' ')).toBe('one two three four five');
  });

  it('keeps the author\u2019s own line breaks', () => {
    expect(wrapText('alpha\nbeta', 1000)).toEqual(['alpha', 'beta']);
  });

  it('keeps blank lines between paragraphs', () => {
    expect(wrapText('a\n\nb', 1000)).toEqual(['a', '', 'b']);
  });

  it('breaks a word that cannot fit on its own line', () => {
    const lines = wrapText('supercalifragilistic', width('abcde'));
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(width(line)).toBeLessThanOrEqual(width('abcde'));
    expect(lines.join('')).toBe('supercalifragilistic');
  });

  it('returns a single empty line for empty text', () => {
    expect(wrapText('', 200)).toEqual(['']);
  });
});
