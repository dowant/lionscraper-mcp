import { describe, it, expect } from 'vitest';
import { normalizeLang, supportedLangFromLangEnv } from '../src/i18n/lang.js';
import {
  BridgeErrorCode,
  createBrowserNotInstalledError,
  createExtensionNotConnectedError,
} from '../src/types/errors.js';

describe('supportedLangFromLangEnv', () => {
  it('maps zh-CN and POSIX zh forms to zh-CN', () => {
    expect(supportedLangFromLangEnv('zh-CN')).toBe('zh-CN');
    expect(supportedLangFromLangEnv('zh_CN.UTF-8')).toBe('zh-CN');
    expect(supportedLangFromLangEnv('  zh-CN  ')).toBe('zh-CN');
  });

  it('maps en forms and C/POSIX to en-US', () => {
    expect(supportedLangFromLangEnv(undefined)).toBe('en-US');
    expect(supportedLangFromLangEnv('')).toBe('en-US');
    expect(supportedLangFromLangEnv('en_US.UTF-8')).toBe('en-US');
    expect(supportedLangFromLangEnv('C')).toBe('en-US');
    expect(supportedLangFromLangEnv('POSIX')).toBe('en-US');
  });

  it('defaults unknown tags to en-US', () => {
    expect(supportedLangFromLangEnv('fr_FR.UTF-8')).toBe('en-US');
  });
});

describe('normalizeLang', () => {
  it('defaults unknown to en-US', () => {
    expect(normalizeLang(undefined)).toBe('en-US');
    expect(normalizeLang('')).toBe('en-US');
    expect(normalizeLang('fr-FR')).toBe('en-US');
  });

  it('accepts en-US and zh-CN', () => {
    expect(normalizeLang('en-US')).toBe('en-US');
    expect(normalizeLang('zh-CN')).toBe('zh-CN');
  });
});

describe('createExtensionNotConnectedError', () => {
  it('localizes message and troubleshooting for zh-CN', () => {
    const err = createExtensionNotConnectedError(
      { bridgePort: 13808, sessionCount: 0 },
      'zh-CN',
    );
    expect(err.message).toContain('未连接到 LionScraper 扩展');
    expect(err.message).toContain('ping');
    expect(err.details).toMatchObject({
      hint: expect.stringContaining('终端'),
    });
    const steps = (err.details as { troubleshooting: string[] }).troubleshooting;
    expect(steps).toHaveLength(5);
    expect(steps[4]).toContain('13808');
    expect(steps[4]).toContain('ws://127.0.0.1:13808');
  });

  it('keeps English for en-US', () => {
    const err = createExtensionNotConnectedError(
      { bridgePort: 99, sessionCount: 0 },
      'en-US',
    );
    expect(err.message).toContain('LionScraper extension is not connected');
    const steps = (err.details as { troubleshooting: string[] }).troubleshooting;
    expect(steps[4]).toContain('99');
  });

  it('merges browserProbe into details when provided', () => {
    const err = createExtensionNotConnectedError(
      { bridgePort: 1, sessionCount: 0 },
      'en-US',
      { browserProbe: { browserRunning: true } },
    );
    expect((err.details as { browserProbe: { browserRunning: boolean } }).browserProbe.browserRunning).toBe(
      true,
    );
  });
});

describe('createBrowserNotInstalledError', () => {
  it('returns BROWSER_NOT_INSTALLED with localized zh-CN message', () => {
    const err = createBrowserNotInstalledError('zh-CN');
    expect(err.code).toBe(BridgeErrorCode.BROWSER_NOT_INSTALLED);
    expect(err.message).toContain('Chrome');
    expect((err.details as { extension: { chrome: string } }).extension.chrome).toContain('chromewebstore');
  });
});
