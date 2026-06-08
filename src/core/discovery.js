import path from "node:path";
import { artifactPaths, fileExists, readUtf8, resolvePublicPath } from "./filesystem.js";
import { parseNdjson } from "./ndjson.js";
import { createRemoteFetchPolicy, fetchText, validateRemoteFetchUrl } from "./remote-fetch.js";
import { discoveryUrlForSite, safeUrl } from "./urls.js";

export async function inspectLocal(options = {}) {
  const root = path.resolve(options.root || ".");
  const paths = artifactPaths(root);
  const warnings = [];
  const manifest = await tryReadJson(paths.manifest, warnings, ".well-known/sitectx");
  const contextPath = manifest?.context?.url
    ? resolvePublicPath(root, manifest.context.url) || paths.context
    : paths.context;
  const updatesPath = manifest?.updates?.url
    ? resolvePublicPath(root, manifest.updates.url) || paths.updates
    : paths.updates;
  const catalogsPath = manifest?.catalogs?.url
    ? resolvePublicPath(root, manifest.catalogs.url) || paths.catalogs
    : paths.catalogs;
  const ndjsonPath = manifest?.updatesNdjson?.url
    ? resolvePublicPath(root, manifest.updatesNdjson.url) || paths.ndjson
    : paths.ndjson;

  const context = await tryReadJson(contextPath, warnings, "sitectx.json");
  const catalogs = await tryReadJson(catalogsPath, warnings, "sitectx/catalogs.json");
  const updates = await tryReadJson(updatesPath, warnings, "updates.json");
  let ndjsonCount = 0;
  if (await fileExists(ndjsonPath)) {
    const parsed = parseNdjson(await readUtf8(ndjsonPath));
    ndjsonCount = parsed.records.length;
    if (parsed.errors.length > 0) {
      warnings.push("updates.ndjson contains malformed JSON lines.");
    }
  } else {
    warnings.push("updates.ndjson was not found.");
  }

  return summarizeInspection({
    target: root,
    manifestLocation: ".well-known/sitectx",
    manifest,
    context,
    catalogs,
    updates,
    ndjsonCount,
    warnings
  });
}

export async function inspectRemote(options = {}) {
  const timeout = Number(options.timeout || 10000);
  const maxBytes = Number(options.maxBytes || 1_000_000);
  const warnings = [];
  const normalized = safeUrl(options.url);
  if (!normalized) {
    warnings.push("URL is not valid.");
    return summarizeInspection({
      target: options.url,
      manifestLocation: null,
      manifest: null,
      context: null,
      updates: null,
      ndjsonCount: 0,
      warnings
    });
  }
  let fetchPolicy;
  try {
    fetchPolicy = createRemoteFetchPolicy(normalized, options);
  } catch (error) {
    warnings.push(error instanceof Error ? error.message : "Remote fetch allowlist is invalid.");
    return summarizeInspection({
      target: normalized,
      manifestLocation: null,
      manifest: null,
      context: null,
      updates: null,
      ndjsonCount: 0,
      warnings
    });
  }
  const targetPolicy = await validateRemoteFetchUrl(normalized, fetchPolicy);
  if (!targetPolicy.ok) {
    warnings.push(targetPolicy.error);
    return summarizeInspection({
      target: normalized,
      manifestLocation: null,
      manifest: null,
      context: null,
      updates: null,
      ndjsonCount: 0,
      warnings
    });
  }

  const manifestUrl = discoveryUrlForSite(normalized);
  const manifestResponse = await fetchText(manifestUrl, { timeout, maxBytes, policy: fetchPolicy });
  if (!manifestResponse.ok) {
    warnings.push(`/.well-known/sitectx was not reachable: ${fetchFailureReason(manifestResponse)}.`);
    return summarizeInspection({
      target: normalized,
      manifestLocation: manifestUrl,
      manifest: null,
      context: null,
      updates: null,
      ndjsonCount: 0,
      warnings
    });
  }
  const manifest = parseJsonText(manifestResponse.body, warnings, manifestUrl);
  const contextUrl = resolveRemoteLink(manifestResponse.url, manifest?.context?.url);
  const catalogsUrl = resolveRemoteLink(manifestResponse.url, manifest?.catalogs?.url);
  const updatesUrl = resolveRemoteLink(manifestResponse.url, manifest?.updates?.url);
  const ndjsonUrl = resolveRemoteLink(manifestResponse.url, manifest?.updatesNdjson?.url);

  const context = contextUrl ? await tryFetchJson(contextUrl, timeout, maxBytes, fetchPolicy, warnings) : null;
  const catalogs = catalogsUrl ? await tryFetchJson(catalogsUrl, timeout, maxBytes, fetchPolicy, warnings) : null;
  const updates = updatesUrl ? await tryFetchJson(updatesUrl, timeout, maxBytes, fetchPolicy, warnings) : null;
  let ndjsonCount = 0;
  if (ndjsonUrl) {
    const response = await fetchText(ndjsonUrl, { timeout, maxBytes, policy: fetchPolicy });
    if (response.ok) {
      const parsed = parseNdjson(response.body);
      ndjsonCount = parsed.records.length;
      if (parsed.errors.length > 0) {
        warnings.push("Remote updates.ndjson contains malformed JSON lines.");
      }
    } else {
      warnings.push(response.error || "Remote updates.ndjson was not reachable.");
    }
  }

  return summarizeInspection({
    target: normalized,
    manifestLocation: manifestUrl,
    manifest,
    context,
    catalogs,
    updates,
    ndjsonCount,
    warnings
  });
}

