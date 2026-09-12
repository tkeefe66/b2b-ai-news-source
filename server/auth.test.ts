import { describe, expect, it, vi } from "vitest";
import { readAuthConfig, createAccessGuard, validateGoogleIdentity, validateOAuthAttempt, SESSION_LIFETIME_MS } from "./auth";

const env = { AUTH_GOOGLE_CLIENT_ID:"synthetic-client", AUTH_GOOGLE_CLIENT_SECRET:"synthetic-secret", ALLOWED_EMAILS:"owner@example.com", APP_BASE_URL:"https://workspace.example", SESSION_SECRET:"a".repeat(48) };
function requestGuard(overrides: Record<string, unknown> = {}, method = "GET", origin?: string) {
  const req: any = {method, headers:{origin}, session:{identity:{email:"owner@example.com",sub:"test",createdAt:Date.now()},destroy:vi.fn(cb => cb())}, ...overrides};
  const res: any = {status:vi.fn().mockReturnThis(),json:vi.fn(),clearCookie:vi.fn()};
  const next = vi.fn();
  createAccessGuard(readAuthConfig(env)!)(req,res,next);
  return {req,res,next};
}
describe("authenticated workspace boundary", () => {
  it("rejects forged, expired and missing OAuth browser state", () => {
    // Mutation: exchange a code without matching the browser's stored state.
    const pending = {state:"browser-state",nonce:"nonce",verifier:"verifier",createdAt:Date.now()};
    expect(() => validateOAuthAttempt(pending,"attacker-state","code")).toThrow();
    expect(() => validateOAuthAttempt(undefined,"browser-state","code")).toThrow();
    expect(() => validateOAuthAttempt({...pending,createdAt:Date.now()-600_000},"browser-state","code")).toThrow();
    expect(validateOAuthAttempt(pending,"browser-state","code")).toBe(pending);
  });
  it("fails closed when authentication config is incomplete", () => {
    // Mutation: accept a missing allowlist or weak session secret.
    expect(readAuthConfig({...env,ALLOWED_EMAILS:""})).toBeNull();
    expect(readAuthConfig({...env,SESSION_SECRET:"weak"})).toBeNull();
    expect(readAuthConfig({...env,APP_BASE_URL:"https://workspace.example/extra"})).toBeNull();
  });
  it("blocks anonymous requests before business handlers", () => {
    // Mutation: call next when identity is absent.
    const {res,next} = requestGuard({session:{}});
    expect(res.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
  });
  it("rejects sessions exactly at the absolute lifetime cap", () => {
    // Mutation: use > rather than >= for absolute expiration.
    vi.useFakeTimers(); vi.setSystemTime(2 * SESSION_LIFETIME_MS);
    const {res,next} = requestGuard({session:{identity:{email:"owner@example.com",sub:"test",createdAt:SESSION_LIFETIME_MS},destroy:vi.fn(cb=>cb())}});
    expect(res.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
  it("revokes access after email removed from allowlist", () => {
    // Mutation: rely only on allowlist check at login.
    const {res,next} = requestGuard({session:{identity:{email:"removed@example.com",sub:"test",createdAt:Date.now()},destroy:vi.fn(cb=>cb())}});
    expect(res.status).toHaveBeenCalledWith(401); expect(next).not.toHaveBeenCalled();
  });
  it.each([undefined,"https://evil.example","null"])("blocks unsafe request with origin %s", origin => {
    // Mutation: accept missing or cross-site Origin on unsafe methods.
    const {res,next} = requestGuard({},"POST",origin);
    expect(res.status).toHaveBeenCalledWith(403); expect(next).not.toHaveBeenCalled();
  });
  it("permits approved user same-origin writes and exposes actor identity", () => {
    // Mutation: fail to expose the authenticated actor for upload ownership.
    const {req,next} = requestGuard({},"POST",env.APP_BASE_URL);
    expect(next).toHaveBeenCalledOnce(); expect(req.auth.email).toBe("owner@example.com");
  });
  it.each([
    {email:"owner@example.com",email_verified:false,nonce:"expected",sub:"subject"},
    {email:"other@example.com",email_verified:true,nonce:"expected",sub:"subject"},
    {email:"owner@example.com",email_verified:true,nonce:"wrong",sub:"subject"},
  ])("rejects unauthorized Google identity %#", payload => {
    // Mutation: omit verified-email, email allowlist or nonce validation.
    expect(() => validateGoogleIdentity(payload,"expected",readAuthConfig(env)!)).toThrow();
  });
  it("accepts only verified allowlisted identity bound to nonce", () => {
    // Mutation: silently omit a stable subject from stored identity.
    expect(validateGoogleIdentity({email:"OWNER@example.com",email_verified:true,nonce:"expected",sub:"subject"},"expected",readAuthConfig(env)!)).toEqual({email:"owner@example.com",sub:"subject"});
  });
});
