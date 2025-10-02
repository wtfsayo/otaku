import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  sourcemap: true,
  clean: false,
  format: ["esm"],
  dts: false,
  external: [
    "dotenv",
    "fs",
    "path",
    "https",
    "http",
    "zod",
    "@elizaos/core",
    "@reservoir0x/relay-sdk",
    "viem",
  ],
});
