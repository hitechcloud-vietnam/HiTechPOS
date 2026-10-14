import http from "node:http";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve("dist");
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".json": "application/json",
  ".ttf": "font/ttf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
http
  .createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    let requested;
    try {
      requested = path.resolve(root, "." + decodeURIComponent(url.pathname));
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    if (requested !== root && !requested.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(requested) || fs.statSync(requested).isDirectory())
      requested = path.join(root, "index.html");
    res.setHeader(
      "Content-Type",
      types[path.extname(requested)] ?? "application/octet-stream",
    );
    res.setHeader("Cache-Control", "no-store");
    fs.createReadStream(requested).pipe(res);
  })
  .listen(8082, "127.0.0.1", () =>
    console.log("Posnic preview: http://127.0.0.1:8082"),
  );
