import crypto from "node:crypto";

export const DEFAULT_SPONSORED_CONTEXT_PATH = "sitectx/sponsored-context.json";
export const DEFAULT_SPONSORED_CONTEXT_URL = "/sitectx/sponsored-context.json";
export const AUTOMATED_NON_BILLABLE_EVENTS = [
  "agent_fetch",
  "agent_click",
  "crawler_visit",
  "bot_impression"
];
export const DEFAULT_BILLABLE_EVENTS = [
  "sponsored_listing_active",
  "verified_human_lead",
  "qualified_conversion"
];

const VALID_RELATIONSHIPS = new Set(["paid_placement", "affiliate", "partner", "first_party"]);
const VALID_STATUSES = new Set(["draft", "active", "paused", "expired"]);
const PROHIBITED_BILLABLE_EVENT_PATTERN = /\b(agent|bot|crawler|spider|automated).*(fetch|click|visit|impression)|\b(fetch|click|visit|impression).*(agent|bot|crawler|spider|automated)\b/i;
const PROHIBITED_SPONSORED_CLAIM_PATTERN = /\b(best|#1|guaranteed|revolutionary|dominate ai search|rank higher in chatgpt|hack agents|exploit ai traffic)\b/i;
const SITEMAP_CONFLICT_PREFIX = ".well-known/sitectx/";

export function commercialContextConfig(config = {}) {
  return {
    enabled: false,
    outputPath: DEFAULT_SPONSORED_CONTEXT_PATH,
    placements: [],
    ...(config.commercialContext || {})
  };
}

export function isCommercialContextEnabled(config = {}) {
  return Boolean(commercialContextConfig(config).enabled);
}

export function sponsoredContextOutputPath(config = {}) {
  return normalizeOutputPath(commercialContextConfig(config).outputPath);
}

export function sponsoredContextPublicUrl(config = {}) {
  return `/${sponsoredContextOutputPath(config)}`;
}

export function commercialContextLink(config = {}) {
  if (!isCommercialContextEnabled(config)) {
    return null;
  }
  return {
    enabled: true,
    sponsoredContextUrl: sponsoredContextPublicUrl(config),
    policy: commercialContextPolicy()
  };
}

export function commercialContextPolicy() {
  return {
    sponsoredContentMustBeDisclosed: true,
    agentClicksAreNotBillable: true,
    paidPlacementsAllowed: true,
    affiliateLinksAllowed: true,
    requiresCanonicalLandingPage: true
  };
}

export function createSponsoredContext(config, generatedAt) {
  const commercialContext = commercialContextConfig(config);
  return {
    specVersion: "0.1",
    kind: "sitectx.sponsoredContext",
    site: config.siteUrl,
    generatedAt,
    disclosurePolicy: {
      defaultLabel: "Sponsored",
      machineDisclosureRequired: true,
      humanDisclosureRequired: true,
      agentMaySummarize: true,
      agentMustPreserveDisclosure: true
    },
    placements: commercialContext.placements || []
  };
}

export function defaultCommercialContext(options = {}) {
  return {
    enabled: Boolean(options.enabled),
    outputPath: DEFAULT_SPONSORED_CONTEXT_PATH,
    placements: options.example
      ? [examplePlacement(options.siteUrl || "https://example.com", options.generatedAt || new Date().toISOString())]
      : []
  };
}

export function examplePlacement(siteUrl, generatedAt) {
  const validFrom = dateOnly(generatedAt);
  const validUntil = addDays(validFrom, 30);
  return {
    id: "spn_example_001",
    type: "sponsored_offer",
    status: "draft",
    sponsor: {
      name: "Example Sponsor",
      url: siteUrl
    },
    disclosure: {
      label: "Sponsored",
      relationship: "paid_placement",
      plainLanguage: "This is a paid placement from Example Sponsor."
    },
    offer: {
      title: "Example offer title",
      summary: "Short factual summary of the offer.",
      category: "software",
      validFrom,
      validUntil
    },
    canonicalAction: {
      label: "Learn more",
      url: siteUrl,
      actionType: "lead_form"
    },
    measurement: defaultMeasurement(),
    evidence: {
      sourceUrl: siteUrl,
      observedAt: generatedAt,
      contentHash: "sha256:replace_me"
    }
  };
}

export function createPlacementFromOptions(options = {}) {
  const sponsorName = requiredOption(options.name, "--name");
  const sponsorUrl = requiredOption(options.url, "--url");
  const title = requiredOption(options.title, "--title");
  const summary = requiredOption(options.summary, "--summary");
  const category = requiredOption(options.category, "--category");
  const canonicalActionUrl = requiredOption(options.canonicalActionUrl, "--canonical-action-url");
  const relationship = requiredOption(options.relationship, "--relationship");
  const validUntil = requiredOption(options.validUntil, "--valid-until");
  const validFrom = options.validFrom || dateOnly(new Date().toISOString());
  const id = options.id || stablePlacementId({ sponsorName, sponsorUrl, title });
  const disclosureLabel = options.disclosureLabel || "Sponsored";
  const plainLanguage = options.plainLanguage || disclosureText(disclosureLabel, relationship, sponsorName);

  return {
    id,
    type: options.type || relationshipToType(relationship),
    status: options.status || "active",
    sponsor: {
      name: sponsorName,
      url: sponsorUrl
    },
    disclosure: {
      label: disclosureLabel,
      relationship,
      plainLanguage,
      ...(options.humanVisibleUrl ? { humanVisibleUrl: options.humanVisibleUrl } : {}),
      ...(options.humanVisibleText ? { humanVisibleText: options.humanVisibleText } : {})
    },
    offer: {
      title,
      summary,
      category,
      ...(options.price ? { price: options.price } : {}),
      ...(options.currency ? { currency: options.currency.toUpperCase() } : {}),
      validFrom,
      validUntil,
      ...(options.sponsorClaim ? { sponsorClaim: true } : {})
    },
    canonicalAction: {
      label: options.canonicalActionLabel || "Learn more",
      url: canonicalActionUrl,
      actionType: options.canonicalActionType || "lead_form"
    },
    ...(targetingContextFromOptions(options) ? { targetingContext: targetingContextFromOptions(options) } : {}),
    measurement: defaultMeasurement(options.billableEvent),
    evidence: {
      ...(options.evidenceSourceUrl ? { sourceUrl: options.evidenceSourceUrl } : { sourceUrl: sponsorUrl }),
      ...(options.evidenceObservedAt ? { observedAt: options.evidenceObservedAt } : {}),
      ...(options.evidenceHash ? { contentHash: options.evidenceHash } : {})
    }
  };
}

export function defaultMeasurement(billableEvents = DEFAULT_BILLABLE_EVENTS) {
  const resolvedBillableEvents = arrayify(billableEvents);
  return {
    billableEvents: resolvedBillableEvents.length > 0 ? resolvedBillableEvents : DEFAULT_BILLABLE_EVENTS,
    nonBillableEvents: AUTOMATED_NON_BILLABLE_EVENTS
  };
}

export function addSponsoredContextChecks(collector, target, document, options = {}) {
  if (!document) {
    collector.fail("sponsoredContext.present", target, "Sponsored context document is missing.");
    return;
  }
  const placements = Array.isArray(document.placements) ? document.placements : [];

  if (document.disclosurePolicy?.machineDisclosureRequired === true) {
    collector.pass("sponsoredContext.disclosure.machine", target, "Machine-readable disclosure is required.");
  } else {
    collector.fail("sponsoredContext.disclosure.machine", target, "Machine-readable disclosure must be required.");
  }
  if (document.disclosurePolicy?.agentMustPreserveDisclosure === true) {
    collector.pass("sponsoredContext.disclosure.preserve", target, "Agent disclosure preservation is required.");
  } else {
    collector.fail("sponsoredContext.disclosure.preserve", target, "Agents must be instructed to preserve disclosure.");
  }

  validateUniquePlacements(collector, target, placements);
  addRepeatedQueryWarnings(collector, target, placements);
  placements.forEach((placement, index) =>
    addPlacementChecks(collector, `${target}#${placement?.id || index}`, placement, options)
  );
}

export function addCommercialConfigChecks(collector, target, config, options = {}) {
  const commercialContext = commercialContextConfig(config);
  const outputPath = normalizeOutputPath(commercialContext.outputPath);
  if (outputPath.startsWith(SITEMAP_CONFLICT_PREFIX)) {
    collector.fail(
      "commercialContext.outputPath.conflict",
      target,
      "commercialContext.outputPath cannot be under .well-known/sitectx/ because /.well-known/sitectx is the manifest file."
    );
  } else {
    collector.pass("commercialContext.outputPath", target, `Commercial context output path is ${outputPath}.`);
  }
  if (!commercialContext.enabled) {
    collector.pass("commercialContext.enabled", target, "Commercial context is disabled.");
    return;
  }
  if (!commercialContext.placements?.length) {
    collector.warn(
      "commercialContext.empty",
      target,
      "Commercial context is enabled with no placements.",
      "This is valid for an explicitly empty feed, but it has no commercial placements to publish."
    );
  }
  addOrganicMixingChecks(collector, target, config);
  addSponsoredContextChecks(collector, target, createSponsoredContext(config, options.generatedAt || new Date().toISOString()), options);
}

export function inspectSponsoredContext(document, config = {}) {
  const placements = document?.placements || [];
  const counts = {
    total: placements.length,
    active: placements.filter((placement) => placement.status === "active").length,
    draft: placements.filter((placement) => placement.status === "draft").length,
    paused: placements.filter((placement) => placement.status === "paused").length,
    expired: placements.filter((placement) => placement.status === "expired" || isExpired(placement.offer?.validUntil)).length
  };
  const sponsors = [...new Set(placements.map((placement) => placement.sponsor?.name).filter(Boolean))];
  return {
    outputPath: sponsoredContextOutputPath(config),
    enabled: isCommercialContextEnabled(config),
    counts,
    sponsors,
    disclosureRequired: document?.disclosurePolicy?.machineDisclosureRequired === true,
    agentClicksBillable: placements.some((placement) =>
      arrayify(placement.measurement?.billableEvents).includes("agent_click")
    )
  };
}

function addPlacementChecks(collector, target, placement, options = {}) {
  if (!placement || typeof placement !== "object") {
    collector.fail("placement.object", target, "Placement must be an object.");
    return;
  }
  requiredFieldCheck(collector, target, placement.id, "placement.id", "Placement id is present.");
  requiredFieldCheck(collector, target, placement.status, "placement.status", "Placement status is present.");
  if (placement.status && !VALID_STATUSES.has(placement.status)) {
    collector.fail("placement.status", target, `Placement status is not supported: ${placement.status}`);
  }
  requiredFieldCheck(collector, target, placement.sponsor?.name, "placement.sponsor.name", "Sponsor name is present.");
  urlFieldCheck(collector, target, placement.sponsor?.url, "placement.sponsor.url", "Sponsor URL is valid.");
  requiredFieldCheck(collector, target, placement.disclosure?.label, "placement.disclosure.label", "Disclosure label is present.");
  requiredFieldCheck(collector, target, placement.disclosure?.relationship, "placement.disclosure.relationship", "Disclosure relationship is present.");
  if (placement.disclosure?.relationship && !VALID_RELATIONSHIPS.has(placement.disclosure.relationship)) {
    collector.fail("placement.disclosure.relationship", target, `Disclosure relationship is not allowed: ${placement.disclosure.relationship}`);
  }
  if (/(hidden|undisclosed|organic|editorial)/i.test(`${placement.disclosure?.label || ""} ${placement.disclosure?.plainLanguage || ""}`)) {
    collector.fail("placement.disclosure.misleading", target, "Disclosure cannot describe sponsored content as hidden, undisclosed, organic, or editorial.");
  }
  urlFieldCheck(collector, target, placement.canonicalAction?.url, "placement.canonicalAction.url", "Canonical action URL is valid.");
  requiredFieldCheck(collector, target, placement.offer?.validFrom, "placement.offer.validFrom", "Offer validFrom date is present.");
  requiredFieldCheck(collector, target, placement.offer?.validUntil, "placement.offer.validUntil", "Offer validUntil date is present.");
  if (placement.status === "active" && isExpired(placement.offer?.validUntil, options.now)) {
    collector.fail("placement.offer.expired", target, `Active placement expired on ${placement.offer.validUntil}.`);
  }

  addMeasurementChecks(collector, target, placement);
  addEvidenceChecks(collector, target, placement);
  addCommercialLanguageChecks(collector, target, placement);
  addTargetingChecks(collector, target, placement);
  addDomainMismatchCheck(collector, target, placement);
  addDisclosureReferenceCheck(collector, target, placement);
}

function addMeasurementChecks(collector, target, placement) {
  const billableEvents = arrayify(placement.measurement?.billableEvents);
  const nonBillableEvents = arrayify(placement.measurement?.nonBillableEvents);
  const prohibited = billableEvents.filter((event) =>
    AUTOMATED_NON_BILLABLE_EVENTS.includes(event) || PROHIBITED_BILLABLE_EVENT_PATTERN.test(event)
  );
  if (prohibited.length > 0) {
    collector.fail(
      "placement.measurement.billable",
      target,
      `Automated agent, bot, crawler, click, impression, or fetch events cannot be billable: ${prohibited.join(", ")}`
    );
  } else {
    collector.pass("placement.measurement.billable", target, "Automated events are not billable.");
  }
  const missing = AUTOMATED_NON_BILLABLE_EVENTS.filter((event) => !nonBillableEvents.includes(event));
  if (placement.measurement && missing.length > 0) {
    collector.fail(
      "placement.measurement.nonBillable",
      target,
      `measurement.nonBillableEvents must include ${missing.join(", ")}.`
    );
  }
}

function addEvidenceChecks(collector, target, placement) {
  if (!placement.evidence?.contentHash || placement.evidence.contentHash === "sha256:replace_me") {
    collector.warn("placement.evidence.hash", target, "Evidence content hash is missing or still a placeholder.");
  }
  if (!placement.evidence?.sourceUrl) {
    collector.warn("placement.evidence.sourceUrl", target, "Evidence source URL is missing.");
  }
  if (!placement.evidence?.observedAt) {
    collector.warn("placement.evidence.observedAt", target, "Evidence observedAt timestamp is missing.");
  }
}

function addCommercialLanguageChecks(collector, target, placement) {
  const text = `${placement.offer?.title || ""} ${placement.offer?.summary || ""} ${placement.disclosure?.plainLanguage || ""}`;
  if (/sitectx\s+(endorses|recommends|approves|certifies)|endorsed\s+by\s+sitectx/i.test(text)) {
    collector.fail("placement.claim.sitectx", target, "Sponsored context must not claim endorsement, approval, or certification by SiteCTX.");
  }
  if (!placement.offer?.sponsorClaim && PROHIBITED_SPONSORED_CLAIM_PATTERN.test(text)) {
    collector.fail(
      "placement.claim.hype",
      target,
      "Sponsored claims such as best, #1, guaranteed, or AI ranking promises require an explicit sponsorClaim marker."
    );
  }
  if ((placement.offer?.summary || "").length > 500) {
    collector.warn("placement.offer.summaryLength", target, "Offer summary is unusually long.");
  }
  if (placement.offer?.price && !placement.offer?.currency) {
    collector.warn("placement.offer.currency", target, "Offer price is present without currency.");
  }
}

function addTargetingChecks(collector, target, placement) {
  const queries = arrayify(placement.targetingContext?.relevantQueries);
  if (queries.length > 10) {
    collector.warn("placement.targeting.queryCount", target, "Placement has many relevantQueries; avoid keyword stuffing.");
  }
}

function addDomainMismatchCheck(collector, target, placement) {
  const sponsorHost = hostname(placement.sponsor?.url);
  const actionHost = hostname(placement.canonicalAction?.url);
  if (sponsorHost && actionHost && sponsorHost !== actionHost) {
    collector.warn(
      "placement.domainMismatch",
      target,
      `Sponsor domain (${sponsorHost}) differs from canonical action domain (${actionHost}).`
    );
  }
}

function addDisclosureReferenceCheck(collector, target, placement) {
  if (!placement.disclosure?.humanVisibleUrl && !placement.disclosure?.humanVisibleText) {
    collector.warn("placement.disclosure.humanVisible", target, "Human-visible disclosure reference is missing.");
  }
}

function addRepeatedQueryWarnings(collector, target, placements) {
  const seen = new Map();
  for (const placement of placements) {
    for (const query of arrayify(placement.targetingContext?.relevantQueries)) {
      const normalized = query.trim().toLowerCase();
      if (!normalized) {
        continue;
      }
      seen.set(normalized, (seen.get(normalized) || 0) + 1);
    }
  }
  const repeated = [...seen.entries()].filter(([, count]) => count > 1).map(([query]) => query);
  if (repeated.length > 0) {
    collector.warn("sponsoredContext.repeatedQueries", target, `Repeated relevantQueries found: ${repeated.slice(0, 5).join(", ")}.`);
  }
}

function addOrganicMixingChecks(collector, target, config) {
  const organicBuckets = [
    ["canonicalFacts", config.canonicalFacts],
    ["products", config.products],
    ["claims", config.claims]
  ];
  for (const [name, values] of organicBuckets) {
    for (const item of arrayify(values)) {
      const relationship = item?.relationship || item?.disclosure?.relationship;
      if (relationship && VALID_RELATIONSHIPS.has(relationship) && !item?.disclosure?.label) {
        collector.fail(
          "commercialContext.organicMixing",
          target,
          `$.${name} contains commercial relationship "${relationship}" without disclosure label.`
        );
      }
    }
  }
}

function validateUniquePlacements(collector, target, placements) {
  const seen = new Set();
  const duplicates = new Set();
  for (const placement of placements) {
    if (!placement?.id) {
      continue;
    }
    if (seen.has(placement.id)) {
      duplicates.add(placement.id);
    }
    seen.add(placement.id);
  }
  if (duplicates.size > 0) {
    collector.fail("sponsoredContext.ids", target, `Duplicate placement ids: ${[...duplicates].join(", ")}`);
  } else {
    collector.pass("sponsoredContext.ids", target, "Placement IDs are unique.");
  }
}

function requiredFieldCheck(collector, target, value, code, passMessage) {
  if (value == null || value === "") {
    collector.fail(code, target, `${code} is required.`);
  } else {
    collector.pass(code, target, passMessage);
  }
}

function urlFieldCheck(collector, target, value, code, passMessage) {
  if (!value) {
    collector.fail(code, target, `${code} is required.`);
    return;
  }
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      collector.fail(code, target, `${code} must use HTTP or HTTPS.`);
      return;
    }
    collector.pass(code, target, passMessage);
  } catch {
    collector.fail(code, target, `${code} must be a valid HTTP(S) URL.`);
  }
}

