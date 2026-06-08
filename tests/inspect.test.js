import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closeServer, listenLocalhost, localServerOrigin, makeTempRoot, readJson, runCli, runCliAsync } from "./helpers.js";

describe("inspect", () => {
  it("inspect --root summarizes generated artifacts", async () => {
    const root = await makeTempRoot();
    expect(
      runCli([
        "init",
        "--root",
        root,
        "--site-url",
        "https://example.com",
        "--name",
        "Example Site"
      ]).status
    ).toBe(0);

    const result = runCli(["inspect", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Site name: Example Site");
    expect(result.stdout).toContain("Context URL: /sitectx.json");
    expect(result.stdout).toContain("Catalogs URL: /sitectx/catalogs.json");
    expect(result.stdout).toContain("Updates URL: /sitectx/updates.json");
    expect(result.stdout).toContain("Updates NDJSON URL: /sitectx/updates.ndjson");
    expect(result.stdout).toContain("Sections: 2");
    expect(result.stdout).toContain("Catalogs: 0");
    expect(result.stdout).toContain("Updates: 1");
  });

  it("inspect --json returns discovery fields", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["inspect", "--root", root, "--json"]);
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.specVersion).toBe("0.1");
    expect(parsed.contextUrl).toBe("/sitectx.json");
    expect(parsed.catalogsUrl).toBe("/sitectx/catalogs.json");
    expect(parsed.updatesUrl).toBe("/sitectx/updates.json");
    expect(parsed.updatesNdjsonUrl).toBe("/sitectx/updates.ndjson");
  });

  it("inspect --root ignores manifest links that escape the root", async () => {
    const root = await makeTempRoot();
    const escapedName = `${path.basename(root)}-escaped-context.json`;
    const escapedPath = path.join(path.dirname(root), escapedName);
    expect(
      runCli([
        "init",
        "--root",
        root,
        "--site-url",
        "https://example.com",
        "--name",
        "Safe Site"
      ]).status
    ).toBe(0);
    await fs.writeFile(escapedPath, JSON.stringify({ site: { name: "Leaked Site" } }), "utf8");
    const manifestPath = path.join(root, ".well-known", "sitectx");
    const manifest = await readJson(manifestPath);
    manifest.site = {};
    manifest.context.url = `../${escapedName}`;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const result = runCli(["inspect", "--root", root, "--json"]);
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.siteName).toBe("Safe Site");
    expect(result.stdout).not.toContain("Leaked Site");
  });

  it("inspect unsupported URL schemes fail cleanly", () => {
    const result = runCli(["inspect", "ftp://example.com"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Inspect only accepts http/https URLs or local paths");
    expect(result.stderr).not.toContain("Trace:");
  });

  it("inspect remote blocks private targets unless explicitly allowlisted", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    const site = await startStaticSite(root);
    try {
      const blocked = await runCliAsync(["inspect", site.url, "--json"]);
      const blockedResult = JSON.parse(blocked.stdout);

      expect(blocked.status).toBe(0);
      expect(blockedResult.warnings.join("\n")).toContain("Remote fetch blocked private");
      expect(site.hits()).toBe(0);

      const allowed = await runCliAsync(["inspect", site.url, "--allow-remote-origin", site.origin, "--json"]);
      const allowedResult = JSON.parse(allowed.stdout);

      expect(allowed.status).toBe(0);
      expect(allowedResult.siteName).toBe("Example Site");
      expect(site.hits()).toBeGreaterThan(0);
    } finally {
      await site.close();
    }
  });

  it("inspect remote blocks off-origin manifest links before fetching them", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    const blockedArtifact = await startStaticSite(root);
    const manifestPath = path.join(root, ".well-known", "sitectx");
    const manifest = await readJson(manifestPath);
    manifest.context.url = `${blockedArtifact.origin}/sitectx.json`;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const site = await startStaticSite(root);
    try {
      const result = await runCliAsync(["inspect", site.url, "--allow-remote-origin", site.origin, "--json"]);
      const parsed = JSON.parse(result.stdout);

      expect(result.status).toBe(0);
      expect(parsed.warnings.join("\n")).toContain("Remote fetch blocked off-origin URL");
      expect(blockedArtifact.hits()).toBe(0);
    } finally {
      await site.close();
      await blockedArtifact.close();
    }
  });

  it("inspect remote rejects oversized linked artifacts before parsing", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    const site = await startStaticSite(root);
    try {
      const result = await runCliAsync([
        "inspect",
        site.url,
        "--allow-remote-origin",
        site.origin,
        "--max-bytes",
        "2000",
        "--json"
      ]);
      const parsed = JSON.parse(result.stdout);

      expect(result.status).toBe(0);
      expect(parsed.warnings.join("\n")).toContain("exceeded 2000 bytes");
      expect(parsed.sectionCount).toBe(0);
    } finally {
      await site.close();
    }
  });
});

async function startStaticSite(root) {
  let hits = 0;
  const server = http.createServer(async (request, response) => {
    hits += 1;
    try {
      const pathname = new URL(request.url, "http://127.0.0.1").pathname;
      const relativePath = pathname === "/.well-known/sitectx" ? ".well-known/sitectx" : pathname.replace(/^\/+/, "");
      const body = await fs.readFile(path.join(root, relativePath), "utf8");
      response.setHeader("content-type", relativePath.endsWith(".ndjson") ? "application/x-ndjson" : "application/json");
      response.end(body);
    } catch {
      response.statusCode = 404;
      response.end("not found");
    }
  });
  await listenLocalhost(server);
  const origin = localServerOrigin(server);
  return {
    origin,
    url: `${origin}/`,
    hits: () => hits,
    close: () => closeServer(server)
  };
}
