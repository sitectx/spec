export function summarizeReviewConfig(config) {
  return {
    status: config.discovery?.status || "none",
    name: config.name,
    siteUrl: config.siteUrl,
    description: config.description,
    counts: {
      actions: (config.actions || []).length,
      navigation: (config.navigation || []).length,
      catalogs: (config.catalogs || []).length,
      sourcePages: reviewablePages(config).length,
      discoveryClaims: (config.discoveryCandidates?.claims || []).length,
      discoveryFaq: (config.discoveryCandidates?.faq || []).length
    }
  };
}

export function applyReviewDecisions(config, decisions = {}, now = new Date().toISOString()) {
  const next = structuredClone(config);
  const originalDescription = config.description;
  const summary = normalizeText(decisions.description);

  if (summary) {
    next.description = summary;
    if (next.identity && (!next.identity.description || next.identity.description === originalDescription)) {
      next.identity.description = summary;
    }
    if (next.positioning && (!next.positioning.summary || next.positioning.summary === originalDescription)) {
      next.positioning.summary = summary;
    }
  }

  next.actions = filterByKeys(next.actions, decisions.actionKeys, "action");
  next.navigation = filterByKeys(next.navigation, decisions.navigationKeys, "navigation");
  next.catalogs = markReviewed(filterByKeys(next.catalogs, decisions.catalogKeys, "catalog"));

  applyPageReview(next, decisions.pageKeys, now);
  markReviewablePublicItems(next);

  next.discovery = {
    ...(next.discovery || {}),
    status: "reviewed",
    reviewedAt: now,
    reviewedBy: "sitectx review",
    notes: uniqueStrings([
      ...((next.discovery && next.discovery.notes) || []),
      "Human review completed with sitectx review."
    ])
  };

  return next;
}

export function reviewablePages(config) {
  if (Array.isArray(config.sourcePages) && config.sourcePages.length > 0) {
    return config.sourcePages.map((page, index) => ({
      key: itemKey(page, "page", index),
      id: page.id,
      title: page.title || page.url,
      url: page.url,
      role: page.role
    }));
  }
  return (config.sections || []).map((section, index) => ({
    key: itemKey(section, "section", index),
    id: section.id,
    title: section.title || section.url,
    url: section.url,
    role: section.role
  }));
}

export function keyedItems(items = [], prefix) {
  return items.map((item, index) => ({
    key: itemKey(item, prefix, index),
    item
  }));
}

function applyPageReview(config, pageKeys, now) {
  if (pageKeys == null) {
    if (Array.isArray(config.sourcePages)) {
      config.sourcePages = config.sourcePages.map((page) => ({
        ...page,
        lastReviewedAt: page.lastReviewedAt || now
      }));
    }
    return;
  }

  const keep = new Set(pageKeys);
  if (Array.isArray(config.sourcePages) && config.sourcePages.length > 0) {
    const keptPages = keyedItems(config.sourcePages, "page")
      .filter(({ key }) => keep.has(key))
      .map(({ item }) => ({
        ...item,
        lastReviewedAt: now
      }));
    const keptUrls = new Set(keptPages.map((page) => page.url));
    config.sourcePages = keptPages;
    config.sections = (config.sections || []).filter((section) => keptUrls.has(section.url));
    return;
  }

  config.sections = keyedItems(config.sections || [], "section")
    .filter(({ key }) => keep.has(key))
    .map(({ item }) => item);
}

function filterByKeys(items = [], keys, prefix) {
  if (!Array.isArray(items)) {
    return [];
  }
  if (keys == null) {
    return items;
  }
  const keep = new Set(keys);
  return keyedItems(items, prefix)
    .filter(({ key }) => keep.has(key))
    .map(({ item }) => item);
}

function itemKey(item, prefix, index) {
  return item?.id || item?.url || `${prefix}:${index}`;
}

function markReviewablePublicItems(config) {
  for (const field of ["canonicalFacts", "products", "claims", "faq"]) {
    if (Array.isArray(config[field])) {
      config[field] = markReviewed(config[field]);
    }
  }
}

function markReviewed(items = []) {
  return items.map((item) => {
    if (!item || typeof item !== "object" || !("reviewRequired" in item)) {
      return item;
    }
    return {
      ...item,
      reviewRequired: false
    };
  });
}

function normalizeText(value) {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  return normalized || "";
}

function uniqueStrings(values) {
  return [...new Set(values.filter(Boolean))];
}
