import path from "node:path";
import { artifactPaths, fileExists } from "../core/filesystem.js";
import { formatRelativePath } from "./output.js";

export const CLI_RUNNER = "npx sitectx@latest";
const NEARBY_PUBLIC_DIRS = ["public", "dist", "out", "build"];

export async function findNearbyArtifactRoot(root = ".") {
  const resolvedRoot = path.resolve(root || ".");
  for (const directory of NEARBY_PUBLIC_DIRS) {
    const candidate = path.join(resolvedRoot, directory);
    if (await fileExists(artifactPaths(candidate).manifest)) {
      return {
        root: candidate,
        displayPath: commandPathFor(candidate)
      };
    }
  }
  return null;
}

export async function addNearbyArtifactSuggestion(result, root, command) {
  if (result.ok || !hasMissingRequiredArtifactFailures(result)) {
    return null;
  }
  const nearby = await findNearbyArtifactRoot(root);
  if (!nearby) {
    return null;
  }
  const suggestion = nearbyArtifactSuggestion(nearby.displayPath, command);
  result.suggestions = [...(result.suggestions || []), suggestion];
  return suggestion;
}

export function nearbyArtifactSuggestion(displayPath, command) {
  return `Found SiteCTX artifacts under ${displayPath}. Try: ${CLI_RUNNER} ${command} ${displayPath}`;
}

export function hasMissingRequiredArtifactFailures(result) {
  return result.checks?.some((check) =>
    check.level === "FAIL" &&
    ["manifest.exists", "context.exists"].includes(check.code)
  );
}

function commandPathFor(target) {
  const relative = path.relative(process.cwd(), path.resolve(target));
  if (!relative) {
    return ".";
  }
  if (!relative.startsWith("..") && !path.isAbsolute(relative)) {
    return `./${formatRelativePath(relative)}`;
  }
  return formatRelativePath(path.resolve(target));
}
