// No import attribute: tsup/esbuild inlines the JSON at build time, so the
// runtime never loads package.json, and tsc's module target predates
// `with { type: "json" }` syntax.
import pkg from "../package.json";

// Derived from package.json so changesets version bumps propagate — a
// hardcoded constant here shipped 0.2.0 reporting itself as 0.1.0.
export const VERSION: string = pkg.version;
export const ENVELOPE_VERSION = 1;
export const USER_AGENT = `shoppingscraper-cli/${VERSION}`;
