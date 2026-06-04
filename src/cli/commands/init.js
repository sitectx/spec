import fs from "node:fs/promises";
import path from "node:path";
import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from "../exit-codes.js";
import { printCheckResult, writeError, writeJson, writeLine } from "../output.js";
import { GENERATED_ARTIFACTS, buildInitFiles, toWritePlan } from "../../core/artifacts.js";
import { readExistingConfig, summarizeConfigChanges } from "../../core/change-detection.js";
import { discoverSite } from "../../core/discover.js";
import { artifactPaths, fileExists, removeFileIfExists, writeUtf8 } from "../../core/filesystem.js";
import { inferSiteContext } from "../../core/site-inference.js";
import { validateLocalArtifacts } from "../../core/validation.js";

class InitWizardCancelled extends Error {
  constructor() {
    super("Init wizard cancelled.");
    this.name = "InitWizardCancelled";
  }
}

export function registerInitCommand(program) {
  program
    .command("init")
    .description("Create starter SiteCTX files in a website root.")
    .option("--root <path>", "Target website root.", ".")
    .option("--public-dir <path>", "Directory that serves public static files.")
    .option("--site-url <url>", "Public site URL.")
    .option("--name <name>", "Site name.")
    .option("--description <text>", "Short description of what the site is about.")
    .option("--timeout <ms>", "Site metadata fetch timeout in milliseconds.", "7000")
    .option("--max-pages <number>", "Maximum pages to inspect during interactive init.", "8")
    .option("--max-depth <number>", "Maximum link depth during interactive init.", "1")
    .option("--force", "Overwrite generated files.")
    .option("--dry-run", "Show what would be written without writing.")
    .option("--json", "Print machine-readable output.")
    .addHelpText("after", `

Examples:
  npx sitectx@latest init
  npx sitectx@latest init --root . --public-dir ./public
  npx sitectx@latest init --site-url http://localhost:3000 --name "Local Site"

Behavior:
  Detects ./public in web apps and writes served artifacts there.
  Keeps sitectx.config.json in the project root.
  Existing SiteCTX files require confirmation in the wizard or --force in non-interactive runs.
`)
    .action(async (options) => {
      if (shouldRunInitWizard(options)) {
        program._sitectxExitCode = await runInitWizard(options);
        return;
      }
      const result = await runInit(options);
      program._sitectxExitCode = result.ok ? EXIT_SUCCESS : EXIT_RUNTIME_ERROR;
    });
}

function shouldRunInitWizard(options, env = process.env, streams = process) {
  if (!streams.stdin?.isTTY || !streams.stdout?.isTTY || isCiEnvironment(env) || options.json || options.dryRun) {
    return false;
  }
  return !options.siteUrl || !options.name;
}

function isCiEnvironment(env = process.env) {
  const ci = env.CI;
  return Boolean(ci && ci !== "0" && ci.toLowerCase?.() !== "false");
}

