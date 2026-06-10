import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stableJson } from "./artifacts.js";
import { ensureParentDirectory, fileExists, writeUtf8 } from "./filesystem.js";
import { applyPresetMetadata, normalizePreset, presetActionBoost, presetCatalogRoles, presetRoleBoost } from "./presets.js";
import { createRemoteFetchPolicy, fetchValidatedResponse, readLimitedText, validateRemoteFetchUrl } from "./remote-fetch.js";
import { scanForSecrets, redactSecretsInString } from "./secrets.js";
import { isLocalhostUrl } from "./urls.js";

const SKIPPED_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".gif",
  ".webp",
  ".avif",
  ".svg",
  ".ico",
  ".mp4",
  ".mov",
  ".webm",
  ".mp3",
  ".wav",
  ".css",
  ".js",
  ".mjs",
  ".map",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".xml",
  ".rss",
  ".zip",
  ".tar",
  ".gz",
  ".rar",
  ".7z",
  ".pdf"
]);

const HTML_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];
const XML_CONTENT_TYPES = ["application/xml", "text/xml", "application/rss+xml"];
const MAX_EXCERPT_LENGTH = 800;
const MAX_SITEMAP_DEPTH = 3;
const MAX_CHILD_SITEMAPS = 12;
const MAX_FETCH_REDIRECTS = 5;

export async function discoverSite(options = {}) {
  const generatedAt = new Date().toISOString();
  const maxPages = positiveInt(options.maxPages, 25);
  const maxDepth = positiveInt(options.maxDepth, 2);
  const timeout = positiveInt(options.timeout, 10000);
  const delayMs = Math.max(0, positiveInt(options.delayMs, 100));
  const maxBytes = positiveInt(options.maxBytes, 1_500_000);
  const preset = normalizePreset(options.preset);
  const base = normalizeBaseUrl(options.url);
  enforceDiscoveryScheme(base.normalizedBaseUrl);
  const fetchPolicy = createDiscoveryFetchPolicy(base);
  emitProgress(options, {
    stage: "start",
    message: `Preparing bounded crawl for ${base.siteUrl}`,
    url: base.normalizedBaseUrl,
    maxPages,
    maxDepth
  });

  const explicitWorkdir = Boolean(options.workdir);
  const workdir = explicitWorkdir
    ? path.resolve(options.workdir)
    : await fs.mkdtemp(path.join(os.tmpdir(), "sitectx-discovery-"));
  const preserveWorkdir = Boolean(options.keepWorkdir || explicitWorkdir);
  const warnings = [];
  const notices = [];
  const skipped = [];
  const queued = [];
  const includedUrls = new Set();
  const seenHashes = new Set();
  const pages = [];
  const extracts = [];
  let queueOrder = 0;
  const maxQueueSize = Math.max(maxPages * 8, 50);
  emitProgress(options, {
    stage: "robots",
    message: "Checking robots.txt",
    url: new URL("/robots.txt", base.origin).toString()
  });
  const robots = await fetchRobots(base, { timeout, maxBytes, policy: fetchPolicy });
  emitProgress(options, {
    stage: "sitemap",
    message: "Looking for sitemaps",
    url: base.origin
  });
  const sitemapUrls = await fetchSitemapCandidates(base, { timeout, maxBytes, policy: fetchPolicy, warnings, notices, robots, preset });
  emitProgress(options, {
    stage: "queue",
    message: sitemapUrls.length > 0
      ? `Found ${sitemapUrls.length} sitemap URL${sitemapUrls.length === 1 ? "" : "s"}`
      : "No sitemap URLs found, following page links",
    sitemapUrls: sitemapUrls.length
  });

  enqueue(base.normalizedBaseUrl, 0, "base");
  for (const url of sitemapUrls) {
    enqueue(url, 1, "sitemap");
  }

  while (queued.length > 0 && pages.length < maxPages) {
    queued.sort(compareCrawlCandidates);
    const candidate = queued.shift();
    if (candidate.depth > maxDepth) {
      skipped.push({ url: candidate.url, reason: "max-depth" });
      continue;
    }
    if (!matchesFilters(candidate.url, base.origin, options)) {
      skipped.push({ url: candidate.url, reason: "filtered" });
      continue;
    }
    if (shouldSkipAsset(candidate.url)) {
      skipped.push({ url: candidate.url, reason: "asset" });
      continue;
    }
    if (delayMs > 0 && pages.length > 0) {
      await sleep(delayMs);
    }

    emitProgress(options, {
      stage: "fetch",
      message: `Fetching ${displayCrawlPath(candidate.url)} (${pages.length + 1}/${maxPages})`,
      url: candidate.url,
      depth: candidate.depth,
      pagesFetched: pages.length,
      maxPages,
      queued: queued.length
    });
    const fetched = await fetchPage(candidate.url, {
      timeout,
      maxBytes,
      policy: fetchPolicy
    });
    if (!fetched.ok) {
      if (fetched.reason === "off-origin-redirect") {
        emitProgress(options, {
          stage: "skip",
          message: `Skipped ${displayCrawlPath(candidate.url)}: ${fetched.message}`,
          url: candidate.url,
          reason: fetched.reason
        });
        warnings.push(`Skipped redirect outside origin: ${candidate.url}`);
        skipped.push({ url: candidate.url, reason: fetched.reason });
        continue;
      }
      const reason = fetched.reason === "unsupported-content-type" ? "non-html" : "fetch-failed";
      emitProgress(options, {
        stage: "skip",
        message: `Skipped ${displayCrawlPath(candidate.url)}: ${fetched.message}`,
        url: candidate.url,
        reason
      });
      if (reason !== "non-html") {
        warnings.push(`Skipped ${candidate.url}: ${fetched.message}`);
      }
      skipped.push({ url: candidate.url, reason });
      continue;
    }
    const normalizedFinalUrl = normalizeCrawlUrl(fetched.finalUrl, base.normalizedBaseUrl);
    if (!normalizedFinalUrl || !sameOrigin(normalizedFinalUrl, base.origin)) {
      warnings.push(`Skipped redirect outside origin: ${candidate.url}`);
      skipped.push({ url: candidate.url, reason: "off-origin-redirect" });
      continue;
    }
    if (!isHtmlContent(fetched.contentType)) {
      skipped.push({ url: candidate.url, reason: "non-html" });
      continue;
    }
    if (includedUrls.has(normalizedFinalUrl)) {
      skipped.push({ url: candidate.url, reason: "duplicate-final-url" });
      continue;
    }

    const contentHash = `sha256:${sha256(fetched.body)}`;
    if (seenHashes.has(contentHash)) {
      skipped.push({ url: candidate.url, reason: "duplicate-content" });
      continue;
    }
    seenHashes.add(contentHash);
    includedUrls.add(normalizedFinalUrl);

    const extract = extractHtml(fetched.body, normalizedFinalUrl, base.normalizedBaseUrl, preset);
    extract.warnings.push(...extractSecretWarnings(extract));
    emitProgress(options, {
      stage: "extract",
      message: extractionProgressMessage({
        url: normalizedFinalUrl,
        actions: extract.actions.length,
        catalogs: extract.catalogHints.length,
        links: extract.linkedUrls.length
      }),
      url: normalizedFinalUrl,
      actions: extract.actions.length,
      catalogs: extract.catalogHints.length,
      linkedUrls: extract.linkedUrls.length
    });
    for (const navItem of extract.navigation || []) {
      if (sameOrigin(navItem.url, base.origin)) {
        enqueue(navItem.url, candidate.depth + 1, "navigation");
      }
    }
    for (const linkedUrl of extract.linkedUrls) {
      enqueue(linkedUrl, candidate.depth + 1, "link");
    }

    const hash = sha256(normalizedFinalUrl);
    const pageRecord = {
      kind: "sitectx.discovery.page",
      url: candidate.url,
      finalUrl: normalizedFinalUrl,
      depth: candidate.depth,
      status: fetched.status,
      contentType: fetched.contentType,
      fetchedAt: generatedAt,
      contentHash,
      byteLength: fetched.byteLength,
      linkedUrls: extract.linkedUrls
    };
    const extractRecord = {
      kind: "sitectx.discovery.extract",
      url: normalizedFinalUrl,
      canonicalUrl: extract.canonicalUrl,
      title: extract.title,
      metaDescription: extract.metaDescription,
      language: extract.language,
      h1: extract.h1,
      h2: extract.h2,
      role: extract.role,
      actions: extract.actions,
      navigation: extract.navigation,
      identity: extract.identity,
      products: extract.products,
      faqFromJsonLd: extract.faqFromJsonLd,
      catalogHints: extract.catalogHints,
      excerpt: extract.excerpt,
      possibleFaq: extract.possibleFaq,
      possibleClaims: extract.possibleClaims,
      warnings: extract.warnings
    };
    pages.push({ hash, record: pageRecord });
    extracts.push({ hash, record: extractRecord });
    emitProgress(options, {
      stage: "included",
      message: `Included ${pages.length}/${maxPages} page${pages.length === 1 ? "" : "s"}`,
      url: normalizedFinalUrl,
      pagesIncluded: pages.length,
      queued: queued.length,
      skipped: skipped.length
    });
  }

  const allWarnings = uniqueStrings([...warnings, ...extracts.flatMap((entry) => entry.record.warnings)]);
  const allNotices = uniqueStrings(notices);
  emitProgress(options, {
    stage: "build",
    message: "Building SiteCTX draft",
    pagesIncluded: extracts.length
  });
  const crawlManifest = {
    kind: "sitectx.discovery.crawlManifest",
    generatedAt,
    baseUrl: options.url,
    normalizedBaseUrl: base.normalizedBaseUrl,
    maxPages,
    maxDepth,
    preset,
    pagesFetched: pages.length,
    pagesIncluded: extracts.length,
    pagesSkipped: skipped.length,
    robots,
    notices: allNotices,
    warnings: allWarnings
  };
  const config = buildDraftConfig({
    base,
    generatedAt,
    extracts: extracts.map((entry) => entry.record),
    pages: pages.map((entry) => entry.record),
    warnings: allWarnings,
    preset,
    corpusPath: preserveWorkdir ? options.workdir || workdir : null
  });

  emitProgress(options, {
    stage: "write",
    message: preserveWorkdir ? "Writing discovery corpus" : "Writing temporary discovery corpus",
    workdir
  });
  await writeCorpus(workdir, {
    pages,
    extracts,
    crawlManifest,
    config,
    notices: allNotices,
    warnings: allWarnings
  });

  if (!preserveWorkdir) {
    emitProgress(options, {
      stage: "cleanup",
      message: "Cleaning temporary crawl data",
      workdir
    });
    await fs.rm(workdir, { recursive: true, force: true });
  }

  emitProgress(options, {
    stage: "done",
    message: `Discovery complete: ${extracts.length} page${extracts.length === 1 ? "" : "s"}, ${(config.actions || []).length} action${(config.actions || []).length === 1 ? "" : "s"}, ${(config.catalogs || []).length} catalog signal${(config.catalogs || []).length === 1 ? "" : "s"}`,
    pagesIncluded: extracts.length,
    actions: (config.actions || []).length,
    catalogs: (config.catalogs || []).length,
    warnings: allWarnings.length
  });

  return {
    ok: true,
    config,
    crawlManifest,
    workdir: preserveWorkdir ? workdir : null,
    notices: allNotices,
    warnings: allWarnings
  };

  function enqueue(url, depth, source) {
    const normalized = normalizeCrawlUrl(url, base.normalizedBaseUrl);
    if (!normalized) {
      skipped.push({ url, reason: "invalid-url", source });
      return;
    }
    if (!sameOrigin(normalized, base.origin)) {
      warnings.push(`Skipped off-origin URL: ${normalized}`);
      skipped.push({ url: normalized, reason: "off-origin", source });
      return;
    }
    if (includedUrls.has(normalized)) {
      return;
    }
    const candidate = {
      url: normalized,
      depth,
      source,
      priority: crawlPriority(normalized, source, depth, preset),
      order: queueOrder
    };
    const existingIndex = queued.findIndex((entry) => entry.url === normalized);
    if (existingIndex >= 0) {
      if (compareCrawlCandidates(candidate, queued[existingIndex]) < 0) {
        queued[existingIndex] = {
          ...candidate,
          order: queued[existingIndex].order
        };
      }
      return;
    }
    if (queued.length >= maxQueueSize) {
      const worstIndex = queued.reduce(
        (worst, entry, index) => (compareCrawlCandidates(entry, queued[worst]) > 0 ? index : worst),
        0
      );
      if (compareCrawlCandidates(candidate, queued[worstIndex]) >= 0) {
        skipped.push({ url: normalized, reason: "queue-limit", source });
        return;
      }
      skipped.push({ url: queued[worstIndex].url, reason: "queue-pruned", source: queued[worstIndex].source });
      queued.splice(worstIndex, 1);
    }
    queueOrder += 1;
    queued.push(candidate);
  }
}

