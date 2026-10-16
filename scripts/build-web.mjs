import { copyFile, mkdir } from "node:fs/promises";
import { build } from "esbuild";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("../", import.meta.url)));
const publicDirectory = resolve(projectRoot, "public");
const assetsDirectory = resolve(publicDirectory, "assets");

await mkdir(assetsDirectory, { recursive: true });
await build({
  entryPoints: [resolve(projectRoot, "web/app.js")],
  outfile: resolve(publicDirectory, "app.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2022"],
  minify: true,
  legalComments: "none",
});
await copyFile(
  resolve(projectRoot, "node_modules/@rive-app/canvas/rive.wasm"),
  resolve(assetsDirectory, "rive.wasm"),
);
