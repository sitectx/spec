import { EXIT_RUNTIME_ERROR, EXIT_SUCCESS, EXIT_VALIDATION_FAILED } from "../exit-codes.js";
import { printCheckResult, writeLine } from "../output.js";
import { runDiscover } from "./discover.js";
import { runGenerate } from "./generate.js";
import { createSpinnerProgressReporter, discoverForInit, discoveryCompleteMessage, runInit } from "./init.js";
import { printInspection } from "./inspect.js";
import { loadConfig } from "../../core/config.js";
import { doctorLocal, doctorRemote } from "../../core/doctor-checks.js";
import { inspectLocal, inspectRemote } from "../../core/discovery.js";
import { validateLocalArtifacts } from "../../core/validation.js";

const ACTIONS = {
  SETUP: "setup",
  DISCOVER: "discover",
  GENERATE: "generate",
  VALIDATE: "validate",
  DOCTOR: "doctor",
  INSPECT: "inspect"
};

class WizardCancelled extends Error {
  constructor() {
    super("Wizard cancelled.");
    this.name = "WizardCancelled";
  }
}

export function registerSetupCommand(program) {
  const setupCommand = program
    .command("setup")
    .description("Open the interactive SiteCTX setup wizard.")
    .action(async () => {
      if (!shouldRunInteractiveWizard()) {
        setupCommand.outputHelp();
        program._sitectxExitCode = EXIT_SUCCESS;
        return;
      }
      program._sitectxExitCode = await runSetupWizard();
    });
}

export function shouldRunInteractiveWizard(env = process.env, streams = process) {
  return Boolean(streams.stdin?.isTTY && streams.stdout?.isTTY && !isCiEnvironment(env));
}

export function isCiEnvironment(env = process.env) {
  const ci = env.CI;
  return Boolean(ci && ci !== "0" && ci.toLowerCase?.() !== "false");
}

export async function runSetupWizard() {
  const prompts = await loadPrompts();

  try {
    prompts.intro("SiteCTX");
    prompts.log.info("Create, discover, validate, and diagnose machine-readable website context.");

    const action = await askSelect(prompts, {
      message: "What do you want to do?",
      options: [
        { value: ACTIONS.SETUP, label: "Set up SiteCTX files for this project" },
        { value: ACTIONS.DISCOVER, label: "Discover context from a live website" },
        { value: ACTIONS.GENERATE, label: "Generate files from an existing config" },
        { value: ACTIONS.VALIDATE, label: "Validate existing SiteCTX files" },
        { value: ACTIONS.DOCTOR, label: "Run doctor on a public URL" },
        { value: ACTIONS.INSPECT, label: "Inspect existing SiteCTX metadata" }
      ]
    });

    const exitCode = await runSelectedAction(prompts, action);
    if (exitCode === EXIT_SUCCESS) {
      prompts.outro("Done.");
    }
    return exitCode;
  } catch (error) {
    if (error instanceof WizardCancelled) {
      prompts.cancel("Cancelled.");
      return EXIT_SUCCESS;
    }
    prompts.log.error(error instanceof Error ? error.message : "Setup wizard failed.");
    return EXIT_RUNTIME_ERROR;
  }
}

async function runSelectedAction(prompts, action) {
  switch (action) {
    case ACTIONS.SETUP:
      return runSetupFlow(prompts);
    case ACTIONS.DISCOVER:
      return runDiscoverFlow(prompts);
    case ACTIONS.GENERATE:
      return runGenerateFlow(prompts);
    case ACTIONS.VALIDATE:
      return runValidateFlow(prompts);
    case ACTIONS.DOCTOR:
      return runDoctorFlow(prompts);
    case ACTIONS.INSPECT:
      return runInspectFlow(prompts);
    default:
      return EXIT_SUCCESS;
  }
}

