import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempRoot, readJson, runCli } from "./helpers.js";

describe("validate", () => {
  it("validate passes on generated artifacts", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["validate", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Result: PASS");
  });

  it("suggests nearby public artifacts when validating an app root", async () => {
    const root = await makeTempRoot();
    await fs.mkdir(path.join(root, "public"));
    expect(runCli(["init", "--root", ".", "--public-dir", "./public"], { cwd: root }).status).toBe(0);

    const result = runCli(["validate", "."], { cwd: root });

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Found SiteCTX artifacts under ./public");
    expect(result.stdout).toContain("Try: npx sitectx@latest validate ./public");
    expect(result.stdout).toContain("Result: FAIL");

    const publicResult = runCli(["validate", "./public"], { cwd: root });
    expect(publicResult.status).toBe(0);
    expect(publicResult.stdout).not.toContain("Found SiteCTX artifacts under ./public");
  });

  it("does not suggest a public dir when no nearby artifacts exist", async () => {
    const root = await makeTempRoot();

    const result = runCli(["validate", "."], { cwd: root });

    expect(result.status).toBe(1);
    expect(result.stdout).not.toContain("Found SiteCTX artifacts under");
  });

  it("validate fails on invalid JSON", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    await fs.writeFile(path.join(root, "sitectx.json"), "{", "utf8");

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("not valid JSON");
  });

  it("validate --json returns structured JSON", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["validate", "--root", root, "--json"]);
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary.failures).toBe(0);
    expect(parsed.checks[0]).toHaveProperty("level");
  });

  it("validate catches malformed NDJSON", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    await fs.writeFile(path.join(root, "sitectx", "updates.ndjson"), "{\"id\":\"ok\"}\nnot-json\n", "utf8");

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("NDJSON line 2 is not valid JSON");
  });

  it("URL resolver handles relative manifest URLs", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Manifest context URL resolves to sitectx.json");
  });

  it("secret scanner catches fake secrets and redacts values", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    const contextPath = path.join(root, "sitectx.json");
    const context = await readJson(contextPath);
    context.publisher.notes = "Use sessionid=fake-session-value for testing";
    await fs.writeFile(contextPath, JSON.stringify(context, null, 2), "utf8");

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Possible secret detected");
    expect(result.stdout).toContain("sessioni****");
    expect(result.stdout).not.toContain("fake-session-value");
  });

  it("manifest link validation catches missing linked context file", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    await fs.unlink(path.join(root, "sitectx.json"));

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Manifest-linked file is missing: sitectx.json");
  });

  it("validates manifest-linked evidence index against its schema", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    await fs.writeFile(
      path.join(root, "sitectx", "evidence.json"),
      JSON.stringify({ specVersion: "0.1", evidence: [] }, null, 2),
      "utf8"
    );
    for (const manifestPath of [
      path.join(root, ".well-known", "sitectx"),
      path.join(root, ".well-known", "sitectx.json")
    ]) {
      const manifest = await readJson(manifestPath);
      manifest.evidence = {
        url: "/sitectx/evidence.json",
        contentType: "application/json"
      };
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    }

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("sitectx/evidence.json schema validation failed");
    expect(result.stdout).toContain("must have required property 'kind'");
  });

  it("manifest link validation rejects sponsored context paths outside the root before reading", async () => {
    const root = await makeTempRoot();
    const escapedName = `${path.basename(root)}-escaped-sponsored-context.json`;
    const escapedPath = path.join(path.dirname(root), escapedName);
    expect(runCli(["init", "--root", root]).status).toBe(0);
    await fs.writeFile(escapedPath, "{", "utf8");
    for (const manifestPath of [
      path.join(root, ".well-known", "sitectx"),
      path.join(root, ".well-known", "sitectx.json")
    ]) {
      const manifest = await readJson(manifestPath);
      manifest.commercialContext = {
        enabled: true,
        sponsoredContextUrl: `../${escapedName}`,
        policy: {
          sponsoredContentMustBeDisclosed: true,
          agentClicksAreNotBillable: true,
          paidPlacementsAllowed: true,
          affiliateLinksAllowed: true,
          requiresCanonicalLandingPage: true
        }
      };
      await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    }

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Manifest sponsoredContext URL resolves outside the root.");
    expect(result.stdout).not.toContain("not valid JSON");
  });

  it("warns but validates legacy root-level update files as fallback", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    await fs.rename(path.join(root, "sitectx", "updates.json"), path.join(root, "updates.json"));
    await fs.rename(path.join(root, "sitectx", "updates.ndjson"), path.join(root, "updates.ndjson"));
    for (const manifestPath of [
      path.join(root, ".well-known", "sitectx"),
      path.join(root, ".well-known", "sitectx.json")
    ]) {
      const manifest = await readJson(manifestPath);
      manifest.updates.url = "/updates.json";
      manifest.updatesNdjson.url = "/updates.ndjson";
      await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
    }

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Using legacy root-level updates.json fallback");
    expect(result.stdout).toContain("Using legacy root-level updates.ndjson fallback");
    expect(result.stdout).toContain("Manifest updates URL resolves to updates.json");
  });
});
