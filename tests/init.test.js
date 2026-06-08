import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverForInit, runInit } from "../src/cli/commands/init.js";
import { EXIT_VALIDATION_FAILED } from "../src/cli/exit-codes.js";
import { makeTempRoot, readJson, runCli } from "./helpers.js";

const servers = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        })
    )
  );
});

const generatedFiles = [
  ".well-known/sitectx",
  ".well-known/sitectx.json",
  "sitectx.json",
  "sitectx/catalogs.json",
  "sitectx/updates.json",
  "sitectx/updates.ndjson",
  "sitectx.config.json"
];

const publicArtifactFiles = generatedFiles.filter((file) => file !== "sitectx.config.json");

describe("init", () => {
  it("init --dry-run writes nothing", async () => {
    const root = await makeTempRoot();
    const result = runCli([
      "init",
      "--root",
      root,
      "--site-url",
      "https://example.com",
      "--name",
      "Example Site",
      "--description",
      "Example Site helps teams publish useful website context.",
      "--dry-run"
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WOULD CREATE .well-known/sitectx");
    await expect(fs.readdir(root)).resolves.toEqual([]);
  });

  it("init creates SiteCTX public artifacts and config", async () => {
    const root = await makeTempRoot();
    const result = runCli([
      "init",
      "--root",
      root,
      "--site-url",
      "https://example.com",
      "--name",
      "Example Site",
      "--description",
      "Example Site helps teams publish useful website context."
    ]);

    expect(result.status).toBe(0);
    for (const file of generatedFiles) {
      await expect(fs.stat(path.join(root, file))).resolves.toBeTruthy();
    }
    const config = await readJson(path.join(root, "sitectx.config.json"));
    const manifest = await readJson(path.join(root, ".well-known", "sitectx"));
    expect(config.siteUrl).toBe("https://example.com");
    expect(config.description).toBe("Example Site helps teams publish useful website context.");
    expect(manifest.site.description).toBe("Example Site helps teams publish useful website context.");
    expect(manifest.summary).toBe("Example Site helps teams publish useful website context.");
    expect(manifest.records[0].summary).toBe("Example Site helps teams publish useful website context.");
    expect(config.sections).toHaveLength(2);
  });

  it("init rejects generated artifacts that would publish secrets", async () => {
    const root = await makeTempRoot();
    const cliRoot = await makeTempRoot();

    const result = await runInit({
      root,
      siteUrl: "https://example.com",
      name: "Example Site",
      description: "Public description accidentally includes sessionid=fake-session-value",
      silent: true
    });

    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(result.errors.join("\n")).toContain("Generated artifact");
    expect(result.errors.join("\n")).toContain("possible session cookie");
    expect(result.errors.join("\n")).toContain("sessioni****");
    expect(result.errors.join("\n")).not.toContain("fake-session-value");
    for (const file of generatedFiles) {
      await expect(fs.stat(path.join(root, file))).rejects.toThrow();
    }

    const cliResult = runCli([
      "init",
      "--root",
      cliRoot,
      "--site-url",
      "https://example.com",
      "--name",
      "Example Site",
      "--description",
      "Public description accidentally includes sessionid=fake-session-value"
    ]);

    expect(cliResult.status).toBe(EXIT_VALIDATION_FAILED);
    expect(cliResult.stderr).toContain("Generated artifact");
    expect(cliResult.stderr).not.toContain("fake-session-value");
    for (const file of generatedFiles) {
      await expect(fs.stat(path.join(cliRoot, file))).rejects.toThrow();
    }
  });

  it("init with full flags stays non-interactive", async () => {
    const root = await makeTempRoot();
    const result = runCli(
      [
        "init",
        "--root",
        root,
        "--site-url",
        "https://example.com",
        "--name",
        "Example Site",
        "--description",
        "Example Site helps teams publish useful website context."
      ],
      { env: { SITECTX_TEST_FAIL_ON_PROMPTS_LOAD: "1" } }
    );

    expect(result.status).toBe(0);
    await expect(fs.stat(path.join(root, "sitectx.config.json"))).resolves.toBeTruthy();
  });

  it("init --preset writes vertical preset metadata", async () => {
    const root = await makeTempRoot();
    const result = runCli([
      "init",
      "--root",
      root,
      "--site-url",
      "https://example.com",
      "--name",
      "Example Shop",
      "--preset",
      "ecommerce"
    ]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Preset: Ecommerce");
    const config = await readJson(path.join(root, "sitectx.config.json"));
    const manifest = await readJson(path.join(root, ".well-known", "sitectx"));
    const context = await readJson(path.join(root, "sitectx.json"));
    expect(config.verticalPreset).toBe("ecommerce");
    expect(config.positioning.vertical).toMatchObject({ id: "ecommerce", label: "Ecommerce" });
    expect(manifest.site.vertical).toMatchObject({ id: "ecommerce", label: "Ecommerce" });
    expect(context.site.vertical).toMatchObject({ id: "ecommerce", label: "Ecommerce" });
  });

  it("init detects a web app public directory and keeps config in the app root", async () => {
    const root = await makeTempRoot();
    await fs.writeFile(path.join(root, "package.json"), '{"scripts":{"dev":"next dev"}}\n', "utf8");
    await fs.writeFile(path.join(root, "next.config.mjs"), "export default {};\n", "utf8");
    await fs.mkdir(path.join(root, "public"));

    const result = runCli(
      [
        "init",
        "--site-url",
        "http://localhost:3000",
        "--name",
        "Next App",
        "--force"
      ],
      { cwd: root, env: { SITECTX_TEST_FAIL_ON_PROMPTS_LOAD: "1" } }
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Detected a web app with ./public");
    expect(result.stdout).toContain("Using a localhost development URL");
    await expect(fs.stat(path.join(root, "sitectx.config.json"))).resolves.toBeTruthy();
    for (const file of publicArtifactFiles) {
      await expect(fs.stat(path.join(root, "public", file))).resolves.toBeTruthy();
      await expect(fs.stat(path.join(root, file))).rejects.toBeTruthy();
    }
    await expect(fs.stat(path.join(root, "package-lock.json"))).rejects.toBeTruthy();
    await expect(fs.stat(path.join(root, "node_modules"))).rejects.toBeTruthy();

    const validation = runCli(["validate", "./public"], { cwd: root });
    expect(validation.status).toBe(0);
  });

  it("init respects explicit --root and --public-dir", async () => {
    const root = await makeTempRoot();
    await fs.mkdir(path.join(root, "static"));

    const result = runCli([
      "init",
      "--root",
      root,
      "--public-dir",
      "./static",
      "--site-url",
      "https://example.com",
      "--name",
      "Static App",
      "--force"
    ]);

    expect(result.status).toBe(0);
    await expect(fs.stat(path.join(root, "sitectx.config.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, "static", ".well-known", "sitectx"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(root, ".well-known", "sitectx"))).rejects.toBeTruthy();
  });

  it("init discovery builds starter context from linked pages without a sitemap", async () => {
    const { url } = await startSite({
      "/": html(
        "Price Papertrail",
        "Price Papertrail tracks pricing evidence and product changes for commerce teams.",
        [
          "<h1>Price Papertrail</h1>",
          '<a href="/about">About</a>',
          '<a href="/donate">Donate</a>',
          '<a href="/contact">Contact</a>'
        ].join("")
      ),
      "/about": html(
        "About Price Papertrail",
        "About page for Price Papertrail.",
        "<h1>About Price Papertrail</h1><p>Pricing evidence workflows for commerce teams.</p>"
      ),
      "/donate": html("Donate", "Donate to Price Papertrail.", "<h1>Donate</h1>"),
      "/contact": html("Contact", "Contact Price Papertrail.", "<h1>Contact</h1>")
    });
    const root = await makeTempRoot();

    const discovered = await discoverForInit(url, { maxPages: 2, maxDepth: 1, delayMs: 0 });
    expect(discovered.ok).toBe(true);
    expect(discovered.config.discoveryCandidates).toBeUndefined();
    expect(discovered.config.sections.map((section) => section.id)).toEqual(["home", "about"]);
    expect(discovered.config.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "action:donate",
          type: "donate",
          url: new URL("/donate", url).toString(),
          label: "Donate"
        }),
        expect.objectContaining({
          id: "action:contact",
          type: "contact",
          url: new URL("/contact", url).toString(),
          label: "Contact"
        })
      ])
    );

    const result = await runInit({ root, config: discovered.config, force: true, silent: true });
    expect(result.ok).toBe(true);

    const manifest = await readJson(path.join(root, ".well-known", "sitectx"));
    const context = await readJson(path.join(root, "sitectx.json"));
    expect(manifest.summary).toBe("Price Papertrail tracks pricing evidence and product changes for commerce teams.");
    expect(manifest.records.map((record) => record.id)).toEqual(["page:home", "page:about"]);
    expect(manifest.actions).toEqual(expect.arrayContaining(discovered.config.actions));
    expect(context.actions).toEqual(expect.arrayContaining(discovered.config.actions));
  });

  it("init discovery uses nonprofit preset to prioritize donation intent", async () => {
    const { url } = await startSite({
      "/": html(
        "Community Fund",
        "Community Fund supports local programs.",
        [
          "<h1>Community Fund</h1>",
          '<a href="/products">Products</a>',
          '<a href="/donate">Donate</a>',
          '<a href="/contact">Contact</a>'
        ].join("")
      ),
      "/products": html("Products", "Program merchandise.", "<h1>Products</h1>"),
      "/donate": html("Donate", "Support Community Fund.", "<h1>Donate</h1>"),
      "/contact": html("Contact", "Contact Community Fund.", "<h1>Contact</h1>")
    });

    const discovered = await discoverForInit(url, { preset: "nonprofit", maxPages: 2, maxDepth: 1, delayMs: 0 });

    expect(discovered.ok).toBe(true);
    expect(discovered.config.verticalPreset).toBe("nonprofit");
    expect(discovered.config.sections.map((section) => section.id)).toEqual(["home", "donate"]);
    expect(discovered.config.actions[0]).toMatchObject({ type: "donate" });
    expect(discovered.config.catalogs).toEqual([]);
  });

  it("init discovery fallback does not fetch non-HTTPS public URLs", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("raw fetch should not be called"));

    const discovered = await discoverForInit("http://example.com", {
      name: "Example Fallback",
      timeout: 100
    });

    expect(discovered.ok).toBe(false);
    expect(discovered.warning).toContain("Discovery requires HTTPS for non-localhost URLs.");
    expect(discovered.config.name).toBe("Example Fallback");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("init refuses overwrite without --force", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    const manifestPath = path.join(root, ".well-known", "sitectx");
    const before = await fs.readFile(manifestPath, "utf8");

    const result = runCli(["init", "--root", root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already exists");
    await expect(fs.readFile(manifestPath, "utf8")).resolves.toBe(before);
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
    response.writeHead(200, { "content-type": "text/html" });
    response.end(route);
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}/`;
  return { server, url: baseUrl };
}

function html(title, description, body) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <title>${title}</title>
      <meta name="description" content="${description}">
    </head>
    <body>${body}</body>
  </html>`;
}
