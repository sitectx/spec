import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { isoDateTimePattern, makeTempRoot, readJson, runCli } from "./helpers.js";

describe("generate", () => {
  it("generate creates valid artifacts from config", async () => {
    const configRoot = await makeTempRoot();
    const outRoot = await makeTempRoot();
    expect(
      runCli([
        "init",
        "--root",
        configRoot,
        "--site-url",
        "https://example.com",
        "--name",
        "Example Site"
      ]).status
    ).toBe(0);

    const result = runCli([
      "generate",
      "--root",
      configRoot,
      "--config",
      "sitectx.config.json",
      "--out",
      outRoot,
      "--force"
    ]);

    expect(result.status).toBe(0);
    for (const file of [
      ".well-known/sitectx",
      "sitectx.json",
      "updates.json",
      "updates.ndjson"
    ]) {
      await expect(fs.stat(path.join(outRoot, file))).resolves.toBeTruthy();
    }
    expect(runCli(["validate", "--root", outRoot]).status).toBe(0);
  });

  it("build aliases generate", async () => {
    const configRoot = await makeTempRoot();
    const outRoot = await makeTempRoot();
    expect(runCli(["init", "--root", configRoot]).status).toBe(0);

    const result = runCli([
      "build",
      "--root",
      configRoot,
      "--out",
      outRoot,
      "--force"
    ]);

    expect(result.status).toBe(0);
    await expect(fs.stat(path.join(outRoot, "sitectx.json"))).resolves.toBeTruthy();
  });

  it("generated artifacts have stable structure with ISO timestamps", async () => {
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

    const manifest = await readJson(path.join(root, ".well-known/sitectx"));
    const context = await readJson(path.join(root, "sitectx.json"));
    const updates = await readJson(path.join(root, "updates.json"));

    expect(manifest.generatedAt).toMatch(isoDateTimePattern);
    expect(context.freshness.generated_at).toMatch(isoDateTimePattern);
    expect(updates.updates[0].publishedAt).toMatch(isoDateTimePattern);
    expect(context.records.map((record) => record.id)).toEqual(["page:home", "page:about"]);
  });

  it("config validation fails with a bad URL", async () => {
    const root = await makeTempRoot();
    await fs.writeFile(
      path.join(root, "sitectx.config.json"),
      JSON.stringify({
        siteUrl: "not-a-url",
        name: "Bad Site",
        description: "Bad config",
        language: "en",
        publisher: { name: "Bad Site", url: "https://example.com" },
        sections: [
          {
            id: "home",
            title: "Home",
            url: "https://example.com/",
            summary: "Home."
          }
        ],
        updates: []
      }),
      "utf8"
    );

    const result = runCli(["generate", "--root", root]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Config validation failed");
  });
});
