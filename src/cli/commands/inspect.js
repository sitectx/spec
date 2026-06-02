import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS } from "../exit-codes.js";
import { writeJson, writeLine } from "../output.js";
import { inspectLocal, inspectRemote } from "../../core/discovery.js";

export function registerInspectCommand(program) {
  program
    .command("inspect")
    .description("Inspect local or remote SiteCTX metadata.")
    .option("--root <path>", "Local website root.")
    .option("--url <url>", "Public website URL.")
    .option("--timeout <ms>", "Remote fetch timeout in milliseconds.", "10000")
    .option("--json", "Print machine-readable output.")
    .action(async (options) => {
      if (options.root && options.url) {
        const result = {
          target: options.url,
          warnings: ["Use either --root or --url, not both."]
        };
        if (options.json) {
          writeJson(result);
        } else {
          printInspection(result);
        }
        program._sitectxExitCode = EXIT_RUNTIME_ERROR;
        return;
      }

      const result = options.url
        ? await inspectRemote(options)
        : await inspectLocal({ ...options, root: options.root || "." });
      if (options.json) {
        writeJson(result);
      } else {
        printInspection(result);
      }
      program._sitectxExitCode = EXIT_SUCCESS;
    });
}

function printInspection(result) {
  writeLine("SiteCTX inspect");
  writeLine();
  writeLine(`Target: ${result.target || ""}`);
  writeLine(`Site name: ${result.siteName || "unknown"}`);
  writeLine(`Site URL: ${result.siteUrl || "unknown"}`);
  writeLine(`Spec version: ${result.specVersion || "unknown"}`);
  writeLine(`Manifest: ${result.manifestLocation || "unknown"}`);
  writeLine(`Context URL: ${result.contextUrl || "unknown"}`);
  writeLine(`Updates URL: ${result.updatesUrl || "unknown"}`);
  writeLine(`Updates NDJSON URL: ${result.updatesNdjsonUrl || "unknown"}`);
  writeLine(`Generated: ${result.generatedAt || "unknown"}`);
  writeLine(`Sections: ${result.sectionCount ?? 0}`);
  writeLine(`Updates: ${result.updateCount ?? 0}`);
  if (result.warnings?.length) {
    writeLine();
    for (const warning of result.warnings) {
      writeLine(`WARN ${warning}`);
    }
  }
}
