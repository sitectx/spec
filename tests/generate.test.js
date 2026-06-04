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
        "Example Site",
        "--description",
        "Example Site helps teams publish useful website context."
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
      ".well-known/sitectx.json",
      "sitectx.json",
      "sitectx/catalogs.json",
      "sitectx/updates.json",
      "sitectx/updates.ndjson"
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
        "Example Site",
        "--description",
        "Example Site helps teams publish useful website context."
      ]).status
    ).toBe(0);

    const manifest = await readJson(path.join(root, ".well-known/sitectx"));
    const context = await readJson(path.join(root, "sitectx.json"));
    const catalogs = await readJson(path.join(root, "sitectx", "catalogs.json"));
    const updates = await readJson(path.join(root, "sitectx", "updates.json"));

    expect(manifest.generatedAt).toMatch(isoDateTimePattern);
    expect(manifest.catalogs).toEqual({
      url: "/sitectx/catalogs.json",
      contentType: "application/json"
    });
    expect(manifest.freshness).toEqual({ status: "fresh" });
    expect(manifest.site.description).toBe("Example Site helps teams publish useful website context.");
    expect(manifest.identity).toMatchObject({
      name: "Example Site",
      url: "https://example.com",
      sourceUrl: "https://example.com/"
    });
    expect(manifest.summary).toBe("Example Site helps teams publish useful website context.");
    expect(manifest.records[0]).toMatchObject({
      id: "page:home",
      type: "page",
      title: "Home",
      role: "home",
      summary: "Example Site helps teams publish useful website context."
    });
    expect(manifest.actions).toEqual([
      {
        id: "action:home",
        type: "learn",
        url: "https://example.com/",
        label: "Visit site",
        priority: 1,
        sourceUrl: "https://example.com/",
        sourceText: "Visit site"
      }
    ]);
    expect(context.freshness.generated_at).toMatch(isoDateTimePattern);
    expect(context.records[0].page_role).toBe("home");
    expect(context.resources.catalogs).toBe("https://example.com/sitectx/catalogs.json");
    expect(catalogs.kind).toBe("sitectx.catalogs");
    expect(catalogs.catalogs).toEqual([]);
    expect(context.actions).toEqual(manifest.actions);
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
