import { safeJsonStringify } from "../core/json-hygiene.js";

export function writeJson(value) {
  process.stdout.write(`${safeJsonStringify(value, 2)}\n`);
}

export function writeLine(value = "") {
  process.stdout.write(`${value}\n`);
}

export function writeError(value = "") {
  process.stderr.write(`${value}\n`);
}

export function formatRelativePath(filePath) {
  return filePath.replaceAll("\\", "/");
}

export function printCheckResult(title, result, target) {
  writeLine(title);
  if (target) {
    writeLine();
    writeLine(`Target: ${target}`);
  }
  writeLine();
  for (const check of result.checks) {
    const targetLabel = check.target ? ` ${check.target}` : "";
    writeLine(`${check.level}${targetLabel} ${check.message}`);
    if (check.hint) {
      writeLine(`     Hint: ${check.hint}`);
    }
  }
  writeLine();
  const warningText =
    result.summary.warnings === 1
      ? "1 warning"
      : `${result.summary.warnings} warnings`;
  const failureText =
    result.summary.failures === 1
      ? "1 failure"
      : `${result.summary.failures} failures`;
  if (result.summary.failures > 0) {
    writeLine(`Result: FAIL with ${failureText}`);
  } else if (result.summary.warnings > 0) {
    writeLine(`Result: PASS with ${warningText}`);
  } else {
    writeLine("Result: PASS");
  }
}
