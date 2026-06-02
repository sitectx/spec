import path from "node:path";
import { parseNdjson } from "./ndjson.js";
import { fetchText } from "./remote-fetch.js";
import { scanForSecrets } from "./secrets.js";
import { getValidators } from "./schemas.js";
import { createCollector, summarizeChecks, validateLocalArtifacts, validateWithSchema } from "./validation.js";
import { discoveryUrlForSite, isLocalhostUrl, safeUrl } from "./urls.js";

const PROHIBITED_CLAIMS = [
  {
    code: "claim.crawler-permission",
    label: "crawler permission control",
    pattern: /crawler\s+permission\s+control/i
  },
  {
    code: "claim.legal-certification",
    label: "legal certification",
    pattern: /legal\s+certification/i
  },
  {
    code: "claim.training-license",
    label: "model training license",
    pattern: /model\s+training\s+(license|permission)/i
  },
  {
    code: "claim.ranking-guarantee",
    label: "ranking guarantee",
    pattern: /ranking\s+guarantee/i
  }
];

export async function doctorLocal(options = {}) {
  const validation = await validateLocalArtifacts(options);
  const checks = [...validation.checks];
  const collector = { checks };

  addCheckMethods(collector);
  collector.warn(
    "local.http",
    path.resolve(options.root || "."),
    "HTTP reachability and content-type headers were not checked in local mode.",
    "Run doctor --url after deploying the artifacts."
  );
  addClaimChecks(collector, "local artifacts", validation.checks.map((check) => check.message).join("\n"));

  return summarizeChecks(checks, Boolean(options.strict));
}

export async function doctorRemote(options = {}) {
  const collector = createCollector();
  const timeout = Number(options.timeout || 10000);
  const inputUrl = options.url;
  const normalized = safeUrl(inputUrl);
  const { validators } = await getValidators();

  if (!normalized) {
    collector.fail("url.parse", inputUrl, "URL is not valid.");
    return summarizeChecks(collector.checks, Boolean(options.strict));
  }

  const parsed = new URL(normalized);
  if (parsed.protocol === "https:") {
    collector.pass("url.https", normalized, "Target uses HTTPS.");
  } else if (parsed.protocol === "http:" && isLocalhostUrl(normalized)) {
    collector.warn("url.https", normalized, "HTTP is allowed for localhost targets.");
  } else {
    collector.fail("url.https", normalized, "Remote SiteCTX doctor requires HTTPS outside localhost.");
  }

  const manifestUrl = discoveryUrlForSite(normalized);
  const manifestFetch = await fetchText(manifestUrl, { timeout });
  if (!manifestFetch.ok) {
    collector.fail(
      "manifest.fetch",
      manifestUrl,
      manifestFetch.error || `/.well-known/sitectx returned HTTP ${manifestFetch.status}.`,
      "Publish a JSON discovery manifest at /.well-known/sitectx."
    );
    return summarizeChecks(collector.checks, Boolean(options.strict));
  }
  collector.pass("manifest.fetch", manifestUrl, "/.well-known/sitectx is reachable.");
  addContentTypeCheck(collector, "manifest.contentType", manifestUrl, manifestFetch.contentType);
  addSizeCheck(collector, "manifest.size", manifestUrl, manifestFetch.body);

  const manifest = parseRemoteJson(collector, "manifest.parse", manifestUrl, manifestFetch.body);
  if (!manifest) {
    return summarizeChecks(collector.checks, Boolean(options.strict));
  }
  validateWithSchema({
    collector,
    root: ".",
    filePath: ".",
    key: "manifest",
    validator: validators.manifest,
    value: manifest,
    targetOverride: manifestUrl
  });
  addSecretChecks(collector, manifestUrl, manifest);
  addClaimChecks(collector, manifestUrl, JSON.stringify(manifest));

  const contextUrl = resolveRemoteLink(normalized, manifest.context?.url);
  await fetchAndValidateJson({
    collector,
    url: contextUrl,
    label: "context",
    required: true,
    timeout,
    validator: validators.context
  });

  const updatesUrl = resolveRemoteLink(normalized, manifest.updates?.url);
  await fetchAndValidateJson({
    collector,
    url: updatesUrl,
    label: "updates",
    required: false,
    timeout,
    validator: validators.updates
  });

  const ndjsonUrl = resolveRemoteLink(normalized, manifest.updatesNdjson?.url);
  await fetchAndValidateNdjson({
    collector,
    url: ndjsonUrl,
    timeout,
    validator: validators.update
  });

  return summarizeChecks(collector.checks, Boolean(options.strict));
}

