import path from "node:path";
import { Command } from "commander";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from "../exit-codes.js";
import { printCheckResult, writeError, writeJson, writeLine } from "../output.js";
import { artifactSecretErrors, buildArtifacts, stableJson, toWritePlan } from "../../core/artifacts.js";
import {
  addCommercialConfigChecks,
  addSponsoredContextChecks,
  createPlacementFromOptions,
  createSponsoredContext,
  defaultCommercialContext,
  inspectSponsoredContext,
  isCommercialContextEnabled,
  sponsoredContextOutputPath
} from "../../core/commercial-context.js";
import { loadConfig, normalizeConfig } from "../../core/config.js";
import { fileExists, readUtf8, resolveRoot, writeUtf8 } from "../../core/filesystem.js";
import { getValidators } from "../../core/schemas.js";
import { createCollector, summarizeChecks, validateWithSchema } from "../../core/validation.js";

export function registerSponsorCommand(program) {
  const sponsor = new Command("sponsor")
    .description("Manage disclosed sponsored commercial context.");

  sponsor
    .command("init")
    .description("Add commercialContext config without publishing fake placements.")
    .option("--root <path>", "Project root.", ".")
    .option("--config <path>", "Path to sitectx.config.json.", "sitectx.config.json")
    .option("--enable", "Enable commercial context.")
    .option("--example", "Add a sober example placement.")
    .option("--json", "Print machine-readable output.")
    .action(async (options) => {
      const result = await runSponsorInit(options);
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR;
    });

  sponsor
    .command("add")
    .description("Add a disclosed sponsored placement to config.")
    .option("--root <path>", "Project root.", ".")
    .option("--config <path>", "Path to sitectx.config.json.", "sitectx.config.json")
    .option("--id <id>", "Placement id.")
    .option("--name <name>", "Sponsor name.")
    .option("--url <url>", "Sponsor URL.")
    .option("--title <title>", "Offer title.")
    .option("--summary <text>", "Short factual offer summary.")
    .option("--category <category>", "Offer category.")
    .option("--price <price>", "Offer price.")
    .option("--currency <currency>", "Offer currency code.")
    .option("--valid-from <date>", "Offer valid-from date, YYYY-MM-DD.")
    .option("--valid-until <date>", "Offer valid-until date, YYYY-MM-DD.")
    .option("--canonical-action-url <url>", "Canonical landing/action URL.")
    .option("--canonical-action-label <label>", "Canonical action label.", "Learn more")
    .option("--canonical-action-type <type>", "Canonical action type.", "lead_form")
    .option("--relationship <relationship>", "Disclosure relationship, such as paid_placement.")
    .option("--disclosure-label <label>", "Disclosure label.", "Sponsored")
    .option("--plain-language <text>", "Plain-language disclosure text.")
    .option("--human-visible-url <url>", "Human-visible disclosure URL.")
    .option("--human-visible-text <text>", "Human-visible disclosure text.")
    .option("--evidence-source-url <url>", "Evidence source URL.")
    .option("--evidence-observed-at <timestamp>", "Evidence observedAt timestamp.")
    .option("--evidence-hash <hash>", "Evidence content hash.")
    .option("--sponsor-claim", "Mark offer title/summary as sponsor-supplied claim.")
    .option("--billable-event <event>", "Repeatable billable event.", collect, [])
    .option("--audience <text>", "Repeatable intended audience.", collect, [])
    .option("--query <text>", "Repeatable relevant query.", collect, [])
    .option("--json", "Print machine-readable output.")
    .action(async (options) => {
      const result = await runSponsorAdd(options);
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR;
    });

  sponsor
    .command("validate")
    .description("Validate commercial context config and generated artifact.")
    .option("--root <path>", "Project root.", ".")
    .option("--config <path>", "Path to sitectx.config.json.", "sitectx.config.json")
    .option("--out <path>", "Public output root.", ".")
    .option("--strict", "Treat warnings as failures.")
    .option("--json", "Print machine-readable output.")
    .action(async (options) => {
      const result = await runSponsorValidate(options);
      if (options.json) {
        writeJson(result);
      } else {
        printCheckResult("SiteCTX sponsor validate", result);
      }
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_VALIDATION_FAILED;
    });

  sponsor
    .command("inspect")
    .description("Inspect sponsored commercial context.")
    .option("--root <path>", "Project root.", ".")
    .option("--config <path>", "Path to sitectx.config.json.", "sitectx.config.json")
    .option("--json", "Print machine-readable output.")
    .action(async (options) => {
      const result = await runSponsorInspect(options);
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR;
    });

  sponsor
    .command("build")
    .description("Build SiteCTX artifacts with sponsored context when enabled.")
    .option("--root <path>", "Project root.", ".")
    .option("--config <path>", "Path to sitectx.config.json.", "sitectx.config.json")
    .option("--out <path>", "Public output root.", ".")
    .option("--force", "Overwrite generated artifacts.")
    .option("--allow-draft", "Build from an unreviewed discovery draft.")
    .option("--dry-run", "Show intended output without writing.")
    .option("--json", "Print machine-readable output.")
    .action(async (options) => {
      const result = await runSponsorBuild(options);
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR;
    });

  sponsor.addHelpText("after", `

Examples:
  npx sitectx@latest sponsor init --enable
  npx sitectx@latest sponsor add --name "Price Papertrail" --url "https://pricepapertrail.com" --title "Defensible records for pricing changes" --summary "Create evidence packets for pricing page changes, reviews, and decisions." --category "compliance_software" --valid-until "2026-07-04" --canonical-action-url "https://pricepapertrail.com/pilot" --canonical-action-label "Request pilot" --relationship "paid_placement"
  npx sitectx@latest sponsor build --force

Policy:
  Sponsored context must be disclosed and canonical.
  Agent fetches, crawler visits, bot impressions, and agent clicks are non-billable.
`);

  program.addCommand(sponsor);
}

