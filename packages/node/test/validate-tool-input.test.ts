import { describe, expect, it } from 'vitest';
import { validateToolInput } from '../src/mcp/validate-tool-input.js';

describe('validateToolInput', () => {
  it('accepts empty ping args', () => {
    expect(validateToolInput('ping', {}, 'en-US')).toBeNull();
  });

  it('rejects scrape without url', () => {
    const msg = validateToolInput('scrape', {}, 'en-US');
    expect(msg).toBeTruthy();
    expect(msg).toMatch(/url/i);
  });

  it('rejects invalid delay type', () => {
    const msg = validateToolInput('scrape', { url: 'https://a.com', delay: 'x' as unknown as number }, 'en-US');
    expect(msg).toBeTruthy();
  });
});
