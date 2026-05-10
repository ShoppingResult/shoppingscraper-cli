import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { SscError } from "./errors.js";

export interface ResolvedConfig {
  apiKey: string;
  source: "flag" | "env" | "file";
  baseUrl: string;
  appBaseUrl: string;
  timeoutMs: number;
  retries: number;
  concurrency: number;
  maxSpendCredits: number | null;
  pretty: boolean;
  quiet: boolean;
}

export interface ConfigInputs {
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  appBaseUrl?: string | undefined;
  timeoutMs?: number | undefined;
  retries?: number | undefined;
  concurrency?: number | undefined;
  maxSpendCredits?: number | null | undefined;
  pretty?: boolean | undefined;
  quiet?: boolean | undefined;
}

const DEFAULT_BASE_URL = "https://api.shoppingscraper.com";
const DEFAULT_APP_BASE_URL = "https://app.shoppingscraper.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 2;
const DEFAULT_CONCURRENCY = 5;
const DEFAULT_MAX_SPEND_CREDITS = 100;

export function configPath(): string {
  return join(homedir(), ".config", "ssc", "config.json");
}

interface FileConfig {
  api_key?: string;
  base_url?: string;
  app_base_url?: string;
}

function readFileConfig(): FileConfig | null {
  const path = configPath();
  try {
    const stat = statSync(path);
    if (!stat.isFile()) return null;
    // On POSIX, warn if file is world/group-readable. We don't enforce —
    // some CI setups use 0644 — but we surface a heads-up via stderr.
    if (process.platform !== "win32" && (stat.mode & 0o077) !== 0) {
      process.stderr.write(
        `[ssc] warning: ${path} has loose permissions (mode ${(stat.mode & 0o777).toString(8)}). chmod 600 recommended.\n`,
      );
    }
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as FileConfig;
    return parsed;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    return null;
  }
}

export function resolveConfig(inputs: ConfigInputs = {}): ResolvedConfig {
  const fileCfg = readFileConfig();

  const apiKey = inputs.apiKey ?? process.env.SSC_API_KEY ?? fileCfg?.api_key;
  if (!apiKey) {
    throw new SscError(
      "AUTH_MISSING",
      'No API key found. Set SSC_API_KEY environment variable or create ~/.config/ssc/config.json with {"api_key": "..."}. See https://app.shoppingscraper.com/apiguide',
    );
  }

  const source: ResolvedConfig["source"] = inputs.apiKey
    ? "flag"
    : process.env.SSC_API_KEY
      ? "env"
      : "file";

  return {
    apiKey,
    source,
    baseUrl: inputs.baseUrl ?? process.env.SSC_BASE_URL ?? fileCfg?.base_url ?? DEFAULT_BASE_URL,
    appBaseUrl:
      inputs.appBaseUrl ??
      process.env.SSC_APP_BASE_URL ??
      fileCfg?.app_base_url ??
      DEFAULT_APP_BASE_URL,
    timeoutMs: inputs.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    retries: inputs.retries ?? DEFAULT_RETRIES,
    concurrency: inputs.concurrency ?? DEFAULT_CONCURRENCY,
    maxSpendCredits:
      inputs.maxSpendCredits === undefined ? DEFAULT_MAX_SPEND_CREDITS : inputs.maxSpendCredits,
    pretty: inputs.pretty ?? false,
    quiet: inputs.quiet ?? false,
  };
}
