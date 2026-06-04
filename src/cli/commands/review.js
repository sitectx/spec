import path from "node:path";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS } from "../exit-codes.js";
import { writeError, writeJson, writeLine } from "../output.js";
import { loadConfig, normalizeConfig } from "../../core/config.js";
import { fileExists, resolveRoot, writeUtf8 } from "../../core/filesystem.js";
import { applyReviewDecisions, keyedItems, reviewablePages, summarizeReviewConfig } from "../../core/review.js";

class ReviewCancelled extends Error {
  constructor() {
    super("Review cancelled.");
    this.name = "ReviewCancelled";
  }
}

export function registerReviewCommand(program) {
  program
    .command("review")
    .description("Review a discovered draft config before publishing.")
    .argument("[config]", "Path to sitectx.config.draft.json.", "sitectx.config.draft.json")
    .option("--root <path>", "Base directory for resolving config.", ".")
    .option("--out <path>", "Write reviewed config to a different path.")
    .option("--summary <text>", "Set reviewed site summary.")
    .option("--approve", "Mark the config reviewed without prompts.")
    .option("--force", "Overwrite --out if it already exists.")
    .option("--dry-run", "Show intended review result without writing.")
    .option("--json", "Print machine-readable output.")
    .addHelpText("after", `

Examples:
  npx sitectx@latest review sitectx.config.draft.json
  npx sitectx@latest review sitectx.config.draft.json --approve
  npx sitectx@latest review sitectx.config.draft.json --out sitectx.config.json --force

Behavior:
  Opens a terminal review flow for discovered summary, actions, navigation, catalogs, and source pages.
  Writes discovery.status="reviewed" so generate can run without --allow-draft.
`)
    .action(async (config, options) => {
      const result = await runReview({
        ...options,
        config
      });
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR;
    });
}

export async function runReview(options = {}) {
  const result = {
    ok: true,
    config: null,
    output: null,
    dryRun: Boolean(options.dryRun),
    reviewed: false,
    summary: null,
    warnings: [],
    errors: []
  };

  try {
    const root = resolveRoot(options.root);
    const configPath = path.resolve(root, options.config || "sitectx.config.draft.json");
    const outPath = path.resolve(root, options.out || options.config || "sitectx.config.draft.json");
    const config = await loadConfig(configPath);
    result.config = configPath;
    result.output = outPath;
    result.summary = summarizeReviewConfig(config);

    const decisions = shouldReviewWithoutPrompts(options)
      ? nonInteractiveDecisions(options)
      : await interactiveReviewDecisions(config);

    const reviewed = await normalizeConfig(applyReviewDecisions(config, decisions));
    result.summary = summarizeReviewConfig(reviewed);
    result.reviewed = true;

    if (!options.dryRun) {
      if (outPath !== configPath && (await fileExists(outPath)) && !options.force) {
        result.ok = false;
        result.errors.push(`${outPath} already exists. Use --force to overwrite it.`);
      } else {
        await writeUtf8(outPath, `${JSON.stringify(reviewed, null, 2)}\n`);
      }
    }
  } catch (error) {
    result.ok = false;
    result.errors.push(error instanceof Error ? error.message : "Review failed.");
  }

  printReviewResult(result, options);
  return result;
}

function shouldReviewWithoutPrompts(options) {
  if (options.approve || options.summary) {
    return true;
  }
  if (!shouldRunInteractiveReview() || options.json || options.dryRun) {
    return true;
  }
  return false;
}

function nonInteractiveDecisions(options) {
  if (!options.approve && !options.summary) {
    throw new Error("Run review in an interactive terminal, or pass --approve after manually reviewing the config.");
  }
  return {
    description: options.summary
  };
}

