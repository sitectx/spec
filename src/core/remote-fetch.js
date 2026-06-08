import dns from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import { Readable } from "node:stream";

const DEFAULT_MAX_REDIRECTS = 5;
const DEFAULT_MAX_BYTES = 1_000_000;
const BLOCKED_IPV4_RANGES = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4]
].map(([address, prefix]) => ({ bytes: parseIpv4Bytes(address), prefix }));
const BLOCKED_IPV6_RANGES = [
  ["::", 128],
  ["::1", 128],
  ["::", 96],
  ["64:ff9b::", 96],
  ["64:ff9b:1::", 48],
  ["100::", 64],
  ["2001::", 32],
  ["2001:2::", 48],
  ["2001:10::", 28],
  ["2001:20::", 28],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8]
].map(([address, prefix]) => ({ bytes: parseIpv6Bytes(address), prefix }));

export function createRemoteFetchPolicy(baseUrl, options = {}) {
  const base = new URL(baseUrl);
  return {
    baseOrigin: base.origin,
    allowedOrigins: new Set([
      ...arrayify(options.allowOrigins),
      ...arrayify(options.allowRemoteOrigin)
    ].map(normalizeOrigin))
  };
}

export async function fetchText(url, options = {}) {
  const timeout = Number(options.timeout || 10000);
  const maxRedirects = Number(options.maxRedirects || DEFAULT_MAX_REDIRECTS);
  const maxBytes = Number(options.maxBytes || DEFAULT_MAX_BYTES);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    let currentUrl = new URL(url).toString();
    const redirects = [];
    for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
      const policyCheck = await validateRemoteFetchUrl(currentUrl, options.policy);
      if (!policyCheck.ok) {
        return failedResponse(currentUrl, policyCheck.error, redirects);
      }

      const response = await fetchValidatedResponse(currentUrl, {
        signal: controller.signal,
        policyCheck
      });
      if (isRedirect(response.status)) {
        const location = response.headers.get("location");
        if (!location) {
          return failedResponse(currentUrl, `Redirect from ${currentUrl} is missing a Location header.`, redirects, response.status);
        }
        if (redirectCount === maxRedirects) {
          return failedResponse(currentUrl, `Too many redirects while fetching ${url}.`, redirects, response.status);
        }
        currentUrl = new URL(location, currentUrl).toString();
        redirects.push(currentUrl);
        continue;
      }

      const contentLength = Number(response.headers.get("content-length") || 0);
      if (contentLength > maxBytes) {
        return failedResponse(currentUrl, `Remote fetch exceeded ${maxBytes} bytes before buffering.`, redirects, response.status);
      }
      let body;
      try {
        body = await readLimitedText(response, maxBytes);
      } catch (error) {
        return failedResponse(
          currentUrl,
          error instanceof Error ? error.message : `Remote fetch exceeded ${maxBytes} bytes before buffering.`,
          redirects,
          response.status
        );
      }
      return {
        ok: response.ok,
        status: response.status,
        url: currentUrl,
        contentType: response.headers.get("content-type") || "",
        contentLength,
        body,
        byteLength: Buffer.byteLength(body, "utf8"),
        redirects
      };
    }
    return failedResponse(currentUrl, `Too many redirects while fetching ${url}.`, redirects);
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      contentType: "",
      contentLength: 0,
      body: "",
      byteLength: 0,
      redirects: [],
      error: error instanceof Error ? error.message : "Request failed."
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function readLimitedText(response, maxBytes = DEFAULT_MAX_BYTES, options = {}) {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) {
    throw new Error("maxBytes must be a positive number.");
  }
  if (!response.body) {
    throw new Error("Response body stream is unavailable for bounded read.");
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBytes) {
      const allowedBytes = value.byteLength - (total - maxBytes);
      if (options.truncate) {
        chunks.push(value.slice(0, allowedBytes));
        await reader.cancel();
        break;
      }
      await reader.cancel();
      throw new Error(`Remote fetch exceeded ${maxBytes} bytes before buffering.`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8");
}

export async function fetchValidatedResponse(url, { signal, policyCheck } = {}) {
  if (!policyCheck?.resolvedAddress) {
    return fetch(url, {
      signal,
      redirect: "manual"
    });
  }
  return fetchWithPinnedLookup(url, {
    signal,
    address: policyCheck.resolvedAddress,
    family: policyCheck.resolvedFamily
  });
}

export async function validateRemoteFetchUrl(value, policy) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, error: `Remote fetch URL is not valid: ${value}` };
  }
  if (!["http:", "https:"].includes(url.protocol)) {
    return { ok: false, error: `Remote fetch URL must use HTTP or HTTPS: ${value}` };
  }
  if (!policy) {
    return { ok: true, allowlisted: false };
  }

  const allowlisted = policy.allowedOrigins.has(url.origin);
  if (!allowlisted && url.origin !== policy.baseOrigin) {
    return {
      ok: false,
      allowlisted,
      error: `Remote fetch blocked off-origin URL ${url.toString()}; add --allow-remote-origin ${url.origin} to allow it.`
    };
  }
  const localOrLiteralCheck = localOrLiteralHostCheck(url.hostname);
  if (!allowlisted && localOrLiteralCheck && !localOrLiteralCheck.ok) {
    return { ok: false, allowlisted, error: localOrLiteralCheck.error };
  }
  if (!allowlisted && url.protocol !== "https:") {
    return {
      ok: false,
      allowlisted,
      error: `Remote fetch blocked non-HTTPS URL ${url.toString()}; add --allow-remote-origin ${url.origin} to allow it.`
    };
  }
  let hostCheck = localOrLiteralCheck;
  if (!allowlisted) {
    hostCheck ||= await hostHasBlockedAddress(url.hostname);
    if (!hostCheck.ok) {
      return { ok: false, allowlisted, error: hostCheck.error };
    }
  }
  return {
    ok: true,
    allowlisted,
    ...(hostCheck?.address ? { resolvedAddress: hostCheck.address, resolvedFamily: hostCheck.family } : {})
  };
}

