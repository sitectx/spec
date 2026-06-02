import path from "node:path";
import {
  artifactPaths,
  displayPath,
  fileExists,
  readUtf8,
  resolvePublicPath
} from "./filesystem.js";
import { parseNdjson } from "./ndjson.js";
import { scanForSecrets } from "./secrets.js";
import { formatSchemaErrors, getValidators } from "./schemas.js";
import { isRelativePublicUrl } from "./urls.js";

export function createCollector() {
  const checks = [];
  return {
    checks,
    pass(code, target, message, hint) {
      checks.push({ level: "PASS", code, target, message, ...(hint ? { hint } : {}) });
    },
    warn(code, target, message, hint) {
      checks.push({ level: "WARN", code, target, message, ...(hint ? { hint } : {}) });
    },
    fail(code, target, message, hint) {
      checks.push({ level: "FAIL", code, target, message, ...(hint ? { hint } : {}) });
    }
  };
}

export function summarizeChecks(checks, strict = false) {
  const summary = {
    passes: checks.filter((check) => check.level === "PASS").length,
    warnings: checks.filter((check) => check.level === "WARN").length,
    failures: checks.filter((check) => check.level === "FAIL").length
  };
  return {
    ok: summary.failures === 0 && (!strict || summary.warnings === 0),
    strict,
    summary,
    checks
  };
}

export async function validateLocalArtifacts(options = {}) {
  const root = path.resolve(options.root || ".");
  const defaults = artifactPaths(root);
  const paths = {
    manifest: path.resolve(options.manifest || defaults.manifest),
    context: path.resolve(options.context || defaults.context),
    updates: path.resolve(options.updates || defaults.updates),
    ndjson: path.resolve(options.ndjson || defaults.ndjson)
  };
  const collector = createCollector();
  const parsed = {};
  const raw = {};
  const { validators } = await getValidators();

  parsed.manifest = await readJsonArtifact({
    collector,
    root,
    filePath: paths.manifest,
    key: "manifest",
    validator: validators.manifest
  });
  parsed.context = await readJsonArtifact({
    collector,
    root,
    filePath: paths.context,
    key: "context",
    validator: validators.context
  });
  if (parsed.context) {
    validateWithSchema({
      collector,
      root,
      filePath: paths.context,
      key: "context.v0.1",
      validator: validators.sitectx,
      value: parsed.context
    });
  }
  parsed.updates = await readJsonArtifact({
    collector,
    root,
    filePath: paths.updates,
    key: "updates",
    validator: validators.updates
  });

  const ndjsonTarget = displayPath(root, paths.ndjson);
  if (!(await fileExists(paths.ndjson))) {
    collector.fail("ndjson.exists", ndjsonTarget, "updates.ndjson is missing.");
  } else {
    raw.ndjson = await readUtf8(paths.ndjson);
    collector.pass("ndjson.exists", ndjsonTarget, "updates.ndjson exists.");
    const parsedNdjson = parseNdjson(raw.ndjson);
    if (parsedNdjson.errors.length > 0) {
      for (const error of parsedNdjson.errors) {
        collector.fail(
          "ndjson.parse",
          `${ndjsonTarget}:${error.line}`,
          `NDJSON line ${error.line} is not valid JSON: ${error.message}`
        );
      }
    } else {
      collector.pass("ndjson.parse", ndjsonTarget, "updates.ndjson parsed successfully.");
    }
    if (parsedNdjson.records.length === 0) {
      collector.warn("ndjson.empty", ndjsonTarget, "updates.ndjson is empty.");
    }
    for (const record of parsedNdjson.records) {
      validateWithSchema({
        collector,
        root,
        filePath: paths.ndjson,
        key: `ndjson.line.${record.line}`,
        validator: validators.update,
        value: record.value,
        targetOverride: `${ndjsonTarget}:${record.line}`
      });
      addSecretChecks(collector, `${ndjsonTarget}:${record.line}`, record.value);
    }
    parsed.ndjson = parsedNdjson.records.map((record) => record.value);
  }

  if (parsed.manifest) {
    await validateManifestLinks({ collector, root, manifest: parsed.manifest });
    addSecretChecks(collector, displayPath(root, paths.manifest), parsed.manifest);
  }
  if (parsed.context) {
    validateUniqueField(collector, "context.sectionIds", "sitectx.json", parsed.context.sections, "id", "Section IDs are unique.");
    validateUniqueField(collector, "context.recordIds", "sitectx.json", parsed.context.records, "id", "Record IDs are unique.");
    validateStringLengths(collector, "sitectx.json", parsed.context);
    addSecretChecks(collector, displayPath(root, paths.context), parsed.context);
  }
  if (parsed.updates) {
    validateUniqueField(collector, "updates.ids", "updates.json", parsed.updates.updates, "id", "Update IDs are unique.");
    validateStringLengths(collector, "updates.json", parsed.updates);
    addSecretChecks(collector, displayPath(root, paths.updates), parsed.updates);
  }

  return summarizeChecks(collector.checks, Boolean(options.strict));
}

