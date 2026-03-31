import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Package version from [package.json](package.json); used for MCP server metadata and bridge probe identity. */
export const PACKAGE_VERSION: string = require('../package.json').version as string;
