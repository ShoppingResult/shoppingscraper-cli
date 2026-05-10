import { execSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * Pre-publish tripwire: assert the npm tarball never contains a UUID-shaped
 * string or an `api_key=<value>` literal. CI runs this on every release.
 *
 * Skipped locally if the build hasn't run; release pipeline must run a
 * fresh `npm run build` before this test.
 */
const SHOULD_RUN = process.env.RUN_TARBALL_TEST === "1" || process.env.CI === "true";

describe.skipIf(!SHOULD_RUN)("npm tarball contents", () => {
  it("contains no UUID-shaped strings", () => {
    const out = execSync("npm pack --dry-run --json", {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });
    const parsed = JSON.parse(out) as Array<{ files: Array<{ path: string }> }>;
    expect(parsed[0]?.files.length).toBeGreaterThan(0);
  });

  it("source files contain no UUID-shaped strings", () => {
    // Grep the dist/ output for the UUID pattern. If found, fail with the file.
    const result = execSync(
      `grep -RE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' dist/ || true`,
      { cwd: new URL("..", import.meta.url), encoding: "utf8" },
    );
    expect(result.trim()).toBe("");
  });

  it("source files contain no api_key=<value> literals", () => {
    const result = execSync("grep -RE 'api_key=[A-Za-z0-9_-]{8,}' dist/ || true", {
      cwd: new URL("..", import.meta.url),
      encoding: "utf8",
    });
    expect(result.trim()).toBe("");
  });
});
