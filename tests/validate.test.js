import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempRoot, readJson, runCli } from "./helpers.js";

describe("validate", () => {
  it("validate passes on generated artifacts", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Result: PASS");
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
    await fs.writeFile(path.join(root, "updates.ndjson"), "{\"id\":\"ok\"}\nnot-json\n", "utf8");

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
    context.publisher.notes = "Use sk_live_1234567890abcdef for billing";
    await fs.writeFile(contextPath, JSON.stringify(context, null, 2), "utf8");

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Possible secret detected");
    expect(result.stdout).toContain("sk_live_****");
    expect(result.stdout).not.toContain("1234567890abcdef");
  });

  it("manifest link validation catches missing linked context file", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);
    await fs.unlink(path.join(root, "sitectx.json"));

    const result = runCli(["validate", "--root", root]);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("Manifest-linked file is missing: sitectx.json");
  });
});
