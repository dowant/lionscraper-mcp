import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { logger } from './logger.js';

const CONFIG_DIR_NAME = '.lionscraper';
const PORT_FILE_NAME = 'port';

function getConfigDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

function getPortFilePath(): string {
  return path.join(getConfigDir(), PORT_FILE_NAME);
}

export function writePortFile(port: number): void {
  const configDir = getConfigDir();
  const portFile = getPortFilePath();

  try {
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    fs.writeFileSync(portFile, String(port), 'utf-8');
    logger.info(`Port file written: ${portFile} → ${port}`);
  } catch (err) {
    logger.warn(`Failed to write port file: ${portFile}`, err);
  }
}

export function cleanupPortFile(): void {
  const portFile = getPortFilePath();

  try {
    if (fs.existsSync(portFile)) {
      fs.unlinkSync(portFile);
      logger.info(`Port file cleaned up: ${portFile}`);
    }
  } catch (err) {
    logger.warn(`Failed to clean up port file: ${portFile}`, err);
  }
}

export function readPortFile(): number | null {
  const portFile = getPortFilePath();

  try {
    if (fs.existsSync(portFile)) {
      const content = fs.readFileSync(portFile, 'utf-8').trim();
      const port = parseInt(content, 10);
      return isNaN(port) ? null : port;
    }
  } catch {
    // ignore
  }

  return null;
}
