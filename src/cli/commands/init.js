import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS } from "../exit-codes.js";
import { writeError, writeJson, writeLine } from "../output.js";
import { buildInitFiles, toWritePlan } from "../../core/artifacts.js";
import { artifactPaths, fileExists, removeFileIfExists, writeUtf8 } from "../../core/filesystem.js";

export function registerInitCommand(program) {
  program
    .command("init")
    .description("Create starter SiteCTX files in a website root.")
    .option("--root <path>", "Target website root.", ".")
    .option("--site-url <url>", "Public site URL.")
    .option("--name <name>", "Site name.")
    .option("--force", "Overwrite generated files.")
    .option("--dry-run", "Show what would be written without writing.")
    .option("--json", "Print machine-readable output.")
    .action(async (options) => {
      const result = await runInit(options);
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR;
    });
}

async function runInit(options) {
  let plan;
  try {
    const initFiles = buildInitFiles({
      siteUrl: options.siteUrl,
      name: options.name
    });
    plan = toWritePlan(options.root, initFiles.files);
  } catch (error) {
    const result = emptyResult(false, [error.message]);
    printInitResult(result, options);
    return result;
  }

  const result = emptyResult(true);
  if (options.force && !options.dryRun) {
    await removeLegacyUpdateArtifacts(options.root, result);
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

  printInitResult(result, options);
  return result;
}

function emptyResult(ok, errors = []) {
  return {
    ok,
    created: [],
    removed: [],
    skipped: [],
    wouldCreate: [],
    errors
  };
}

function printInitResult(result, options) {
  if (options.json) {
    writeJson(result);
    return;
  }
  writeLine("SiteCTX init");
  writeLine();
  if (result.wouldCreate.length > 0) {
    for (const file of result.wouldCreate) {
      writeLine(`WOULD CREATE ${file}`);
    }
  }
  if (result.created.length > 0) {
    for (const file of result.created) {
      writeLine(`CREATE ${file}`);
    }
  }
  if (result.skipped.length > 0) {
    for (const file of result.skipped) {
      writeLine(`SKIP ${file}`);
    }
  }
  if (result.removed.length > 0) {
    for (const file of result.removed) {
      writeLine(`REMOVE ${file}`);
    }
  }
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      writeError(`ERROR ${error}`);
    }
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