async function fetchWithPinnedLookup(url, { signal, address, family }) {
  const parsed = new URL(url);
  const client = parsed.protocol === "https:" ? https : http;
  const hostname = normalizeHostname(parsed.hostname);
  const requestOptions = {
    protocol: parsed.protocol,
    hostname,
    port: parsed.port || undefined,
    path: `${parsed.pathname}${parsed.search}`,
    method: "GET",
    signal,
    lookup: pinnedLookup(address, family)
  };
  if (parsed.protocol === "https:" && net.isIP(hostname) === 0) {
    requestOptions.servername = hostname;
  }

  return await new Promise((resolve, reject) => {
    const request = client.request(requestOptions, (response) => {
      resolve({
        ok: response.statusCode >= 200 && response.statusCode <= 299,
        status: response.statusCode || 0,
        headers: nodeHeaders(response.headers),
        body: Readable.toWeb(response)
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function pinnedLookup(address, family) {
  return (_hostname, options, callback) => {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (options?.all) {
      callback(null, [{ address, family }]);
      return;
    }
    callback(null, address, family);
  };
}

function nodeHeaders(headers) {
  return {
    get(name) {
      const value = headers[String(name || "").toLowerCase()];
      if (Array.isArray(value)) {
        return value.join(", ");
      }
      return value == null ? null : String(value);
    }
  };
}

function failedResponse(url, error, redirects = [], status = 0) {
  return {
    ok: false,
    status,
    url,
    contentType: "",
    contentLength: 0,
    body: "",
    byteLength: 0,
    redirects,
    error
  };
}

function isRedirect(status) {
  return [301, 302, 303, 307, 308].includes(status);
}

function arrayify(value) {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return value ? [value] : [];
}

function normalizeOrigin(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Allowed remote origin must use HTTP or HTTPS: ${value}`);
  }
  return url.origin;
}

async function hostHasBlockedAddress(hostname) {
  const localOrLiteralCheck = localOrLiteralHostCheck(hostname);
  if (localOrLiteralCheck) {
    return localOrLiteralCheck;
  }
  const host = normalizeHostname(hostname);

  let records;
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (error) {
    return {
      ok: false,
      error: `Remote fetch DNS validation failed for ${hostname}: ${error instanceof Error ? error.message : "lookup failed"}.`
    };
  }
  if (!Array.isArray(records) || records.length === 0) {
    return { ok: false, error: `Remote fetch DNS validation found no addresses for ${hostname}.` };
  }
  if (records.some((record) => isBlockedIpAddress(record.address))) {
    return { ok: false, error: `Remote fetch blocked private or link-local DNS address for ${hostname}.` };
  }
  const firstRecord = records[0];
  const firstAddress = parseIpAddress(firstRecord.address);
  return {
    ok: true,
    address: firstRecord.address,
    family: firstAddress?.family || firstRecord.family
  };
}

function localOrLiteralHostCheck(hostname) {
  const host = normalizeHostname(hostname);
  if (!host) {
    return { ok: false, error: "Remote fetch blocked empty host." };
  }
  if (host.includes("%")) {
    return { ok: false, error: `Remote fetch blocked scoped local address: ${hostname}` };
  }
  if (host === "localhost" || host.endsWith(".localhost")) {
    return { ok: false, error: `Remote fetch blocked private or local host: ${hostname}` };
  }

  const literalVersion = net.isIP(host);
  if (!literalVersion) {
    return null;
  }
  return isBlockedIpAddress(host)
    ? { ok: false, error: `Remote fetch blocked private or link-local address: ${hostname}` }
    : { ok: true, address: host, family: literalVersion };
}

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function isBlockedIpAddress(address) {
  const parsed = parseIpAddress(address);
  if (!parsed) {
    return true;
  }
  if (parsed.family === 4) {
    return isBlockedIpv4Bytes(parsed.bytes);
  }
  return isBlockedIpv6Bytes(parsed.bytes);
}

function parseIpAddress(address) {
  const host = normalizeHostname(address);
  const family = net.isIP(host);
  if (family === 4) {
    return { family, bytes: parseIpv4Bytes(host) };
  }
  if (family === 6) {
    return { family, bytes: parseIpv6Bytes(host) };
  }
  return null;
}

function parseIpv4Bytes(address) {
  const parts = String(address).split(".");
  if (parts.length !== 4) {
    return null;
  }
  const bytes = parts.map((part) => (/^\d+$/.test(part) ? Number(part) : Number.NaN));
  if (bytes.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return Buffer.from(bytes);
}

function parseIpv6Bytes(address) {
  const value = String(address).toLowerCase();
  if (value.includes("%")) {
    return null;
  }
  const compressedParts = value.split("::");
  if (compressedParts.length > 2) {
    return null;
  }
  const head = parseIpv6Hextets(compressedParts[0]);
  const tail = compressedParts.length === 2 ? parseIpv6Hextets(compressedParts[1]) : [];
  if (!head || !tail) {
    return null;
  }
  const missing = 8 - head.length - tail.length;
  if ((compressedParts.length === 1 && missing !== 0) || (compressedParts.length === 2 && missing < 1)) {
    return null;
  }
  const hextets = [...head, ...Array(missing).fill(0), ...tail];
  if (hextets.length !== 8) {
    return null;
  }
  const bytes = Buffer.alloc(16);
  hextets.forEach((hextet, index) => bytes.writeUInt16BE(hextet, index * 2));
  return bytes;
}

function parseIpv6Hextets(part) {
  if (!part) {
    return [];
  }
  const segments = part.split(":");
  const hextets = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment.includes(".")) {
      if (index !== segments.length - 1) {
        return null;
      }
      const ipv4 = parseIpv4Bytes(segment);
      if (!ipv4) {
        return null;
      }
      hextets.push((ipv4[0] << 8) | ipv4[1], (ipv4[2] << 8) | ipv4[3]);
      continue;
    }
    if (!/^[0-9a-f]{1,4}$/i.test(segment)) {
      return null;
    }
    hextets.push(Number.parseInt(segment, 16));
  }
  return hextets;
}

function isBlockedIpv4Bytes(bytes) {
  if (!bytes || bytes.length !== 4) {
    return true;
  }
  return BLOCKED_IPV4_RANGES.some((range) => bytesMatchCidr(bytes, range.bytes, range.prefix));
}

function isBlockedIpv6Bytes(bytes) {
  if (!bytes || bytes.length !== 16) {
    return true;
  }
  const embeddedIpv4 = embeddedIpv4Bytes(bytes);
  if (embeddedIpv4 && isBlockedIpv4Bytes(embeddedIpv4)) {
    return true;
  }
  return BLOCKED_IPV6_RANGES.some((range) => bytesMatchCidr(bytes, range.bytes, range.prefix));
}

function embeddedIpv4Bytes(bytes) {
  if (bytes.subarray(0, 10).every((byte) => byte === 0) && bytes[10] === 0xff && bytes[11] === 0xff) {
    return bytes.subarray(12, 16);
  }
  if (bytes.subarray(0, 12).every((byte) => byte === 0)) {
    return bytes.subarray(12, 16);
  }
  if (bytesMatchCidr(bytes, parseIpv6Bytes("64:ff9b::"), 96)) {
    return bytes.subarray(12, 16);
  }
  if (bytesMatchCidr(bytes, parseIpv6Bytes("2002::"), 16)) {
    return bytes.subarray(2, 6);
  }
  if (bytesMatchCidr(bytes, parseIpv6Bytes("2001::"), 32)) {
    return Buffer.from(bytes.subarray(12, 16).map((byte) => byte ^ 0xff));
  }
  return null;
}

function bytesMatchCidr(bytes, rangeBytes, prefixLength) {
  if (!bytes || !rangeBytes || bytes.length !== rangeBytes.length) {
    return false;
  }
  const wholeBytes = Math.floor(prefixLength / 8);
  for (let index = 0; index < wholeBytes; index += 1) {
    if (bytes[index] !== rangeBytes[index]) {
      return false;
    }
  }
  const remainingBits = prefixLength % 8;
  if (remainingBits === 0) {
    return true;
  }
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (bytes[wholeBytes] & mask) === (rangeBytes[wholeBytes] & mask);
}
