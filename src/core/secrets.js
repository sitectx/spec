const SECRET_PATTERNS = [
  {
    name: "private key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/
  },
  {
    name: "AWS secret access key",
    pattern: /AWS_SECRET_ACCESS_KEY/i
  },
  {
    name: "AWS access key id",
    pattern: /AKIA[0-9A-Z]{12,20}/
  },
  {
    name: "Stripe live secret key",
    pattern: /sk_live_[A-Za-z0-9_]{8,}/
  },
  {
    name: "Stripe test secret key",
    pattern: /sk_test_[A-Za-z0-9_]{8,}/
  },
  {
    name: "JWT bearer token",
    pattern: /Bearer\s+eyJ[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+){1,2}/
  },
  {
    name: "GitHub token",
    pattern: /ghp_[A-Za-z0-9_]{12,}/
  },
  {
    name: "Slack bot token",
    pattern: /xoxb-[A-Za-z0-9-]{8,}/
  },
  {
    name: "session cookie",
    pattern: /sessionid=[^\s;"']+/i
  },
  {
    name: "set-cookie header",
    pattern: /Set-Cookie/i
  }
];

export function scanForSecrets(value, options = {}) {
  const findings = [];
  const rootPath = options.path || "$";
  visit(value, rootPath, findings);
  return findings;
}

function visit(value, currentPath, findings) {
  if (typeof value === "string") {
    for (const detector of SECRET_PATTERNS) {
      const match = detector.pattern.exec(value);
      if (match) {
        findings.push({
          path: currentPath,
          type: detector.name,
          redacted: redact(match[0])
        });
      }
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => visit(entry, `${currentPath}[${index}]`, findings));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, entry] of Object.entries(value)) {
      const safeKey = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
        ? `.${key}`
        : `[${JSON.stringify(key)}]`;
      visit(entry, `${currentPath}${safeKey}`, findings);
    }
  }
}

function redact(value) {
  const compact = value.replace(/\s+/g, " ");
  if (compact.length <= 8) {
    return "****";
  }
  return `${compact.slice(0, Math.min(8, compact.length))}****`;
}

export function redactSecretsInString(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  let redacted = value;
  for (const detector of SECRET_PATTERNS) {
    redacted = redacted.replace(detector.pattern, (match) => redact(match));
  }
  return redacted;
}
