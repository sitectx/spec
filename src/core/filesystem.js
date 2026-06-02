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
    context: path.join(resolvedRoot, "sitectx.json"),
    updates: path.join(resolvedRoot, "updates.json"),
    ndjson: path.join(resolvedRoot, "updates.ndjson"),
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

export function displayPath(root, filePath) {
  const relative = path.relative(root, filePath) || ".";
  return relative.replaceAll(path.sep, "/");
}

export function resolvePublicPath(root, publicUrl) {
  if (typeof publicUrl !== "string" || publicUrl.length === 0) {
    return null;
  }
  if (/^https?:\/\//i.test(publicUrl)) {
    return null;
  }
  const withoutQuery = publicUrl.split(/[?#]/, 1)[0];
  const relativePath = withoutQuery.startsWith("/")
    ? withoutQuery.slice(1)
    : withoutQuery;
  return path.join(root, relativePath);
}