function normalizeOutputPath(value) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_SPONSORED_CONTEXT_PATH;
  return raw.replace(/^\/+/, "").replaceAll("\\", "/");
}

function requiredOption(value, optionName) {
  if (value == null || value === "") {
    throw new Error(`${optionName} is required.`);
  }
  return value;
}

function stablePlacementId({ sponsorName, sponsorUrl, title }) {
  const base = slugForText(sponsorName) || "sponsor";
  const hash = crypto.createHash("sha256").update(`${sponsorName}:${sponsorUrl}:${title}`).digest("hex").slice(0, 8);
  return `spn_${base}_${hash}`;
}

function slugForText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function relationshipToType(relationship) {
  if (relationship === "affiliate") {
    return "affiliate_offer";
  }
  if (relationship === "partner") {
    return "partner_offer";
  }
  if (relationship === "first_party") {
    return "first_party_offer";
  }
  return "sponsored_offer";
}

function disclosureText(label, relationship, sponsorName) {
  if (relationship === "affiliate") {
    return `${label}: this placement may include affiliate compensation from ${sponsorName}.`;
  }
  if (relationship === "partner") {
    return `${label}: this is a partner placement from ${sponsorName}.`;
  }
  if (relationship === "first_party") {
    return `${label}: this is a first-party commercial offer.`;
  }
  return `${label}: this is a paid placement from ${sponsorName}.`;
}

function targetingContextFromOptions(options) {
  const intendedAudience = arrayify(options.audience);
  const relevantQueries = arrayify(options.query);
  if (intendedAudience.length === 0 && relevantQueries.length === 0) {
    return null;
  }
  return {
    ...(intendedAudience.length ? { intendedAudience } : {}),
    ...(relevantQueries.length ? { relevantQueries } : {})
  };
}

function arrayify(value) {
  if (Array.isArray(value)) {
    return value.filter((entry) => entry != null && entry !== "");
  }
  if (value == null || value === "") {
    return [];
  }
  return [value];
}

function dateOnly(value) {
  return new Date(value).toISOString().slice(0, 10);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isExpired(dateText, now = new Date()) {
  if (!dateText) {
    return false;
  }
  const today = dateOnly(now instanceof Date ? now.toISOString() : now);
  return dateText < today;
}

function hostname(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}
