import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from "../exit-codes.js";
import { printCheckResult, writeJson } from "../output.js";
import { doctorLocal, doctorRemote } from "../../core/doctor-checks.js";

export function registerDoctorCommand(program) {
  program
    .command("doctor")
    .description("Run SiteCTX diagnostics for a local root or public URL.")
    .option("--root <path>", "Local website root.")
    .option("--url <url>", "Public website URL.")
    .option("--timeout <ms>", "Remote fetch timeout in milliseconds.", "10000")
    .option("--strict", "Treat warnings as failures.")
    .option("--json", "Print machine-readable output.")
    .option("--verbose", "Include extra check details.")
    .action(async (options) => {
      if (options.root && options.url) {
        const result = {
          ok: false,
          strict: Boolean(options.strict),
          summary: { passes: 0, warnings: 0, failures: 1 },
          checks: [
            {
              level: "FAIL",
              code: "usage.target",
              target: "doctor",
              message: "Use either --root or --url, not both."
            }
          ]
        };
        if (options.json) {
          writeJson(result);
        } else {
          printCheckResult("SiteCTX doctor", result);
        }
        program._sitectxExitCode = EXIT_RUNTIME_ERROR;
        return;
      }

      const result = options.url
        ? await doctorRemote(options)
        : await doctorLocal({ ...options, root: options.root || "." });

      if (options.json) {
        writeJson(result);
      } else {
        printCheckResult("SiteCTX doctor", result, options.url || options.root || ".");
      }
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_VALIDATION_FAILED;
    });
}
