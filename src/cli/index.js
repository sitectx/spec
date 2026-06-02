import { Command } from "commander";
import { createRequire } from "node:module";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS } from "./exit-codes.js";
import { writeError } from "./output.js";
import { registerDiscoverCommand } from "./commands/discover.js";
import { registerDoctorCommand } from "./commands/doctor.js";
import { registerGenerateCommand } from "./commands/generate.js";
import { registerInitCommand } from "./commands/init.js";
import { registerInspectCommand } from "./commands/inspect.js";
import { registerValidateCommand } from "./commands/validate.js";
import { registerVersionCommand } from "./commands/version.js";

const require = createRequire(import.meta.url);
const packageJson = require("../../package.json");

export function buildProgram() {
  const program = new Command();

  program
    .name("sitectx")
    .description("Create, validate, inspect, and diagnose SiteCTX artifacts.")
    .version(packageJson.version);

  registerVersionCommand(program, packageJson.version);
  registerInitCommand(program);
  registerDiscoverCommand(program);
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
