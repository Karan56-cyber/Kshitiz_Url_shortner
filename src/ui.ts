import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";

const publicDirectory = join(__dirname, "../public");

const publicFiles = {
  "/": { file: "index.html", contentType: "text/html; charset=utf-8" },
  "/app.css": { file: "app.css", contentType: "text/css; charset=utf-8" },
  "/app.js": {
    file: "app.js",
    contentType: "text/javascript; charset=utf-8",
    cache: true,
  },
  "/assets/login.riv": {
    file: "assets/login.riv",
    contentType: "application/octet-stream",
    cache: true,
  },
  "/assets/rive.wasm": {
    file: "assets/rive.wasm",
    contentType: "application/wasm",
    cache: true,
  },
} as const;

export function registerFrontend(app: FastifyInstance): void {
  for (const [route, asset] of Object.entries(publicFiles)) {
    app.get(route, async (_request, reply) => {
      const content = await readFile(join(publicDirectory, asset.file));
      reply.type(asset.contentType);
      if ("cache" in asset && asset.cache) {
        reply.header("Cache-Control", "public, max-age=3600");
      } else {
        reply.header("Cache-Control", "no-cache");
      }
      return reply.send(content);
    });
  }
}
