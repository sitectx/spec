import http from "node:http";
import https from "node:https";
import dns from "node:dns/promises";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createRemoteFetchPolicy, fetchText, fetchWithPinnedLookup, validateRemoteFetchUrl } from "../src/core/remote-fetch.js";
import { closeServer, listenLocalhost, localServerOrigin } from "./helpers.js";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("remote fetch policy", () => {
  it("blocks private and non-HTTPS URLs unless their origin is allowlisted", async () => {
    const privatePolicy = createRemoteFetchPolicy("https://127.0.0.1");
    await expect(validateRemoteFetchUrl("https://127.0.0.1/.well-known/sitectx", privatePolicy)).resolves.toMatchObject({
      ok: false
    });

    const httpPolicy = createRemoteFetchPolicy("http://example.com");
    await expect(validateRemoteFetchUrl("http://example.com/.well-known/sitectx", httpPolicy)).resolves.toMatchObject({
      ok: false
    });

    const allowlistedPolicy = createRemoteFetchPolicy("http://127.0.0.1:3000", {
      allowRemoteOrigin: "http://127.0.0.1:3000"
    });
    await expect(validateRemoteFetchUrl("http://127.0.0.1:3000/.well-known/sitectx", allowlistedPolicy)).resolves.toMatchObject({
      ok: true,
      allowlisted: true
    });
  });

  it("blocks IPv4-mapped and special IPv6 literal addresses", async () => {
    const blockedUrls = [
      "https://[::ffff:7f00:1]/.well-known/sitectx",
      "https://[::7f00:1]/.well-known/sitectx",
      "https://[64:ff9b::7f00:1]/.well-known/sitectx",
      "https://[2002:7f00:1::]/.well-known/sitectx",
      "https://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/.well-known/sitectx",
      "https://[fc00::1]/.well-known/sitectx",
      "https://[fe80::1]/.well-known/sitectx",
      "https://[fec0::1]/.well-known/sitectx",
      "https://[ff02::1]/.well-known/sitectx"
    ];

    for (const url of blockedUrls) {
      await expect(validateRemoteFetchUrl(url, createRemoteFetchPolicy(new URL(url).origin))).resolves.toMatchObject({
        ok: false
      });
    }

    const publicIpv6Url = "https://[2606:4700:4700::1111]/.well-known/sitectx";
    await expect(validateRemoteFetchUrl(publicIpv6Url, createRemoteFetchPolicy(new URL(publicIpv6Url).origin))).resolves.toMatchObject({
      ok: true
    });
  });

  it("pins the validated DNS address for the request connection", async () => {
    const validatedAddress = "93.184.216.34";
    let lookupResult = null;
    const dnsLookup = vi.spyOn(dns, "lookup").mockResolvedValue([{ address: validatedAddress, family: 4 }]);
    const requestSpy = vi.spyOn(https, "request").mockImplementation((options, onResponse) => {
      const request = {
        on: vi.fn(() => request),
        end: vi.fn(() => {
          options.lookup("example.com", {}, (error, address, family) => {
            lookupResult = { error, address, family };
            const response = Readable.from(["ok"]);
            response.statusCode = 200;
            response.headers = { "content-type": "text/plain" };
            onResponse(response);
          });
        })
      };
      return request;
    });

    const response = await fetchText("https://example.com/.well-known/sitectx", {
      policy: createRemoteFetchPolicy("https://example.com")
    });

    expect(response.ok).toBe(true);
    expect(response.body).toBe("ok");
    expect(dnsLookup).toHaveBeenCalledWith("example.com", { all: true, verbatim: true });
    expect(requestSpy).toHaveBeenCalledOnce();
    expect(requestSpy.mock.calls[0][0]).toMatchObject({
      hostname: "example.com",
      servername: "example.com",
      headers: expect.objectContaining({
        "user-agent": expect.stringContaining("SiteCTX")
      })
    });
    expect(lookupResult).toEqual({ error: null, address: validatedAddress, family: 4 });
  });

  it("identifies pinned requests with a User-Agent", async () => {
    const site = await startRoutes({
      "/": (request, response) => {
        const userAgent = request.headers["user-agent"] || "";
        response.statusCode = userAgent.includes("SiteCTX") ? 200 : 403;
        response.end(userAgent);
      }
    });
    try {
      const response = await fetchWithPinnedLookup(site.origin, {
        address: "127.0.0.1",
        family: 4
      });

      expect(response.status).toBe(200);
    } finally {
      await site.close();
    }
  });

  it("follows same-origin redirects manually", async () => {
    const site = await startRoutes({
      "/redirect": (_request, response) => {
        response.writeHead(302, { location: "/final" });
        response.end();
      },
      "/final": (_request, response) => {
        response.setHeader("content-type", "text/plain");
        response.end("ok");
      }
    });
    try {
      const response = await fetchText(`${site.origin}/redirect`, {
        policy: createRemoteFetchPolicy(site.origin, { allowRemoteOrigin: site.origin })
      });

      expect(response.ok).toBe(true);
      expect(response.url).toBe(`${site.origin}/final`);
      expect(response.body).toBe("ok");
    } finally {
      await site.close();
    }
  });

  it("blocks redirects to non-allowlisted origins before fetching them", async () => {
    let blockedHits = 0;
    const blocked = await startRoutes({
      "/secret": (_request, response) => {
        blockedHits += 1;
        response.end("secret");
      }
    });
    const site = await startRoutes({
      "/redirect": (_request, response) => {
        response.writeHead(302, { location: `${blocked.origin}/secret` });
        response.end();
      }
    });
    try {
      const response = await fetchText(`${site.origin}/redirect`, {
        policy: createRemoteFetchPolicy(site.origin, { allowRemoteOrigin: site.origin })
      });

      expect(response.ok).toBe(false);
      expect(response.error).toContain("Remote fetch blocked off-origin URL");
      expect(blockedHits).toBe(0);
    } finally {
      await site.close();
      await blocked.close();
    }
  });

  it("rejects responses over the byte limit before buffering", async () => {
    const site = await startRoutes({
      "/content-length-too-large": (_request, response) => {
        response.writeHead(200, {
          "content-length": "1024",
          "content-type": "text/plain"
        });
        response.end("small");
      },
      "/stream-too-large": (_request, response) => {
        response.writeHead(200, { "content-type": "text/plain" });
        response.write("12345");
        response.write("67890");
        response.write("abcde");
        response.end();
      }
    });
    try {
      const policy = createRemoteFetchPolicy(site.origin, { allowRemoteOrigin: site.origin });

      const contentLengthResponse = await fetchText(`${site.origin}/content-length-too-large`, {
        maxBytes: 10,
        policy
      });
      expect(contentLengthResponse.ok).toBe(false);
      expect(contentLengthResponse.error).toContain("exceeded 10 bytes");
      expect(contentLengthResponse.body).toBe("");

      const streamedResponse = await fetchText(`${site.origin}/stream-too-large`, {
        maxBytes: 10,
        policy
      });
      expect(streamedResponse.ok).toBe(false);
      expect(streamedResponse.error).toContain("exceeded 10 bytes");
      expect(streamedResponse.body).toBe("");
    } finally {
      await site.close();
    }
  });
});

async function startRoutes(routes) {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const handler = routes[pathname];
    if (handler) {
      handler(request, response);
      return;
    }
    response.statusCode = 404;
    response.end("not found");
  });
  await listenLocalhost(server);
  const origin = localServerOrigin(server);
  return {
    origin,
    close: () => closeServer(server)
  };
}
