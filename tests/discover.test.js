import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { normalizeCrawlUrl } from "../src/core/discover.js";
import { makeTempRoot, readJson, runCli, runCliAsync } from "./helpers.js";

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

describe("discover", () => {
  it("discover --help shows command options", () => {
    const result = runCli(["discover", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--url <url>");
    expect(result.stdout).toContain("--max-pages <number>");
    expect(result.stdout).toContain("--keep-workdir");
  });

  it("normalizes crawl URLs deterministically", () => {
    expect(normalizeCrawlUrl("/About?x=1#team", "https://EXAMPLE.com/")).toBe("https://example.com/About");
    expect(normalizeCrawlUrl("mailto:test@example.com", "https://example.com/")).toBeNull();
    expect(normalizeCrawlUrl("javascript:void(0)", "https://example.com/")).toBeNull();
  });

  it("discovers homepage-only sites without inventing pages", async () => {
    const { url } = await startSite({
      "/": html("Home", "<h1>Example</h1><p>Trusted service since 2020.</p>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.discovery.status).toBe("draft_review_required");
    expect(draft.sections.map((section) => section.id)).toEqual(["home"]);
    expect(draft.sections.some((section) => section.id === "about")).toBe(false);
    expect(draft.discoveryCandidates.claims[0].reviewRequired).toBe(true);
  });

  it("uses sitemap URLs as crawl candidates", async () => {
    const { url } = await startSite({
      "/": html("Home", "<h1>Home</h1>"),
      "/service": html("Service", "<h1>Service</h1>"),
      "/sitemap.xml": {
        contentType: "application/xml",
        body: `<?xml version="1.0"?><urlset><url><loc>__BASE__/service</loc></url></urlset>`
      }
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.sections.map((section) => section.id)).toContain("service");
  });

  it("enforces same origin and skips off-origin links", async () => {
    const { url } = await startSite({
      "/": html("Home", '<h1>Home</h1><a href="https://example.net/out">External</a><a href="/local">Local</a>'),
      "/local": html("Local", "<h1>Local</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(draft.sections.map((section) => section.id)).toEqual(["home", "local"]);
    expect(draft.discovery.warnings.some((warning) => warning.includes("off-origin"))).toBe(true);
  });

  it("enforces max-pages", async () => {
    const { url } = await startSite({
      "/": html("Home", '<a href="/a">A</a><a href="/b">B</a>'),
      "/a": html("A", "<h1>A</h1>"),
      "/b": html("B", "<h1>B</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    await runCliAsync(["discover", "--url", url, "--out", out, "--max-pages", "1", "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(draft.sections).toHaveLength(1);
  });

  it("enforces max-depth", async () => {
    const { url } = await startSite({
      "/": html("Home", '<a href="/level-1">One</a>'),
      "/level-1": html("One", '<a href="/level-2">Two</a>'),
      "/level-2": html("Two", "<h1>Two</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    await runCliAsync(["discover", "--url", url, "--out", out, "--max-depth", "1", "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(draft.sections.map((section) => section.id)).toEqual(["home", "level-1"]);
  });

  it("skips non-HTML assets", async () => {
    const { url } = await startSite({
      "/": html("Home", '<a href="/logo.png">Logo</a><a href="/page">Page</a>'),
      "/logo.png": { contentType: "image/png", body: "not really a png" },
      "/page": html("Page", "<h1>Page</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(draft.sections.map((section) => section.url).some((sectionUrl) => sectionUrl.endsWith(".png"))).toBe(false);
  });

  it("discover --dry-run writes no output", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", "--url", url, "--out", out, "--dry-run", "--delay-ms", "0"]);

    expect(result.status).toBe(0);
    await expect(fs.stat(out)).rejects.toThrow();
    expect(JSON.parse(result.stdout).discovery.status).toBe("draft_review_required");
  });

  it("discover --json returns structured output", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", "--url", url, "--out", out, "--json", "--force", "--delay-ms", "0"]);
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary.pagesIncluded).toBe(1);
    expect(parsed.config.discovery.status).toBe("draft_review_required");
  });

  it("preserves workdir corpus when requested", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    const workdir = path.join(root, "corpus");

    const result = await runCliAsync([
      "discover",
      "--url",
      url,
      "--out",
      out,
      "--workdir",
      workdir,
      "--keep-workdir",
      "--force",
      "--delay-ms",
      "0"
    ]);

    expect(result.status).toBe(0);
    await expect(fs.stat(path.join(workdir, "crawl-manifest.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(workdir, "config.draft.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(workdir, "warnings.json"))).resolves.toBeTruthy();
    expect((await fs.readdir(path.join(workdir, "pages"))).length).toBeGreaterThan(0);
    expect((await fs.readdir(path.join(workdir, "extracts"))).length).toBeGreaterThan(0);
  });

  it("generated draft config validates enough for allow-draft generation", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);

    const result = runCli(["generate", "--config", out, "--out", path.join(root, "public"), "--allow-draft", "--dry-run"]);

    expect(result.status).toBe(0);
  });

  it("generate refuses draft_review_required config by default", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);

    const result = runCli(["generate", "--config", out, "--out", path.join(root, "public")]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Discovered drafts require human review");
  });

  it("generate --allow-draft works with warning", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    const publicRoot = path.join(root, "public");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);

    const result = runCli(["generate", "--config", out, "--out", publicRoot, "--allow-draft", "--force"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WARN Generating from an unreviewed discovery draft");
    await expect(fs.stat(path.join(publicRoot, "sitectx.json"))).resolves.toBeTruthy();
  });

  it("generate works after discovery status is reviewed", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    const publicRoot = path.join(root, "public");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);
    draft.discovery.status = "reviewed";
    await fs.writeFile(out, JSON.stringify(draft, null, 2), "utf8");

    const result = runCli(["generate", "--config", out, "--out", publicRoot, "--force"]);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("unreviewed discovery draft");
  });

  it("does not publish discoveryCandidates into sitectx.json", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1><h2>What is included?</h2>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    const publicRoot = path.join(root, "public");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    expect(runCli(["generate", "--config", out, "--out", publicRoot, "--allow-draft", "--force"]).status).toBe(0);

    const context = await readJson(path.join(publicRoot, "sitectx.json"));

    expect(context.discoveryCandidates).toBeUndefined();
  });

  it("redacts possible secrets from excerpts and candidates", async () => {
    const { url } = await startSite({
      "/": html("Home", "<h1>Home</h1><p>Session marker sessionid=fake-session-value should not publish.</p>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const raw = await fs.readFile(out, "utf8");

    expect(raw).toContain("sessioni****");
    expect(raw).not.toContain("fake-session-value");
  });

  it("duplicate IDs in richer fields fail config validation", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);
    draft.discovery.status = "reviewed";
    draft.sourcePages.push({ ...draft.sourcePages[0] });
    await fs.writeFile(out, JSON.stringify(draft, null, 2), "utf8");

    const result = runCli(["generate", "--config", out, "--out", path.join(root, "public")]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("duplicate id");
  });

  it("bad richer-field URLs fail config validation", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);
    draft.discovery.status = "reviewed";
    draft.sourcePages[0].url = "not-a-url";
    await fs.writeFile(out, JSON.stringify(draft, null, 2), "utf8");

    const result = runCli(["generate", "--config", out, "--out", path.join(root, "public")]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("/sourcePages/0/url");
  });
});

async function startSite(routes) {
  let baseUrl = "";
  const server = http.createServer((request, response) => {
    const route = routes[new URL(request.url, baseUrl).pathname];
    if (!route) {
      response.writeHead(404, { "content-type": "text/plain" });
      response.end("not found");
      return;
    }
    const normalized = typeof route === "string" ? { contentType: "text/html", body: route } : route;
    response.writeHead(200, { "content-type": normalized.contentType });
    response.end(normalized.body.replaceAll("__BASE__", baseUrl.replace(/\/$/, "")));
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}/`;
  return { server, url: baseUrl };
}

function html(title, body) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <title>${title}</title>
      <meta name="description" content="${title} description">
      <link rel="canonical" href="/">
    </head>
    <body>${body}</body>
  </html>`;
}
