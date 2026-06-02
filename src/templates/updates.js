export function createUpdates(config, generatedAt) {
  const updates = config.updates.map((update) => ({
    id: update.id,
    type: update.type,
    url: update.url,
    title: update.title,
    summary: update.summary,
    publishedAt: update.publishedAt || update.published_at || generatedAt
  }));

  return {
    specVersion: "0.1",
    kind: "sitectx.updates",
    site: {
      name: config.name,
      url: config.siteUrl
    },
    generatedAt,
    updates
  };
}

export function createNdjsonUpdates(config, generatedAt) {
  return config.updates.map((update) => ({
    specVersion: "0.1",
    kind: "sitectx.update",
    siteUrl: config.siteUrl,
    id: update.id,
    type: update.type,
    url: update.url,
    title: update.title,
    summary: update.summary,
    publishedAt: update.publishedAt || update.published_at || generatedAt
  }));
}
