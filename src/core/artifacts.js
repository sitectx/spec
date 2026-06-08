import path from "node:path";
import { isCommercialContextEnabled, sponsoredContextOutputPath } from "./commercial-context.js";
import { safeJsonStringify } from "./json-hygiene.js";
import { stringifyNdjson } from "./ndjson.js";
import { artifactPaths, displayPath } from "./filesystem.js";
import { scanForSecrets } from "./secrets.js";
import { createContext } from "../templates/context.js";
import { createCatalogs } from "../templates/catalogs.js";
import { createDefaultConfig } from "../templates/default-config.js";
import { createManifest } from "../templates/manifest.js";
import { createNdjsonUpdates, createUpdates } from "../templates/updates.js";
import { createSponsoredContextArtifact } from "../templates/sponsored-context.js";

export const GENERATED_ARTIFACTS = [
  ".well-known/sitectx",
  ".well-known/sitectx.json",
  "sitectx.json",
  "sitectx/catalogs.json",
  "sitectx/updates.json",
  "sitectx/updates.ndjson"
];

export const ALL_INIT_FILES = [
  ...GENERATED_ARTIFACTS,
  "sitectx.config.json"
];

export function stableJson(value) {
  return `${safeJsonStringify(value, 2)}\n`;
}

export function buildArtifacts(config, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const manifest = createManifest(config, generatedAt);
  const context = createContext(config, generatedAt);
  const catalogs = createCatalogs(config, generatedAt);
  const updates = createUpdates(config, generatedAt);
  const ndjsonUpdates = createNdjsonUpdates(config, generatedAt);
  const sponsoredContext = isCommercialContextEnabled(config)
    ? createSponsoredContextArtifact(config, generatedAt)
    : null;

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
        relativePath: "sitectx/catalogs.json",
        content: stableJson(catalogs),
        data: catalogs
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
      },
      ...(sponsoredContext
        ? [
            {
              relativePath: sponsoredContextOutputPath(config),
              content: stableJson(sponsoredContext),
              data: sponsoredContext
            }
          ]
        : [])
    ]
  };
}

export function buildInitFiles(options = {}) {
  const config = options.config || createDefaultConfig(options);
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
  return files.map((file) => {
    const absolutePath = resolveArtifactPath(paths.root, file.relativePath);
    return {
      ...file,
      absolutePath,
      displayPath: displayPath(paths.root, absolutePath)
    };
  });
}

export function artifactSecretErrors(files) {
  return artifactSecretFindings(files).map(
    (finding) =>
      `Generated artifact ${finding.relativePath} contains possible ${finding.type} at ${finding.path}: ${finding.redacted}. Redact secrets before writing public artifacts.`
  );
}

export function artifactSecretFindings(files) {
  return files.flatMap((file) =>
    scanForSecrets(file.data ?? file.content, { path: "$" }).map((finding) => ({
      relativePath: file.relativePath,
      ...finding
    }))
  );
}

function resolveArtifactPath(root, relativePath) {
  if (typeof relativePath !== "string" || relativePath.trim().length === 0) {
    throw new Error("Artifact relativePath must be a non-empty relative path.");
  }
  if (path.isAbsolute(relativePath) || path.win32.isAbsolute(relativePath)) {
    throw new Error(`Artifact path must be relative: ${relativePath}`);
  }
  const normalizedRelativePath = relativePath.replaceAll("\\", "/");
  if (normalizedRelativePath.split("/").includes("..")) {
    throw new Error(`Artifact path cannot contain .. segments: ${relativePath}`);
  }

  const resolvedRoot = path.resolve(root);
  const absolutePath = path.resolve(resolvedRoot, normalizedRelativePath);
  const relativeFromRoot = path.relative(resolvedRoot, absolutePath);
  if (relativeFromRoot.startsWith("..") || path.isAbsolute(relativeFromRoot)) {
    throw new Error(`Artifact path escapes output root: ${relativePath}`);
  }
  return absolutePath;
}
