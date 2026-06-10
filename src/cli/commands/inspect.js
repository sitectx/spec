import path from "node:path";
import { Option } from "commander";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS } from "../exit-codes.js";
import { writeJson, writeLine } from "../output.js";
import { findNearbyArtifactRoot, nearbyArtifactSuggestion } from "../artifact-root-suggestions.js";
import { inspectLocal, inspectRemote } from "../../core/discovery.js";
import { artifactPaths, fileExists } from "../../core/filesystem.js";

export function registerInspectCommand(program) {
  program
    .command("inspect")
    .description("Inspect local or remote SiteCTX metadata.")
    .argument("[target]", "Public URL or local root. Defaults to current directory.")
    .addOption(new Option("--root <path>", "Local website root.").hideHelp())
    .addOption(new Option("--url <url>", "Public website URL.").hideHelp())
    .option("--timeout <ms>", "Remote fetch timeout in milliseconds.", "10000")
    .option("--max-bytes <bytes>", "Maximum bytes to read per remote artifact.", "1000000")
    .option("--allow-remote-origin <origin>", "Allow an additional remote origin for redirects or linked artifacts. Repeat for localhost/private test origins.", collect, [])
    .option("--json", "Print machine-readable output.")
    .addHelpText("after", `

Examples:
  npx sitectx@latest inspect ./public
  npx sitectx@latest inspect http://localhost:3000 --allow-remote-origin http://localhost:3000
  npx sitectx@latest inspect https://example.com
`)
    .action(async (target, options) => {
      const resolvedTarget = resolveInspectTarget(target, options);
      if (!resolvedTarget.ok) {
        const result = {
          ok: false,
          target: "inspect",
          warnings: [resolvedTarget.message]
        };
        if (options.json) {
          writeJson(result);
        } else {
          printInspection(result);
        }
        program._sitectxExitCode = EXIT_RUNTIME_ERROR;
        return;
      }

      if (!resolvedTarget.url) {
        const preflight = await inspectLocalTargetPreflight(resolvedTarget.root);
        if (!preflight.ok) {
          if (options.json) {
            writeJson(preflight.result);
          } else {
            printInspection(preflight.result);
          }
          program._sitectxExitCode = EXIT_RUNTIME_ERROR;
          return;
        }
      }

      const result = resolvedTarget.url
        ? await inspectRemote({ ...options, url: resolvedTarget.url })
        : await inspectLocal({ ...options, root: resolvedTarget.root });
      if (options.json) {
        writeJson(result);
      } else {
        printInspection(result);
      }
      program._sitectxExitCode = EXIT_SUCCESS;
    });
}

function resolveInspectTarget(target, options) {
  const explicitTargets = [target, options.root, options.url].filter(Boolean);
  if (explicitTargets.length > 1) {
    return {
      ok: false,
      message: "Use one target only. Try: npx sitectx@latest inspect https://example.com or npx sitectx@latest inspect ./public"
    };
  }
  if (options.url) {
    return { ok: true, url: options.url };
  }
  if (options.root) {
    return { ok: true, root: options.root };
  }
  if (!target) {
    return { ok: true, root: "." };
  }
  if (/^https?:\/\//i.test(target)) {
    return { ok: true, url: target };
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) {
    return {
      ok: false,
      message: "Inspect only accepts http/https URLs or local paths. Try: npx sitectx@latest inspect http://localhost:3000 or npx sitectx@latest inspect ./public"
    };
  }
  return { ok: true, root: target };
}

function collect(value, previous) {
  return [...previous, value];
}

async function inspectLocalTargetPreflight(root = ".") {
  const resolvedRoot = path.resolve(root || ".");
  if (await fileExists(artifactPaths(resolvedRoot).manifest)) {
    return { ok: true };
  }

  const result = {
    ok: false,
    target: resolvedRoot,
    warnings: [".well-known/sitectx was not found."]
  };
  const nearby = await findNearbyArtifactRoot(resolvedRoot);
  if (nearby) {
    result.suggestions = [nearbyArtifactSuggestion(nearby.displayPath, "inspect")];
  }
  return { ok: false, result };
}

export function printInspection(result) {
  writeLine("SiteCTX inspect");
  writeLine();
  if (result.ok === false) {
    writeLine(`Target: ${result.target || ""}`);
    if (result.warnings?.length) {
      writeLine();
      for (const warning of result.warnings) {
        writeLine(`WARN ${warning}`);
      }
    }
    if (result.suggestions?.length) {
      writeLine();
      for (const suggestion of result.suggestions) {
        writeLine(`Suggestion: ${suggestion}`);
      }
    }
    writeLine();
    writeLine("Result: FAIL");
    return;
  }

  writeLine(`Target: ${result.target || ""}`);
  writeLine(`Site name: ${result.siteName || "unknown"}`);
  writeLine(`Site URL: ${result.siteUrl || "unknown"}`);
  writeLine(`Spec version: ${result.specVersion || "unknown"}`);
  writeLine(`Manifest: ${result.manifestLocation || "unknown"}`);
  writeLine(`Context URL: ${result.contextUrl || "unknown"}`);
  writeLine(`Catalogs URL: ${result.catalogsUrl || "unknown"}`);
  writeLine(`Updates URL: ${result.updatesUrl || "unknown"}`);
  writeLine(`Updates NDJSON URL: ${result.updatesNdjsonUrl || "unknown"}`);
  writeLine(`Evidence URL: ${result.evidenceUrl || "unknown"}`);
  writeLine(`Generated: ${result.generatedAt || "unknown"}`);
  writeLine(`Sections: ${result.sectionCount ?? 0}`);
  writeLine(`Catalogs: ${result.catalogCount ?? 0}`);
  writeLine(`Updates: ${result.updateCount ?? 0}`);
  if (result.warnings?.length) {
    writeLine();
    for (const warning of result.warnings) {
      writeLine(`WARN ${warning}`);
    }
  }
}