async function runInitWizard(options = {}) {
  const prompts = await loadPrompts();

  try {
    prompts.intro("SiteCTX init");
    const appLayout = await detectAppLayout(options.root || ".", options.publicDir);
    if (appLayout.detectedPublicDir) {
      prompts.log.info(webAppPublicDirMessage(appLayout));
    }
    const suggestedRoot = appLayout.publicDir || appLayout.root;
    prompts.log.info(`Suggested output root: ${suggestedRoot}`);
    const root = await askText(prompts, {
      message: "Output root",
      defaultValue: suggestedRoot,
      validate: requiredValue
    });
    const writeRoot = appLayout.detectedPublicDir || options.publicDir ? appLayout.root : root;
    const writePublicDir = appLayout.detectedPublicDir || options.publicDir ? root : undefined;
    const siteUrl = await askText(prompts, {
      message: "Site URL",
      defaultValue: options.siteUrl,
      placeholder: "https://example.com",
      validate: validateHttpUrl
    });
    if (isLocalhostSiteUrl(siteUrl)) {
      prompts.log.warn(localhostSiteUrlWarning());
    }

    const discoverySpinner = prompts.spinner();
    discoverySpinner.start("Preparing discovery");
    const discovered = await discoverForInit(siteUrl, {
      ...options,
      onProgress: createSpinnerProgressReporter(discoverySpinner)
    });
    stopSpinner(
      discoverySpinner,
      true,
      discovered.ok ? discoveryCompleteMessage(discovered) : "Using fallback site context."
    );
    if (discovered.warning) {
      prompts.log.warn(discovered.warning);
    }
    const changes = summarizeConfigChanges(await readExistingConfig(writeRoot), discovered.config);
    prompts.note(detectedContextSummary(discovered.config), "Review detected context");
    printPromptChangeSummary(prompts, changes);
    const reviewedConfig = await reviewDetectedConfig(prompts, discovered.config);
    if (discovered.warnings?.length) {
      prompts.log.warn(`${discovered.warnings.length} discovery warning${discovered.warnings.length === 1 ? "" : "s"}. Run sitectx discover ${siteUrl} for details.`);
    }

    const conflicts = await existingGeneratedFiles({
      root: writeRoot,
      publicDir: writePublicDir || writeRoot
    });
    const force =
      conflicts.length > 0
        ? await askConfirm(prompts, {
            message: `Overwrite ${conflicts.length} existing SiteCTX file${conflicts.length === 1 ? "" : "s"}?`,
            initialValue: Boolean(options.force)
          })
        : false;

    const spinner = prompts.spinner();
    spinner.start("Creating SiteCTX files");
    const result = await runInit({
      root: writeRoot,
      publicDir: writePublicDir,
      config: reviewedConfig,
      force,
      silent: true
    });
    stopSpinner(spinner, result.ok, result.ok ? "SiteCTX files ready." : "Init failed.");
    printPromptWriteSummary(prompts, result);
    if (!result.ok) {
      printPromptErrors(prompts, result.errors);
      return EXIT_RUNTIME_ERROR;
    }

    const validation = await validateLocalArtifacts({ root });
    printCheckResult("SiteCTX validation", validation, root);
    if (!validation.ok) {
      return EXIT_VALIDATION_FAILED;
    }

    writeLine();
    writeLine("Next commands:");
    writeLine(`  sitectx validate ${root}`);
    writeLine(`  sitectx doctor ${root}`);
    writeLine(`  sitectx inspect ${root}`);
    prompts.outro("Done.");
    return EXIT_SUCCESS;
  } catch (error) {
    if (error instanceof InitWizardCancelled) {
      prompts.cancel("Cancelled.");
      return EXIT_SUCCESS;
    }
    prompts.log.error(error instanceof Error ? error.message : "Init wizard failed.");
    return EXIT_RUNTIME_ERROR;
  }
}

export async function discoverForInit(siteUrl, options = {}) {
  try {
    const discovery = await discoverSite({
      url: siteUrl,
      maxPages: options.maxPages || 8,
      maxDepth: options.maxDepth || 1,
      timeout: options.timeout || 7000,
      delayMs: 50,
      onProgress: options.onProgress
    });
    return {
      ok: true,
      config: starterConfigFromDiscovery(discovery.config),
      pagesIncluded: discovery.crawlManifest.pagesIncluded,
      actions: (discovery.config.actions || []).length,
      catalogs: (discovery.config.catalogs || []).length,
      warnings: discovery.warnings
    };
  } catch (error) {
    const inferred = await inferSiteContext({
      siteUrl,
      name: options.name,
      description: options.description,
      timeout: options.timeout
    });
    return {
      ok: false,
      config: fallbackConfigFromInference(inferred),
      pagesIncluded: 1,
      actions: 1,
      catalogs: 0,
      warning: error instanceof Error ? error.message : "Could not discover site pages."
    };
  }
}

function starterConfigFromDiscovery(config) {
  const starter = structuredClone(config);
  delete starter.discoveryCandidates;
  delete starter.discovery;
  starter.updates = [
    {
      id: "initial-context",
      type: "created",
      url: starter.siteUrl,
      title: "Initial SiteCTX context published",
      summary: "Initial machine-readable site context was generated from public website pages."
    }
  ];
  return starter;
}

