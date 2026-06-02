import path from "node:path";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS } from "../exit-codes.js";
import { writeError, writeJson, writeLine } from "../output.js";
import { buildArtifacts, toWritePlan } from "../../core/artifacts.js";
import { loadConfig } from "../../core/config.js";
import { fileExists, resolveRoot, writeUtf8 } from "../../core/filesystem.js";

export function registerGenerateCommand(program) {
  const addGenerateCommand = (name, description) => {
    program
      .command(name)
      .description(description)
      .option("--config <path>", "Path to sitectx.config.json.", "sitectx.config.json")
      .option("--root <path>", "Base directory for resolving config.", ".")
      .option("--out <path>", "Output root for generated public artifacts.", ".")
      .option("--force", "Overwrite generated artifacts.")
      .option("--dry-run", "Show intended output without writing.")
      .option("--json", "Print machine-readable output.")
      .action(async (options) => {
        const result = await runGenerate(options);
        program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR;
      });
  };

  addGenerateCommand("generate", "Generate public SiteCTX artifacts from config.");
  addGenerateCommand("build", "Alias for generate.");
}

async function runGenerate(options) {
  const result = {
    ok: true,
    created: [],
    skipped: [],
    wouldCreate: [],
    errors: []
  };
  let plan;

  try {
    const root = resolveRoot(options.root);
    const configPath = path.resolve(root, options.config);
    const config = await loadConfig(configPath);
    const artifacts = buildArtifacts(config);
    plan = toWritePlan(path.resolve(root, options.out), artifacts.files);
  } catch (error) {
    result.ok = false;
    result.errors.push(error.message);
    printGenerateResult(result, options);
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

  printGenerateResult(result, options);
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
  for (const error of result.errors) {
    writeError(`ERROR ${error}`);
  }
  writeLine();
  writeLine(result.ok ? "Result: PASS" : "Result: FAIL");
}
