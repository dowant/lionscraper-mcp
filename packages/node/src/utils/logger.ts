import { inspect } from 'node:util';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

function formatArg(value: unknown): string {
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value);
    } catch {
      return inspect(value, { depth: 6, breakLength: 120 });
    }
  }
  return String(value);
}

function write(level: LogLevel, message: string, ...args: unknown[]): void {
  if (!shouldLog(level)) return;

  const prefix = `[${formatTimestamp()}] [${level.toUpperCase()}]`;
  const formatted = args.length > 0
    ? `${prefix} ${message} ${args.map(formatArg).join(' ')}`
    : `${prefix} ${message}`;

  process.stderr.write(formatted + '\n');
}

export const logger = {
  debug: (message: string, ...args: unknown[]) => write('debug', message, ...args),
  info: (message: string, ...args: unknown[]) => write('info', message, ...args),
  warn: (message: string, ...args: unknown[]) => write('warn', message, ...args),
  error: (message: string, ...args: unknown[]) => write('error', message, ...args),
};
