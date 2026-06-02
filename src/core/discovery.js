import path from "node:path";
import { artifactPaths, fileExists, readUtf8, resolvePublicPath } from "./filesystem.js";
import { parseNdjson } from "./ndjson.js";
import { fetchText } from "./remote-fetch.js";
import { discoveryUrlForSite } from "./urls.js";

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
  const ndjsonPath = manifest?.updatesNdjson?.url
    ? resolvePublicPath(root, manifest.updatesNdjson.url) || paths.ndjson
    : paths.ndjson;

  const context = await tryReadJson(contextPath, warnings, "sitectx.json");
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
    updates,
    ndjsonCount,
    warnings
  });
}

export async function inspectRemote(options = {}) {
  const timeout = Number(options.timeout || 10000);
  const warnings = [];
  const manifestUrl = discoveryUrlForSite(options.url);
  const manifestResponse = await fetchText(manifestUrl, { timeout });
  if (!manifestResponse.ok) {
    warnings.push(`/.well-known/sitectx was not reachable: HTTP ${manifestResponse.status || "request failed"}.`);
    return summarizeInspection({
      target: options.url,
      manifestLocation: manifestUrl,
      manifest: null,
      context: null,
      updates: null,
      ndjsonCount: 0,
      warnings
    });
  }
  const manifest = parseJsonText(manifestResponse.body, warnings, manifestUrl);
  const contextUrl = manifest?.context?.url ? new URL(manifest.context.url, manifestUrl).toString() : null;
  const updatesUrl = manifest?.updates?.url ? new URL(manifest.updates.url, manifestUrl).toString() : null;
  const ndjsonUrl = manifest?.updatesNdjson?.url ? new URL(manifest.updatesNdjson.url, manifestUrl).toString() : null;

  const context = contextUrl ? await tryFetchJson(contextUrl, timeout, warnings) : null;
  const updates = updatesUrl ? await tryFetchJson(updatesUrl, timeout, warnings) : null;
  let ndjsonCount = 0;
  if (ndjsonUrl) {
    const response = await fetchText(ndjsonUrl, { timeout });
    if (response.ok) {
      const parsed = parseNdjson(response.body);
      ndjsonCount = parsed.records.length;
      if (parsed.errors.length > 0) {
        warnings.push("Remote updates.ndjson contains malformed JSON lines.");
      }
    } else {
      warnings.push("Remote updates.ndjson was not reachable.");
    }
  }

  return summarizeInspection({
    target: options.url,
    manifestLocation: manifestUrl,
    manifest,
    context,
    updates,
    ndjsonCount,
    warnings
  });
}

function summarizeInspection({ target, manifestLocation, manifest, context, updates, ndjsonCount, warnings }) {
  const sectionCount = Array.isArray(context?.sections)
    ? context.sections.length
    : Array.isArray(context?.records)
      ? context.records.length
      : 0;
  const updateCount = Array.isArray(updates?.updates) ? updates.updates.length : ndjsonCount;
  return {
    target,
    siteName: manifest?.site?.name || context?.site?.name || null,
    siteUrl: manifest?.site?.url || context?.site?.url || null,
    specVersion: manifest?.specVersion || context?.specVersion || context?.sitectx_version || null,
    manifestLocation,
    contextUrl: manifest?.context?.url || context?.resources?.self || null,
    updatesUrl: manifest?.updates?.url || context?.resources?.updates_json || null,
    updatesNdjsonUrl: manifest?.updatesNdjson?.url || context?.resources?.updates || null,
    generatedAt: manifest?.generatedAt || context?.generatedAt || context?.freshness?.generated_at || null,
    sectionCount,
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

async function tryFetchJson(url, timeout, warnings) {
  const response = await fetchText(url, { timeout });
  if (!response.ok) {
    warnings.push(`${url} was not reachable.`);
    return null;
  }
  return parseJsonText(response.body, warnings, url);
}

function parseJsonText(text, warnings, label) {
  try {
    return JSON.parse(text);
  } catch {
    warnings.push(`${label} is not valid JSON.`);
    return null;
  }
}
