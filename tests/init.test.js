import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempRoot, readJson, runCli } from "./helpers.js";

const generatedFiles = [
  ".well-known/sitectx",
  "sitectx.json",
  "updates.json",
  "updates.ndjson",
  "sitectx.config.json"
];

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
      "Example Site"
    ]);

    expect(result.status).toBe(0);
    for (const file of generatedFiles) {
      await expect(fs.stat(path.join(root, file))).resolves.toBeTruthy();
    }
    const config = await readJson(path.join(root, "sitectx.config.json"));
    expect(config.siteUrl).toBe("https://example.com");
    expect(config.sections).toHaveLength(2);
  });

  it("init refuses overwrite without --force", async () => {
    const root = await makeTempRoot();
    expect(runCli(["init", "--root", root]).status).toBe(0);

    const result = runCli(["init", "--root", root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("already exists");
  });
});
