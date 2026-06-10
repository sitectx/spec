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

export function formatCheckResultStatus(result) {
  const summary = result.summary || { warnings: 0, failures: 0 };
  const warningText = pluralize(summary.warnings || 0, "warning");
  const failureText = pluralize(summary.failures || 0, "failure");

  if (!result.ok) {
    if ((summary.failures || 0) > 0 && (summary.warnings || 0) > 0) {
      return `FAIL with ${failureText} and ${warningText}`;
    }
    if ((summary.failures || 0) > 0) {
      return `FAIL with ${failureText}`;
    }
    if (result.strict && (summary.warnings || 0) > 0) {
      return `FAIL - warnings treated as errors (${warningText})`;
    }
    if ((summary.warnings || 0) > 0) {
      return `FAIL with ${warningText}`;
    }
    return "FAIL";
  }

  if ((summary.warnings || 0) > 0) {
    return `PASS with ${warningText}`;
  }
  return "PASS";
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
  if (result.suggestions?.length > 0) {
    writeLine();
    for (const suggestion of result.suggestions) {
      writeLine(`Suggestion: ${suggestion}`);
    }
  }
  writeLine();
  writeLine(`Result: ${formatCheckResultStatus(result)}`);
}

function pluralize(count, singular) {
  return count === 1 ? `1 ${singular}` : `${count} ${singular}s`;
}
