import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  tsconfig: "./tsconfig.build.json",
  sourcemap: true,
  clean: true,
  format: ["esm"],
  dts: false, // Disable type generation for now
  external: [
    "dotenv",
    "fs",
    "path",
    "https",
    "http",
    "@elizaos/core",
    "zod",
    "viem",
    "bignumber.js",
  ],
});
