import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { discoverSite, normalizeCrawlUrl } from "../src/core/discover.js";
import { makeTempRoot, readJson, runCli, runCliAsync } from "./helpers.js";

const servers = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise((resolve) => {
          server.close(resolve);
        })
    )
  );
});

describe("discover", () => {
  it("discover --help shows command options", () => {
    const result = runCli(["discover", "--help"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("[url]");
    expect(result.stdout).not.toContain("--url <url>");
    expect(result.stdout).toContain("--max-pages <number>");
    expect(result.stdout).toContain("--keep-workdir");
  });

  it("normalizes crawl URLs deterministically", () => {
    expect(normalizeCrawlUrl("/About?x=1#team", "https://EXAMPLE.com/")).toBe("https://example.com/About");
    expect(normalizeCrawlUrl("mailto:test@example.com", "https://example.com/")).toBeNull();
    expect(normalizeCrawlUrl("javascript:void(0)", "https://example.com/")).toBeNull();
  });

  it("emits progress events during discovery", async () => {
    const { url } = await startSite({
      "/": html("Home", '<h1>Home</h1><a href="/contact">Contact</a>'),
      "/contact": html("Contact", "<h1>Contact</h1>")
    });
    const events = [];

    const result = await discoverSite({
      url,
      maxPages: 2,
      maxDepth: 1,
      delayMs: 0,
      onProgress: (event) => events.push(event)
    });

    expect(result.ok).toBe(true);
    expect(events.map((event) => event.stage)).toEqual(
      expect.arrayContaining(["start", "robots", "sitemap", "fetch", "extract", "included", "build", "write", "cleanup", "done"])
    );
    expect(events.find((event) => event.stage === "fetch")?.message).toContain("Fetching");
    expect(events.find((event) => event.stage === "done")?.message).toContain("Discovery complete");
  });

  it("discovers homepage-only sites without inventing pages", async () => {
    const { url } = await startSite({
      "/": html("Home", "<h1>Example</h1><p>Trusted service since 2020.</p>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.discovery.status).toBe("draft_review_required");
    expect(draft.sections.map((section) => section.id)).toEqual(["home"]);
    expect(draft.sections.some((section) => section.id === "about")).toBe(false);
    expect(draft.discoveryCandidates.claims[0].reviewRequired).toBe(true);
  });

  it("discover not-a-url fails cleanly", async () => {
    const result = await runCliAsync(["discover", "not-a-url", "--delay-ms", "0"]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ERROR");
    expect(result.stderr).not.toContain("Trace:");
    expect(result.stderr).not.toContain("TypeError:");
  });

  it("uses sitemap URLs as crawl candidates", async () => {
    const { url } = await startSite({
      "/": html("Home", "<h1>Home</h1>"),
      "/service": html("Service", "<h1>Service</h1>"),
      "/sitemap.xml": {
        contentType: "application/xml",
        body: `<?xml version="1.0"?><urlset><url><loc>__BASE__/service</loc></url></urlset>`
      }
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.sections.map((section) => section.id)).toContain("service");
  });

  it("recurses through sitemap indexes before crawling page URLs", async () => {
    const { url } = await startSite({
      "/": html("Home", "<h1>Home</h1>"),
      "/products": html("Products", "<h1>Products</h1><p>Wholesale catalog.</p>"),
      "/sitemap.xml": {
        contentType: "application/xml",
        body: `<?xml version="1.0"?><sitemapindex><sitemap><loc>__BASE__/page-sitemap.xml</loc></sitemap></sitemapindex>`
      },
      "/page-sitemap.xml": {
        contentType: "application/xml",
        body: `<?xml version="1.0"?><urlset><url><loc>__BASE__/products</loc></url></urlset>`
      }
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--max-pages", "2", "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.sections.map((section) => section.id)).toContain("products");
    expect(draft.discovery.warnings.join("\n")).not.toContain("unsupported content type application/xml");
  });

  it("prioritizes navigation and product links over low-value sitemap URLs", async () => {
    const { url } = await startSite({
      "/": html(
        "Home",
        '<header><nav><a href="/products">Products</a><a href="/how-to-buy">How To Buy</a><a href="/contact">Contact</a></nav></header><h1>Home</h1>'
      ),
      "/products": html("Products", "<h1>Products</h1><p>Product line catalog.</p>"),
      "/how-to-buy": html("How To Buy", "<h1>How To Buy</h1>"),
      "/contact": html("Contact", "<h1>Contact</h1>"),
      "/old-post": html("Old Post", "<h1>Old Post</h1>"),
      "/sitemap.xml": {
        contentType: "application/xml",
        body: `<?xml version="1.0"?><urlset><url><loc>__BASE__/old-post</loc></url><url><loc>__BASE__/products</loc></url></urlset>`
      }
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--max-pages", "3", "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);
    const sectionIds = draft.sections.map((section) => section.id);

    expect(result.status).toBe(0);
    expect(sectionIds).toEqual(expect.arrayContaining(["home", "products", "how-to-buy"]));
    expect(sectionIds).not.toContain("old-post");
    expect(draft.navigation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Products", url: new URL("/products", url).toString(), role: "products" })
      ])
    );
    expect(draft.products).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "product-line:products", type: "product_line" })
      ])
    );
  });

  it("enforces same origin for crawl links", async () => {
    const { url } = await startSite({
      "/": html("Home", '<h1>Home</h1><a href="https://example.net/out">External</a><a href="/local">Local</a>'),
      "/local": html("Local", "<h1>Local</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(draft.sections.map((section) => section.id)).toEqual(["home", "local"]);
    expect(draft.sections.map((section) => section.url)).not.toContain("https://example.net/out");
  });

  it("enforces max-pages", async () => {
    const { url } = await startSite({
      "/": html("Home", '<a href="/a">A</a><a href="/b">B</a>'),
      "/a": html("A", "<h1>A</h1>"),
      "/b": html("B", "<h1>B</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    await runCliAsync(["discover", "--url", url, "--out", out, "--max-pages", "1", "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(draft.sections).toHaveLength(1);
  });

  it("enforces max-depth", async () => {
    const { url } = await startSite({
      "/": html("Home", '<a href="/level-1">One</a>'),
      "/level-1": html("One", '<a href="/level-2">Two</a>'),
      "/level-2": html("Two", "<h1>Two</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    await runCliAsync(["discover", "--url", url, "--out", out, "--max-depth", "1", "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(draft.sections.map((section) => section.id)).toEqual(["home", "level-1"]);
  });

  it("extracts user actions from links and forms", async () => {
    const { url } = await startSite({
      "/": html(
        "Home",
        [
          "<h1>Home</h1>",
          '<a href="/donate">Support us</a>',
          '<a href="/contact">Contact</a>',
          '<form action="/newsletter" aria-label="Subscribe to updates"><button>Subscribe</button></form>'
        ].join("")
      ),
      "/donate": html("Donate", "<h1>Donate</h1>"),
      "/contact": html("Contact", "<h1>Contact</h1>"),
      "/newsletter": html("Newsletter", "<h1>Newsletter</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "action:donate",
          type: "donate",
          url: new URL("/donate", url).toString(),
          label: "Support us",
          priority: 1,
          sourceUrl: url,
          sourceText: "Support us"
        }),
        expect.objectContaining({
          id: "action:contact",
          type: "contact",
          url: new URL("/contact", url).toString(),
          label: "Contact"
        }),
        expect.objectContaining({
          id: "action:newsletter",
          type: "subscribe",
          url: new URL("/newsletter", url).toString(),
          label: "Subscribe to updates"
        })
      ])
    );
  });

  it("keeps external commerce links as actions and catalog pointers", async () => {
    const { url } = await startSite({
      "/": html(
        "Home",
        [
          "<h1>Home</h1>",
          '<header><nav><a href="https://app.kometsales.com/">Shop Now</a><a href="https://store.flowerwebshop.com/">Dutch Direct</a></nav></header>'
        ].join("")
      )
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--max-pages", "1", "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "buy", url: "https://app.kometsales.com/", label: "Shop Now" }),
        expect.objectContaining({ type: "buy", url: "https://store.flowerwebshop.com/", label: "Dutch Direct" })
      ])
    );
    expect(draft.catalogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "catalog:komet-sales", source: "komet-sales" }),
        expect.objectContaining({ id: "catalog:dutch-direct", source: "dutch-direct" })
      ])
    );
    expect(draft.navigation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Shop Now", external: true }),
        expect.objectContaining({ label: "Dutch Direct", external: true })
      ])
    );
  });

  it("does not promote generic external learn-more links as actions", async () => {
    const { url } = await startSite({
      "/": html(
        "Home",
        '<h1>Home</h1><a href="https://partner.example/alstroemeria">Learn More</a><a href="https://partner.example/shop">Shop partner</a>'
      )
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--max-pages", "1", "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "buy", url: "https://partner.example/shop", label: "Shop partner" })
      ])
    );
    expect(draft.actions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "learn", url: "https://partner.example/alstroemeria" })
      ])
    );
  });

  it("does not create duplicate or bogus actions from brand text and no-action forms", async () => {
    const { url } = await startSite({
      "/": html(
        "Troops in Contact | Veteran Natural Disaster Response",
        [
          "<h1>Troops in Contact</h1>",
          '<a href="/">Troops in Contact 501(c)(3) nonprofit</a>',
          '<a href="/about">About</a>',
          '<a href="/contact">Contact</a>',
          '<a href="/donate">Donate</a>',
          "<form><button>Subscribe</button></form>"
        ].join("")
      ),
      "/about": html("About | Troops in Contact", "<h1>About</h1><form><button>Subscribe</button></form>"),
      "/contact": html("Contact | Troops in Contact", "<h1>Contact</h1>"),
      "/donate": html("Donate | Troops in Contact", "<h1>Donate</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);
    const actionIds = draft.actions.map((action) => action.id);

    expect(result.status).toBe(0);
    expect(new Set(actionIds).size).toBe(actionIds.length);
    expect(draft.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "action:donate", type: "donate", url: new URL("/donate", url).toString() }),
        expect.objectContaining({ id: "action:contact", type: "contact", url: new URL("/contact", url).toString() })
      ])
    );
    expect(draft.actions.some((action) => action.type === "contact" && action.url === url)).toBe(false);
    expect(draft.actions.some((action) => action.type === "subscribe" && action.url === new URL("/about", url).toString())).toBe(false);
    expect(draft.sections.find((section) => section.id === "about")).toMatchObject({ role: "about" });
    expect(draft.sections.find((section) => section.id === "contact")).toMatchObject({ role: "contact" });
    expect(draft.sections.find((section) => section.id === "donate")).toMatchObject({ role: "donate" });
  });

  it("extracts JSON-LD identity, products, FAQ, search actions, and page roles", async () => {
    const { url } = await startSite({
      "/": html(
        "Home",
        [
          "<h1>Home</h1>",
          '<a href="/contact">Contact</a>',
          `<script type="application/ld+json">${JSON.stringify({
            "@context": "https://schema.org",
            "@graph": [
              {
                "@type": "Organization",
                name: "Example Org",
                url: "__BASE__/",
                logo: "__BASE__/logo.png",
                sameAs: ["https://www.linkedin.com/company/example-org"]
              },
              {
                "@type": "WebSite",
                potentialAction: {
                  "@type": "SearchAction",
                  target: "__BASE__/search?q={search_term_string}",
                  name: "Search"
                }
              },
              {
                "@type": "Product",
                name: "Evidence Tracker",
                description: "Tracks source-backed pricing evidence.",
                url: "__BASE__/products/evidence-tracker",
                offers: {
                  "@type": "Offer",
                  price: "49",
                  priceCurrency: "USD",
                  availability: "https://schema.org/InStock"
                }
              },
              {
                "@type": "FAQPage",
                mainEntity: [
                  {
                    "@type": "Question",
                    name: "What does Evidence Tracker do?",
                    acceptedAnswer: {
                      "@type": "Answer",
                      text: "It tracks source-backed pricing evidence."
                    }
                  }
                ]
              }
            ]
          })}</script>`
        ].join("")
      ),
      "/contact": html("Contact", "<h1>Contact</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.identity).toMatchObject({
      name: "Example Org",
      url: url.replace(/\/$/, ""),
      logo: new URL("/logo.png", url).toString(),
      profiles: ["https://www.linkedin.com/company/example-org"]
    });
    expect(draft.products[0]).toMatchObject({
      id: "product:evidence-tracker",
      name: "Evidence Tracker",
      price: "49",
      currency: "USD",
      availability: "InStock"
    });
    expect(draft.faq[0]).toMatchObject({
      id: "faq:what-does-evidence-tracker-do",
      question: "What does Evidence Tracker do?",
      answer: "It tracks source-backed pricing evidence."
    });
    expect(draft.catalogs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "catalog:jsonld-products",
          type: "products",
          status: "detected",
          source: "json-ld",
          url,
          requiresSetup: true,
          sampleUrl: url
        })
      ])
    );
    expect(draft.actions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "action:search",
          type: "search",
          url: new URL("/search", url).toString(),
          sourceText: "JSON-LD SearchAction"
        })
      ])
    );
    expect(draft.sections[0]).toMatchObject({ id: "home", role: "home" });
    expect(draft.sourcePages[0]).toMatchObject({ id: "home", role: "home" });
  });

  it("only keeps social profile URLs in profiles", async () => {
    const { url } = await startSite({
      "/": html(
        "Home",
        [
          "<h1>Home</h1>",
          '<a href="https://www.youtube.com/channel/UCKn_eMWiWw-F1e94yqluY_A">YouTube</a>',
          '<a href="https://www.youtube.com/watch?v=abc123">Video</a>',
          '<a href="https://www.instagram.com/examplebrand/">Instagram</a>',
          '<a href="https://www.linkedin.com/company/example-brand/">LinkedIn</a>'
        ].join("")
      )
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.identity.profiles).toEqual(
      expect.arrayContaining([
        "https://www.youtube.com/channel/UCKn_eMWiWw-F1e94yqluY_A",
        "https://www.instagram.com/examplebrand/",
        "https://www.linkedin.com/company/example-brand/"
      ])
    );
    expect(draft.identity.profiles).not.toContain("https://www.youtube.com/watch");
    expect(draft.identity.profiles).not.toContain("https://www.youtube.com/watch?v=abc123");
  });

  it("detects Shopify catalog pointers without crawling the catalog", async () => {
    const { url } = await startSite({
      "/": html(
        "Shop",
        [
          "<h1>Shop</h1>",
          '<script>window.Shopify = { shop: "example.myshopify.com" };</script>',
          '<link rel="preload" href="https://cdn.shopify.com/s/files/1/theme.css">'
        ].join("")
      )
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.catalogs).toEqual([
      expect.objectContaining({
        id: "catalog:shopify-products",
        type: "products",
        status: "detected",
        source: "shopify",
        url: new URL("/products.json", url).toString(),
        format: "shopify.products.json",
        requiresSetup: false
      })
    ]);
    expect(draft.sections.map((section) => section.id)).toEqual(["home"]);
  });

  it("rejects localhost metadata URLs that do not match the crawled origin", async () => {
    const { url } = await startSite({
      "/": html(
        "Home",
        [
          '<meta property="og:image" content="http://localhost:3005/opengraph-image.jpg">',
          '<link rel="icon" href="/icon.png">',
          `<script type="application/ld+json">${JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Organization",
            name: "Public Site",
            url: "http://localhost:3005/",
            logo: "http://localhost:3005/assets/logo.png"
          })}</script>`
        ].join("")
      )
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(result.status).toBe(0);
    expect(draft.identity.url).toBe(url.replace(/\/$/, ""));
    expect(draft.identity.logo).toBe(new URL("/icon.png", url).toString());
    expect(JSON.stringify(draft)).not.toContain("localhost:3005");
  });

  it("skips non-HTML assets", async () => {
    const { url } = await startSite({
      "/": html("Home", '<a href="/logo.png">Logo</a><a href="/page">Page</a>'),
      "/logo.png": { contentType: "image/png", body: "not really a png" },
      "/page": html("Page", "<h1>Page</h1>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);

    expect(draft.sections.map((section) => section.url).some((sectionUrl) => sectionUrl.endsWith(".png"))).toBe(false);
  });

  it("discover --dry-run writes no output", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", "--url", url, "--out", out, "--dry-run", "--delay-ms", "0"]);

    expect(result.status).toBe(0);
    await expect(fs.stat(out)).rejects.toThrow();
    expect(JSON.parse(result.stdout).discovery.status).toBe("draft_review_required");
  });

  it("discover --json returns structured output", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    const result = await runCliAsync(["discover", "--url", url, "--out", out, "--json", "--force", "--delay-ms", "0"]);
    const parsed = JSON.parse(result.stdout);

    expect(result.status).toBe(0);
    expect(parsed.ok).toBe(true);
    expect(parsed.summary.pagesIncluded).toBe(1);
    expect(parsed.config.discovery.status).toBe("draft_review_required");
  });

  it("preserves workdir corpus when requested", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    const workdir = path.join(root, "corpus");

    const result = await runCliAsync([
      "discover",
      "--url",
      url,
      "--out",
      out,
      "--workdir",
      workdir,
      "--keep-workdir",
      "--force",
      "--delay-ms",
      "0"
    ]);

    expect(result.status).toBe(0);
    await expect(fs.stat(path.join(workdir, "crawl-manifest.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(workdir, "config.draft.json"))).resolves.toBeTruthy();
    await expect(fs.stat(path.join(workdir, "warnings.json"))).resolves.toBeTruthy();
    expect((await fs.readdir(path.join(workdir, "pages"))).length).toBeGreaterThan(0);
    expect((await fs.readdir(path.join(workdir, "extracts"))).length).toBeGreaterThan(0);
  });

  it("generated draft config validates enough for allow-draft generation", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);

    const result = runCli(["generate", "--config", out, "--out", path.join(root, "public"), "--allow-draft", "--dry-run"]);

    expect(result.status).toBe(0);
  });

  it("generate refuses draft_review_required config by default", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);

    const result = runCli(["generate", "--config", out, "--out", path.join(root, "public")]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Discovered drafts require human review");
  });

  it("generate --allow-draft works with warning", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    const publicRoot = path.join(root, "public");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);

    const result = runCli(["generate", "--config", out, "--out", publicRoot, "--allow-draft", "--force"]);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("WARN Generating from an unreviewed discovery draft");
    await expect(fs.stat(path.join(publicRoot, "sitectx.json"))).resolves.toBeTruthy();
  });

  it("generate works after discovery status is reviewed", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    const publicRoot = path.join(root, "public");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);
    draft.discovery.status = "reviewed";
    await fs.writeFile(out, JSON.stringify(draft, null, 2), "utf8");

    const result = runCli(["generate", "--config", out, "--out", publicRoot, "--force"]);

    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("unreviewed discovery draft");
  });

  it("does not publish discoveryCandidates into sitectx.json", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1><h2>What is included?</h2>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    const publicRoot = path.join(root, "public");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    expect(runCli(["generate", "--config", out, "--out", publicRoot, "--allow-draft", "--force"]).status).toBe(0);

    const context = await readJson(path.join(publicRoot, "sitectx.json"));

    expect(context.discoveryCandidates).toBeUndefined();
  });

  it("redacts possible secrets from excerpts and candidates", async () => {
    const { url } = await startSite({
      "/": html("Home", "<h1>Home</h1><p>Session marker sessionid=fake-session-value should not publish.</p>")
    });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");

    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const raw = await fs.readFile(out, "utf8");

    expect(raw).toContain("sessioni****");
    expect(raw).not.toContain("fake-session-value");
  });

  it("duplicate IDs in richer fields fail config validation", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);
    draft.discovery.status = "reviewed";
    draft.actions = [
      {
        id: "action:contact",
        type: "contact",
        url: new URL("/contact", url).toString(),
        label: "Contact"
      },
      {
        id: "action:contact",
        type: "contact",
        url: new URL("/contact-us", url).toString(),
        label: "Contact us"
      }
    ];
    await fs.writeFile(out, JSON.stringify(draft, null, 2), "utf8");

    const result = runCli(["generate", "--config", out, "--out", path.join(root, "public")]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("duplicate id");
  });

  it("bad richer-field URLs fail config validation", async () => {
    const { url } = await startSite({ "/": html("Home", "<h1>Home</h1>") });
    const root = await makeTempRoot();
    const out = path.join(root, "draft.json");
    await runCliAsync(["discover", "--url", url, "--out", out, "--force", "--delay-ms", "0"]);
    const draft = await readJson(out);
    draft.discovery.status = "reviewed";
    draft.actions = [
      {
        id: "action:contact",
        type: "contact",
        url: "not-a-url",
        label: "Contact"
      }
    ];
    await fs.writeFile(out, JSON.stringify(draft, null, 2), "utf8");

    const result = runCli(["generate", "--config", out, "--out", path.join(root, "public")]);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("/actions/0/url");
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
    const normalized = typeof route === "string" ? { contentType: "text/html", body: route } : route;
    response.writeHead(200, { "content-type": normalized.contentType });
    response.end(normalized.body.replaceAll("__BASE__", baseUrl.replace(/\/$/, "")));
  });
  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  servers.push(server);
  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}/`;
  return { server, url: baseUrl };
}

function html(title, body) {
  return `<!doctype html>
  <html lang="en">
    <head>
      <title>${title}</title>
      <meta name="description" content="${title} description">
      <link rel="canonical" href="/">
    </head>
    <body>${body}</body>
  </html>`;
}
