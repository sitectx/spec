import { Option } from "commander";
import { EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from "../exit-codes.js";
import { printCheckResult, writeJson } from "../output.js";
import { validateLocalArtifacts } from "../../core/validation.js";

export function registerValidateCommand(program) {
  program
    .command("validate")
    .description("Validate local SiteCTX artifacts.")
    .argument("[root]", "Root containing SiteCTX public artifacts.", ".")
    .addOption(new Option("--root <path>", "Root containing SiteCTX public artifacts.").hideHelp())
    .option("--manifest <path>", "Path to discovery manifest.")
    .option("--context <path>", "Path to context snapshot.")
    .option("--catalogs <path>", "Path to catalog index.")
    .option("--sponsored-context <path>", "Path to sponsored context artifact.")
    .option("--updates <path>", "Path to JSON update feed.")
    .option("--ndjson <path>", "Path to NDJSON update feed.")
    .option("--schema-version <version>", "Schema version to validate with.", "v0.1")
    .option("--strict", "Treat warnings as failures.")
    .option("--json", "Print machine-readable output.")
    .addHelpText("after", `

Examples:
  npx sitectx@latest validate .
  npx sitectx@latest validate ./public
`)
    .action(async (root, options) => {
      const result = await validateLocalArtifacts({ ...options, root: options.root || root || "." });
      if (options.json) {
        writeJson(result);
      } else {
        printCheckResult("SiteCTX validation", result);
      }
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_VALIDATION_FAILED;
    });
}
