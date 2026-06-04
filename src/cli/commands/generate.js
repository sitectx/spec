import path from "node:path";
import { Option } from "commander";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from "../exit-codes.js";
import { writeError, writeJson, writeLine } from "../output.js";
import { buildArtifacts, toWritePlan } from "../../core/artifacts.js";
import { loadConfig } from "../../core/config.js";
import { artifactPaths, fileExists, removeFileIfExists, resolveRoot, writeUtf8 } from "../../core/filesystem.js";

export function registerGenerateCommand(program) {
  const addGenerateCommand = (name, description) => {
    program
      .command(name)
      .description(description)
      .argument("[config]", "Path to sitectx.config.json.", "sitectx.config.json")
      .argument("[out]", "Output root for generated public artifacts.", ".")
      .addOption(new Option("--config <path>", "Path to sitectx.config.json.").hideHelp())
      .addOption(new Option("--root <path>", "Base directory for resolving config.").hideHelp())
      .addOption(new Option("--out <path>", "Output root for generated public artifacts.").hideHelp())
      .option("--force", "Overwrite generated artifacts.")
      .option("--dry-run", "Show intended output without writing.")
      .option("--allow-draft", "Generate from an unreviewed discovery draft.")
      .option("--json", "Print machine-readable output.")
      .addHelpText("after", `

Examples:
  npx sitectx@latest generate sitectx.config.json ./public --force
  npx sitectx@latest generate sitectx.config.draft.json ./public --allow-draft --force

Behavior:
  Review-required discovery drafts fail unless --allow-draft is passed.
  Existing generated artifacts require --force.
`)
      .action(async (config, out, options) => {
        const result = await runGenerate({
          ...options,
          config: options.config || config || "sitectx.config.json",
          out: options.out || out || ".",
          root: options.root || "."
        });
        program._sitectxExitCode = result.exitCode ?? (result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR);
      });
  };

  addGenerateCommand("generate", "Generate public SiteCTX artifacts from config.");
  addGenerateCommand("build", "Alias for generate.");
}

export async function runGenerate(options) {
  const result = {
    ok: true,
    created: [],
    skipped: [],
    wouldCreate: [],
    removed: [],
    warnings: [],
    errors: []
  };
  let plan;

  try {
    const root = resolveRoot(options.root);
    const configPath = path.resolve(root, options.config);
    const config = await loadConfig(configPath);
    if (config.discovery?.status === "draft_review_required") {
      if (!options.allowDraft) {
        result.ok = false;
        result.exitCode = EXIT_VALIDATION_FAILED;
        result.errors.push(
          "Discovered drafts require human review before generation. Edit the config and set discovery.status to \"reviewed\", or pass --allow-draft to generate anyway."
        );
        if (!options.silent) {
          printGenerateResult(result, options);
        }
        return result;
      }
      result.warnings.push(
        "Generating from an unreviewed discovery draft because --allow-draft was passed. Review is recommended before publishing."
      );
    }
    const artifacts = buildArtifacts(config);
    const outRoot = path.resolve(root, options.out);
    if (options.force && !options.dryRun) {
      await removeLegacyUpdateArtifacts(outRoot, result);
    }
    plan = toWritePlan(outRoot, artifacts.files);
  } catch (error) {
    result.ok = false;
    result.errors.push(error.message);
    if (!options.silent) {
      printGenerateResult(result, options);
    }
    return result;
  }

  for (const file of plan) {
    const exists = await fileExists(file.absolutePath);
    if (options.dryRun) {
      if (exists && !options.force) {
        result.skipped.push(file.displayPath);
      } else {
        result.wouldCreate.push(file.displayPath);
      }
      continue;
    }
    if (exists && !options.force) {
      result.skipped.push(file.displayPath);
      result.errors.push(`${file.displayPath} already exists. Use --force to overwrite it.`);
      result.ok = false;
      continue;
    }
    await writeUtf8(file.absolutePath, file.content);
    result.created.push(file.displayPath);
  }

  if (!options.silent) {
    printGenerateResult(result, options);
  }
  return result;
}

function printGenerateResult(result, options) {
  if (options.json) {
    writeJson(result);
    return;
  }
  writeLine("SiteCTX generate");
  writeLine();
  for (const file of result.wouldCreate) {
    writeLine(`WOULD CREATE ${file}`);
  }
  for (const file of result.created) {
    writeLine(`CREATE ${file}`);
  }
  for (const file of result.skipped) {
    writeLine(`SKIP ${file}`);
  }
  for (const file of result.removed) {
    writeLine(`REMOVE ${file}`);
  }
  for (const warning of result.warnings) {
    writeLine(`WARN ${warning}`);
  }
  for (const error of result.errors) {
    writeError(`ERROR ${error}`);
  }
  writeLine();
  writeLine(result.ok ? "Result: PASS" : "Result: FAIL");
}

async function removeLegacyUpdateArtifacts(root, result) {
  const paths = artifactPaths(root);
  if (await removeFileIfExists(paths.legacyUpdates)) {
    result.removed.push("updates.json");
  }
  if (await removeFileIfExists(paths.legacyNdjson)) {
    result.removed.push("updates.ndjson");
  }
}
