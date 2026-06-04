import { Command } from "commander";
import { createRequire } from "node:module";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS } from "./exit-codes.js";
import { writeError } from "./output.js";
import { registerDiscoverCommand } from "./commands/discover.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerReviewCommand } from "./commands/review.js";
import { registerSetupCommand, runSetupWizard, shouldRunInteractiveWizard } from "./commands/setup.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerVersionCommand } from "./commands/version.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");

export function buildProgram() {
  const program = new Command();

  program
    .name("sitectx")
    .description("Create, validate, inspect, and diagnose SiteCTX artifacts.")
    .version(packageJson.version)
    .addHelpText("after", `

Zero-install quick start:
  npx sitectx@latest init
  npx sitectx@latest validate .
  npx sitectx@latest doctor .

Existing app/static public dir:
  npx sitectx@latest init --root . --public-dir ./public
  npx sitectx@latest init --preset ecommerce

Localhost discovery:
  npx sitectx@latest discover http://localhost:3000 --preset saas --max-pages 25 --max-depth 2
  npx sitectx@latest review sitectx.config.draft.json
  npx sitectx@latest generate sitectx.config.draft.json ./public --force

Commands:
  init       Create SiteCTX files
  discover   Crawl a site into a review-required draft config
  review     Review a discovered draft config before publishing
  generate   Generate public artifacts from config
  validate   Validate local artifacts
  doctor     Diagnose local or remote artifacts
  inspect    Inspect local or remote metadata
`);

  registerVersionCommand(program, packageJson.version);
  registerSetupCommand(program);
  registerInitCommand(program);
  registerDiscoverCommand(program);
  registerReviewCommand(program);
  registerGenerateCommand(program);
  registerValidateCommand(program);
  registerDoctorCommand(program);
  registerInspectCommand(program);

  return program;
}

export async function runCli(argv) {
  const program = buildProgram();
  program.exitOverride();

  try {
    if (argv.slice(2).length === 0) {
      if (shouldRunInteractiveWizard()) {
        return await runSetupWizard();
      }
      program.outputHelp();
      return EXIT_SUCCESS;
    }
    await program.parseAsync(argv);
    return program._sitectxExitCode ?? EXIT_SUCCESS;
  } catch (error) {
    if (typeof error.exitCode === "number") {
      if (error.code !== "commander.helpDisplayed" && error.code !== "commander.version") {
        const message = error.message || "Command failed.";
        if (!message.startsWith("error:")) {
          writeError(message);
        }
      }
      return error.exitCode;
    }
    writeError(error?.message || "SiteCTX CLI runtime error.");
    return EXIT_RUNTIME_ERROR;
  }
}