function fallbackConfigFromInference(inferred) {
  return {
    siteUrl: inferred.siteUrl,
    name: inferred.name,
    description: inferred.description,
    language: "en",
    publisher: {
      name: inferred.name,
      siteUrl: inferred.siteUrl,
      url: inferred.siteUrl
    },
    identity: {
      name: inferred.name,
      url: inferred.siteUrl,
      description: inferred.description,
      sourceUrl: `${inferred.siteUrl}/`
    },
    positioning: {
      summary: inferred.summary,
      audience: [],
      not: [
        "Not a crawler permission system",
        "Not a model training license",
        "Not a ranking guarantee"
      ]
    },
    sections: [
      {
        id: "home",
        title: "Home",
        url: `${inferred.siteUrl}/`,
        role: "home",
        summary: inferred.summary
      }
    ],
    actions: [
      {
        id: "action:home",
        type: "learn",
        url: `${inferred.siteUrl}/`,
        label: "Visit site",
        priority: 1,
        sourceUrl: `${inferred.siteUrl}/`,
        sourceText: "Visit site"
      }
    ],
    updates: [
      {
        id: "initial-context",
        type: "created",
        url: `${inferred.siteUrl}/`,
        title: "Initial SiteCTX context published",
        summary: "Initial machine-readable site context was generated from public website metadata."
      }
    ]
  };
}

export async function runInit(options) {
  let plan;
  let config;
  let layout;
  try {
    layout = await detectAppLayout(options.root || ".", options.publicDir);
    const initFiles = buildInitFiles({
      config: options.config,
      siteUrl: options.siteUrl,
      name: options.name,
      description: options.description,
      sampleContent: options.sampleContent
    });
    config = initFiles.config;
    plan = initWritePlan(layout, initFiles.files);
  } catch (error) {
    const result = emptyResult(false, [error.message]);
    if (!options.silent) {
      printInitResult(result, options);
    }
    return result;
  }

  const result = emptyResult(true);
  result.root = layout.root;
  result.publicDir = layout.publicDir;
  result.detectedPublicDir = layout.detectedPublicDir;
  result.warnings = [];
  result.changes = summarizeConfigChanges(await readExistingConfig(layout.root), config);
  if (isLocalhostSiteUrl(config.siteUrl)) {
    result.warnings.push(localhostSiteUrlWarning());
  }
  if (options.force && !options.dryRun) {
    await removeLegacyUpdateArtifacts(layout.publicDir, result);
  }
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

  if (!options.silent) {
    printInitResult(result, options);
  }
  return result;
}

function emptyResult(ok, errors = []) {
  return {
    ok,
    created: [],
    removed: [],
    skipped: [],
    wouldCreate: [],
    changes: null,
    errors
  };
}

function printInitResult(result, options) {
  if (options.json) {
    writeJson(result);
    return;
  }
  writeLine("SiteCTX init");
  writeLine();
  if (result.wouldCreate.length > 0) {
    for (const file of result.wouldCreate) {
      writeLine(`WOULD CREATE ${file}`);
    }
  }
  if (result.created.length > 0) {
    for (const file of result.created) {
      writeLine(`CREATE ${file}`);
    }
  }
  if (result.skipped.length > 0) {
    for (const file of result.skipped) {
      writeLine(`SKIP ${file}`);
    }
  }
  if (result.removed.length > 0) {
    for (const file of result.removed) {
      writeLine(`REMOVE ${file}`);
    }
  }
  for (const warning of result.warnings || []) {
    writeLine(`WARN ${warning}`);
  }
  if (result.detectedPublicDir && !options.json) {
    writeLine(webAppPublicDirMessage(result));
  }
  printInitChangeSummary(result.changes);
  if (result.errors.length > 0) {
    for (const error of result.errors) {
      writeError(`ERROR ${error}`);
    }
  }
  writeLine();
  writeLine(result.ok ? "Result: PASS" : "Result: FAIL");
}

async function removeLegacyUpdateArtifacts(publicDir, result) {
  const paths = artifactPaths(publicDir);
  if (await removeFileIfExists(paths.legacyUpdates)) {
    result.removed.push("updates.json");
  }
  if (await removeFileIfExists(paths.legacyNdjson)) {
    result.removed.push("updates.ndjson");
  }
}

async function existingGeneratedFiles({ root, publicDir }) {
  const configRoot = artifactPaths(root);
  const publicRoot = artifactPaths(publicDir);
  const existing = [];
  for (const file of GENERATED_ARTIFACTS) {
    const absolutePath = path.join(publicRoot.root, file);
    if (await fileExists(absolutePath)) {
      existing.push(file);
    }
  }
  if (await fileExists(configRoot.config)) {
    existing.push("sitectx.config.json");
  }
  return existing;
}

