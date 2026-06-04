const TYPOGRAPHY_REPLACEMENTS = new Map([
  ["\u00A0", " "],
  ["\u00AD", ""],
  ["\u2007", " "],
  ["\u2010", "-"],
  ["\u2011", "-"],
  ["\u2012", "-"],
  ["\u2013", "-"],
  ["\u2014", "-"],
  ["\u2015", "-"],
  ["\u2018", "'"],
  ["\u2019", "'"],
  ["\u201A", "'"],
  ["\u201B", "'"],
  ["\u201C", "\""],
  ["\u201D", "\""],
  ["\u201E", "\""],
  ["\u201F", "\""],
  ["\u2026", "..."],
  ["\u202F", " "],
  ["\u2032", "'"],
  ["\u2033", "\""],
  ["\u2212", "-"]
]);

const TYPOGRAPHY_PATTERN = /[\u00A0\u00AD\u2007\u2010-\u2015\u2018-\u201F\u2026\u202F\u2032\u2033\u2212]/g;
const DANGEROUS_FORMAT_PATTERN = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

export function sanitizeJsonString(value) {
  if (typeof value !== "string" || value.length === 0) {
    return value;
  }
  return stripControlCharacters(value.normalize("NFC"))
    .replace(DANGEROUS_FORMAT_PATTERN, "")
    .replace(TYPOGRAPHY_PATTERN, (character) => TYPOGRAPHY_REPLACEMENTS.get(character) ?? "");
}

function stripControlCharacters(value) {
  let sanitized = "";
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      (code >= 0x00 && code <= 0x08) ||
      code === 0x0B ||
      code === 0x0C ||
      (code >= 0x0E && code <= 0x1F) ||
      (code >= 0x7F && code <= 0x9F)
    ) {
      continue;
    }
    sanitized += character;
  }
  return sanitized;
}

export function sanitizeJsonValue(value) {
  if (typeof value === "string") {
    return sanitizeJsonString(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeJsonValue(entry));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeJsonValue(entry)])
    );
  }
  return value;
}

export function safeJsonStringify(value, space) {
  return JSON.stringify(sanitizeJsonValue(value), null, space);
}