async function readJsonArtifact({ collector, root, filePath, key, validator }) {
  const target = displayPath(root, filePath);
  if (!(await fileExists(filePath))) {
    collector.fail(`${key}.exists`, target, `${target} is missing.`);
    return null;
  }
  collector.pass(`${key}.exists`, target, `${target} exists.`);

  let raw;
  try {
    raw = await readUtf8(filePath);
  } catch (error) {
    collector.fail(`${key}.read`, target, `${target} could not be read: ${error.message}`);
    return null;
  }

  let value;
  try {
    value = JSON.parse(raw);
    collector.pass(`${key}.parse`, target, `${target} parsed successfully.`);
  } catch (error) {
    collector.fail(`${key}.parse`, target, `${target} is not valid JSON: ${error.message}`);
    return null;
  }

  validateWithSchema({ collector, root, filePath, key, validator, value });
  return value;
}

export function validateWithSchema({ collector, root, filePath, key, validator, value, targetOverride }) {
  const target = targetOverride || displayPath(root, filePath);
  if (validator(value)) {
    collector.pass(`${key}.schema`, target, `${target} matches the SiteCTX schema.`);
    return;
  }
  for (const error of formatSchemaErrors(validator)) {
    collector.fail(`${key}.schema`, target, `${target} schema validation failed: ${error}`);
  }
}

async function validateManifestLinks({ collector, root, manifest }) {
  const links = [
    ["context", manifest.context?.url, "sitectx.json"],
    ["updates", manifest.updates?.url, "updates.json"],
    ["updatesNdjson", manifest.updatesNdjson?.url, "updates.ndjson"]
  ];

  for (const [name, link, expectedFile] of links) {
    const target = ".well-known/sitectx";
    if (!link) {
      collector.fail(`manifest.${name}.url`, target, `Manifest ${name} URL is missing.`);
      continue;
    }
    if (isRelativePublicUrl(link)) {
      collector.pass(`manifest.${name}.relative`, target, `Manifest ${name} URL is relative: ${link}`);
    } else {
      collector.warn(
        `manifest.${name}.relative`,
        target,
        `Manifest ${name} URL is not a root-relative URL: ${link}`,
        "Root-relative URLs such as /sitectx.json are easier to relocate."
      );
    }
    const resolved = resolvePublicPath(root, link);
    if (!resolved) {
      collector.warn(
        `manifest.${name}.local`,
        target,
        `Manifest ${name} URL cannot be checked as a local file: ${link}`
      );
      continue;
    }
    const display = displayPath(root, resolved);
    if (display !== expectedFile) {
      collector.warn(
        `manifest.${name}.path`,
        target,
        `Manifest ${name} URL resolves to ${display}, expected ${expectedFile}.`
      );
    }
    if (path.relative(root, resolved).startsWith("..")) {
      collector.fail(`manifest.${name}.bounds`, target, `Manifest ${name} URL resolves outside the root.`);
      continue;
    }
    collector.pass(
      `manifest.${name}.resolve`,
      target,
      `Manifest ${name} URL resolves to ${display}.`
    );
    if (await fileExists(resolved)) {
      collector.pass(`manifest.${name}.exists`, display, `Manifest-linked file exists: ${display}`);
    } else {
      collector.fail(`manifest.${name}.exists`, display, `Manifest-linked file is missing: ${display}`);
    }
  }
}

function validateUniqueField(collector, code, target, values, field, successMessage) {
  if (!Array.isArray(values)) {
    return;
  }
  const seen = new Set();
  const duplicates = new Set();
  for (const item of values) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const value = item[field];
    if (!value) {
      continue;
    }
    if (seen.has(value)) {
      duplicates.add(value);
    }
    seen.add(value);
  }
  if (duplicates.size > 0) {
    collector.fail(code, target, `Duplicate ${field} values: ${[...duplicates].join(", ")}`);
  } else {
    collector.pass(code, target, successMessage);
  }
}

function validateStringLengths(collector, target, value) {
  const oversized = [];
  visitStrings(value, "$", (jsonPath, text) => {
    if (text.length > 10000) {
      oversized.push(jsonPath);
    }
  });
  if (oversized.length > 0) {
    collector.warn(
      "field.length",
      target,
      `Some fields are unusually long: ${oversized.slice(0, 5).join(", ")}`
    );
  } else {
    collector.pass("field.length", target, "Field lengths look sane.");
  }
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

function visitStrings(value, currentPath, callback) {
  if (typeof value === "string") {
    callback(currentPath, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => visitStrings(entry, `${currentPath}[${index}]`, callback));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      visitStrings(entry, `${currentPath}.${key}`, callback);
    }
  }
}
