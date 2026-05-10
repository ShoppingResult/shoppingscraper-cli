import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    cli: "src/cli.ts",
    index: "src/index.ts",
  },
  format: ["esm"],
  target: "node20",
  platform: "node",
  dts: true,
  sourcemap: true,
  clean: true,
  shims: false,
  splitting: false,
  banner: ({ format }) => {
    if (format === "esm") {
      return { js: "#!/usr/bin/env node" };
    }
    return {};
  },
});
