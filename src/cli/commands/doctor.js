import { Option } from "commander";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from "../exit-codes.js";
import { printCheckResult, writeJson } from "../output.js";
import { doctorLocal, doctorRemote } from "../../core/doctor-checks.js";

export function registerDoctorCommand(program) {
  program
    .command("doctor")
    .description("Run SiteCTX diagnostics for a local root or public URL.")
    .argument("[target]", "Public URL or local root. Defaults to current directory.")
    .addOption(new Option("--root <path>", "Local website root.").hideHelp())
    .addOption(new Option("--url <url>", "Public website URL.").hideHelp())
    .option("--timeout <ms>", "Remote fetch timeout in milliseconds.", "10000")
    .option("--max-bytes <bytes>", "Maximum bytes to read per remote artifact.", "1000000")
    .option("--allow-remote-origin <origin>", "Allow an additional remote origin for redirects or linked artifacts. Repeat for localhost/private test origins.", collect, [])
    .option("--strict", "Treat warnings as failures.")
    .option("--json", "Print machine-readable output.")
    .option("--verbose", "Include extra check details.")
    .addHelpText("after", `

Examples:
  npx sitectx@latest doctor ./public
  npx sitectx@latest doctor http://localhost:3000 --allow-remote-origin http://localhost:3000
  npx sitectx@latest doctor https://example.com
`)
    .action(async (target, options) => {
      const resolvedTarget = resolveDoctorTarget(target, options);
      if (!resolvedTarget.ok) {
        const result = {
          ok: false,
          strict: Boolean(options.strict),
          summary: { passes: 0, warnings: 0, failures: 1 },
          checks: [
            {
              level: "FAIL",
              code: "usage.target",
              target: "doctor",
              message: resolvedTarget.message
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

      const result = resolvedTarget.url
        ? await doctorRemote({ ...options, url: resolvedTarget.url })
        : await doctorLocal({ ...options, root: resolvedTarget.root });

      if (options.json) {
        writeJson(result);
      } else {
        printCheckResult("SiteCTX doctor", result, resolvedTarget.url || resolvedTarget.root);
      }
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_VALIDATION_FAILED;
    });
}

function resolveDoctorTarget(target, options) {
  const explicitTargets = [target, options.root, options.url].filter(Boolean);
  if (explicitTargets.length > 1) {
    return {
      ok: false,
      message: "Use one target only. Try: sitectx doctor https://example.com or sitectx doctor ./public"
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
      message: "Doctor only accepts http/https URLs or local paths. Try: sitectx doctor http://localhost:3000 or sitectx doctor ./public"
    };
  }
  return { ok: true, root: target };
}

function collect(value, previous) {
  return [...previous, value];
}