async function runSetupFlow(prompts) {
  const siteUrl = await askText(prompts, {
    message: "Site URL",
    placeholder: "https://example.com",
    validate: validateHttpUrl
  });
  const inferSpinner = prompts.spinner();
  inferSpinner.start("Preparing discovery");
  const discovered = await discoverForInit(siteUrl, {
    onProgress: createSpinnerProgressReporter(inferSpinner)
  });
  stopSpinner(inferSpinner, true, discovered.ok ? discoveryCompleteMessage(discovered) : "Using fallback site context.");
  if (discovered.warning) {
    prompts.log.warn(discovered.warning);
  }
  prompts.note(
    [
      `Name: ${discovered.config.name}`,
      `Summary: ${discovered.config.description}`,
      `Actions: ${(discovered.config.actions || []).map((action) => `${action.label} (${action.type})`).join(", ") || "none detected"}`,
      `Catalogs: ${(discovered.config.catalogs || []).map((catalog) => `${catalog.label} (${catalog.source || catalog.type})`).join(", ") || "none detected"}`
    ].join("\n"),
    "Detected context"
  );
  const root = await askOutputRoot(prompts, "Output root");
  const accepted = await askConfirm(prompts, {
    message: "Use this detected context?",
    initialValue: true
  });
  if (!accepted) {
    throw new WizardCancelled();
  }
  const force = await askConfirm(prompts, {
    message: "Overwrite existing generated files?",
    initialValue: false
  });

  const spinner = prompts.spinner();
  spinner.start("Creating SiteCTX files");
  const result = await runInit({
    root,
    config: discovered.config,
    force,
    silent: true
  });
  stopSpinner(spinner, result.ok, result.ok ? "SiteCTX files ready." : "Setup failed.");
  printWriteSummary(prompts, result);
  if (!result.ok) {
    return EXIT_RUNTIME_ERROR;
  }

  const validateNow = await askConfirm(prompts, {
    message: "Run validate now?",
    initialValue: true
  });
  if (validateNow) {
    const validateExit = await validateRoot(root);
    if (validateExit !== EXIT_SUCCESS) {
      return validateExit;
    }
  }

  const doctorNow = await askConfirm(prompts, {
    message: "Run doctor on local files now?",
    initialValue: false
  });
  if (doctorNow) {
    const doctorExit = await doctorTarget({ root });
    if (doctorExit !== EXIT_SUCCESS) {
      return doctorExit;
    }
  }

  printNextCommands([
    `sitectx validate ${root}`,
    `sitectx doctor ${root}`,
    `sitectx inspect ${root}`
  ]);
  return EXIT_SUCCESS;
}

async function runDiscoverFlow(prompts) {
  const url = await askText(prompts, {
    message: "Website URL",
    placeholder: "https://example.com",
    validate: validateHttpUrl
  });
  const out = await askText(prompts, {
    message: "Output config path",
    defaultValue: "sitectx.config.draft.json",
    validate: requiredValue
  });
  const maxPages = await askPositiveInteger(prompts, "Max pages", "25");
  const maxDepth = await askPositiveInteger(prompts, "Max depth", "2");
  const keepWorkdir = await askConfirm(prompts, {
    message: "Preserve crawl workdir?",
    initialValue: false
  });

  const spinner = prompts.spinner();
  spinner.start("Discovering site context");
  const result = await runDiscover({
    url,
    out,
    maxPages,
    maxDepth,
    keepWorkdir,
    silent: true
  });
  stopSpinner(spinner, result.ok, result.ok ? "Discovery draft created." : "Discovery failed.");
  if (!result.ok) {
    printErrors(prompts, result.errors);
    return EXIT_RUNTIME_ERROR;
  }

  writeLine(`Output: ${result.output}`);
  writeLine(`Pages fetched: ${result.summary.pagesFetched}`);
  writeLine(`Pages included: ${result.summary.pagesIncluded}`);
  if (result.workdir) {
    writeLine(`Corpus: ${result.workdir}`);
  }
  printWarnings(prompts, result.warnings);
  prompts.log.warn("Discovery output is draft_review_required and needs human review before publishing.");
  printNextCommands([`sitectx generate ${out} public --force`]);
  writeLine("Review gate: generate requires discovery.status=\"reviewed\" or --allow-draft.");
  return EXIT_SUCCESS;
}