function collect(value, previous) {
  return [...previous, value];
}

export async function runSponsorInit(options = {}) {
  const result = baseResult();
  try {
    const { configPath, config } = await readConfigForSponsor(options);
    const commercialContext = {
      ...defaultCommercialContext({
        enabled: Boolean(options.enable),
        example: Boolean(options.example),
        siteUrl: config.siteUrl
      }),
      ...(config.commercialContext || {})
    };
    commercialContext.enabled = Boolean(options.enable || commercialContext.enabled);
    if (options.example && commercialContext.placements.length === 0) {
      commercialContext.placements = defaultCommercialContext({
        example: true,
        siteUrl: config.siteUrl
      }).placements;
    }
    const nextConfig = await normalizeConfig({
      ...config,
      commercialContext
    });
    await writeUtf8(configPath, stableJson(nextConfig));
    result.output = configPath;
    result.enabled = nextConfig.commercialContext.enabled;
    result.placements = nextConfig.commercialContext.placements.length;
  } catch (error) {
    result.ok = false;
    result.errors.push(error instanceof Error ? error.message : "Sponsor init failed.");
  }
  printSponsorMutationResult("SiteCTX sponsor init", result, options);
  return result;
}

export async function runSponsorAdd(options = {}) {
  const result = baseResult();
  try {
    const { configPath, config } = await readConfigForSponsor(options);
    const placement = createPlacementFromOptions(options);
    const commercialContext = {
      ...defaultCommercialContext({ enabled: true }),
      ...(config.commercialContext || {}),
      enabled: true,
      placements: [...(config.commercialContext?.placements || []), placement]
    };
    const nextConfig = await normalizeConfig({
      ...config,
      commercialContext
    });
    await writeUtf8(configPath, stableJson(nextConfig));
    result.output = configPath;
    result.enabled = true;
    result.placements = commercialContext.placements.length;
    result.placement = placement;
  } catch (error) {
    result.ok = false;
    result.errors.push(error instanceof Error ? error.message : "Sponsor add failed.");
  }
  printSponsorMutationResult("SiteCTX sponsor add", result, options);
  return result;
}

export async function runSponsorValidate(options = {}) {
  const collector = createCollector();
  const root = resolveRoot(options.root || ".");
  const outRoot = path.resolve(root, options.out || ".");
  let config;
  let document;
  try {
    config = await loadConfig(path.resolve(root, options.config || "sitectx.config.json"));
    addCommercialConfigChecks(collector, "sitectx.config.json", config);
    if (isCommercialContextEnabled(config)) {
      document = createSponsoredContext(config, new Date().toISOString());
      const { validators } = await getValidators();
      validateWithSchema({
        collector,
        root,
        filePath: path.join(outRoot, sponsoredContextOutputPath(config)),
        key: "sponsoredContext.config",
        validator: validators.sponsoredContext,
        value: document
      });
      addSponsoredContextChecks(collector, "sitectx.config.json#commercialContext", document);
      const builtPath = path.join(outRoot, sponsoredContextOutputPath(config));
      if (await fileExists(builtPath)) {
        const built = JSON.parse(await readUtf8(builtPath));
        validateWithSchema({
          collector,
          root: outRoot,
          filePath: builtPath,
          key: "sponsoredContext",
          validator: validators.sponsoredContext,
          value: built
        });
        addSponsoredContextChecks(collector, sponsoredContextOutputPath(config), built);
      } else {
        collector.warn("sponsoredContext.built", sponsoredContextOutputPath(config), "Sponsored context artifact has not been built yet.");
      }
    }
  } catch (error) {
    collector.fail("sponsor.validate", "sponsor", error instanceof Error ? error.message : "Sponsor validation failed.");
  }
  return summarizeChecks(collector.checks, Boolean(options.strict));
}

