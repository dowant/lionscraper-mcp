import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { resolveLionscraperJsFromPackageDir } from '../src/utils/resolve-lionscraper-js.js';

describe('resolveLionscraperJsFromPackageDir', () => {
  it('keeps Unix root when resolving from dist/client', () => {
    const dir = '/usr/lib/node_modules/lionscraper/dist/client';
    const got = resolveLionscraperJsFromPackageDir(dir);
    expect(got).toBe('/usr/lib/node_modules/lionscraper/dist/lionscraper.js');
  });

  it('handles dist at end of path', () => {
    const dir = '/opt/lionscraper/dist';
    expect(resolveLionscraperJsFromPackageDir(dir)).toBe('/opt/lionscraper/dist/lionscraper.js');
  });

  it('handles Windows-style paths', () => {
    const dir = 'C:\\Program Files\\lionscraper\\dist\\mcp';
    const got = resolveLionscraperJsFromPackageDir(dir);
    expect(got).toBe('C:/Program Files/lionscraper/dist/lionscraper.js');
  });

  it('falls back when dist segment is missing', () => {
    const dir = '/tmp/dev/src';
    const got = resolveLionscraperJsFromPackageDir(dir);
    expect(got).toBe(path.join(dir, '..', '..', 'dist', 'lionscraper.js'));
  });
});