async function interactiveReviewDecisions(config) {
  const prompts = await loadPrompts();

  try {
    prompts.intro("SiteCTX review");
    prompts.note(reviewSummaryLines(config).join("\n"), "Discovered context");

    const editSummary = await askConfirm(prompts, {
      message: "Edit site summary?",
      initialValue: false
    });
    const description = editSummary
      ? await askText(prompts, {
          message: "Site summary",
          defaultValue: config.description,
          validate: requiredValue
        })
      : config.description;

    const actionKeys = await askKeepList(prompts, {
      message: "Approve actions",
      items: keyedItems(config.actions || [], "action"),
      label: (action) => `${action.label || action.type} (${action.type})`,
      hint: (action) => action.url
    });

    const navigationKeys = await askKeepList(prompts, {
      message: "Approve navigation",
      items: keyedItems(config.navigation || [], "navigation"),
      label: (item) => `${item.label || item.url}${item.role ? ` (${item.role})` : ""}`,
      hint: (item) => item.url
    });

    const catalogKeys = await askKeepList(prompts, {
      message: "Approve catalogs",
      items: keyedItems(config.catalogs || [], "catalog"),
      label: (catalog) => `${catalog.label || catalog.id} (${catalog.source || catalog.type})`,
      hint: (catalog) => catalog.url
    });

    const pageKeys = await askKeepList(prompts, {
      message: "Approve source pages",
      items: reviewablePages(config).map((page) => ({ key: page.key, item: page })),
      label: (page) => `${page.title || page.url}${page.role ? ` (${page.role})` : ""}`,
      hint: (page) => page.url
    });

    const approved = await askConfirm(prompts, {
      message: "Mark this config as reviewed?",
      initialValue: true
    });
    if (!approved) {
      throw new ReviewCancelled();
    }

    prompts.outro("Review complete.");
    return {
      description,
      actionKeys,
      navigationKeys,
      catalogKeys,
      pageKeys
    };
  } catch (error) {
    if (error instanceof ReviewCancelled) {
      prompts.cancel("Cancelled.");
      throw error;
    }
    throw error;
  }
}

async function askKeepList(prompts, { message, items, label, hint }) {
  if (items.length === 0) {
    prompts.log.info(`${message}: none detected.`);
    return [];
  }
  const selected = await unwrapPrompt(
    prompts,
    await prompts.multiselect({
      message,
      required: false,
      options: items.map(({ key, item }) => ({
        value: key,
        label: truncate(label(item), 70),
        hint: truncate(hint(item), 90)
      })),
      initialValues: items.map(({ key }) => key)
    })
  );
  return selected;
}

function reviewSummaryLines(config) {
  const summary = summarizeReviewConfig(config);
  return [
    `Status: ${summary.status}`,
    `Name: ${summary.name}`,
    `URL: ${summary.siteUrl}`,
    `Summary: ${summary.description}`,
    `Actions: ${summary.counts.actions}`,
    `Navigation: ${summary.counts.navigation}`,
    `Catalogs: ${summary.counts.catalogs}`,
    `Source pages: ${summary.counts.sourcePages}`,
    `Discovery candidates: ${summary.counts.discoveryClaims} claims, ${summary.counts.discoveryFaq} FAQ`
  ];
}

function printReviewResult(result, options) {
  if (options.json) {
    writeJson(result);
    return;
  }

  writeLine("SiteCTX review");
  if (result.config) {
    writeLine();
    writeLine(`Config: ${result.config}`);
    writeLine(`Output: ${result.output}`);
  }
  if (result.summary) {
    writeLine();
    for (const line of summaryOutputLines(result.summary)) {
      writeLine(line);
    }
  }
  for (const warning of result.warnings || []) {
    writeLine(`WARN ${warning}`);
  }
  for (const error of result.errors || []) {
    writeError(`ERROR ${error}`);
  }
  writeLine();
  if (result.ok && result.dryRun) {
    writeLine("Result: PASS (dry run)");
  } else {
    writeLine(result.ok ? "Result: PASS" : "Result: FAIL");
  }
}

function summaryOutputLines(summary) {
  return [
    `Status: ${summary.status}`,
    `Name: ${summary.name}`,
    `Summary: ${summary.description}`,
    `Actions: ${summary.counts.actions}`,
    `Navigation: ${summary.counts.navigation}`,
    `Catalogs: ${summary.counts.catalogs}`,
    `Source pages: ${summary.counts.sourcePages}`
  ];
}

function shouldRunInteractiveReview(env = process.env, streams = process) {
  return Boolean(streams.stdin?.isTTY && streams.stdout?.isTTY && !isCiEnvironment(env));
}

function isCiEnvironment(env = process.env) {
  const ci = env.CI;
  return Boolean(ci && ci !== "0" && ci.toLowerCase?.() !== "false");
}

async function askText(prompts, options) {
  return unwrapPrompt(prompts, await prompts.text(options));
}

async function askConfirm(prompts, options) {
  return unwrapPrompt(prompts, await prompts.confirm(options));
}

function unwrapPrompt(prompts, value) {
  if (prompts.isCancel(value)) {
    throw new ReviewCancelled();
  }
  return value;
}

function requiredValue(value) {
  if (!String(value || "").trim()) {
    return "Enter a value.";
  }
  return undefined;
}

function truncate(value, maxLength) {
  const text = String(value || "").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 3)}...` : text;
}

async function loadPrompts() {
  if (process.env.SITECTX_TEST_FAIL_ON_PROMPTS_LOAD === "1") {
    throw new Error("Prompt package was loaded during a non-interactive test.");
  }
  return import("@clack/prompts");
}
