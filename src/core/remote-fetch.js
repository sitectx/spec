export async function fetchText(url, options = {}) {
  const timeout = Number(options.timeout || 10000);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow"
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      url: response.url,
      contentType: response.headers.get("content-type") || "",
      body
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url,
      contentType: "",
      body: "",
      error: error instanceof Error ? error.message : "Request failed."
    };
  } finally {
    clearTimeout(timer);
  }
}