function summarizeInspection({ target, manifestLocation, manifest, context, catalogs, updates, ndjsonCount, warnings }) {
  const sectionCount = Array.isArray(context?.sections)
    ? context.sections.length
    : Array.isArray(context?.records)
      ? context.records.length
      : 0;
  const updateCount = Array.isArray(updates?.updates) ? updates.updates.length : ndjsonCount;
  const catalogCount = Array.isArray(catalogs?.catalogs)
    ? catalogs.catalogs.length
    : Array.isArray(context?.catalogs)
      ? context.catalogs.length
      : 0;
  return {
    target,
    siteName: manifest?.site?.name || context?.site?.name || null,
    siteUrl: manifest?.site?.url || context?.site?.url || null,
    specVersion: manifest?.specVersion || context?.specVersion || context?.sitectx_version || null,
    manifestLocation,
    contextUrl: manifest?.context?.url || context?.resources?.self || null,
    catalogsUrl: manifest?.catalogs?.url || context?.resources?.catalogs || null,
    updatesUrl: manifest?.updates?.url || context?.resources?.updates_json || null,
    updatesNdjsonUrl: manifest?.updatesNdjson?.url || context?.resources?.updates || null,
    evidenceUrl: manifest?.evidence?.url || context?.resources?.evidence || null,
    generatedAt: manifest?.generatedAt || context?.generatedAt || context?.freshness?.generated_at || null,
    sectionCount,
    catalogCount,
    updateCount,
    warnings
  };
}

async function tryReadJson(filePath, warnings, label) {
  if (!(await fileExists(filePath))) {
    warnings.push(`${label} was not found.`);
    return null;
  }
  return parseJsonText(await readUtf8(filePath), warnings, label);
}

async function tryFetchJson(url, timeout, maxBytes, fetchPolicy, warnings) {
  const response = await fetchText(url, { timeout, maxBytes, policy: fetchPolicy });
  if (!response.ok) {
    warnings.push(`${url} was not reachable: ${fetchFailureReason(response)}.`);
    return null;
  }
  return parseJsonText(response.body, warnings, url);
}

function fetchFailureReason(response) {
  return response.error || `HTTP ${response.status || "request failed"}`;
}

function resolveRemoteLink(baseUrl, link) {
  if (!link) {
    return null;
  }
  try {
    return new URL(link, new URL(baseUrl).origin).toString();
  } catch {
    return null;
  }
}

function parseJsonText(text, warnings, label) {
  try {
    return JSON.parse(text);
  } catch {
    warnings.push(`${label} is not valid JSON.`);
    return null;
  }
}
