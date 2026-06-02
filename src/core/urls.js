export function isHttpUrl(value) {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function normalizeSiteUrl(value) {
  if (!value) {
    return "https://example.com";
  }
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Expected an HTTP(S) URL, received ${value}`);
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

export function originFromSiteUrl(value) {
  const url = new URL(normalizeSiteUrl(value));
  return url.origin;
}

export function absoluteUrl(siteUrl, value) {
  if (!value) {
    return null;
  }
  return new URL(value, originFromSiteUrl(siteUrl)).toString();
}

export function publicPathFromUrl(value) {
  if (!value) {
    return null;
  }
  if (value.startsWith("/")) {
    return value;
  }
  try {
    return new URL(value).pathname;
  } catch {
    return value;
  }
}

export function isRelativePublicUrl(value) {
  return typeof value === "string" && value.startsWith("/");
}

export function isLocalhostUrl(value) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function discoveryUrlForSite(siteUrl) {
  return new URL("/.well-known/sitectx", normalizeSiteUrl(siteUrl)).toString();
}

export function safeUrl(value) {
  try {
    return new URL(value).toString();
  } catch {
    return null;
  }
}