async function fetchAndValidateJson({ collector, url, label, required, timeout, validator }) {
  if (!url) {
    const method = required ? "fail" : "warn";
    collector[method](`${label}.url`, label, `${label} URL is missing from the manifest.`);
    return;
  }
  const response = await fetchText(url, { timeout });
  if (!response.ok) {
    const method = required ? "fail" : "warn";
    collector[method](
      `${label}.fetch`,
      url,
      `${label} artifact is not reachable: HTTP ${response.status || "request failed"}.`
    );
    return;
  }
  collector.pass(`${label}.fetch`, url, `${label} artifact is reachable.`);
  addContentTypeCheck(collector, `${label}.contentType`, url, response.contentType);
  addSizeCheck(collector, `${label}.size`, url, response.body);
  const value = parseRemoteJson(collector, `${label}.parse`, url, response.body);
  if (!value) {
    return;
  }
  validateWithSchema({
    collector,
    root: ".",
    filePath: ".",
    key: label,
    validator,
    value,
    targetOverride: url
  });
  addSecretChecks(collector, url, value);
  addClaimChecks(collector, url, JSON.stringify(value));
}

async function fetchAndValidateNdjson({ collector, url, timeout, validator }) {
  if (!url) {
    collector.warn("ndjson.url", "updates.ndjson", "updates.ndjson URL is missing from the manifest.");
    return;
  }
  const response = await fetchText(url, { timeout });
  if (!response.ok) {
    collector.warn("ndjson.fetch", url, "updates.ndjson not found.");
    return;
  }
  collector.pass("ndjson.fetch", url, "updates.ndjson artifact is reachable.");
  addContentTypeCheck(collector, "ndjson.contentType", url, response.contentType, "application/x-ndjson");
  addSizeCheck(collector, "ndjson.size", url, response.body);
  const parsed = parseNdjson(response.body);
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) {
      collector.fail("ndjson.parse", `${url}:${error.line}`, `NDJSON line ${error.line} is not valid JSON.`);
    }
    return;
  }
  collector.pass("ndjson.parse", url, "updates.ndjson parsed successfully.");
  if (parsed.records.length === 0) {
    collector.warn("ndjson.empty", url, "updates.ndjson is empty.");
  }
  for (const record of parsed.records) {
    validateWithSchema({
      collector,
      root: ".",
      filePath: ".",
      key: `ndjson.line.${record.line}`,
      validator,
      value: record.value,
      targetOverride: `${url}:${record.line}`
    });
    addSecretChecks(collector, `${url}:${record.line}`, record.value);
    addClaimChecks(collector, `${url}:${record.line}`, JSON.stringify(record.value));
  }
}

function parseRemoteJson(collector, code, target, body) {
  try {
    const value = JSON.parse(body);
    collector.pass(code, target, "JSON parsed successfully.");
    return value;
  } catch (error) {
    collector.fail(code, target, `JSON parse failed: ${error.message}`);
    return null;
  }
}

function resolveRemoteLink(siteUrl, link) {
  if (!link) {
    return null;
  }
  try {
    return new URL(link, new URL(siteUrl).origin).toString();
  } catch {
    return null;
  }
}

function addContentTypeCheck(collector, code, target, contentType, expected = "application/json") {
  if (contentType.toLowerCase().includes(expected)) {
    collector.pass(code, target, `Content-Type is ${contentType}.`);
    return;
  }
  collector.warn(
    code,
    target,
    contentType
      ? `Content-Type is ${contentType}, expected ${expected}.`
      : `Content-Type is missing, expected ${expected}.`
  );
}

function addSizeCheck(collector, code, target, body) {
  const size = Buffer.byteLength(body || "", "utf8");
  if (size <= 1_000_000) {
    collector.pass(code, target, `Artifact size is sane (${size} bytes).`);
    return;
  }
  collector.warn(code, target, `Artifact is large (${size} bytes).`);
}

function addSecretChecks(collector, target, value) {
  const findings = scanForSecrets(value);
  if (findings.length === 0) {
    collector.pass("secrets.scan", target, "No obvious secrets detected.");
    return;
  }
  for (const finding of findings) {
    collector.fail(
      "secrets.scan",
      target,
      `Possible secret detected at ${finding.path}: ${finding.redacted}`,
      "Remove private tokens, credentials, cookies, or keys from public SiteCTX artifacts."
    );
  }
}

function addClaimChecks(collector, target, text) {
  const findings = PROHIBITED_CLAIMS.filter((claim) => claim.pattern.test(text));
  if (findings.length === 0) {
    collector.pass("claims.scan", target, "No prohibited SiteCTX claims detected.");
    return;
  }
  for (const finding of findings) {
    collector.fail(
      finding.code,
      target,
      `SiteCTX must not be described as ${finding.label}.`
    );
  }
}

function addCheckMethods(collector) {
  collector.pass = (code, target, message, hint) => {
    collector.checks.push({ level: "PASS", code, target, message, ...(hint ? { hint } : {}) });
  };
  collector.warn = (code, target, message, hint) => {
    collector.checks.push({ level: "WARN", code, target, message, ...(hint ? { hint } : {}) });
  };
  collector.fail = (code, target, message, hint) => {
    collector.checks.push({ level: "FAIL", code, target, message, ...(hint ? { hint } : {}) });
  };
}