async function detectAppLayout(root = ".", publicDir) {
  const resolvedRoot = path.resolve(root || ".");
  if (publicDir) {
    return {
      root: resolvedRoot,
      publicDir: path.resolve(resolvedRoot, publicDir),
      publicDirDisplay: displayRelativePath(resolvedRoot, path.resolve(resolvedRoot, publicDir)),
      detectedPublicDir: false
    };
  }
  const publicPath = path.join(resolvedRoot, "public");
  if (await pathExists(publicPath)) {
    return {
      root: resolvedRoot,
      publicDir: publicPath,
      publicDirDisplay: "./public",
      detectedPublicDir: true
    };
  }
  return {
    root: resolvedRoot,
    publicDir: resolvedRoot,
    publicDirDisplay: ".",
    detectedPublicDir: false
  };
}

function initWritePlan(layout, files) {
  const artifactFiles = files.filter((file) => file.relativePath !== "sitectx.config.json");
  const configFiles = files.filter((file) => file.relativePath === "sitectx.config.json");
  return [
    ...toWritePlan(layout.publicDir, artifactFiles),
    ...toWritePlan(layout.root, configFiles)
  ];
}

function displayRelativePath(root, target) {
  const relative = path.relative(root, target).replaceAll(path.sep, "/");
  return relative ? `./${relative}` : ".";
}

function webAppPublicDirMessage(layout) {
  const publicDir = layout.publicDirDisplay || "./public";
  return `Detected a web app with ${publicDir}. SiteCTX files will be written to ${publicDir} so they can be served at /.well-known/sitectx and /sitectx.json.`;
}

