import path from "node:path";
import { Option } from "commander";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS } from "../exit-codes.js";
import { writeError, writeJson, writeLine } from "../output.js";
import { discoverSite, writeDiscoveryOutput } from "../../core/discover.js";
import { stableJson } from "../../core/artifacts.js";
import { VERTICAL_PRESET_NAMES } from "../../core/presets.js";

export function registerDiscoverCommand(program) {
  function collect(value, previous) {
    return [...previous, value];
  }

  program
    .command("discover")
    .description("Crawl a bounded same-origin site and write a review-required draft config.")
    .argument("[url]", "Website URL to discover.")
    .addOption(new Option("--url <url>", "Base site URL.").hideHelp())
    .option("--out <path>", "Draft config output path.", "sitectx.config.draft.json")
    .option("--workdir <path>", "Directory for crawl corpus.")
    .option("--keep-workdir", "Preserve generated crawl corpus after run.")
    .addOption(new Option("--preset <type>", "Vertical preset for discovery priorities.").choices(VERTICAL_PRESET_NAMES))
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
    .addHelpText("after", `

Examples:
  npx sitectx@latest discover https://example.com
  npx sitectx@latest discover https://example.com --preset ecommerce
  npx sitectx@latest discover http://localhost:3000 --max-pages 25 --max-depth 2

Behavior:
  Presets: auto, ecommerce, nonprofit, saas, local-business, docs.
  Writes sitectx.config.draft.json by default.
  Run npx sitectx@latest review sitectx.config.draft.json before generate.
`)
    .action(async (url, options) => {
      const resolvedUrl = resolveDiscoverUrl(url, options.url);
      if (!resolvedUrl.ok) {
        writeError(resolvedUrl.message);
        program._sitectxExitCode = EXIT_RUNTIME_ERROR;
        return;
      }
      const result = await runDiscover({ ...options, url: resolvedUrl.url });
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR;
    });
}

function resolveDiscoverUrl(argumentUrl, optionUrl) {
  if (argumentUrl && optionUrl && argumentUrl !== optionUrl) {
    return {
      ok: false,
      message: "Use one URL only. Try: npx sitectx@latest discover https://example.com"
    };
  }
  const url = argumentUrl || optionUrl;
  if (!url) {
    return {
      ok: false,
      message: "Website URL required. Try: npx sitectx@latest discover https://example.com"
    };
  }
  return { ok: true, url };
}

export async function runDiscover(options) {
  try {
    const result = await discoverSite(options);
    const outPath = path.resolve(options.out);
    const summary = {
      pagesFetched: result.crawlManifest.pagesFetched,
      pagesIncluded: result.crawlManifest.pagesIncluded,
      pagesSkipped: result.crawlManifest.pagesSkipped,
      warnings: result.warnings.length,
      notices: result.notices?.length || 0
    };
    if (summary.pagesFetched === 0) {
      const output = {
        ok: false,
        output: null,
        workdir: result.workdir,
        summary,
        crawlManifest: options.verbose ? result.crawlManifest : undefined,
        notices: result.notices || [],
        warnings: result.warnings,
        errors: ["No pages were fetched."]
      };
      if (!options.silent) {
        printDiscoverResult(output, options);
      }
      return output;
    }
    if (!options.dryRun) {
      await writeDiscoveryOutput(outPath, result.config, { force: Boolean(options.force) });
    }
    const output = {
      ok: true,
      output: options.dryRun ? null : outPath,
      workdir: result.workdir,
      summary,
      config: result.config,
      crawlManifest: options.verbose ? result.crawlManifest : undefined,
      notices: result.notices || [],
      warnings: result.warnings
    };
    if (!options.silent) {
      printDiscoverResult(output, options);
    }
    return output;
  } catch (error) {
    const result = {
      ok: false,
      notices: [],
      warnings: [],
      errors: [error instanceof Error ? error.message : "Discovery failed."]
    };
    if (!options.silent) {
      printDiscoverResult(result, options);
    }
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
  if (result.summary) {
    writeLine(`Pages fetched: ${result.summary.pagesFetched}`);
    writeLine(`Pages included: ${result.summary.pagesIncluded}`);
    writeLine(`Pages skipped: ${result.summary.pagesSkipped}`);
  }
  if (result.ok) {
    writeLine(`Output: ${result.output || "dry-run"}`);
    if (result.workdir) {
      writeLine(`Corpus: ${result.workdir}`);
    }
    if (result.notices.length > 0) {
      writeLine();
      for (const notice of result.notices) {
        writeLine(`INFO ${notice}`);
      }
    }
    if (result.warnings.length > 0) {
      writeLine();
      for (const warning of result.warnings) {
        writeLine(`WARN ${warning}`);
      }
    }
    writeLine();
    writeLine(result.warnings.length > 0 ? "Result: PASS with warnings" : "Result: PASS");
    return;
  }
  if (result.notices?.length > 0) {
    for (const notice of result.notices) {
      writeLine(`INFO ${notice}`);
    }
  }
  if (result.warnings?.length > 0) {
    for (const warning of result.warnings) {
      writeLine(`WARN ${warning}`);
    }
  }
  for (const error of result.errors) {
    writeError(`ERROR ${error}`);
  }
  const noPagesFetched = result.errors.some((error) => /No pages were fetched/i.test(error));
  writeLine(noPagesFetched ? "Result: FAIL - no pages were fetched" : "Result: FAIL");
}
