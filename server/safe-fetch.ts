import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage, type ClientRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

export interface SafeFetchOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface SafeFetchResponse {
  ok: boolean;
  status: number;
  statusText: string;
  url: string;
  headers: Headers;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}

function publicAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    // Also denies IPv4-mapped/transition IPv6, multicast, local and reserved ranges.
    return parsed.range() === "unicast";
  } catch { return false; }
}

/** GET only. Validate every DNS answer and pin the selected address to the socket.
 * No pooled sockets, credentials, ambient proxies, or automatic redirects.
 * One deadline covers DNS, all redirects and streamed body consumption.
 */
export async function safeFetch(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const maxRedirects = options.maxRedirects ?? 5;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw new Error("Invalid outbound request limits");
  }
  let activeRequest: ClientRequest | undefined;
  let activeResponse: IncomingMessage | undefined;
  let expired = false;
  const timeoutError = new Error("Outbound request timed out; try again later");
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      expired = true;
      activeResponse?.destroy();
      activeRequest?.destroy();
      reject(timeoutError);
    }, timeoutMs);
  });
  const run = async (): Promise<SafeFetchResponse> => {
    let url = new URL(input);
    for (let redirects = 0; ; redirects++) {
      if (expired) throw timeoutError;
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
        throw new Error("Outbound URL must use HTTP(S) without credentials");
      }
      const hostname = url.hostname.replace(/^\[|\]$/g, "");
      const addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await lookup(hostname, { all: true, verbatim: true });
      if (expired) throw timeoutError;
      if (!addresses.length || addresses.some(a => !publicAddress(a.address))) {
        throw new Error("Outbound URL must resolve only to public IP addresses");
      }
      const address = addresses[0];
      const headers: Record<string, string> = {};
      // Caller headers are deliberately allowlisted; redirects never forward credentials.
      for (const [key, value] of Object.entries(options.headers ?? {})) {
        if (["accept", "user-agent", "accept-language"].includes(key.toLowerCase())) headers[key] = value;
      }
      headers["accept-encoding"] = "identity";
      const response = await new Promise<IncomingMessage>((resolve, reject) => {
        activeRequest = (url.protocol === "https:" ? httpsRequest : httpRequest)(url, {
          method: "GET", agent: false, headers,
          lookup: (_hostname, lookupOptions, callback) => {
            if (lookupOptions.all) callback(null, [address]);
            else callback(null, address.address, address.family);
          },
        }, resolve);
        activeRequest.on("error", reject);
        activeRequest.end();
      });
      activeResponse = response;
      if (expired) { response.destroy(); throw timeoutError; }
      const status = response.statusCode ?? 0;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.destroy();
        if (redirects >= maxRedirects) throw new Error("Outbound request exceeded redirect limit");
        url = new URL(response.headers.location, url);
        continue;
      }
      const length = Number(response.headers["content-length"]);
      if (Number.isFinite(length) && length > maxBytes) {
        response.destroy();
        throw new Error("Outbound response exceeded byte limit");
      }
      const encoding = response.headers["content-encoding"];
      if (encoding && encoding.toLowerCase() !== "identity") {
        response.destroy();
        throw new Error("Outbound server returned unsupported compressed content");
      }
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of response) {
        if (expired) throw timeoutError;
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        bytes += buffer.length;
        if (bytes > maxBytes) {
          response.destroy();
          throw new Error("Outbound response exceeded byte limit");
        }
        chunks.push(buffer);
      }
      const body = Buffer.concat(chunks);
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(response.headers)) {
        if (value !== undefined) responseHeaders.set(key, Array.isArray(value) ? value.join(", ") : value);
      }
      return {
        ok: status >= 200 && status < 300, status, statusText: response.statusMessage ?? "",
        url: url.href, headers: responseHeaders,
        text: async () => body.toString("utf8"),
        arrayBuffer: async () => Uint8Array.from(body).buffer,
      };
    }
  };
  try { return await Promise.race([run(), deadline]); }
  finally { clearTimeout(timer!); activeResponse?.destroy(); activeRequest?.destroy(); }
}