function isLocalhostSiteUrl(value) {
  try {
    const parsed = new URL(value);
    return ["localhost", "127.0.0.1", "::1", "[::1]"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function localhostSiteUrlWarning() {
  return "Using a localhost development URL. Before publishing, replace site.url with your production URL.";
}

async function pathExists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
}

async function askText(prompts, options) {
  return unwrapPrompt(prompts, await prompts.text(options));
}

async function askSelect(prompts, options) {
  return unwrapPrompt(prompts, await prompts.select(options));
}

async function askConfirm(prompts, options) {
  return unwrapPrompt(prompts, await prompts.confirm(options));
}

function unwrapPrompt(prompts, value) {
  if (prompts.isCancel(value)) {
    throw new InitWizardCancelled();
  }
  return value;
}

function printPromptWriteSummary(prompts, result) {
  const lines = [];
  for (const file of result.created || []) {
    lines.push(`CREATE ${file}`);
  }
  for (const file of result.skipped || []) {
    lines.push(`SKIP ${file}`);
  }
  for (const file of result.removed || []) {
    lines.push(`REMOVE ${file}`);
  }
  for (const file of result.wouldCreate || []) {
    lines.push(`WOULD CREATE ${file}`);
  }
  if (lines.length > 0) {
    prompts.note(lines.join("\n"), "Files");
  } else {
    prompts.log.info("No files changed.");
  }
}

export function createSpinnerProgressReporter(spinner) {
  return (event) => {
    const message = progressMessage(event);
    if (message && typeof spinner.message === "function") {
      spinner.message(message);
    }
  };
}

function progressMessage(event) {
  switch (event.stage) {
    case "start":
      return `Preparing bounded crawl (${event.maxPages} page limit)`;
    case "robots":
      return "Checking robots.txt";
    case "sitemap":
      return "Looking for sitemaps";
    case "queue":
      return event.message;
    case "fetch":
      return event.message;
    case "extract":
      return event.message;
    case "included":
      return `${event.message}, ${event.queued || 0} queued`;
    case "build":
      return "Building SiteCTX context";
    case "write":
      return "Preparing discovery artifacts";
    case "cleanup":
      return "Cleaning temporary crawl data";
    case "done":
      return event.message;
    default:
      return event.message || "";
  }
}

export function discoveryCompleteMessage(discovered) {
  const pageText = `${discovered.pagesIncluded} page${discovered.pagesIncluded === 1 ? "" : "s"}`;
  const actionText = `${discovered.actions || 0} action${discovered.actions === 1 ? "" : "s"}`;
  const catalogText = `${discovered.catalogs || 0} catalog signal${discovered.catalogs === 1 ? "" : "s"}`;
  return `Site context detected: ${pageText}, ${actionText}, ${catalogText}.`;
}

async function reviewDetectedConfig(prompts, config) {
  const accepted = await askConfirm(prompts, {
    message: "Use this detected context?",
    initialValue: true
  });
  if (accepted) {
    return config;
  }

  const next = await askSelect(prompts, {
    message: "How should init continue?",
    options: [
      { value: "without-actions", label: "Use context without actions" },
      { value: "cancel", label: "Cancel init" }
    ],
    initialValue: "without-actions"
  });
  if (next === "cancel") {
    throw new InitWizardCancelled();
  }
  const copy = structuredClone(config);
  copy.actions = [];
  return copy;
}

function detectedContextSummary(config) {
  const lines = [
    `Name: ${config.name}`,
    `Summary: ${config.description}`
  ];
  if (config.identity?.profiles?.length) {
    lines.push(`Profiles: ${config.identity.profiles.slice(0, 3).join(", ")}`);
  }
  lines.push("Actions:");
  for (const action of (config.actions || []).slice(0, 8)) {
    lines.push(`  [x] ${action.label} (${action.type}) ${action.url}`);
  }
  if (!config.actions?.length) {
    lines.push("  none detected");
  }
  lines.push("Catalogs:");
  for (const catalog of (config.catalogs || []).slice(0, 6)) {
    lines.push(`  [x] ${catalog.label} (${catalog.source || catalog.type}) ${catalog.url}`);
  }
  if (!config.catalogs?.length) {
    lines.push("  none detected");
  }
  lines.push("Pages:");
  for (const section of (config.sections || []).slice(0, 8)) {
    lines.push(`  [x] ${section.title} (${section.role || "page"}) ${section.url}`);
  }
  return lines.join("\n");
}

function printPromptChangeSummary(prompts, changes) {
  const summary = formatChangeSummary(changes);
  if (summary) {
    prompts.note(summary, "Changes since last config");
  }
}

function printInitChangeSummary(changes) {
  const summary = formatChangeSummary(changes);
  if (!summary) {
    return;
  }
  writeLine();
  writeLine("Changes since last config:");
  for (const line of summary.split("\n")) {
    writeLine(`  ${line}`);
  }
}

function formatChangeSummary(changes) {
  if (!changes?.available) {
    return "";
  }
  const lines = [
    `Pages: ${changes.pages.added.length} added, ${changes.pages.changed.length} changed, ${changes.pages.removed.length} removed`,
    `Actions: ${changes.actions.added.length} added, ${changes.actions.changed.length} changed, ${changes.actions.removed.length} removed`
  ];
  if (!changes.hasChanges) {
    lines.push("No detected changes.");
    return lines.join("\n");
  }
  const examples = [
    ...changes.pages.changed.map((item) => `page changed: ${item.title}`),
    ...changes.pages.added.map((item) => `page added: ${item.title}`),
    ...changes.actions.added.map((item) => `action added: ${item.title}`),
    ...changes.actions.removed.map((item) => `action removed: ${item.title}`)
  ].slice(0, 5);
  lines.push(...examples);
  return lines.join("\n");
}

function printPromptErrors(prompts, errors = []) {
  for (const error of errors) {
    prompts.log.error(error);
  }
}

function stopSpinner(spinner, ok, message) {
  if (ok) {
    spinner.stop(message);
    return;
  }
  spinner.error(message);
}

function requiredValue(value) {
  if (!String(value || "").trim()) {
    return "Enter a value.";
  }
  return undefined;
}

function validateHttpUrl(value) {
  const required = requiredValue(value);
  if (required) {
    return required;
  }
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "Use an http or https URL.";
    }
  } catch {
    return "Enter a valid URL.";
  }
  return undefined;
}

async function loadPrompts() {
  if (process.env.SITECTX_TEST_FAIL_ON_PROMPTS_LOAD === "1") {
    throw new Error("Prompt package was loaded during a non-interactive test.");
  }
  return import("@clack/prompts");
}
