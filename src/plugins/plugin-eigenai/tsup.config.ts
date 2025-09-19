import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  tsconfig: "./tsconfig.build.json",
  sourcemap: true,
  clean: true,
  format: ["esm"],
  dts: true,
  external: [
    "dotenv",
    "fs",
    "path",
    "https",
    "http",
    "zod",
    "@elizaos/core",
    "@ai-sdk/openai",
    "ai",
    "js-tiktoken",
    "undici"
  ],
});
