import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";

const io = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock("node:dns/promises", () => ({ lookup: io.lookup }));
vi.mock("node:http", () => ({ request: io.request }));
vi.mock("node:https", () => ({ request: io.request }));
import { safeFetch } from "./safe-fetch";

function response(status = 200, chunks = ["hello"], headers: Record<string, string> = {}) {
  io.request.mockImplementationOnce((_url, options, callback) => {
    const req = new EventEmitter() as any;
    req.destroy = vi.fn((error) => { if (error) queueMicrotask(() => req.emit("error", error)); });
    req.end = () => queueMicrotask(() => {
      const res = Readable.from(chunks.map(s => Buffer.from(s))) as any;
      res.statusCode = status; res.statusMessage = "Test"; res.headers = headers;
      callback(res);
    });
    return req;
  });
}

beforeEach(() => {
  io.lookup.mockReset().mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
  io.request.mockReset();
});

describe("safeFetch network boundary", () => {
  it.each(["http://127.0.0.1", "http://2130706433", "http://[::1]", "http://[::ffff:127.0.0.1]", "http://[fc00::1]", "http://[fe80::1]", "http://[64:ff9b::a00:1]", "http://[2002:7f00:1::]", "http://169.254.169.254", "http://100.100.100.200", "http://198.18.0.1", "file:///etc/passwd", "https://user:password@example.com"])("rejects forbidden target %s before transport", async url => {
    await expect(safeFetch(url)).rejects.toThrow();
    expect(io.request).not.toHaveBeenCalled();
  });
  it("rejects DNS answers containing private addresses", async () => {
    io.lookup.mockResolvedValue([{address:"93.184.216.34",family:4},{address:"10.0.0.1",family:4}]);
    await expect(safeFetch("https://example.com")).rejects.toThrow(/public/i);
    expect(io.request).not.toHaveBeenCalled();
  });
  it("pins transport lookup to validated IP rather than resolving again", async () => {
    response();
    const result = await safeFetch("https://example.com/test");
    expect(await result.text()).toBe("hello");
    const options = io.request.mock.calls[0][1];
    const cb = vi.fn(); options.lookup("example.com", {}, cb);
    expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
    expect(options.agent).toBe(false);
    expect(io.lookup).toHaveBeenCalledTimes(1);
  });
  it("revalidates redirect destinations before contacting private hosts", async () => {
    response(302, [], {location:"http://127.0.0.1/admin"});
    await expect(safeFetch("https://example.com")).rejects.toThrow(/public/i);
    expect(io.request).toHaveBeenCalledTimes(1);
  });
  it("resolves redirected DNS independently and blocks a private answer", async () => {
    io.lookup.mockResolvedValueOnce([{address:"93.184.216.34",family:4}]).mockResolvedValueOnce([{address:"192.168.0.10",family:4}]);
    response(302, [], {location:"https://redirect.example/path"});
    await expect(safeFetch("https://example.com")).rejects.toThrow(/public/i);
    expect(io.request).toHaveBeenCalledTimes(1);
  });
  it("allows public IPv6 and pins all-address lookup requests", async () => {
    response();
    await safeFetch("https://[2606:4700:4700::1111]/");
    const cb = vi.fn();
    io.request.mock.calls[0][1].lookup("ignored", {all:true}, cb);
    expect(cb).toHaveBeenCalledWith(null, [{address:"2606:4700:4700::1111",family:6}]);
    expect(io.lookup).not.toHaveBeenCalled();
  });
  it("caps streamed bytes even without content-length", async () => {
    response(200, ["123", "456"]);
    await expect(safeFetch("https://example.com", {maxBytes:5})).rejects.toThrow(/byte/i);
  });
  it("rejects oversized declared bodies before consuming them", async () => {
    response(200, ["1"], {"content-length":"100"});
    await expect(safeFetch("https://example.com", {maxBytes:5})).rejects.toThrow(/byte/i);
  });
  it("limits redirect chains", async () => {
    response(302, [], {location:"/again"});
    await expect(safeFetch("https://example.com", {maxRedirects:0})).rejects.toThrow(/redirect/i);
  });
  it("enforces deadline while DNS hangs", async () => {
    io.lookup.mockImplementation(() => new Promise(() => {}));
    await expect(safeFetch("https://example.com", {timeoutMs:10})).rejects.toThrow(/timed out/i);
    expect(io.request).not.toHaveBeenCalled();
  });
  it("enforces deadline and cancels hung transport", async () => {
    const req = new EventEmitter() as any; req.end = vi.fn(); req.destroy = vi.fn();
    io.request.mockReturnValue(req);
    await expect(safeFetch("https://example.com", {timeoutMs:10})).rejects.toThrow(/timed out/i);
    expect(req.destroy).toHaveBeenCalled();
  });
  it("cancels a stalled body after headers arrive", async () => {
    const res = new Readable({read() {}}) as any;
    res.statusCode = 200; res.headers = {};
    const req = new EventEmitter() as any;
    req.destroy = vi.fn(); req.end = () => {};
    io.request.mockImplementation((_url, _options, cb) => { queueMicrotask(() => cb(res)); return req; });
    await expect(safeFetch("https://example.com", {timeoutMs:10})).rejects.toThrow(/timed out/i);
    expect(res.destroyed).toBe(true);
  });
});
