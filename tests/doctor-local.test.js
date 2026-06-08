import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { closeServer, listenLocalhost, localServerOrigin, makeTempRoot, readJson, runCli, runCliAsync } from "./helpers.js";

describe("doctor local", () => {
  it("doctor --root passes on generated artifacts", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["doctor", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Result: PASS with 1 warning");
  });

  it("doctor --root --strict exits nonzero when warnings are present", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["doctor", "--root", root, "--strict"]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("HTTP reachability and content-type headers were not checked");
  });

  it("doctor unsupported URL schemes fail cleanly", () => {
    const result = runCli(["doctor", "ftp://example.com"]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Doctor only accepts http/https URLs or local paths");
    expect(result.stderr).not.toContain("Trace:");
  });

  it("doctor remote blocks private targets unless explicitly allowlisted", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    const site = await startStaticSite(root);
    try {
      const blocked = await runCliAsync(["doctor", site.url]);

      expect(blocked.status).not.toBe(0);
      expect(blocked.stdout).toContain("Remote fetch blocked private");
      expect(site.hits()).toBe(0);

      const allowed = await runCliAsync(["doctor", site.url, "--allow-remote-origin", site.origin]);

      expect(allowed.stdout).toContain("Target origin was explicitly allowlisted");
      expect(allowed.stdout).toContain("/.well-known/sitectx is reachable");
      expect(site.hits()).toBeGreaterThan(0);
    } finally {
      await site.close();
    }
  });

  it("doctor remote blocks off-origin manifest links before fetching them", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    const blockedArtifact = await startStaticSite(root);
    const manifestPath = path.join(root, ".well-known", "sitectx");
    const manifest = await readJson(manifestPath);
    manifest.context.url = `${blockedArtifact.origin}/sitectx.json`;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    const site = await startStaticSite(root);
    try {
      const result = await runCliAsync(["doctor", site.url, "--allow-remote-origin", site.origin]);

      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("Remote fetch blocked off-origin URL");
      expect(blockedArtifact.hits()).toBe(0);
    } finally {
      await site.close();
      await blockedArtifact.close();
    }
  });

  it("doctor remote rejects oversized linked artifacts before parsing", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    const site = await startStaticSite(root);
    try {
      const result = await runCliAsync([
        "doctor",
        site.url,
        "--allow-remote-origin",
        site.origin,
        "--max-bytes",
        "2000"
      ]);

      expect(result.status).not.toBe(0);
      expect(result.stdout).toContain("context artifact is not reachable");
      expect(result.stdout).toContain("exceeded 2000 bytes");
      expect(result.stdout).not.toContain("context.parse");
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
