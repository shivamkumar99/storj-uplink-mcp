/**
 * The package version, read from package.json at startup.
 *
 * Hardcoding it here means it silently drifts from the published version the
 * moment someone bumps package.json — clients then see a version that does not
 * exist. A test asserts the two agree.
 */
import { createRequire } from 'node:module';

interface PackageManifest {
  readonly version: string;
}

const require = createRequire(import.meta.url);

// dist/core/version.js → ../../package.json, and src/core/version.ts → ../../package.json
export const VERSION: string = (require('../../package.json') as PackageManifest).version;
