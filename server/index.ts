import { SECURITY, SERVER } from "./config";
import { handleRequest, withCacheHeaders } from "./router";

if (SECURITY.isProduction) {
  if (SERVER.assetDrawerPass === "1234") {
    throw new Error("ASSET_DRAWER_PASS must be changed in production.");
  }
  if (!SECURITY.apiToken) {
    throw new Error("STAR_OFFICE_API_TOKEN is required in production.");
  }
}

const server = Bun.serve({
  hostname: SERVER.host,
  port: SERVER.port,
  async fetch(req) {
    const resp = await handleRequest(req);
    return withCacheHeaders(resp, req);
  }
});

console.log(`[star-office-ui] listening on http://${server.hostname}:${server.port}`);
