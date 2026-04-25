import { createReadStream, existsSync, statSync, watch } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 5173);
const clients = new Set();

const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".webp": "image/webp"
};

const liveReloadSnippet = `
<script>
  (() => {
    const events = new EventSource("/__live-reload");
    events.onmessage = event => {
      if (event.data === "reload") window.location.reload();
    };
  })();
</script>`;

const server = createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host}`);

  if (url.pathname === "/__live-reload") {
    response.writeHead(200, {
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "Content-Type": "text/event-stream"
    });
    response.write("\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const requestedPath = resolve(root, `.${safePath}`);
  const indexPath = join(requestedPath, "index.html");
  const filePath = existsSync(requestedPath) && statSync(requestedPath).isDirectory()
    ? indexPath
    : requestedPath;

  if (!filePath.startsWith(root) || !existsSync(filePath) || statSync(filePath).isDirectory()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = extname(filePath);
  response.writeHead(200, {
    "Cache-Control": "no-cache",
    "Content-Type": mimeTypes[extension] || "application/octet-stream"
  });

  if (extension === ".html") {
    let html = "";
    const stream = createReadStream(filePath, "utf8");
    stream.on("data", chunk => {
      html += chunk;
    });
    stream.on("end", () => {
      response.end(html.replace("</body>", `${liveReloadSnippet}\n</body>`));
    });
    stream.on("error", () => {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Server error");
    });
    return;
  }

  createReadStream(filePath).pipe(response);
});

let reloadTimer;
watch(root, { recursive: true }, (_eventType, fileName) => {
  if (!fileName || fileName.includes("node_modules") || fileName.startsWith(".")) return;

  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    for (const client of clients) {
      client.write("data: reload\n\n");
    }
  }, 100);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Live server running at http://localhost:${port}`);
});
