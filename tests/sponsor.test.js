import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempRoot, readJson, runCli } from "./helpers.js";

describe("sponsor", () => {
  it("sponsor init adds disabled commercial context safely", async () => {
    const root = await initializedRoot();

    const result = runCli(["sponsor", "init", "--root", root]);
    const config = await readJson(path.join(root, "sitectx.config.json"));

    expect(result.status).toBe(0);
    expect(config.commercialContext).toEqual({
      enabled: false,
      outputPath: "sitectx/sponsored-context.json",
      placements: []
    });
  });

  it("disabled commercial context does not generate sponsored context", async () => {
    const root = await initializedRoot();
    const out = await makeTempRoot();

    const result = runCli(["sponsor", "build", "--root", root, "--out", out, "--force"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Commercial context is disabled");
    await expect(fs.stat(path.join(out, "sitectx", "sponsored-context.json"))).rejects.toThrow();
    const manifest = await readJson(path.join(root, ".well-known", "sitectx"));
    expect(manifest.commercialContext).toBeUndefined();
  });

  it("sponsor add creates a valid placement", async () => {
    const root = await initializedRoot();

    const result = runCli(["sponsor", "add", "--root", root, ...validSponsorArgs()]);
    const config = await readJson(path.join(root, "sitectx.config.json"));

    expect(result.status).toBe(0);
    expect(config.commercialContext.enabled).toBe(true);
    expect(config.commercialContext.placements).toHaveLength(1);
    expect(config.commercialContext.placements[0]).toMatchObject({
      type: "sponsored_offer",
      status: "active",
      sponsor: {
        name: "Price Papertrail",
        url: "https://pricepapertrail.com"
      },
      disclosure: {
        label: "Sponsored",
        relationship: "paid_placement"
      },
      measurement: {
        nonBillableEvents: ["agent_fetch", "agent_click", "crawler_visit", "bot_impression"]
      }
    });
  });

  it("sponsor build writes sponsored context and links it from main artifacts", async () => {
    const root = await initializedRoot();
    const out = await makeTempRoot();
    expect(runCli(["sponsor", "add", "--root", root, ...validSponsorArgs()]).status).toBe(0);

    const result = runCli(["sponsor", "build", "--root", root, "--out", out, "--force"]);
    const sponsoredContext = await readJson(path.join(out, "sitectx", "sponsored-context.json"));
    const manifest = await readJson(path.join(out, ".well-known", "sitectx"));
    const context = await readJson(path.join(out, "sitectx.json"));

    expect(result.status).toBe(0);
    expect(sponsoredContext.kind).toBe("sitectx.sponsoredContext");
    expect(sponsoredContext.placements).toHaveLength(1);
    expect(manifest.commercialContext).toMatchObject({
      enabled: true,
      sponsoredContextUrl: "/sitectx/sponsored-context.json",
      policy: {
        sponsoredContentMustBeDisclosed: true,
        agentClicksAreNotBillable: true,
        requiresCanonicalLandingPage: true
      }
    });
    expect(context.resources.sponsoredContext).toBe("https://example.com/sitectx/sponsored-context.json");
    expect(context.commercialContext.sponsoredContextUrl).toBe("https://example.com/sitectx/sponsored-context.json");
    expect(runCli(["validate", "--root", out]).status).toBe(0);
  });

  it("sponsor validate fails without disclosure", async () => {
    const root = await rootWithPlacement();
    await mutatePlacement(root, (placement) => {
      delete placement.disclosure.label;
    });

    const result = runCli(["sponsor", "validate", "--root", root]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Config validation failed");
  });

  it("sponsor validate fails when agent_click is billable", async () => {
    const root = await rootWithPlacement();
    await mutatePlacement(root, (placement) => {
      placement.measurement.billableEvents = ["agent_click"];
    });

    const result = runCli(["sponsor", "validate", "--root", root]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Automated agent");
  });

  it("sponsor validate fails when bot_impression is billable", async () => {
    const root = await rootWithPlacement();
    await mutatePlacement(root, (placement) => {
      placement.measurement.billableEvents = ["bot_impression"];
    });

    const result = runCli(["sponsor", "validate", "--root", root]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("bot_impression");
  });

  it("sponsor validate fails on expired active placement", async () => {
    const root = await rootWithPlacement();
    await mutatePlacement(root, (placement) => {
      placement.offer.validUntil = "2000-01-01";
    });

    const result = runCli(["sponsor", "validate", "--root", root]);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain("Active placement expired");
  });

  it("sponsor validate warns on missing evidence hash", async () => {
    const root = await rootWithPlacement();

    const result = runCli(["sponsor", "validate", "--root", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WARN");
    expect(result.stdout).toContain("Evidence content hash is missing");
  });

  it("sponsor inspect includes counts and disclosure status", async () => {
    const root = await rootWithPlacement();

    const result = runCli(["sponsor", "inspect", "--root", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Placements: 1");
    expect(result.stdout).toContain("Active: 1");
    expect(result.stdout).toContain("Disclosure required: yes");
    expect(result.stdout).toContain("Agent clicks billable: no");
  });

  it("sponsor validate warns when relevantQueries look stuffed", async () => {
    const root = await initializedRoot();
    const queries = Array.from({ length: 11 }, (_, index) => ["--query", `pricing audit trail ${index}`]).flat();
    expect(runCli(["sponsor", "add", "--root", root, ...validSponsorArgs(), ...queries]).status).toBe(0);

    const result = runCli(["sponsor", "validate", "--root", root]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("many relevantQueries");
  });
});

async function initializedRoot() {
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
  return root;
}

async function rootWithPlacement() {
  const root = await initializedRoot();
  expect(runCli(["sponsor", "add", "--root", root, ...validSponsorArgs()]).status).toBe(0);
  return root;
}

function validSponsorArgs() {
  return [
    "--name",
    "Price Papertrail",
    "--url",
    "https://pricepapertrail.com",
    "--title",
    "Defensible records for pricing changes",
    "--summary",
    "Create evidence packets for pricing page changes, reviews, and decisions.",
    "--category",
    "compliance_software",
    "--price",
    "$250/month",
    "--currency",
    "USD",
    "--valid-until",
    "2099-07-04",
    "--canonical-action-url",
    "https://pricepapertrail.com/pilot",
    "--canonical-action-label",
    "Request pilot",
    "--relationship",
    "paid_placement"
  ];
}

async function mutatePlacement(root, mutate) {
  const configPath = path.join(root, "sitectx.config.json");
  const config = await readJson(configPath);
  mutate(config.commercialContext.placements[0]);
  await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}