async function runGenerateFlow(prompts) {
  const config = await askText(prompts, {
    message: "Config path",
    defaultValue: "sitectx.config.json",
    validate: requiredValue
  });
  const out = await askOutputRoot(prompts, "Output root");
  let allowDraft = false;
  try {
    const loaded = await loadConfig(config);
    if (loaded.discovery?.status === "draft_review_required") {
      prompts.log.warn("This config is a review-required discovery draft.");
      allowDraft = await askConfirm(prompts, {
        message: "Proceed with --allow-draft?",
        initialValue: false
      });
    }
  } catch {
    allowDraft = false;
  }

  const spinner = prompts.spinner();
  spinner.start("Generating SiteCTX files");
  const result = await runGenerate({
    config,
    out,
    allowDraft,
    silent: true
  });
  stopSpinner(spinner, result.ok, result.ok ? "SiteCTX files generated." : "Generate failed.");
  printWriteSummary(prompts, result);
  printWarnings(prompts, result.warnings);
  if (!result.ok) {
    printErrors(prompts, result.errors);
    return result.exitCode ?? EXIT_RUNTIME_ERROR;
  }

  const validateNow = await askConfirm(prompts, {
    message: "Run validate now?",
    initialValue: true
  });
  if (validateNow) {
    const validateExit = await validateRoot(out);
    if (validateExit !== EXIT_SUCCESS) {
      return validateExit;
    }
  }

  const doctorNow = await askConfirm(prompts, {
    message: "Run doctor on local files now?",
    initialValue: false
  });
  if (doctorNow) {
    const doctorExit = await doctorTarget({ root: out });
    if (doctorExit !== EXIT_SUCCESS) {
      return doctorExit;
    }
  }

  printNextCommands([
    `sitectx validate ${out}`,
    `sitectx doctor ${out}`,
    `sitectx inspect ${out}`
  ]);
  return EXIT_SUCCESS;
}

async function runValidateFlow(prompts) {
  const root = await askText(prompts, {
    message: "Root path",
    defaultValue: ".",
    validate: requiredValue
  });
  const strict = await askConfirm(prompts, {
    message: "Treat warnings as failures?",
    initialValue: false
  });
  return validateRoot(root, { strict });
}

async function runDoctorFlow(prompts) {
  const target = await askTarget(prompts);
  return doctorTarget(target);
}

async function runInspectFlow(prompts) {
  const target = await askTarget(prompts);
  const result = target.url ? await inspectRemote({ url: target.url }) : await inspectLocal({ root: target.root });
  printInspection(result);
  return EXIT_SUCCESS;
}

async function askTarget(prompts) {
  const targetType = await askSelect(prompts, {
    message: "What should SiteCTX inspect?",
    options: [
      { value: "root", label: "Local root" },
      { value: "url", label: "Public URL" }
    ]
  });
  if (targetType === "url") {
    const url = await askText(prompts, {
      message: "Public URL",
      placeholder: "https://example.com",
      validate: validateHttpUrl
    });
    return { url };
  }
  const root = await askText(prompts, {
    message: "Local root",
    defaultValue: ".",
    validate: requiredValue
  });
  return { root };
}

async function askOutputRoot(prompts, message) {
  const selected = await askSelect(prompts, {
    message,
    options: [
      { value: ".", label: "." },
      { value: "./public", label: "./public" },
      { value: "./dist", label: "./dist" },
      { value: "./static", label: "./static" },
      { value: "custom", label: "custom" }
    ]
  });
  if (selected !== "custom") {
    return selected;
  }
  return askText(prompts, {
    message: "Custom output root",
    defaultValue: "./public",
    validate: requiredValue
  });
}

async function askPositiveInteger(prompts, message, defaultValue) {
  const value = await askText(prompts, {
    message,
    defaultValue,
    validate(value) {
      if (!/^[1-9]\d*$/.test(String(value || "").trim())) {
        return "Enter a positive integer.";
      }
      return undefined;
    }
  });
  return value;
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
    throw new WizardCancelled();
  }
  return value;
}

async function validateRoot(root, options = {}) {
  const result = await validateLocalArtifacts({ root, strict: Boolean(options.strict) });
  printCheckResult("SiteCTX validation", result, root);
  return result.ok ? EXIT_SUCCESS : EXIT_VALIDATION_FAILED;
}

async function doctorTarget(target) {
  const result = target.url
    ? await doctorRemote({ url: target.url })
    : await doctorLocal({ root: target.root || "." });
  printCheckResult("SiteCTX doctor", result, target.url || target.root || ".");
  return result.ok ? EXIT_SUCCESS : EXIT_VALIDATION_FAILED;
}

function printWriteSummary(prompts, result) {
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

function printWarnings(prompts, warnings = []) {
  for (const warning of warnings) {
    prompts.log.warn(warning);
  }
}

function printErrors(prompts, errors = []) {
  for (const error of errors) {
    prompts.log.error(error);
  }
}

function printNextCommands(commands) {
  writeLine();
  writeLine("Next commands:");
  for (const command of commands) {
    writeLine(`  ${command}`);
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
