import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve("dist");
http
  .createServer((req, res) => {
    const pathname = decodeURIComponent(
      new URL(req.url, "http://localhost").pathname,
    );
    const candidate = path.resolve(root, "." + pathname);
    if (!candidate.startsWith(root + path.sep) && candidate !== root) {
      res.writeHead(403).end();
      return;
    }
    let file = candidate;
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, "index.html");
    } catch {
      file = path.join(root, "index.html");
    }
    const types = {
      ".html": "text/html",
      ".js": "application/javascript",
      ".css": "text/css",
      ".json": "application/json",
      ".png": "image/png",
      ".ttf": "font/ttf",
    };
    res.setHeader(
      "Content-Type",
      types[path.extname(file)] ?? "application/octet-stream",
    );
    const stream = fs.createReadStream(file);
    stream.on("error", () => res.writeHead(404).end());
    stream.pipe(res);
  })
  .listen(4173, "127.0.0.1", () =>
    console.log("Sample preview at http://127.0.0.1:4173"),
  );
