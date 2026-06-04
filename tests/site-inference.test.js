import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { inferSiteContext } from "../src/core/site-inference.js";

const servers = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        })
    )
  );
});

describe("site inference", () => {
  it("derives site name and summary from homepage metadata", async () => {
    const { url } = await startSite(`<!doctype html>
      <html lang="en">
        <head>
          <title>Price Papertrail | Pricing Evidence</title>
          <meta name="description" content="Price Papertrail tracks pricing evidence and product changes for commerce teams.">
        </head>
        <body>
          <h1>Price Papertrail</h1>
        </body>
      </html>`);

    const inferred = await inferSiteContext({ siteUrl: url });

    expect(inferred.ok).toBe(true);
    expect(inferred.name).toBe("Price Papertrail");
    expect(inferred.summary).toBe("Price Papertrail tracks pricing evidence and product changes for commerce teams.");
  });

  it("falls back to hostname context when fetching fails", async () => {
    const { url } = await startSite("error", { status: 500 });
    const inferred = await inferSiteContext({
      siteUrl: url,
      name: "Fallback Site",
      timeout: 100
    });

    expect(inferred.ok).toBe(false);
    expect(inferred.name).toBe("Fallback Site");
    expect(inferred.summary).toContain("publishes website context");
  });
});

async function startSite(body, options = {}) {
  const server = http.createServer((request, response) => {
    response.writeHead(options.status || 200, { "content-type": "text/html" });
    response.end(body);
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  return { server, url: `http://127.0.0.1:${address.port}/` };
}
