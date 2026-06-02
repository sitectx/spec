export function createManifest(config, generatedAt) {
  return {
    specVersion: "0.1",
    kind: "sitectx.manifest",
    site: {
      name: config.name,
      url: config.siteUrl
    },
    generatedAt,
    context: {
      url: "/sitectx.json",
      contentType: "application/json"
    },
    updates: {
      url: "/sitectx/updates.json",
      contentType: "application/json"
    },
    updatesNdjson: {
      url: "/sitectx/updates.ndjson",
      contentType: "application/x-ndjson"
    }
  };
}
