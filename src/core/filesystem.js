import { constants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

export function resolveRoot(root = ".") {
  return path.resolve(root);
}

export function resolveWithin(base, target = ".") {
  return path.resolve(base, target);
}

export function artifactPaths(root = ".") {
  const resolvedRoot = resolveRoot(root);
  return {
    root: resolvedRoot,
    manifest: path.join(resolvedRoot, ".well-known", "sitectx"),
    manifestAlias: path.join(resolvedRoot, ".well-known", "sitectx.json"),
    context: path.join(resolvedRoot, "sitectx.json"),
    catalogs: path.join(resolvedRoot, "sitectx", "catalogs.json"),
    updates: path.join(resolvedRoot, "sitectx", "updates.json"),
    ndjson: path.join(resolvedRoot, "sitectx", "updates.ndjson"),
    sponsoredContext: path.join(resolvedRoot, "sitectx", "sponsored-context.json"),
    evidence: path.join(resolvedRoot, "sitectx", "evidence.json"),
    legacyUpdates: path.join(resolvedRoot, "updates.json"),
    legacyNdjson: path.join(resolvedRoot, "updates.ndjson"),
    config: path.join(resolvedRoot, "sitectx.config.json")
  };
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function ensureParentDirectory(filePath) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

export async function readUtf8(filePath) {
  return fs.readFile(filePath, "utf8");
}

export async function writeUtf8(filePath, content) {
  await ensureParentDirectory(filePath);
  await fs.writeFile(filePath, content, "utf8");
}

export async function removeFileIfExists(filePath) {
  try {
    await fs.unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export function displayPath(root, filePath) {
  const relative = path.relative(root, filePath) || ".";
  return relative.replaceAll(path.sep, "/");
}

export function resolvePublicPath(root, publicUrl) {
  const relativePath = publicUrlToRelativePath(publicUrl);
  if (relativePath == null) {
    return null;
  }
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (!isWithinRoot(resolvedRoot, resolved)) {
    return null;
  }
  return resolved;
}

export function publicPathEscapesRoot(root, publicUrl) {
  const relativePath = publicUrlToRelativePath(publicUrl);
  if (relativePath == null) {
    return false;
  }
  const resolvedRoot = path.resolve(root);
  return !isWithinRoot(resolvedRoot, path.resolve(resolvedRoot, relativePath));
}

function publicUrlToRelativePath(publicUrl) {
  if (typeof publicUrl !== "string" || publicUrl.length === 0) {
    return null;
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(publicUrl) || publicUrl.startsWith("//")) {
    return null;
  }
  const withoutQuery = publicUrl.split(/[?#]/, 1)[0];
  const normalized = withoutQuery.replaceAll("\\", "/");
  return normalized.startsWith("/")
    ? normalized.slice(1)
    : normalized;
}

function isWithinRoot(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
