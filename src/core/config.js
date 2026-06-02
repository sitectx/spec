import { readUtf8 } from "./filesystem.js";
import { getValidators, formatSchemaErrors } from "./schemas.js";
import { normalizeSiteUrl } from "./urls.js";

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
