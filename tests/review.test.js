import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { makeTempRoot, readJson, runCli } from "./helpers.js";

describe("review", () => {
  it("review --help exits 0 and shows review examples", () => {
    const result = runCli(["review", "--help"], {
      env: { SITECTX_TEST_FAIL_ON_PROMPTS_LOAD: "1" }
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Usage: sitectx review");
    expect(result.stdout).toContain("npx sitectx@latest review sitectx.config.draft.json");
  });

  it("review --approve marks a draft config reviewed", async () => {
    const root = await makeTempRoot();
    const configPath = path.join(root, "sitectx.config.draft.json");
    await writeDraftConfig(configPath);

    const result = runCli(["review", configPath, "--approve", "--summary", "Reviewed website context for Example Site."]);
    const reviewed = await readJson(configPath);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Result: PASS");
    expect(reviewed.description).toBe("Reviewed website context for Example Site.");
    expect(reviewed.identity.description).toBe("Reviewed website context for Example Site.");
    expect(reviewed.positioning.summary).toBe("Reviewed website context for Example Site.");
    expect(reviewed.discovery.status).toBe("reviewed");
    expect(reviewed.discovery.reviewedBy).toBe("sitectx review");
    expect(reviewed.discovery.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(reviewed.sourcePages[0].lastReviewedAt).toBe(reviewed.discovery.reviewedAt);
    expect(reviewed.products[0].reviewRequired).toBe(false);
  });

  it("review --approve can write a reviewed copy without mutating the draft", async () => {
    const root = await makeTempRoot();
    const configPath = path.join(root, "sitectx.config.draft.json");
    const reviewedPath = path.join(root, "sitectx.config.json");
    await writeDraftConfig(configPath);

    const result = runCli(["review", configPath, "--approve", "--out", reviewedPath]);
    const draft = await readJson(configPath);
    const reviewed = await readJson(reviewedPath);

    expect(result.status).toBe(0);
    expect(draft.discovery.status).toBe("draft_review_required");
    expect(reviewed.discovery.status).toBe("reviewed");
  });

  it("generate accepts a reviewed config without --allow-draft", async () => {
    const root = await makeTempRoot();
    const configPath = path.join(root, "sitectx.config.draft.json");
    const publicRoot = path.join(root, "public");
    await writeDraftConfig(configPath);

    expect(runCli(["review", configPath, "--approve"]).status).toBe(0);
    const result = runCli(["generate", configPath, publicRoot, "--force"]);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("unreviewed discovery draft");
    await expect(fs.stat(path.join(publicRoot, ".well-known", "sitectx"))).resolves.toBeTruthy();
  });

  it("review fails cleanly in non-interactive mode without --approve", async () => {
    const root = await makeTempRoot();
    const configPath = path.join(root, "sitectx.config.draft.json");
    await writeDraftConfig(configPath);

    const result = runCli(["review", configPath], {
      env: { SITECTX_TEST_FAIL_ON_PROMPTS_LOAD: "1" }
    });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Run review in an interactive terminal");
    expect(result.stderr).not.toContain("Prompt package was loaded");
  });
});

async function writeDraftConfig(configPath) {
  await fs.writeFile(configPath, `${JSON.stringify(draftConfig(), null, 2)}\n`, "utf8");
}

function draftConfig() {
  return {
    siteUrl: "https://example.com",
    name: "Example Site",
    description: "Draft website context for Example Site.",
    language: "en",
    publisher: {
      name: "Example Site",
      url: "https://example.com"
    },
    identity: {
      name: "Example Site",
      url: "https://example.com",
      description: "Draft website context for Example Site.",
      sourceUrl: "https://example.com/"
    },
    positioning: {
      summary: "Draft website context for Example Site.",
      audience: [],
      not: [
        "Not a crawler permission system",
        "Not a model training license",
        "Not a ranking guarantee"
      ]
    },
    sections: [
      {
        id: "home",
        title: "Home",
        url: "https://example.com/",
        role: "home",
        summary: "Example homepage."
      }
    ],
    products: [
      {
        id: "product-line:services",
        type: "product_line",
        name: "Services",
        url: "https://example.com/services",
        sourceUrl: "https://example.com/",
        reviewRequired: true
      }
    ],
    actions: [
      {
        id: "action:contact",
        type: "contact",
        url: "https://example.com/contact",
        label: "Contact",
        priority: 1,
        sourceUrl: "https://example.com/",
        sourceText: "Contact"
      }
    ],
    navigation: [
      {
        id: "nav:contact",
        label: "Contact",
        url: "https://example.com/contact",
        role: "contact",
        priority: 1
      }
    ],
    catalogs: [
      {
        id: "catalog:products",
        type: "products",
        status: "detected",
        source: "site-pages",
        url: "https://example.com/products",
        label: "Product pages",
        requiresSetup: true,
        confidence: 0.6,
        reviewRequired: true
      }
    ],
    sourcePages: [
      {
        id: "home",
        url: "https://example.com/",
        title: "Home",
        role: "home",
        purpose: "Discovered source page.",
        lastReviewedAt: null,
        discoveredAt: "2026-06-04T10:00:00.000Z",
        contentHash: "abc123"
      }
    ],
    discoveryCandidates: {
      facts: [],
      claims: [
        {
          text: "Trusted service since 2020.",
          sourceUrl: "https://example.com/",
          reviewRequired: true
        }
      ],
      faq: [],
      pages: [
        {
          url: "https://example.com/",
          title: "Home",
          role: "home",
          excerpt: "Example homepage.",
          reviewRequired: true
        }
      ]
    },
    discovery: {
      status: "draft_review_required",
      source: "sitectx discover",
      generatedAt: "2026-06-04T10:00:00.000Z",
      baseUrl: "https://example.com",
      pagesFetched: 1,
      pagesIncluded: 1,
      corpusPath: null,
      notes: [
        "Review and edit this file before publishing.",
        "Discovery candidates are not canonical facts until reviewed."
      ],
      warnings: []
    },
    updates: [
      {
        id: "initial-context",
        type: "created",
        url: "https://example.com/",
        title: "Initial SiteCTX context drafted",
        summary: "Initial SiteCTX draft was generated from discovered site content."
      }
    ]
  };
}