export async function runSponsorInspect(options = {}) {
  const result = baseResult();
  try {
    const root = resolveRoot(options.root || ".");
    const config = await loadConfig(path.resolve(root, options.config || "sitectx.config.json"));
    const document = createSponsoredContext(config, new Date().toISOString());
    result.summary = inspectSponsoredContext(document, config);
  } catch (error) {
    result.ok = false;
    result.errors.push(error instanceof Error ? error.message : "Sponsor inspect failed.");
  }
  if (options.json) {
    writeJson(result);
  } else {
    printSponsorInspectResult(result);
  }
  return result;
}

export async function runSponsorBuild(options = {}) {
  const result = {
    ...baseResult(),
    created: [],
    skipped: [],
    wouldCreate: [],
    warnings: []
  };
  try {
    const root = resolveRoot(options.root || ".");
    const configPath = path.resolve(root, options.config || "sitectx.config.json");
    const config = await loadConfig(configPath);
    if (config.discovery?.status === "draft_review_required" && !options.allowDraft) {
      result.ok = false;
      result.errors.push(
        "Discovered drafts require human review before sponsor build. Edit the config and set discovery.status to \"reviewed\", or pass --allow-draft to build anyway."
      );
      if (options.json) {
        writeJson(result);
      } else {
        printSponsorBuildResult(result, options);
      }
      return result;
    }
    if (!isCommercialContextEnabled(config)) {
      result.warnings.push("Commercial context is disabled. No sponsored context artifact was generated.");
      if (options.json) {
        writeJson(result);
      } else {
        printSponsorBuildResult(result, options);
      }
      return result;
    }
    const artifacts = buildArtifacts(config);
    const secretErrors = artifactSecretErrors(artifacts.files);
    if (secretErrors.length > 0) {
      result.ok = false;
      result.errors.push(...secretErrors);
      if (options.json) {
        writeJson(result);
      } else {
        printSponsorBuildResult(result, options);
      }
      return result;
    }
    const outRoot = path.resolve(root, options.out || ".");
    const plan = toWritePlan(outRoot, artifacts.files);
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
  } catch (error) {
    result.ok = false;
    result.errors.push(error instanceof Error ? error.message : "Sponsor build failed.");
  }
  if (options.json) {
    writeJson(result);
  } else {
    printSponsorBuildResult(result, options);
  }
  return result;
}

async function readConfigForSponsor(options) {
  const root = resolveRoot(options.root || ".");
  const configPath = path.resolve(root, options.config || "sitectx.config.json");
  if (!(await fileExists(configPath))) {
    throw new Error(`${configPath} does not exist. Run sitectx init first.`);
  }
  const config = await loadConfig(configPath);
  return { configPath, config };
}

function baseResult() {
  return {
    ok: true,
    errors: []
  };
}

function printSponsorMutationResult(title, result, options) {
  if (options.json) {
    writeJson(result);
    return;
  }
  writeLine(title);
  writeLine();
  if (result.output) {
    writeLine(`Config: ${result.output}`);
  }
  if (typeof result.enabled === "boolean") {
    writeLine(`Enabled: ${result.enabled ? "yes" : "no"}`);
  }
  if (typeof result.placements === "number") {
    writeLine(`Placements: ${result.placements}`);
  }
  for (const error of result.errors) {
    writeError(`ERROR ${error}`);
  }
  writeLine();
  writeLine(result.ok ? "Result: PASS" : "Result: FAIL");
}

function printSponsorInspectResult(result) {
  writeLine("SiteCTX sponsor inspect");
  writeLine();
  if (!result.ok) {
    for (const error of result.errors) {
      writeError(`ERROR ${error}`);
    }
    writeLine();
    writeLine("Result: FAIL");
    return;
  }
  const summary = result.summary;
  writeLine(`Enabled: ${summary.enabled ? "yes" : "no"}`);
  writeLine(`Output: ${summary.outputPath}`);
  writeLine(`Placements: ${summary.counts.total}`);
  writeLine(`Active: ${summary.counts.active}`);
  writeLine(`Draft: ${summary.counts.draft}`);
  writeLine(`Expired: ${summary.counts.expired}`);
  writeLine(`Sponsors: ${summary.sponsors.length ? summary.sponsors.join(", ") : "none"}`);
  writeLine(`Disclosure required: ${summary.disclosureRequired ? "yes" : "no"}`);
  writeLine(`Agent clicks billable: ${summary.agentClicksBillable ? "yes" : "no"}`);
  writeLine();
  writeLine("Result: PASS");
}

function printSponsorBuildResult(result) {
  writeLine("SiteCTX sponsor build");
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
  for (const warning of result.warnings) {
    writeLine(`WARN ${warning}`);
  }
  for (const error of result.errors) {
    writeError(`ERROR ${error}`);
  }
  writeLine();
  writeLine(result.ok ? "Result: PASS" : "Result: FAIL");
}
