import path from "node:path";
import { stringifyNdjson } from "./ndjson.js";
import { artifactPaths, displayPath } from "./filesystem.js";
import { createContext } from "../templates/context.js";
import { createDefaultConfig } from "../templates/default-config.js";
import { createManifest } from "../templates/manifest.js";
import { createNdjsonUpdates, createUpdates } from "../templates/updates.js";

export const GENERATED_ARTIFACTS = [
  ".well-known/sitectx",
  ".well-known/sitectx.json",
  "sitectx.json",
  "sitectx/updates.json",
  "sitectx/updates.ndjson"
];

export const ALL_INIT_FILES = [
  ...GENERATED_ARTIFACTS,
  "sitectx.config.json"
];

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function buildArtifacts(config, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const manifest = createManifest(config, generatedAt);
  const context = createContext(config, generatedAt);
  const updates = createUpdates(config, generatedAt);
  const ndjsonUpdates = createNdjsonUpdates(config, generatedAt);

  return {
    generatedAt,
    files: [
      {
        relativePath: ".well-known/sitectx",
        content: stableJson(manifest),
        data: manifest
      },
      {
        relativePath: ".well-known/sitectx.json",
        content: stableJson(manifest),
        data: manifest
      },
      {
        relativePath: "sitectx.json",
        content: stableJson(context),
        data: context
      },
      {
        relativePath: "sitectx/updates.json",
        content: stableJson(updates),
        data: updates
      },
      {
        relativePath: "sitectx/updates.ndjson",
        content: stringifyNdjson(ndjsonUpdates),
        data: ndjsonUpdates
      }
    ]
  };
}

export function buildInitFiles(options = {}) {
  const config = createDefaultConfig(options);
  const artifacts = buildArtifacts(config, options);
  return {
    config,
    generatedAt: artifacts.generatedAt,
    files: [
      ...artifacts.files,
      {
        relativePath: "sitectx.config.json",
        content: stableJson(config),
        data: config
      }
    ]
  };
}

export function toWritePlan(root, files) {
  const paths = artifactPaths(root);
  return files.map((file) => ({
    ...file,
    absolutePath: path.join(paths.root, file.relativePath),
    displayPath: displayPath(paths.root, path.join(paths.root, file.relativePath))
  }));
}
