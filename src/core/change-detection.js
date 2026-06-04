import { artifactPaths, fileExists, readUtf8 } from "./filesystem.js";

export async function readExistingConfig(root = ".") {
  const configPath = artifactPaths(root).config;
  if (!(await fileExists(configPath))) {
    return null;
  }
  try {
    return JSON.parse(await readUtf8(configPath));
  } catch {
    return null;
  }
}

export function summarizeConfigChanges(previous, next) {
  if (!previous || !next) {
    return {
      available: false,
      pages: emptyChangeGroup(),
      actions: emptyChangeGroup(),
      hasChanges: false
    };
  }

  const pages = compareByKey({
    previous: previous.sourcePages || previous.sections || [],
    next: next.sourcePages || next.sections || [],
    keyFor: (item) => item?.url,
    changed: (before, after) =>
      Boolean(before?.contentHash && after?.contentHash && before.contentHash !== after.contentHash)
  });
  const actions = compareByKey({
    previous: previous.actions || [],
    next: next.actions || [],
    keyFor: (item) => `${item?.type || ""}:${item?.url || ""}`,
    changed: (before, after) => Boolean(before?.label && after?.label && before.label !== after.label)
  });

  return {
    available: true,
    pages,
    actions,
    hasChanges: pages.changed.length > 0 || pages.added.length > 0 || pages.removed.length > 0 ||
      actions.changed.length > 0 || actions.added.length > 0 || actions.removed.length > 0
  };
}

function compareByKey({ previous, next, keyFor, changed }) {
  const before = indexBy(previous, keyFor);
  const after = indexBy(next, keyFor);
  const added = [];
  const removed = [];
  const changedItems = [];

  for (const [key, item] of after.entries()) {
    if (!before.has(key)) {
      added.push(summaryItem(item, key));
      continue;
    }
    const previousItem = before.get(key);
    if (changed(previousItem, item)) {
      changedItems.push(summaryItem(item, key));
    }
  }
  for (const [key, item] of before.entries()) {
    if (!after.has(key)) {
      removed.push(summaryItem(item, key));
    }
  }

  return {
    added,
    changed: changedItems,
    removed
  };
}

function indexBy(values, keyFor) {
  const map = new Map();
  for (const value of values) {
    const key = keyFor(value);
    if (key) {
      map.set(key, value);
    }
  }
  return map;
}

function summaryItem(item, fallback) {
  return {
    id: item?.id || fallback,
    title: item?.title || item?.label || item?.name || fallback,
    url: item?.url || fallback
  };
}

function emptyChangeGroup() {
  return {
    added: [],
    changed: [],
    removed: []
  };
}
