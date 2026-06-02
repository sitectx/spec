import path from "node:path";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS } from "../exit-codes.js";
import { writeError, writeJson, writeLine } from "../output.js";
import { discoverSite, writeDiscoveryOutput } from "../../core/discover.js";
import { stableJson } from "../../core/artifacts.js";

export function registerDiscoverCommand(program) {
  function collect(value, previous) {
    return [...previous, value];
  }

  program
    .command("discover")
    .description("Crawl a bounded same-origin site and write a review-required draft config.")
    .requiredOption("--url <url>", "Base site URL.")
    .option("--out <path>", "Draft config output path.", "sitectx.config.draft.json")
    .option("--workdir <path>", "Directory for crawl corpus.")
    .option("--keep-workdir", "Preserve generated crawl corpus after run.")
    .option("--max-pages <number>", "Maximum pages to include.", "25")
    .option("--max-depth <number>", "Maximum link depth.", "2")
    .option("--timeout <ms>", "Fetch timeout in milliseconds.", "10000")
    .option("--concurrency <number>", "Maximum concurrent fetches.", "3")
    .option("--delay-ms <number>", "Delay between page fetches.", "100")
    .option("--max-bytes <number>", "Maximum bytes to read per page.", "1500000")
    .option("--include <pattern>", "Repeatable path/prefix include filter.", collect, [])
    .option("--exclude <pattern>", "Repeatable path/prefix exclude filter.", collect, [])
    .option("--force", "Overwrite output file.")
    .option("--dry-run", "Print discovered config without writing output.")
    .option("--json", "Print machine-readable output.")
    .option("--verbose", "Include crawl details.")
    .action(async (options) => {
      const result = await runDiscover(options);
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR;
    });
}

async function runDiscover(options) {
  try {
    const result = await discoverSite(options);
    const outPath = path.resolve(options.out);
    if (!options.dryRun) {
      await writeDiscoveryOutput(outPath, result.config, { force: Boolean(options.force) });
    }
    printDiscoverResult(
      {
        ok: true,
        output: options.dryRun ? null : outPath,
        workdir: result.workdir,
        summary: {
          pagesFetched: result.crawlManifest.pagesFetched,
          pagesIncluded: result.crawlManifest.pagesIncluded,
          pagesSkipped: result.crawlManifest.pagesSkipped,
          warnings: result.warnings.length
        },
        config: result.config,
        crawlManifest: options.verbose ? result.crawlManifest : undefined,
        warnings: result.warnings
      },
      options
    );
    return { ok: true };
  } catch (error) {
    const result = {
      ok: false,
      errors: [error instanceof Error ? error.message : "Discovery failed."]
    };
    printDiscoverResult(result, options);
    return result;
  }
}

function printDiscoverResult(result, options) {
  if (options.json) {
    writeJson(result);
    return;
  }
  if (options.dryRun && result.ok) {
    writeLine(stableJson(result.config).trimEnd());
    return;
  }
  writeLine("SiteCTX discover");
  writeLine();
  if (result.ok) {
    writeLine(`Output: ${result.output || "dry-run"}`);
    if (result.workdir) {
      writeLine(`Corpus: ${result.workdir}`);
    }
    writeLine(`Pages fetched: ${result.summary.pagesFetched}`);
    writeLine(`Pages included: ${result.summary.pagesIncluded}`);
    writeLine(`Pages skipped: ${result.summary.pagesSkipped}`);
    if (result.warnings.length > 0) {
      writeLine();
      for (const warning of result.warnings) {
        writeLine(`WARN ${warning}`);
      }
    }
    writeLine();
    writeLine("Result: PASS");
    return;
  }
  for (const error of result.errors) {
    writeError(`ERROR ${error}`);
  }
  writeLine("Result: FAIL");
}
