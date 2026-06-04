import { readUtf8 } from "./filesystem.js";
import { getValidators, formatSchemaErrors } from "./schemas.js";
import { normalizeSiteUrl } from "./urls.js";
import { scanForSecrets } from "./secrets.js";
import { VERTICAL_PRESET_NAMES } from "./presets.js";

export async function loadConfig(configPath) {
  const raw = await readUtf8(configPath);
  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new ConfigError(
      `Config is not valid JSON: ${error instanceof Error ? error.message : "parse error"}.`
    );
  }
  return normalizeConfig(data);
}

export async function validateConfig(config) {
  const { validators } = await getValidators();
  const ok = validators.config(config);
  if (!ok) {
    return formatSchemaErrors(validators.config);
  }
  const semanticErrors = [];
  try {
    normalizeSiteUrl(config.siteUrl);
  } catch {
    semanticErrors.push("$.siteUrl must be an HTTP(S) URL");
  }
  addConfigSemanticErrors(config, semanticErrors);
  return semanticErrors;
}

export async function normalizeConfig(config) {
  const copy = structuredClone(config);
  if (copy.siteUrl) {
    try {
      copy.siteUrl = normalizeSiteUrl(copy.siteUrl);
    } catch {
      throw new ConfigError("Config validation failed:\n- $.siteUrl must be an HTTP(S) URL");
    }
  }
  const errors = await validateConfig(copy);
  if (errors.length > 0) {
    throw new ConfigError(`Config validation failed:\n${errors.map((item) => `- ${item}`).join("\n")}`);
  }
  return copy;
}

export class ConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfigError";
  }
}

function addConfigSemanticErrors(config, errors) {
  const duplicateChecks = [
    ["sections", config.sections],
    ["sourcePages", config.sourcePages],
    ["canonicalFacts", config.canonicalFacts],
    ["products", config.products],
    ["claims", config.claims],
    ["faq", config.faq],
    ["actions", config.actions],
    ["catalogs", config.catalogs]
  ];
  for (const [name, values] of duplicateChecks) {
    addDuplicateIdErrors(name, values, errors);
  }

  if (config.discovery?.status && !["draft_review_required", "reviewed"].includes(config.discovery.status)) {
    errors.push("$.discovery.status must be draft_review_required or reviewed");
  }
  for (const [jsonPath, value] of [
    ["$.verticalPreset", config.verticalPreset],
    ["$.discovery.preset", config.discovery?.preset]
  ]) {
    if (value != null && !VERTICAL_PRESET_NAMES.filter((preset) => preset !== "auto").includes(value)) {
      errors.push(`${jsonPath} must be ecommerce, nonprofit, saas, local-business, or docs`);
    }
  }

  const urlFields = [
    ["$.siteUrl", config.siteUrl],
    ["$.publisher.url", config.publisher?.url],
    ["$.publisher.logo", config.publisher?.logo],
    ...arrayValues(config.publisher?.profiles, "$.publisher.profiles"),
    ["$.identity.url", config.identity?.url],
    ["$.identity.logo", config.identity?.logo],
    ["$.identity.sourceUrl", config.identity?.sourceUrl],
    ...arrayValues(config.identity?.profiles, "$.identity.profiles"),
    ...fieldValues(config.sections, "url", "$.sections"),
    ...fieldValues(config.sourcePages, "url", "$.sourcePages"),
    ...fieldValues(config.canonicalFacts, "sourceUrl", "$.canonicalFacts"),
    ...fieldValues(config.products, "url", "$.products"),
    ...fieldValues(config.products, "sourceUrl", "$.products"),
    ...fieldValues(config.claims, "sourceUrl", "$.claims"),
    ...fieldValues(config.faq, "sourceUrl", "$.faq"),
    ...fieldValues(config.actions, "url", "$.actions"),
    ...fieldValues(config.catalogs, "url", "$.catalogs"),
    ...fieldValues(config.catalogs, "sourceUrl", "$.catalogs"),
    ...fieldValues(config.catalogs, "sampleUrl", "$.catalogs"),
    ...fieldValues(config.discoveryCandidates?.claims, "sourceUrl", "$.discoveryCandidates.claims"),
    ...fieldValues(config.discoveryCandidates?.faq, "sourceUrl", "$.discoveryCandidates.faq"),
    ...fieldValues(config.discoveryCandidates?.pages, "url", "$.discoveryCandidates.pages"),
    ...fieldValues(config.updates, "url", "$.updates")
  ];
  for (const [jsonPath, value] of urlFields) {
    if (value != null && !isValidHttpUrl(value)) {
      errors.push(`${jsonPath} must be an HTTP(S) URL`);
    }
  }

  const dateFields = [
    ...fieldValues(config.sourcePages, "lastReviewedAt", "$.sourcePages"),
    ...fieldValues(config.sourcePages, "discoveredAt", "$.sourcePages"),
    ...fieldValues(config.catalogs, "observedAt", "$.catalogs"),
    ...fieldValues(config.updates, "publishedAt", "$.updates"),
    ["$.discovery.generatedAt", config.discovery?.generatedAt]
  ];
  for (const [jsonPath, value] of dateFields) {
    if (value != null && !isIsoDate(value)) {
      errors.push(`${jsonPath} must be an ISO 8601 timestamp or null`);
    }
  }

  const secretFindings = [
    ...scanForSecrets(config.discoveryCandidates || {}),
    ...scanForSecrets(config.sourcePages || {})
  ];
  if (secretFindings.length > 0) {
    errors.push("Discovery fields contain possible secrets; redact them before generating public artifacts");
  }

  const prohibitedClaimErrors = prohibitedPublicClaimErrors(config);
  errors.push(...prohibitedClaimErrors);
}

function addDuplicateIdErrors(name, values, errors) {
  if (!Array.isArray(values)) {
    return;
  }
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (!value?.id) {
      continue;
    }
    if (seen.has(value.id)) {
      duplicates.add(value.id);
    }
    seen.add(value.id);
  }
  for (const id of duplicates) {
    errors.push(`$.${name} contains duplicate id "${id}"`);
  }
}

function fieldValues(values, field, basePath) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value, index) => [`${basePath}[${index}].${field}`, value?.[field]]);
}

function arrayValues(values, basePath) {
  if (!Array.isArray(values)) {
    return [];
  }
  return values.map((value, index) => [`${basePath}[${index}]`, value]);
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isIsoDate(value) {
  if (typeof value !== "string") {
    return false;
  }
  const timestamp = Date.parse(value);
  return !Number.isNaN(timestamp);
}

function prohibitedPublicClaimErrors(config) {
  const publicFields = {
    canonicalFacts: config.canonicalFacts,
    products: config.products,
    claims: config.claims,
    faq: config.faq
  };
  const text = JSON.stringify(publicFields);
  const prohibited = [
    ["crawler permission system", /crawler\s+permission\s+system/i],
    ["model training license", /model\s+training\s+license/i],
    ["legal certification", /legal\s+certification/i],
    ["ranking guarantee", /ranking\s+guarantee/i]
  ];
  return prohibited
    .filter(([, pattern]) => pattern.test(text))
    .map(([label]) => `Public config fields must not describe SiteCTX as ${label}`);
}
