import { SERVER } from "./config";
import { handleRequest, withCacheHeaders } from "./router";

const server = Bun.serve({
  hostname: SERVER.host,
  port: SERVER.port,
  async fetch(req) {
    const resp = await handleRequest(req);
    return withCacheHeaders(resp, req);
  }
});

console.log(`[star-office-ui] listening on http://${server.hostname}:${server.port}`);
