import { normalizeSiteUrl } from "./urls.js";

const DEFAULT_TIMEOUT_MS = 7000;
const MAX_HTML_BYTES = 500_000;

export async function inferSiteContext(options = {}) {
  const siteUrl = normalizeSiteUrl(options.siteUrl || "https://example.com");
  const fallbackName = options.name || nameFromHostname(siteUrl);
  const fallbackSummary = `${fallbackName} publishes website context at ${siteUrl}.`;

  try {
    const html = await fetchHtml(siteUrl, {
      timeout: options.timeout || DEFAULT_TIMEOUT_MS,
      maxBytes: options.maxBytes || MAX_HTML_BYTES
    });
    const metadata = extractSiteMetadata(html);
    const name = cleanSiteName(options.name || metadata.siteName || metadata.title || metadata.h1 || fallbackName);
    const description = cleanSummary(
      options.description || metadata.description || metadata.ogDescription || metadata.firstParagraph || fallbackSummary
    );
    return {
      ok: true,
      siteUrl,
      name,
      description,
      summary: description,
      source: "site"
    };
  } catch (error) {
    const description = cleanSummary(options.description || fallbackSummary);
    return {
      ok: false,
      siteUrl,
      name: cleanSiteName(fallbackName),
      description,
      summary: description,
      source: "fallback",
      warning: error instanceof Error ? error.message : "Could not infer site context."
    };
  }
}

async function fetchHtml(siteUrl, { timeout, maxBytes }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(siteUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml"
      }
    });
    if (!response.ok) {
      throw new Error(`Site returned HTTP ${response.status}.`);
    }
    const contentType = response.headers.get("content-type") || "";
    if (contentType && !contentType.toLowerCase().includes("html")) {
      throw new Error(`Site returned ${contentType}, not HTML.`);
    }
    return readLimitedResponse(response, maxBytes);
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

function extractSiteMetadata(html) {
  return {
    title: firstText(html, "title"),
    h1: firstText(html, "h1"),
    siteName:
      metaContent(html, (attrs) => attrs.property === "og:site_name") ||
      metaContent(html, (attrs) => attrs.name === "application-name"),
    description: metaContent(html, (attrs) => attrs.name === "description"),
    ogDescription:
      metaContent(html, (attrs) => attrs.property === "og:description") ||
      metaContent(html, (attrs) => attrs.name === "twitter:description"),
    firstParagraph: firstText(html, "p") || truncate(visibleText(html), 240)
  };
}

function firstText(html, tag) {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(html);
  return match ? normalizeWhitespace(decodeHtml(stripTags(match[1]))) : "";
}

function metaContent(html, predicate) {
  for (const match of html.matchAll(/<meta\b([^>]*)>/gi)) {
    const attrs = parseAttrs(match[1]);
    if (attrs.content && predicate(attrs)) {
      return normalizeWhitespace(decodeHtml(attrs.content));
    }
  }
  return "";
}

function parseAttrs(value) {
  const attrs = {};
  for (const match of value.matchAll(/([:\w-]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    attrs[match[1].toLowerCase()] = decodeHtml(match[3] ?? match[4] ?? match[5] ?? "");
  }
  return attrs;
}

function visibleText(html) {
  const withoutHidden = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  return normalizeWhitespace(decodeHtml(stripTags(withoutHidden)));
}

function stripTags(value) {
  return value.replace(/<[^>]*>/g, " ");
}

function decodeHtml(value) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function cleanSiteName(value) {
  const normalized = normalizeWhitespace(value).replace(/\s+[|·-]\s+.*$/, "");
  return truncate(normalized, 120) || "Website";
}

function cleanSummary(value) {
  return truncate(normalizeWhitespace(value), 320);
}

function truncate(value, maxLength) {
  const normalized = normalizeWhitespace(value);
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}.`;
}

function nameFromHostname(siteUrl) {
  const host = new URL(siteUrl).hostname.replace(/^www\./, "");
  return host
    .split(".")[0]
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ") || host;
}
