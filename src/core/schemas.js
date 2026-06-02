import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const SCHEMA_BASE_URL = new URL("../../versions/v0.1/schema/", import.meta.url);

let validatorCache;

export async function loadSchema(name) {
  const schemaUrl = new URL(name, SCHEMA_BASE_URL);
  const schemaText = await fs.readFile(fileURLToPath(schemaUrl), "utf8");
  return JSON.parse(schemaText);
}

export async function getValidators() {
  if (validatorCache) {
    return validatorCache;
  }

  const ajv = new Ajv2020({
    allErrors: true,
    strict: false
  });
  ajv.addFormat("uri", {
    type: "string",
    validate: (value) => {
      try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch {
        return false;
      }
    }
  });
  ajv.addFormat("date-time", {
    type: "string",
    validate: (value) => !Number.isNaN(Date.parse(value))
  });

  const [
    manifestSchema,
    contextSchema,
    updatesSchema,
    updateSchema,
    configSchema,
    sitectxSchema
  ] = await Promise.all([
    loadSchema("manifest.schema.json"),
    loadSchema("context.schema.json"),
    loadSchema("updates.schema.json"),
    loadSchema("update.schema.json"),
    loadSchema("config.schema.json"),
    loadSchema("sitectx.schema.json")
  ]);

  ajv.addSchema(updateSchema);

  const validators = {
    manifest: ajv.compile(manifestSchema),
    context: ajv.compile(contextSchema),
    updates: ajv.compile(updatesSchema),
    update: ajv.getSchema(updateSchema.$id),
    config: ajv.compile(configSchema),
    sitectx: ajv.compile(sitectxSchema)
  };

  validatorCache = { ajv, validators };
  return validatorCache;
}

export function formatSchemaErrors(validate) {
  return (validate.errors || []).map((error) => {
    const location = error.instancePath || "$";
    return `${location} ${error.message}`.trim();
  });
}
