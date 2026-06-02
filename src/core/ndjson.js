export function stringifyNdjson(records) {
  if (!records || records.length === 0) {
    return "";
  }
  return `${records.map((record) => JSON.stringify(record)).join("\n")}\n`;
}

export function parseNdjson(text) {
  const records = [];
  const errors = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    if (line.trim() === "") {
      return;
    }
    try {
      records.push({ line: index + 1, value: JSON.parse(line) });
    } catch (error) {
      errors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : "Invalid JSON line."
      });
    }
  });
  return { records, errors };
}
