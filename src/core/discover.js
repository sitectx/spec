import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stableJson } from "./artifacts.js";
import { ensureParentDirectory, fileExists, writeUtf8 } from "./filesystem.js";
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

export async function discoverSite(options = {}) {
  const generatedAt = new Date().toISOString();
  const maxPages = positiveInt(options.maxPages, 25);
  const maxDepth = positiveInt(options.maxDepth, 2);
  const timeout = positiveInt(options.timeout, 10000);
  const delayMs = Math.max(0, positiveInt(options.delayMs, 100));
  const maxBytes = positiveInt(options.maxBytes, 1_500_000);
  const base = normalizeBaseUrl(options.url);
  enforceDiscoveryScheme(base.normalizedBaseUrl);

  const explicitWorkdir = Boolean(options.workdir);
  const workdir = explicitWorkdir
    ? path.resolve(options.workdir)
    : await fs.mkdtemp(path.join(os.tmpdir(), "sitectx-discovery-"));
  const preserveWorkdir = Boolean(options.keepWorkdir || explicitWorkdir);
  const warnings = [];
  const skipped = [];
  const queued = [];
  const seenUrls = new Set();
  const includedUrls = new Set();
  const seenHashes = new Set();
  const pages = [];
  const extracts = [];
  const robots = await fetchRobots(base, { timeout, maxBytes, warnings });
  const sitemapUrls = await fetchSitemapCandidates(base, { timeout, maxBytes, warnings });

  enqueue(base.normalizedBaseUrl, 0, "base");
  for (const url of sitemapUrls) {
    enqueue(url, 1, "sitemap");
  }

  while (queued.length > 0 && pages.length < maxPages) {
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

    const fetched = await fetchPage(candidate.url, {
      timeout,
      maxBytes
    });
    if (!fetched.ok) {
      warnings.push(`Skipped ${candidate.url}: ${fetched.message}`);
      skipped.push({ url: candidate.url, reason: "fetch-failed" });
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

    const contentHash = `sha256:${sha256(fetched.body)}`;
    if (seenHashes.has(contentHash)) {
      skipped.push({ url: candidate.url, reason: "duplicate-content" });
      continue;
    }
    seenHashes.add(contentHash);
    includedUrls.add(normalizedFinalUrl);

    const extract = extractHtml(fetched.body, normalizedFinalUrl, base.normalizedBaseUrl);
    extract.warnings.push(...extractSecretWarnings(extract));
    for (const linkedUrl of extract.linkedUrls) {
      if (pages.length + queued.length >= maxPages * 4) {
        break;
      }
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
      excerpt: extract.excerpt,
      possibleFaq: extract.possibleFaq,
      possibleClaims: extract.possibleClaims,
      warnings: extract.warnings
    };
    pages.push({ hash, record: pageRecord });
    extracts.push({ hash, record: extractRecord });
  }

  const allWarnings = [...warnings, ...extracts.flatMap((entry) => entry.record.warnings)];
  const crawlManifest = {
    kind: "sitectx.discovery.crawlManifest",
    generatedAt,
    baseUrl: options.url,
    normalizedBaseUrl: base.normalizedBaseUrl,
    maxPages,
    maxDepth,
    pagesFetched: pages.length,
    pagesIncluded: extracts.length,
    pagesSkipped: skipped.length,
    robots,
    warnings: allWarnings
  };
  const config = buildDraftConfig({
    base,
    generatedAt,
    extracts: extracts.map((entry) => entry.record),
    pages: pages.map((entry) => entry.record),
    warnings: allWarnings,
    corpusPath: preserveWorkdir ? options.workdir || workdir : null
  });

  await writeCorpus(workdir, {
    pages,
    extracts,
    crawlManifest,
    config,
    warnings: allWarnings
  });

  if (!preserveWorkdir) {
    await fs.rm(workdir, { recursive: true, force: true });
  }

  return {
    ok: true,
    config,
    crawlManifest,
    workdir: preserveWorkdir ? workdir : null,
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
    if (seenUrls.has(normalized) || includedUrls.has(normalized)) {
      return;
    }
    seenUrls.add(normalized);
    queued.push({ url: normalized, depth, source });
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

async function fetchRobots(base, { timeout, maxBytes, warnings }) {
  const url = new URL("/robots.txt", base.origin).toString();
  const result = await fetchPage(url, { timeout, maxBytes, acceptAnyText: true });
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
    contentHash: `sha256:${sha256(result.body)}`
  };
}

async function fetchSitemapCandidates(base, { timeout, maxBytes, warnings }) {
  const sitemapPaths = ["/sitemap.xml", "/sitemap_index.xml"];
  const urls = [];
  for (const sitemapPath of sitemapPaths) {
    const sitemapUrl = new URL(sitemapPath, base.origin).toString();
    const result = await fetchPage(sitemapUrl, { timeout, maxBytes, acceptAnyText: true });
    if (!result.ok || result.status >= 400) {
      warnings.push(`Sitemap not found or not readable: ${sitemapPath}`);
      continue;
    }
    if (!isXmlContent(result.contentType) && !result.body.includes("<urlset") && !result.body.includes("<sitemapindex")) {
      warnings.push(`Sitemap response did not look like XML: ${sitemapPath}`);
      continue;
    }
    for (const loc of parseSitemapLocs(result.body)) {
      const normalized = normalizeCrawlUrl(loc, base.normalizedBaseUrl);
      if (!normalized) {
        continue;
      }
      if (!sameOrigin(normalized, base.origin)) {
        warnings.push(`Skipped off-origin sitemap URL: ${normalized}`);
        continue;
      }
      urls.push(normalized);
    }
  }
  return [...new Set(urls)].sort();
}

async function fetchPage(url, { timeout, maxBytes, acceptAnyText = false }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal
    });
    const contentType = response.headers.get("content-type") || "";
    if (!acceptAnyText && !isHtmlContent(contentType)) {
      return {
        ok: false,
        status: response.status,
        finalUrl: response.url,
        contentType,
        message: `unsupported content type ${contentType || "unknown"}`
      };
    }
    const body = await readLimitedResponse(response, maxBytes);
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      contentType,
      body,
      byteLength: Buffer.byteLength(body, "utf8"),
      message: response.ok ? null : `HTTP ${response.status}`
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

async function readLimitedResponse(response, maxBytes) {
  if (!response.body) {
    const text = await response.text();
    return text.slice(0, maxBytes);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      chunks.push(value.slice(0, value.byteLength - (total - maxBytes)));
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

function extractHtml(html, pageUrl, baseUrl) {
  const canonicalHref = firstTagAttr(html, "link", "href", (attrs) => /\bcanonical\b/i.test(attrs.rel || ""));
  const linkedUrls = extractLinks(html, pageUrl, baseUrl);
  const linkWarnings = offOriginLinkWarnings(html, pageUrl, baseUrl);
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
  return {
    canonicalUrl: normalizeCrawlUrl(canonicalHref || pageUrl, pageUrl) || pageUrl,
    title: firstText(html, "title") || "",
    metaDescription: metaDescription(html),
    language: htmlLang(html),
    h1,
    h2,
    excerpt: redactedExcerpt,
    possibleFaq,
    possibleClaims,
    linkedUrls,
    warnings: [
      ...linkWarnings,
      ...(scanForSecrets(rawExcerpt).length > 0 ? ["Possible secret redacted from extracted text."] : [])
    ]
  };
}

function buildDraftConfig({ base, generatedAt, extracts, pages, warnings, corpusPath }) {
  const primary = extracts[0] || {};
  const name = primary.title || primary.h1 || new URL(base.normalizedBaseUrl).hostname;
  const description = primary.metaDescription || `Draft SiteCTX context for ${name}.`;
  const language = primary.language || "en";
  const sections = extracts.map((extract) => ({
    id: sectionIdForUrl(extract.url, base.origin),
    title: sectionTitleForExtract(extract),
    url: extract.url,
    summary: extract.url === base.normalizedBaseUrl ? "Homepage." : "Discovered source page."
  }));
  const sourcePages = extracts.map((extract) => {
    const page = pages.find((entry) => entry.finalUrl === extract.url);
    return {
      id: sectionIdForUrl(extract.url, base.origin),
      url: extract.url,
      title: sectionTitleForExtract(extract),
      purpose: "Discovered source page.",
      lastReviewedAt: null,
      discoveredAt: generatedAt,
      contentHash: page?.contentHash || null
    };
  });
  const candidatePages = extracts.map((extract) => ({
    url: extract.url,
    title: sectionTitleForExtract(extract),
    excerpt: extract.excerpt,
    reviewRequired: true
  }));
  return {
    siteUrl: base.siteUrl,
    name,
    description,
    language,
    publisher: {
      name,
      url: base.siteUrl
    },
    positioning: {
      summary: "",
      audience: [],
      not: [
        "Not a crawler permission system",
        "Not a model training license",
        "Not a ranking guarantee"
      ]
    },
    canonicalFacts: [],
    products: [],
    claims: [],
    faq: [],
    sections,
    sourcePages,
    discoveryCandidates: {
      facts: [],
      claims: extracts.flatMap((extract) =>
        extract.possibleClaims.map((candidate) => ({
          ...candidate,
          sourceUrl: extract.url
        }))
      ),
      faq: extracts.flatMap((extract) =>
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
  };
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
  return [...new Set(links)].sort();
}

function offOriginLinkWarnings(html, pageUrl, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const warnings = [];
  for (const match of html.matchAll(/<a\b([^>]*)>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (!attrs.href) {
      continue;
    }
    const normalized = normalizeCrawlUrl(attrs.href, pageUrl);
    if (normalized && !sameOrigin(normalized, origin)) {
      warnings.push(`Skipped off-origin URL: ${normalized}`);
    }
  }
  return [...new Set(warnings)];
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
  const slug = parsed.pathname
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .join("-")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "page";
}

function sectionTitleForExtract(extract) {
  return extract.title || extract.h1 || "Discovered Page";
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