export function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Discovery URL must use HTTP or HTTPS.");
  }
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/";
  }
  return {
    normalizedBaseUrl: url.toString(),
    origin: url.origin,
    siteUrl: url.origin
  };
}

export function normalizeCrawlUrl(value, baseUrl) {
  const base = new URL(baseUrl);
  let url;
  try {
    url = new URL(value, baseUrl);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return null;
  }
  if (["mailto:", "tel:", "javascript:", "data:"].includes(url.protocol)) {
    return null;
  }
  if (base.protocol === "https:" && url.protocol === "http:" && url.hostname === base.hostname) {
    url.protocol = "https:";
  }
  url.hash = "";
  url.search = "";
  url.hostname = url.hostname.toLowerCase();
  if (!url.pathname) {
    url.pathname = "/";
  }
  if (url.pathname === "") {
    url.pathname = "/";
  }
  return url.toString();
}

function emitProgress(options, event) {
  if (typeof options.onProgress !== "function") {
    return;
  }
  try {
    options.onProgress(event);
  } catch {
    // Progress callbacks must never change crawl behavior.
  }
}

function displayCrawlPath(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname || "/"}${parsed.search || ""}`;
  } catch {
    return url;
  }
}

function extractionProgressMessage({ url, actions, catalogs, links }) {
  const parts = [];
  if (actions > 0) {
    parts.push(`${actions} action${actions === 1 ? "" : "s"}`);
  }
  if (catalogs > 0) {
    parts.push(`${catalogs} catalog signal${catalogs === 1 ? "" : "s"}`);
  }
  if (links > 0) {
    parts.push(`${links} link${links === 1 ? "" : "s"}`);
  }
  return parts.length > 0
    ? `Extracted ${parts.join(", ")} from ${displayCrawlPath(url)}`
    : `Extracted page context from ${displayCrawlPath(url)}`;
}

function compareCrawlCandidates(a, b) {
  if (a.priority !== b.priority) {
    return a.priority - b.priority;
  }
  return a.order - b.order;
}

function crawlPriority(url, source, depth, preset = "auto") {
  const parsed = new URL(url);
  const pathText = parsed.pathname.toLowerCase();
  const role = pageRoleForUrl(url, {});
  const sourceScore = {
    base: -1000,
    navigation: -120,
    link: 0,
    sitemap: 35
  }[source] ?? 15;
  const roleScore = {
    products: -75,
    buy: -70,
    pricing: -65,
    book: -60,
    shipping: -30,
    about: -35,
    contact: -25,
    docs: -20,
    blog: 35,
    legal: 60,
    page: 0
  }[role] ?? 0;
  let score = sourceScore + roleScore + presetRoleBoost(preset, role) + depth * 15;
  if (/\b(featured_item|our-brands|preserved|greenery|peonies|plants|roses?|flowers?|growers)\b/.test(pathText)) {
    score -= 50;
  }
  if (/\b(how-to-buy|buy|order|sales|shop)\b/.test(pathText)) {
    score -= 55;
  }
  if (/^\/\d{4}\//.test(pathText)) {
    score += 35;
  }
  if (/\b(demos?|elements|attachment|author|category|tag|blocks|wpdmpro)\b/.test(pathText)) {
    score += 90;
  }
  return score;
}

function navigationPriority(item, base, preset = "auto") {
  let score = crawlPriority(item.url, "navigation", 1, preset);
  const label = normalizeWhitespace(item.label || "").toLowerCase();
  if (/\b(shop|buy|order|products?|brands?|catalog|flowers?|roses?|peonies|greenery|plants)\b/.test(label)) {
    score -= 35;
  }
  if (/\b(how to buy|buy|order|sales|shop)\b/.test(label)) {
    score -= 55;
  } else if (/\b(contact|shipping|delivery)\b/.test(label)) {
    score -= 20;
  }
  if (base?.origin && !sameOrigin(item.url, base.origin)) {
    score -= /\b(shop|buy|order|store|sales|merch)\b/.test(label) ? 10 : -20;
  }
  return score + presetRoleBoost(preset, item.role || pageRoleForUrl(item.url, {}));
}

function createDiscoveryFetchPolicy(base) {
  return createRemoteFetchPolicy(base.normalizedBaseUrl, {
    allowOrigins: isLocalhostUrl(base.normalizedBaseUrl) ? [base.origin] : []
  });
}

function enforceDiscoveryScheme(url) {
  const parsed = new URL(url);
  if (parsed.protocol === "https:") {
    return;
  }
  if (parsed.protocol === "http:" && isLocalhostUrl(url)) {
    return;
  }
  throw new Error("Discovery requires HTTPS for non-localhost URLs.");
}

async function fetchRobots(base, { timeout, maxBytes, policy }) {
  const url = new URL("/robots.txt", base.origin).toString();
  const result = await fetchPage(url, { timeout, maxBytes, acceptAnyText: true, policy });
  if (!result.ok) {
    return {
      url,
      exists: false,
      status: result.status || null
    };
  }
  if (result.status >= 400) {
    return {
      url,
      exists: false,
      status: result.status
    };
  }
  return {
    url,
    exists: true,
    status: result.status,
    contentHash: `sha256:${sha256(result.body)}`,
    sitemapUrls: parseRobotsSitemapUrls(result.body, base)
  };
}

async function fetchSitemapCandidates(base, { timeout, maxBytes, policy, warnings, notices, robots, preset }) {
  const seedUrls = uniqueStrings([
    ...(robots?.sitemapUrls || []),
    new URL("/sitemap.xml", base.origin).toString(),
    new URL("/sitemap_index.xml", base.origin).toString(),
    new URL("/wp-sitemap.xml", base.origin).toString()
  ]);
  const pageUrls = [];
  const seenSitemaps = new Set();
  let readableSitemaps = 0;

  async function readSitemap(sitemapUrl, depth) {
    if (depth > MAX_SITEMAP_DEPTH) {
      return;
    }
    const normalizedSitemapUrl = normalizeCrawlUrl(sitemapUrl, base.normalizedBaseUrl);
    if (!normalizedSitemapUrl || seenSitemaps.has(normalizedSitemapUrl)) {
      return;
    }
    if (!sameOrigin(normalizedSitemapUrl, base.origin)) {
      warnings.push(`Skipped off-origin sitemap URL: ${normalizedSitemapUrl}`);
      return;
    }
    seenSitemaps.add(normalizedSitemapUrl);
    const result = await fetchPage(normalizedSitemapUrl, { timeout, maxBytes, acceptAnyText: true, policy });
    if (!result.ok || result.status >= 400) {
      return;
    }
    if (!looksLikeXmlSitemap(result)) {
      if (depth > 0) {
        warnings.push(`Sitemap response did not look like XML: ${displayCrawlPath(normalizedSitemapUrl)}`);
      }
      return;
    }
    readableSitemaps += 1;
    const locs = parseSitemapLocs(result.body);
    if (isSitemapIndex(result.body)) {
      const childSitemaps = rankSitemapUrls(locs, base, preset)
        .filter((url) => !/\/(attachment|author|category|post_tag|blocks|wpdmpro)-sitemap/i.test(safePathname(url)))
        .slice(0, MAX_CHILD_SITEMAPS);
      for (const childSitemap of childSitemaps) {
        await readSitemap(childSitemap, depth + 1);
      }
      return;
    }
    for (const loc of locs) {
      const normalized = normalizeCrawlUrl(loc, base.normalizedBaseUrl);
      if (!normalized) {
        continue;
      }
      if (!sameOrigin(normalized, base.origin)) {
        warnings.push(`Skipped off-origin sitemap URL: ${normalized}`);
        continue;
      }
      if (!shouldSkipAsset(normalized)) {
        pageUrls.push(normalized);
      }
    }
  }

  for (const sitemapUrl of seedUrls) {
    await readSitemap(sitemapUrl, 0);
  }
  if (readableSitemaps === 0) {
    notices.push("No sitemap found; continued with crawl discovery.");
  } else if (pageUrls.length === 0) {
    notices.push("No sitemap page URLs found; continued with crawl discovery.");
  }
  return rankSitemapUrls([...new Set(pageUrls)], base, preset);
}

async function fetchPage(url, { timeout, maxBytes, acceptAnyText = false, policy, maxRedirects = MAX_FETCH_REDIRECTS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    let currentUrl = new URL(url).toString();
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const policyCheck = await validateRemoteFetchUrl(currentUrl, policy);
      if (!policyCheck.ok) {
        return {
          ok: false,
          status: 0,
          finalUrl: currentUrl,
          contentType: "",
          body: "",
          byteLength: 0,
          reason: redirectCount > 0 && policy?.baseOrigin && !sameOrigin(currentUrl, policy.baseOrigin)
            ? "off-origin-redirect"
            : "fetch-policy",
          message: policyCheck.error || "URL blocked by discovery fetch policy"
        };
      }

      const response = await fetchValidatedResponse(currentUrl, {
        signal: controller.signal,
        policyCheck
      });
      if (isRedirectStatus(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return {
            ok: false,
            status: response.status,
            finalUrl: currentUrl,
            contentType: "",
            body: "",
            byteLength: 0,
            reason: "redirect",
            message: `Redirect from ${currentUrl} is missing a Location header.`
          };
        }
        if (redirectCount === maxRedirects) {
          return {
            ok: false,
            status: response.status,
            finalUrl: currentUrl,
            contentType: "",
            body: "",
            byteLength: 0,
            reason: "redirect",
            message: `Too many redirects while fetching ${url}.`
          };
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }

      const contentType = response.headers.get("content-type") || "";
      if (!acceptAnyText && !isHtmlContent(contentType)) {
        return {
          ok: false,
          status: response.status,
          finalUrl: currentUrl,
          contentType,
          reason: "unsupported-content-type",
          message: isXmlContent(contentType)
            ? `XML sitemap/feed, not page HTML`
            : `unsupported content type ${contentType || "unknown"}`
        };
      }
      const body = await readLimitedText(response, maxBytes, { truncate: true });
      return {
        ok: response.ok,
        status: response.status,
        finalUrl: currentUrl,
        contentType,
        body,
        byteLength: Buffer.byteLength(body, "utf8"),
        message: response.ok ? null : `HTTP ${response.status}`
      };
    }
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: "",
      body: "",
      byteLength: 0,
      reason: "redirect",
      message: `Too many redirects while fetching ${url}.`
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      finalUrl: url,
      contentType: "",
      body: "",
      byteLength: 0,
      message: error instanceof Error ? error.message : "request failed"
    };
  } finally {
    clearTimeout(timer);
  }
}

function isRedirectStatus(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function extractHtml(html, pageUrl, baseUrl, preset = "auto") {
  const canonicalHref = firstTagAttr(html, "link", "href", (attrs) => /\bcanonical\b/i.test(attrs.rel || ""));
  const jsonLd = jsonLdNodes(html);
  const linkedUrls = extractLinks(html, pageUrl, baseUrl);
  const navigation = extractNavigation(html, pageUrl, baseUrl, preset);
  const linkWarnings = offOriginLinkWarnings();
  const rawExcerpt = visibleText(html);
  const redactedExcerpt = truncate(redactSecretsInString(rawExcerpt), MAX_EXCERPT_LENGTH);
  const h1 = firstText(html, "h1");
  const h2 = allText(html, "h2").slice(0, 20);
  const possibleFaq = faqCandidates([...allText(html, "h1"), ...h2, ...splitLines(rawExcerpt)]).map((question) => ({
    question: redactSecretsInString(question),
    reviewRequired: true
  }));
  const possibleClaims = claimCandidates(rawExcerpt).map((text) => ({
    text: redactSecretsInString(text),
      reviewRequired: true
    }));
  const title = firstText(html, "title") || "";
  const meta = metaDescription(html);
  const role = pageRoleForUrl(pageUrl, { title, h1 });
  const actions = rankActions(
    [
      ...actionCandidates(html, pageUrl, baseUrl, preset),
      ...jsonLdActionCandidates(jsonLd, pageUrl, baseUrl, preset)
    ],
    baseUrl,
    preset
  );
  return {
    canonicalUrl: normalizeCrawlUrl(canonicalHref || pageUrl, pageUrl) || pageUrl,
    title,
    metaDescription: meta,
    language: htmlLang(html),
    h1,
    h2,
    role,
    actions,
    identity: identityCandidate(html, pageUrl, baseUrl, jsonLd),
    products: productCandidatesFromJsonLd(jsonLd, pageUrl),
    faqFromJsonLd: faqCandidatesFromJsonLd(jsonLd, pageUrl),
    catalogHints: catalogHintsFromPage(html, pageUrl, baseUrl, jsonLd, preset),
    excerpt: redactedExcerpt,
    possibleFaq,
    possibleClaims,
    linkedUrls,
    navigation,
    warnings: [
      ...linkWarnings,
      ...(scanForSecrets(rawExcerpt).length > 0 ? ["Possible secret redacted from extracted text."] : [])
    ]
  };
}

function buildDraftConfig({ base, generatedAt, extracts, pages, warnings, preset, corpusPath }) {
  const uniqueExtracts = dedupeExtractsByUrl(extracts);
  const pageEntries = pageEntriesForExtracts(uniqueExtracts, base.origin);
  const primary = uniqueExtracts[0] || {};
  const identity = mergeIdentity(
    uniqueExtracts.map((extract) => extract.identity),
    base
  );
  const name = identity.name || primary.title || primary.h1 || new URL(base.normalizedBaseUrl).hostname;
  const description = identity.description || primary.metaDescription || primary.excerpt || `Draft SiteCTX context for ${name}.`;
  identity.name ||= name;
  identity.description ||= description;
  identity.url ||= base.siteUrl;
  identity.sourceUrl ||= primary.url || base.normalizedBaseUrl;
  const language = primary.language || "en";
  const sections = pageEntries.map(({ extract, id }) => ({
    id,
    title: sectionTitleForExtract(extract),
    url: extract.url,
    role: extract.role || pageRoleForUrl(extract.url, extract),
    summary: pageSummaryForExtract(extract, base.normalizedBaseUrl)
  }));
  const navigation = buildNavigation(uniqueExtracts, base, preset).slice(0, 60);
  const sourcePages = pageEntries.map(({ extract, id }) => {
    const page = pages.find((entry) => entry.finalUrl === extract.url);
    return {
      id,
      url: extract.url,
      title: sectionTitleForExtract(extract),
      role: extract.role || pageRoleForUrl(extract.url, extract),
      purpose: "Discovered source page.",
      lastReviewedAt: null,
      discoveredAt: generatedAt,
      contentHash: page?.contentHash || null
    };
  });
  const candidatePages = uniqueExtracts.map((extract) => ({
    url: extract.url,
    title: sectionTitleForExtract(extract),
    role: extract.role || pageRoleForUrl(extract.url, extract),
    excerpt: extract.excerpt,
    reviewRequired: true
  }));
  const actions = rankActions(uniqueExtracts.flatMap((extract) => extract.actions || []), base.normalizedBaseUrl, preset).slice(0, 20);
  const products = dedupeItemsById([
    ...uniqueExtracts.flatMap((extract) => extract.products || []),
    ...productLineCandidatesFromNavigationAndSections({ navigation, sections })
  ]).slice(0, 20);
  const faq = dedupeItemsById([
    ...uniqueExtracts.flatMap((extract) => extract.faqFromJsonLd || [])
  ]).slice(0, 20);
  const catalogs = buildCatalogs({
    base,
    extracts: uniqueExtracts,
    products,
    preset,
    generatedAt
  });
  return applyPresetMetadata({
    siteUrl: base.siteUrl,
    name,
    description,
    language,
    publisher: {
      name,
      url: base.siteUrl,
      ...(identity.logo ? { logo: identity.logo } : {}),
      ...(identity.profiles?.length ? { profiles: identity.profiles } : {})
    },
    identity,
    positioning: {
      summary: description,
      audience: [],
      not: [
        "Not a crawler permission system",
        "Not a model training license",
        "Not a ranking guarantee"
      ]
    },
    canonicalFacts: [],
    products,
    claims: [],
    faq,
    actions,
    navigation,
    catalogs,
    sections,
    sourcePages,
    discoveryCandidates: {
      facts: [],
      claims: uniqueExtracts.flatMap((extract) =>
        extract.possibleClaims.map((candidate) => ({
          ...candidate,
          sourceUrl: extract.url
        }))
      ),
      faq: uniqueExtracts.flatMap((extract) =>
        extract.possibleFaq.map((candidate) => ({
          ...candidate,
          sourceUrl: extract.url
        }))
      ),
      pages: candidatePages
    },
    discovery: {
      status: "draft_review_required",
      source: "sitectx discover",
      ...(preset && preset !== "auto" ? { preset } : {}),
      generatedAt,
      baseUrl: base.siteUrl,
      pagesFetched: pages.length,
      pagesIncluded: extracts.length,
      corpusPath,
      notes: [
        "Review and edit this file before publishing.",
        "Discovery candidates are not canonical facts until reviewed."
      ],
      warnings
    },
    updates: [
      {
        id: "initial-context",
        type: "created",
        url: base.normalizedBaseUrl,
        title: "Initial SiteCTX context drafted",
        summary: "Initial SiteCTX draft was generated from discovered site content."
      }
    ]
  }, preset);
}

function dedupeExtractsByUrl(extracts) {
  const byUrl = new Map();
  for (const extract of extracts) {
    if (!byUrl.has(extract.url)) {
      byUrl.set(extract.url, extract);
    }
  }
  return [...byUrl.values()];
}

function pageEntriesForExtracts(extracts, origin) {
  const used = new Set();
  return extracts.map((extract) => {
    const baseId = sectionIdForUrl(extract.url, origin);
    let id = baseId;
    if (used.has(id)) {
      id = `${baseId}-${sha256(extract.url).slice(0, 8)}`;
      let suffix = 2;
      while (used.has(id)) {
        id = `${baseId}-${sha256(`${extract.url}:${suffix}`).slice(0, 8)}`;
        suffix += 1;
      }
    }
    used.add(id);
    return { extract, id };
  });
}

function pageSummaryForExtract(extract, baseUrl) {
  if (extract.metaDescription) {
    return truncate(extract.metaDescription, 500);
  }
  if (extract.excerpt) {
    return truncate(extract.excerpt, 500);
  }
  return extract.url === baseUrl ? "Homepage." : "Discovered source page.";
}

async function writeCorpus(workdir, { pages, extracts, crawlManifest, config, warnings }) {
  await fs.mkdir(path.join(workdir, "pages"), { recursive: true });
  await fs.mkdir(path.join(workdir, "extracts"), { recursive: true });
  await writeUtf8(path.join(workdir, "crawl-manifest.json"), stableJson(crawlManifest));
  await writeUtf8(path.join(workdir, "config.draft.json"), stableJson(config));
  await writeUtf8(path.join(workdir, "warnings.json"), stableJson(warnings));
  for (const page of pages) {
    await writeUtf8(path.join(workdir, "pages", `${page.hash}.json`), stableJson(page.record));
  }
  for (const extract of extracts) {
    await writeUtf8(path.join(workdir, "extracts", `${extract.hash}.json`), stableJson(extract.record));
  }
}

export async function writeDiscoveryOutput(outPath, config, { force = false } = {}) {
  if (!force && (await fileExists(outPath))) {
    throw new Error(`${outPath} already exists. Use --force to overwrite it.`);
  }
  await ensureParentDirectory(outPath);
  await writeUtf8(outPath, stableJson(config));
}

function parseSitemapLocs(xml) {
  return [...xml.matchAll(/<loc\b[^>]*>([\s\S]*?)<\/loc>/gi)]
    .map((match) => decodeHtml(stripTags(match[1]).trim()))
    .filter(Boolean);
}

function parseRobotsSitemapUrls(body, base) {
  return uniqueStrings(
    String(body || "")
      .split(/\r?\n/)
      .map((line) => /^sitemap:\s*(.+)$/i.exec(line.trim())?.[1] || "")
      .map((url) => normalizeCrawlUrl(url, base.normalizedBaseUrl))
      .filter((url) => url && sameOrigin(url, base.origin))
  );
}

function looksLikeXmlSitemap(result) {
  return isXmlContent(result.contentType) || isSitemapIndex(result.body) || isSitemapUrlSet(result.body);
}

function isSitemapIndex(xml) {
  return /<sitemapindex\b/i.test(xml);
}

function isSitemapUrlSet(xml) {
  return /<urlset\b/i.test(xml);
}

function rankSitemapUrls(urls, base, preset = "auto") {
  return uniqueStrings(urls)
    .map((url, index) => {
      const normalized = normalizeCrawlUrl(url, base.normalizedBaseUrl);
      return normalized
        ? {
            url: normalized,
            index,
            priority: crawlPriority(normalized, "sitemap", 1, preset)
          }
        : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.url);
}

function extractLinks(html, pageUrl, baseUrl) {
  const links = [];
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.href) {
      continue;
    }
    const normalized = normalizeCrawlUrl(attrs.href, pageUrl);
    if (normalized && sameOrigin(normalized, new URL(baseUrl).origin) && !shouldSkipAsset(normalized)) {
      links.push(normalized);
    }
  }
  return uniqueStrings(links);
}

function extractNavigation(html, pageUrl, baseUrl, preset = "auto") {
  const blocks = navigationBlocks(html);
  const sourceBlocks = blocks.length > 0 ? blocks : [html.slice(0, 120_000)];
  const items = [];
  for (const block of sourceBlocks) {
    for (const match of block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
      const attrs = parseAttrs(match[1]);
      if (!attrs.href) {
        continue;
      }
      const url = normalizeCrawlUrl(attrs.href, pageUrl);
      if (!url || shouldSkipAsset(url)) {
        continue;
      }
      const label = normalizeWhitespace(
        decodeHtml(stripTags(attrs["aria-label"] || attrs.title || match[2] || ""))
      );
      if (!isUsefulNavigationLabel(label)) {
        continue;
      }
      const role = pageRoleForUrl(url, { title: label, h1: label });
      items.push({
        label,
        url,
        role,
        external: !sameOrigin(url, new URL(baseUrl).origin),
        sourceUrl: pageUrl,
        priority: navigationPriority({ label, url, role }, { origin: new URL(baseUrl).origin }, preset)
      });
    }
  }
  const byKey = new Map();
  for (const item of items) {
    const key = `${item.label.toLowerCase()}:${item.url}`;
    const existing = byKey.get(key);
    if (existing && existing.priority <= item.priority) {
      continue;
    }
    byKey.set(key, item);
  }
  return [...byKey.values()]
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return `${a.label}:${a.url}`.localeCompare(`${b.label}:${b.url}`);
    })
    .slice(0, 80);
}

function navigationBlocks(html) {
  const blocks = [];
  for (const tag of ["nav", "header", "footer"]) {
    const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "gi");
    blocks.push(...[...html.matchAll(re)].map((match) => match[0]));
  }
  for (const match of html.matchAll(/<(div|ul|ol)\b([^>]*)>[\s\S]*?<\/\1>/gi)) {
    const attrs = parseAttrs(match[2]);
    const marker = `${attrs.id || ""} ${attrs.class || ""} ${attrs.role || ""}`.toLowerCase();
    if (/\b(nav|navbar|navigation|menu|main-menu|site-header|site-footer)\b/.test(marker)) {
      blocks.push(match[0]);
    }
  }
  return blocks;
}

function isUsefulNavigationLabel(label) {
  const normalized = normalizeWhitespace(label);
  if (normalized.length < 2 || normalized.length > 80) {
    return false;
  }
  if (/^(skip to content|home|menu|explore|learn more|read more|more|-|#)$/.test(normalized.toLowerCase())) {
    return false;
  }
  return /[a-z0-9]/i.test(normalized);
}

function jsonLdNodes(html) {
  const nodes = [];
  for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!/\bapplication\/ld\+json\b/i.test(attrs.type || "")) {
      continue;
    }
    const parsed = parseJsonLd(match[2]);
    if (parsed == null) {
      continue;
    }
    nodes.push(...expandJsonLd(parsed));
  }
  return nodes;
}

function parseJsonLd(raw) {
  const text = raw
    .replace(/^\s*<!--/, "")
    .replace(/-->\s*$/, "")
    .trim();
  for (const candidate of [text, decodeHtml(text)]) {
    try {
      return JSON.parse(candidate);
    } catch {
      continue;
    }
  }
  return null;
}

function expandJsonLd(value) {
  if (Array.isArray(value)) {
    return value.flatMap(expandJsonLd);
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const nodes = [value];
  if (Array.isArray(value["@graph"])) {
    nodes.push(...value["@graph"].flatMap(expandJsonLd));
  }
  return nodes;
}

function identityCandidate(html, pageUrl, baseUrl, jsonLd) {
  const fromJsonLd = identityFromJsonLd(jsonLd, pageUrl, baseUrl);
  const ogSiteName = metaContent(html, "property", "og:site_name");
  const ogDescription = metaContent(html, "property", "og:description") || metaDescription(html);
  const ogImage = metaContent(html, "property", "og:image") || metaContent(html, "name", "twitter:image");
  const iconHref = firstTagAttr(html, "link", "href", (attrs) => /\b(icon|apple-touch-icon)\b/i.test(attrs.rel || ""));
  const logo = firstUsableMetadataUrl([fromJsonLd.logo, ogImage, iconHref], pageUrl, baseUrl);
  const profiles = uniqueStrings([
    ...(fromJsonLd.profiles || []),
    ...socialProfileLinks(html, pageUrl)
  ].filter((url) => isUsableMetadataUrl(url, baseUrl, { allowOffOrigin: true }))).slice(0, 20);
  return removeEmptyFields({
    name: fromJsonLd.name || ogSiteName,
    url: isUsableMetadataUrl(fromJsonLd.url, baseUrl) ? fromJsonLd.url : new URL(baseUrl).origin,
    description: fromJsonLd.description || ogDescription,
    logo,
    profiles,
    telephone: fromJsonLd.telephone,
    email: fromJsonLd.email,
    address: fromJsonLd.address,
    sourceUrl: pageUrl
  });
}

function mergeIdentity(identities, base) {
  const merged = {
    url: base.siteUrl,
    profiles: []
  };
  for (const identity of identities) {
    if (!identity || typeof identity !== "object") {
      continue;
    }
    for (const field of ["name", "description", "logo", "telephone", "email", "address", "sourceUrl"]) {
      if (!merged[field] && identity[field]) {
        merged[field] = identity[field];
      }
    }
    if (identity.url && (!merged.url || identity.url === base.siteUrl)) {
      merged.url = identity.url;
    }
    if (Array.isArray(identity.profiles)) {
      merged.profiles.push(...identity.profiles);
    }
  }
  merged.profiles = uniqueStrings(merged.profiles).slice(0, 20);
  return removeEmptyFields(merged);
}

function identityFromJsonLd(nodes, pageUrl, baseUrl) {
  const identityTypes = ["organization", "localbusiness", "corporation", "ngo", "website"];
  const node = nodes.find((entry) => nodeTypes(entry).some((type) => identityTypes.includes(type)));
  if (!node) {
    return {};
  }
  const logo = firstUsableMetadataUrl([firstValue(node.logo)], pageUrl, baseUrl);
  const url = jsonLdUrl(firstValue(node.url || node["@id"]), pageUrl);
  return removeEmptyFields({
    name: stringField(node.name),
    url: isUsableMetadataUrl(url, baseUrl) ? url : new URL(baseUrl).origin,
    description: stringField(node.description),
    logo,
    profiles: jsonLdUrlArray(node.sameAs, pageUrl).filter((profileUrl) =>
      isUsableMetadataUrl(profileUrl, baseUrl, { allowOffOrigin: true })
    ),
    telephone: stringField(node.telephone),
    email: stringField(node.email),
    address: normalizeJsonLdAddress(node.address)
  });
}

function productCandidatesFromJsonLd(nodes, pageUrl) {
  const products = [];
  for (const node of nodes) {
    const types = nodeTypes(node);
    if (!types.some((type) => ["product", "service"].includes(type))) {
      continue;
    }
    const name = stringField(node.name);
    const url = jsonLdUrl(firstValue(node.url || node["@id"]), pageUrl) || pageUrl;
    const offer = firstObject(node.offers);
    const price = stringField(offer?.price);
    const currency = stringField(offer?.priceCurrency);
    products.push(
      removeEmptyFields({
        id: `product:${slugForText(name || url)}`,
        name,
        url,
        sourceUrl: pageUrl,
        summary: stringField(node.description),
        price,
        currency,
        availability: schemaTail(stringField(offer?.availability)),
        reviewRequired: false
      })
    );
  }
  return dedupeItemsById(products);
}

function faqCandidatesFromJsonLd(nodes, pageUrl) {
  const faq = [];
  for (const node of nodes) {
    if (!nodeTypes(node).includes("faqpage")) {
      continue;
    }
    for (const question of arrayify(node.mainEntity)) {
      const text = stringField(question?.name);
      const answer = answerText(question?.acceptedAnswer);
      if (!text || !answer) {
        continue;
      }
      faq.push({
        id: `faq:${slugForText(text)}`,
        question: text,
        answer,
        sourceUrl: pageUrl,
        reviewRequired: false
      });
    }
  }
  return dedupeItemsById(faq);
}

function jsonLdActionCandidates(nodes, pageUrl, baseUrl, preset = "auto") {
  const actions = [];
  for (const node of nodes) {
    for (const action of arrayify(node.potentialAction)) {
      const type = actionTypeFromJsonLd(action);
      if (!type) {
        continue;
      }
      const target = actionTargetUrl(action, pageUrl);
      const url = normalizeCrawlUrl(target || pageUrl, pageUrl);
      if (!url || !sameOrigin(url, new URL(baseUrl).origin) || shouldSkipAsset(url)) {
        continue;
      }
      const label = stringField(action.name) || defaultActionLabel(type);
      actions.push({
        id: actionId(type, url),
        type,
        url,
        label,
        priority: actionPriority(type, url, pageUrl, baseUrl, preset),
        sourceUrl: pageUrl,
        sourceText: `JSON-LD ${schemaTail(stringField(action["@type"])) || defaultActionLabel(type)}`
      });
    }
  }
  return rankActions(actions, baseUrl, preset);
}

function catalogHintsFromPage(html, pageUrl, baseUrl, jsonLd, preset = "auto") {
  const hints = [];
  const lowerHtml = html.toLowerCase();
  const origin = new URL(baseUrl).origin;

  if (lowerHtml.includes("cdn.shopify.com") || lowerHtml.includes("shopify-features") || lowerHtml.includes("shopify.theme")) {
    hints.push({
      id: "catalog:shopify-products",
      type: "products",
      status: "detected",
      source: "shopify",
      url: new URL("/products.json", origin).toString(),
      label: "Shopify product catalog",
      format: "shopify.products.json",
      requiresSetup: false,
      sourceUrl: pageUrl,
      confidence: 0.95,
      notes: [
        "Detected Shopify storefront signals. Verify the catalog endpoint and freshness before treating it as authoritative."
      ]
    });
  }

  if (
    lowerHtml.includes("woocommerce") ||
    lowerHtml.includes("wp-content/plugins/woocommerce") ||
    lowerHtml.includes("wc-block")
  ) {
    hints.push({
      id: "catalog:woocommerce-products",
      type: "products",
      status: "detected",
      source: "woocommerce",
      url: new URL("/wp-json/wc/store/v1/products", origin).toString(),
      label: "WooCommerce product catalog",
      format: "woocommerce.store-api.products",
      requiresSetup: true,
      sourceUrl: pageUrl,
      confidence: 0.85,
      notes: [
        "Detected WooCommerce storefront signals. Store API access and completeness vary by site."
      ]
    });
  }

  if (lowerHtml.includes("bigcommerce") || lowerHtml.includes("cdn11.bigcommerce.com")) {
    hints.push({
      id: "catalog:bigcommerce-products",
      type: "products",
      status: "detected",
      source: "bigcommerce",
      url: new URL("/sitectx/catalogs.json", origin).toString(),
      label: "BigCommerce product catalog",
      format: "requires-connector",
      requiresSetup: true,
      sourceUrl: pageUrl,
      confidence: 0.8,
      notes: [
        "Detected BigCommerce storefront signals. A connector is needed for a fresh product feed."
      ]
    });
  }

  hints.push(...commerceCatalogHintsFromLinks(html, pageUrl, baseUrl));

  if (jsonLd.some((node) => nodeTypes(node).some((type) => ["product", "service"].includes(type)))) {
    hints.push({
      id: "catalog:jsonld-products",
      type: "products",
      status: "detected",
      source: "json-ld",
      url: pageUrl,
      label: "Product or service structured data",
      format: "schema.org.Product",
      requiresSetup: true,
      sourceUrl: pageUrl,
      sampleUrl: pageUrl,
      confidence: 0.7,
      notes: [
        "Detected Product or Service JSON-LD on a crawled page. This is a sample signal, not a complete catalog."
      ]
    });
  }

  const role = pageRoleForUrl(pageUrl, {});
  if (presetCatalogRoles(preset).includes(role)) {
    hints.push({
      id: `catalog:${role}-pages`,
      type: role === "pricing" ? "offers" : "products",
      status: "detected",
      source: "site-pages",
      url: pageUrl,
      label: role === "pricing" ? "Offer or pricing pages" : "Product or service pages",
      format: "site-pages",
      requiresSetup: true,
      sourceUrl: pageUrl,
      sampleUrl: pageUrl,
      confidence: 0.55,
      notes: [
        "Detected product-like page paths. Use a source system connector for a complete fresh feed."
      ]
    });
  }

  return hints;
}

function commerceCatalogHintsFromLinks(html, pageUrl, baseUrl) {
  const hints = [];
  const baseOrigin = new URL(baseUrl).origin;
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.href) {
      continue;
    }
    const url = normalizeCrawlUrl(attrs.href, pageUrl);
    if (!url || shouldSkipAsset(url)) {
      continue;
    }
    const label = normalizeWhitespace(decodeHtml(stripTags(attrs["aria-label"] || attrs.title || match[2] || "")));
    const source = commerceSourceForUrl(url, label, baseOrigin);
    if (!source) {
      continue;
    }
    hints.push({
      id: `catalog:${source.id}`,
      type: "products",
      status: "detected",
      source: source.id,
      url,
      label: source.label,
      format: source.format,
      requiresSetup: source.requiresSetup,
      sourceUrl: pageUrl,
      confidence: sameOrigin(url, baseOrigin) ? 0.65 : 0.8,
      notes: [
        source.note
      ]
    });
  }
  return hints;
}

function commerceSourceForUrl(url, label, baseOrigin) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const labelText = normalizeWhitespace(label || "").toLowerCase();
  if (host.endsWith("play.google.com") || host.endsWith("itunes.apple.com")) {
    return null;
  }
  if (host.endsWith("kometsales.com") || /\bkomet\b/.test(labelText)) {
    return {
      id: "komet-sales",
      label: "Komet Sales buying portal",
      format: "external-commerce-portal",
      requiresSetup: true,
      note: "Detected Komet Sales commerce link. A connector is needed for complete inventory, pricing, and freshness."
    };
  }
  if (host.endsWith("flowerwebshop.com") || /\bdutch direct\b/.test(labelText)) {
    return {
      id: "dutch-direct",
      label: "Dutch Direct buying portal",
      format: "external-commerce-portal",
      requiresSetup: true,
      note: "Detected Dutch Direct commerce link. A connector is needed for complete inventory, pricing, and freshness."
    };
  }
  if (host.endsWith("myshopify.com") || host.includes("shopify")) {
    return {
      id: "shopify-storefront",
      label: "Shopify storefront",
      format: "shopify.storefront",
      requiresSetup: true,
      note: "Detected Shopify storefront link. Verify the storefront catalog endpoint or connect a source system feed."
    };
  }
  if (!sameOrigin(url, baseOrigin) && actionTypeForLink({ url, label }) === "buy") {
    return {
      id: `commerce-${slugForText(host)}`,
      label: label ? `${label} commerce portal` : "External commerce portal",
      format: "external-commerce-portal",
      requiresSetup: true,
      note: "Detected an external commerce action. A connector is needed for complete catalog and inventory data."
    };
  }
  return null;
}

function buildCatalogs({ base, extracts, products, preset = "auto", generatedAt }) {
  const hints = extracts.flatMap((extract) => extract.catalogHints || []);
  const catalogMap = new Map();
  for (const hint of hints) {
    const existing = catalogMap.get(hint.id);
    if (existing && (existing.confidence || 0) >= (hint.confidence || 0)) {
      continue;
    }
    catalogMap.set(hint.id, {
      ...hint,
      observedAt: generatedAt
    });
  }

  if (presetCatalogRoles(preset).length > 0 && products.length > 0 && !catalogMap.has("catalog:jsonld-products")) {
    const product = products[0];
    catalogMap.set("catalog:jsonld-products", {
      id: "catalog:jsonld-products",
      type: "products",
      status: "detected",
      source: "json-ld",
      url: product.url || product.sourceUrl || base.normalizedBaseUrl,
      label: "Product or service structured data",
      format: "schema.org.Product",
      requiresSetup: true,
      sourceUrl: product.sourceUrl || base.normalizedBaseUrl,
      sampleUrl: product.url || product.sourceUrl || base.normalizedBaseUrl,
      confidence: 0.7,
      observedAt: generatedAt,
      notes: [
        "Detected Product or Service JSON-LD on crawled pages. This is a sample signal, not a complete catalog."
      ]
    });
  }

  return [...catalogMap.values()]
    .sort((a, b) => {
      if ((b.confidence || 0) !== (a.confidence || 0)) {
        return (b.confidence || 0) - (a.confidence || 0);
      }
      return a.id.localeCompare(b.id);
    })
    .slice(0, 20);
}

function buildNavigation(extracts, base, preset = "auto") {
  const byKey = new Map();
  for (const item of extracts.flatMap((extract) => extract.navigation || [])) {
    const role = item.role || pageRoleForUrl(item.url, {});
    const normalized = removeEmptyFields({
      id: `nav:${slugForText(`${item.label}-${item.url}`)}`,
      label: item.label,
      url: item.url,
      role,
      external: !sameOrigin(item.url, base.origin),
      sourceUrl: item.sourceUrl,
      priority: item.priority ?? navigationPriority({ ...item, role }, base, preset)
    });
    const key = `${normalized.label.toLowerCase()}:${normalized.url}`;
    const existing = byKey.get(key);
    if (existing && existing.priority <= normalized.priority) {
      continue;
    }
    byKey.set(key, normalized);
  }
  return [...byKey.values()]
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return `${a.label}:${a.url}`.localeCompare(`${b.label}:${b.url}`);
    })
    .map((item, index) => ({
      ...item,
      priority: index + 1
    }));
}

function productLineCandidatesFromNavigationAndSections({ navigation, sections }) {
  const candidates = [];
  for (const section of sections) {
    if (section.role !== "products") {
      continue;
    }
    candidates.push(productLineCandidate({
      title: section.title,
      url: section.url,
      sourceUrl: section.url,
      source: "crawled-page"
    }));
  }
  for (const item of navigation) {
    if (item.external || item.role !== "products") {
      continue;
    }
    candidates.push(productLineCandidate({
      title: item.label,
      url: item.url,
      sourceUrl: item.sourceUrl,
      source: "site-navigation"
    }));
  }
  return candidates;
}

function productLineCandidate({ title, url, sourceUrl, source }) {
  const name = cleanPageTitle(title);
  return removeEmptyFields({
    id: `product-line:${slugForText(name || url)}`,
    type: "product_line",
    name,
    url,
    sourceUrl,
    source,
    summary: name ? `Product or service area discovered from site structure: ${name}.` : "",
    reviewRequired: true
  });
}

function actionCandidates(html, pageUrl, baseUrl, preset = "auto") {
  const actions = [];
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.href) {
      continue;
    }
    const url = normalizeCrawlUrl(attrs.href, pageUrl);
    if (!url || shouldSkipAsset(url)) {
      continue;
    }
    const label = normalizeWhitespace(
      decodeHtml(stripTags(attrs["aria-label"] || attrs.title || match[2] || ""))
    );
    const type = actionTypeForLink({ url, label });
    if (!type) {
      continue;
    }
    if (!sameOrigin(url, new URL(baseUrl).origin) && type === "learn") {
      continue;
    }
    actions.push({
      id: actionId(type, url),
      type,
      url,
      label: label || defaultActionLabel(type),
      priority: actionPriority(type, url, pageUrl, baseUrl, preset),
      sourceUrl: pageUrl,
      sourceText: label || defaultActionLabel(type)
    });
  }
  for (const match of html.matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.action) {
      continue;
    }
    const url = normalizeCrawlUrl(attrs.action, pageUrl);
    if (!url || shouldSkipAsset(url)) {
      continue;
    }
    const label = normalizeWhitespace(decodeHtml(stripTags(attrs["aria-label"] || formActionText(match[2]) || "")));
    const type = actionTypeForLink({ url, label });
    if (!type || type === "learn") {
      continue;
    }
    actions.push({
      id: actionId(type, url),
      type,
      url,
      label: label || defaultActionLabel(type),
      priority: actionPriority(type, url, pageUrl, baseUrl, preset),
      sourceUrl: pageUrl,
      sourceText: label || defaultActionLabel(type)
    });
  }
  return rankActions(actions, baseUrl, preset);
}

function actionTypeForLink({ url, label }) {
  const parsed = new URL(url);
  const pathText = parsed.pathname.toLowerCase();
  const hostText = parsed.hostname.toLowerCase();
  const labelText = normalizeWhitespace(label || "").toLowerCase();
  if (
    (hostText.endsWith("play.google.com") && pathText.includes("/store/apps")) ||
    (hostText.endsWith("itunes.apple.com") && pathText.includes("/app/"))
  ) {
    return "download";
  }
  const patterns = [
    ["donate", /\b(donate|donation|give|giving|gift|make-a-gift|make_a_gift|support-us|support_us|support\s+us|contribute|contribution)\b/, /\b(donate|donation|give|giving|gift|make\s+a\s+gift|support\s+us|contribute|contribution)\b/],
    ["contact", /\b(contact|contact-us|contact_us|get-in-touch|inquire|enquiry|request-info|support)\b/, /^(contact|contact us|get in touch|inquire|enquiry|request info|support)$/],
    ["book", /\b(book|booking|schedule|appointment|reserve|reservation)\b/, /\b(book|booking|schedule|appointment|reserve|reservation)\b/],
    ["buy", /\b(buy|shop|store|cart|checkout|pricing|order|purchase|sales|merch)\b/, /\b(buy|shop|store|cart|checkout|pricing|order|purchase|sales|merch)\b/],
    ["signup", /\b(signup|register|join|get-started|start|create-account)\b/, /\b(sign\s*up|signup|register|join|get\s+started|start|create\s+account)\b/],
    ["login", /\b(login|signin|account|portal)\b/, /\b(log\s*in|login|sign\s*in|signin|account|portal)\b/],
    ["subscribe", /\b(subscribe|newsletter|updates)\b/, /\b(subscribe|newsletter|updates)\b/],
    ["apply", /\b(apply|application)\b/, /\b(apply|application)\b/],
    ["download", /\b(download|install)\b/, /\b(download|install)\b/],
    ["demo", /\b(demo|request-demo|request_demo)\b/, /\b(demo|request\s+demo)\b/],
    ["search", /\b(search|find)\b/, /^(search|find)$/],
    ["learn", /\b(learn-more|learn_more|about|services|programs)\b/, /^(learn more|about|services|programs)$/]
  ];
  return patterns.find(([, pathPattern, labelPattern]) =>
    pathPattern.test(pathText) || pathPattern.test(hostText) || labelPattern.test(labelText)
  )?.[0] || null;
}

function formActionText(html) {
  const buttonText = firstText(html, "button");
  if (buttonText) {
    return buttonText;
  }
  const inputValue = firstTagAttr(html, "input", "value", (attrs) =>
    ["submit", "button"].includes((attrs.type || "").toLowerCase())
  );
  return inputValue || "";
}

function actionPriority(type, url, sourceUrl, baseUrl, preset = "auto") {
  const typeScore = {
    donate: 10,
    buy: 15,
    book: 20,
    signup: 25,
    contact: 30,
    demo: 35,
    subscribe: 40,
    apply: 45,
    download: 50,
    search: 60,
    login: 70,
    learn: 90
  }[type] ?? 80;
  let score = typeScore + presetActionBoost(preset, type);
  const sourcePath = safePathname(sourceUrl);
  if (sourcePath && sourcePath !== "/") {
    score += 5;
  }
  const actionPath = safePathname(url);
  if (!actionPath || actionPath === "/") {
    score += 20;
  }
  if (url === baseUrl) {
    score += 20;
  }
  return score;
}

function actionId(type, url) {
  const parsed = new URL(url);
  const slug = parsed.pathname
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  return `action:${slug || `${type}:home`}`;
}

function defaultActionLabel(type) {
  return `${type.slice(0, 1).toUpperCase()}${type.slice(1)}`;
}

function dedupeActions(actions) {
  const byKey = new Map();
  for (const action of actions) {
    const key = `${action.type}:${action.url}`;
    const existing = byKey.get(key);
    if (existing && (existing.priority || 1000) <= (action.priority || 1000)) {
      continue;
    }
    byKey.set(key, action);
  }
  return [...byKey.values()];
}

function rankActions(actions, baseUrl, preset = "auto") {
  const ranked = dedupeActions(actions)
    .map((action) => ({
      ...action,
      priority: Number.isInteger(action.priority)
        ? action.priority
        : actionPriority(action.type, action.url, action.sourceUrl, baseUrl, preset)
    }))
    .sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return `${a.type}:${a.label}:${a.url}`.localeCompare(`${b.type}:${b.label}:${b.url}`);
    })
    .map((action, index) => ({
      ...action,
      priority: index + 1
    }));
  return ensureUniqueActionIds(ranked);
}

function ensureUniqueActionIds(actions) {
  const used = new Set();
  return actions.map((action) => {
    let id = action.id;
    if (used.has(id)) {
      const baseId = `${id}:${action.type}`;
      id = baseId;
      let suffix = 2;
      while (used.has(id)) {
        id = `${baseId}-${suffix}`;
        suffix += 1;
      }
    }
    used.add(id);
    return {
      ...action,
      id
    };
  });
}

function actionTypeFromJsonLd(action) {
  const types = nodeTypes(action);
  const typeMap = {
    donateaction: "donate",
    giveaction: "donate",
    buyaction: "buy",
    orderaction: "buy",
    reserveaction: "book",
    scheduleaction: "book",
    registeraction: "signup",
    joinaction: "signup",
    searchaction: "search",
    contactaction: "contact",
    subscribeaction: "subscribe",
    downloadaction: "download",
    applyaction: "apply"
  };
  for (const type of types) {
    if (typeMap[type]) {
      return typeMap[type];
    }
  }
  const name = stringField(action?.name);
  const target = stringField(actionTargetUrl(action, "https://example.com/"));
  return actionTypeForLink({ url: target || "https://example.com/", label: name });
}

function actionTargetUrl(action, pageUrl) {
  const target = firstValue(action?.target);
  if (typeof target === "string") {
    return stripUrlTemplate(target);
  }
  if (target && typeof target === "object") {
    return stripUrlTemplate(
      stringField(target.urlTemplate) ||
        stringField(target.url) ||
        stringField(target["@id"])
    );
  }
  return jsonLdUrl(firstValue(action?.url), pageUrl);
}

function stripUrlTemplate(value) {
  return typeof value === "string" ? value.replace(/\{[^}]+\}/g, "").replace(/[?&]$/, "") : "";
}

function offOriginLinkWarnings() {
  return [];
}

function visibleText(html) {
  const withoutHidden = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const withBreaks = withoutHidden.replace(/<\/(p|div|section|article|header|footer|li|h[1-6])>/gi, "\n");
  return normalizeWhitespace(decodeHtml(stripTags(withBreaks)));
}

function firstText(html, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(html);
  return match ? normalizeWhitespace(decodeHtml(stripTags(match[1]))) : "";
}

function allText(html, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...html.matchAll(re)]
    .map((match) => normalizeWhitespace(decodeHtml(stripTags(match[1]))))
    .filter(Boolean);
}

function firstTagAttr(html, tag, attr, predicate = () => true) {
  const re = new RegExp(`<${tag}\\b([^>]*)>`, "gi");
  for (const match of html.matchAll(re)) {
    const attrs = parseAttrs(match[1]);
    if (predicate(attrs) && attrs[attr]) {
      return attrs[attr];
    }
  }
  return "";
}

function metaDescription(html) {
  return firstTagAttr(html, "meta", "content", (attrs) => (attrs.name || "").toLowerCase() === "description");
}

function metaContent(html, attr, value) {
  return firstTagAttr(html, "meta", "content", (attrs) => (attrs[attr] || "").toLowerCase() === value);
}

function htmlLang(html) {
  const match = /<html\b([^>]*)>/i.exec(html);
  if (!match) {
    return "";
  }
  return parseAttrs(match[1]).lang || "";
}

function parseAttrs(text) {
  const attrs = {};
  for (const match of text.matchAll(/([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'>]+))/g)) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[3] ?? match[4] ?? match[5] ?? "");
  }
  return attrs;
}

function socialProfileLinks(html, pageUrl) {
  const profiles = [];
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.href) {
      continue;
    }
    const url = normalizeCrawlUrl(attrs.href, pageUrl);
    if (!url) {
      continue;
    }
    if (isSocialProfileUrl(url)) {
      profiles.push(url);
    }
  }
  return uniqueStrings(profiles);
}

function isSocialProfileUrl(url) {
  const parsed = new URL(url);
  const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
  const segments = parsed.pathname.split("/").filter(Boolean);
  if (host === "youtube.com" || host.endsWith(".youtube.com")) {
    return segments.length >= 1 && ["@", "channel", "c", "user"].some((prefix) =>
      segments[0].startsWith(prefix)
    );
  }
  if (host === "linkedin.com" || host.endsWith(".linkedin.com")) {
    return segments.length >= 2 && ["company", "school", "in"].includes(segments[0].toLowerCase());
  }
  if (host === "facebook.com" || host.endsWith(".facebook.com")) {
    const segment = segments[0]?.toLowerCase() || "";
    const route = segment.replace(/\.[a-z0-9]+$/i, "");
    return segments.length === 1 && !["share", "sharer", "watch", "events", "groups", "reel", "photo"].includes(route);
  }
  if (["instagram.com", "threads.net", "tiktok.com", "x.com", "twitter.com", "github.com", "medium.com", "bsky.app"].some((socialHost) =>
    host === socialHost || host.endsWith(`.${socialHost}`)
  )) {
    return segments.length >= 1 && !["p", "reel", "tv", "status", "statuses", "watch", "share"].includes(segments[0].toLowerCase());
  }
  return false;
}

function firstUsableMetadataUrl(values, pageUrl, baseUrl, options = {}) {
  for (const value of values) {
    const url = jsonLdUrl(value, pageUrl);
    if (isUsableMetadataUrl(url, baseUrl, options)) {
      return url;
    }
  }
  return "";
}

function isUsableMetadataUrl(url, baseUrl, { allowOffOrigin = false } = {}) {
  if (!url) {
    return false;
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return false;
  }
  const baseIsLocal = isLocalhostUrl(baseUrl);
  const baseOrigin = new URL(baseUrl).origin;
  if (isLocalhostUrl(url) && parsed.origin !== baseOrigin) {
    return false;
  }
  if (!baseIsLocal && isLocalhostUrl(url)) {
    return false;
  }
  if (!allowOffOrigin && !baseIsLocal && parsed.origin !== baseOrigin) {
    return false;
  }
  return true;
}

function nodeTypes(node) {
  return arrayify(node?.["@type"])
    .map((type) => schemaTail(stringField(type)).toLowerCase())
    .filter(Boolean);
}

function stringField(value) {
  if (typeof value === "string" || typeof value === "number") {
    return normalizeWhitespace(String(value));
  }
  if (value && typeof value === "object") {
    if (typeof value["@value"] === "string") {
      return normalizeWhitespace(value["@value"]);
    }
    if (typeof value.name === "string") {
      return normalizeWhitespace(value.name);
    }
    if (typeof value.text === "string") {
      return normalizeWhitespace(stripTags(value.text));
    }
    if (typeof value.url === "string") {
      return normalizeWhitespace(value.url);
    }
  }
  return "";
}

function firstValue(value) {
  return Array.isArray(value) ? value[0] : value;
}

function firstObject(value) {
  const candidate = firstValue(value);
  return candidate && typeof candidate === "object" ? candidate : null;
}

function arrayify(value) {
  if (value == null) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function jsonLdUrl(value, pageUrl) {
  if (!value) {
    return "";
  }
  if (typeof value === "object") {
    return jsonLdUrl(value.url || value["@id"] || value.contentUrl, pageUrl);
  }
  return normalizeCrawlUrl(String(value), pageUrl) || "";
}

function jsonLdUrlArray(value, pageUrl) {
  return uniqueStrings(arrayify(value).map((entry) => jsonLdUrl(entry, pageUrl)).filter(Boolean));
}

function schemaTail(value) {
  return String(value || "").split(/[/#]/).pop() || "";
}

function normalizeJsonLdAddress(value) {
  const address = firstObject(value);
  if (!address) {
    return "";
  }
  const parts = [
    address.streetAddress,
    address.addressLocality,
    address.addressRegion,
    address.postalCode,
    address.addressCountry
  ]
    .map(stringField)
    .filter(Boolean);
  return parts.join(", ");
}

function answerText(value) {
  const answer = firstObject(value);
  return stringField(answer?.text || answer?.name || value);
}

function removeEmptyFields(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry == null || entry === "") {
        return false;
      }
      if (Array.isArray(entry)) {
        return entry.length > 0;
      }
      return true;
    })
  );
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}

function dedupeItemsById(items) {
  const seen = new Set();
  const unique = [];
  for (const item of items) {
    if (!item?.id || seen.has(item.id)) {
      continue;
    }
    seen.add(item.id);
    unique.push(item);
  }
  return unique;
}

function faqCandidates(values) {
  const seen = new Set();
  const candidates = [];
  for (const value of values) {
    const trimmed = normalizeWhitespace(value);
    if (trimmed.length < 8 || trimmed.length > 180 || !trimmed.endsWith("?")) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(trimmed);
    }
    if (candidates.length >= 10) {
      break;
    }
  }
  return candidates;
}

function claimCandidates(text) {
  const keywords = /\b(since|founded|certified|trusted|award|customers|clients|guarantee|guaranteed|available|ships|serves|serving)\b/i;
  const sentences = normalizeWhitespace(text).split(/(?<=[.!?])\s+/);
  const seen = new Set();
  const candidates = [];
  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (trimmed.length < 20 || trimmed.length > 240) {
      continue;
    }
    if (!keywords.test(trimmed) && !/\b\d{2,}\b/.test(trimmed)) {
      continue;
    }
    const key = trimmed.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      candidates.push(trimmed);
    }
    if (candidates.length >= 10) {
      break;
    }
  }
  return candidates;
}

function extractSecretWarnings(extract) {
  const findings = [
    ...scanForSecrets(extract.excerpt),
    ...scanForSecrets(extract.possibleFaq),
    ...scanForSecrets(extract.possibleClaims)
  ];
  return findings.length > 0 ? ["Possible secret redacted from discovery candidates."] : [];
}

function sectionIdForUrl(url, origin) {
  const parsed = new URL(url);
  if (parsed.origin === origin && (parsed.pathname === "/" || parsed.pathname === "")) {
    return "home";
  }
  const slug = slugForText(parsed.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).join("-"));
  return slug || "page";
}

function sectionTitleForExtract(extract) {
  return extract.title || extract.h1 || "Discovered Page";
}

function cleanPageTitle(value) {
  return normalizeWhitespace(String(value || ""))
    .replace(/\s+[-|]\s+.*$/g, "")
    .slice(0, 160);
}

function pageRoleForUrl(url, extract = {}) {
  const parsed = new URL(url);
  if (parsed.pathname === "/" || parsed.pathname === "") {
    return "home";
  }
  const pathText = parsed.pathname.toLowerCase();
  const titleText = normalizeWhitespace(`${extract.title || ""} ${extract.h1 || ""}`).toLowerCase();
  const patterns = [
    ["donate", /\b(donate|donation|giving|give|support-us)\b/, /\b(donate|donation|giving|give|support\s+us)\b/],
    ["contact", /\b(contact|contact-us|get-in-touch|support)\b/, /^(contact|contact us|get in touch|support)\b/],
    ["pricing", /\b(pricing|prices|plans|rates)\b/, /\b(pricing|prices|plans|rates)\b/],
    ["book", /\b(book|booking|schedule|appointment|reserve|reservation)\b/, /\b(book|booking|schedule|appointment|reserve|reservation)\b/],
    ["buy", /\b(how-to-buy|buy|order|purchase|komet-sales)\b/, /\b(how to buy|buy|order|purchase|komet sales)\b/],
    ["shipping", /\b(shipping|delivery|transportation|caribbean|canada|fresh-delivery)\b/, /\b(shipping|delivery|transportation|caribbean|canada|fresh delivery)\b/],
    ["products", /\b(product|products|shop|store|catalog|services|programs|featured_item|our-brands|preserved|greenery|peonies|plants|roses?|flowers?|growers)\b/, /\b(product|products|shop|store|catalog|services|programs|brands?|preserved|greenery|peonies|plants|roses?)\b/],
    ["blog", /\b(blog|news|updates|articles|posts)\b/, /\b(blog|news|updates|articles|posts)\b/],
    ["about", /\b(about|mission|team|company|who-we-are)\b/, /\b(about|mission|team|company|who we are)\b/],
    ["careers", /\b(careers|jobs|hiring|work-with-us)\b/, /\b(careers|jobs|hiring|work with us)\b/],
    ["docs", /\b(docs|documentation|help|guide|guides|api|resources)\b/, /\b(docs|documentation|help|guide|guides|api|resources)\b/],
    ["legal", /\b(privacy|terms|legal|policy|policies|cookies|accessibility)\b/, /\b(privacy|terms|legal|policy|policies|cookies|accessibility)\b/]
  ];
  return patterns.find(([, pathPattern, titlePattern]) => pathPattern.test(pathText) || titlePattern.test(titleText))?.[0] || "page";
}

function slugForText(value) {
  return normalizeWhitespace(String(value || ""))
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "item";
}

function safePathname(url) {
  try {
    return new URL(url).pathname || "/";
  } catch {
    return "";
  }
}

function matchesFilters(url, origin, options) {
  const parsed = new URL(url);
  const pathName = parsed.pathname || "/";
  const includes = normalizePatternList(options.include);
  const excludes = normalizePatternList(options.exclude);
  if (includes.length > 0 && !includes.some((pattern) => matchesPattern(pathName, pattern))) {
    return false;
  }
  if (excludes.some((pattern) => matchesPattern(pathName, pattern))) {
    return false;
  }
  return parsed.origin === origin;
}

function matchesPattern(pathName, pattern) {
  if (pattern.endsWith("*")) {
    return pathName.startsWith(pattern.slice(0, -1));
  }
  return pathName === pattern || pathName.startsWith(pattern);
}

function normalizePatternList(value) {
  if (!value) {
    return [];
  }
  return Array.isArray(value) ? value : [value];
}

function shouldSkipAsset(url) {
  const parsed = new URL(url);
  return SKIPPED_EXTENSIONS.has(path.extname(parsed.pathname).toLowerCase());
}

function sameOrigin(url, origin) {
  return new URL(url).origin === origin;
}

function isHtmlContent(contentType) {
  const normalized = contentType.toLowerCase();
  return HTML_CONTENT_TYPES.some((type) => normalized.includes(type));
}

function isXmlContent(contentType) {
  const normalized = contentType.toLowerCase();
  return XML_CONTENT_TYPES.some((type) => normalized.includes(type));
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ");
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)));
}

function normalizeWhitespace(value) {
  return splitLines(value).join(" ");
}

function splitLines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function truncate(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1).trim()}...`;
}

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function positiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
