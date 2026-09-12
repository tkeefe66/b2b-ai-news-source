import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const external = vi.hoisted(() => ({token:vi.fn(),verify:vi.fn(),authorize:vi.fn(),storeOptions:vi.fn()}));
vi.mock("googleapis", () => ({google:{auth:{OAuth2:class {
  getToken = external.token; verifyIdToken = external.verify; generateAuthUrl = external.authorize;
}}}}));
vi.mock("connect-pg-simple", () => ({default:() => class { constructor(options:unknown){external.storeOptions(options);} on(){} }}));
// Session persistence has its own runtime verification gate. These tests exercise the
// actual registered handlers with synthetic session lifecycle and external OAuth I/O.
vi.mock("express-session", () => ({default:() => (_req:unknown,_res:unknown,next:()=>void) => next()}));
import { installAuth } from "./auth";

beforeEach(() => {
  vi.stubEnv("AUTH_GOOGLE_CLIENT_ID","test-client"); vi.stubEnv("AUTH_GOOGLE_CLIENT_SECRET","test-secret");
  vi.stubEnv("SESSION_SECRET","s".repeat(48)); vi.stubEnv("APP_BASE_URL","https://workspace.example");
  vi.stubEnv("ALLOWED_EMAILS","owner@example.com");
  external.token.mockReset().mockResolvedValue({tokens:{id_token:"synthetic-id-token"}});
  external.verify.mockReset().mockResolvedValue({getPayload:() => ({email:"owner@example.com",email_verified:true,sub:"subject",nonce:"nonce"})});
  external.authorize.mockReset().mockReturnValue("https://accounts.google.com/synthetic");
});
afterEach(() => vi.unstubAllEnvs());
function fixture() {
  const routes = new Map<string,any[]>();
  const app:any = {use:vi.fn(),get:(path:string,...handlers:any[])=>routes.set(path,handlers),post:(path:string,...handlers:any[])=>routes.set(path,handlers)};
  installAuth(app,{} as any);
  const lifecycle:string[] = [];
  const req:any = {ip:"synthetic-client",query:{state:"state",code:"code"},session:{oauth:{state:"state",nonce:"nonce",verifier:"verifier",createdAt:Date.now()},save:(cb:any)=>{lifecycle.push("save");cb();},regenerate:(cb:any)=>{lifecycle.push("regenerate");delete req.session.identity;cb();},cookie:{}}};
  const res:any = {status:vi.fn().mockReturnThis(),send:vi.fn(),json:vi.fn(),redirect:vi.fn(),setHeader:vi.fn()};
  return {routes,req,res,lifecycle};
}
describe("registered OAuth callback", () => {
  it("consumes browser state, exchanges PKCE code, verifies audience and regenerates session", async () => {
    // Mutation: skip state consumption or session regeneration, or omit PKCE/audience.
    const {routes,req,res,lifecycle} = fixture();
    await routes.get("/api/auth/google/callback")![0](req,res);
    expect(req.session.oauth).toBeUndefined();
    expect(external.token).toHaveBeenCalledWith({code:"code",codeVerifier:"verifier"});
    expect(external.verify).toHaveBeenCalledWith({idToken:"synthetic-id-token",audience:"test-client"});
    expect(lifecycle).toEqual(["save","regenerate","save"]);
    expect(req.session.identity).toMatchObject({email:"owner@example.com",sub:"subject"});
    expect(res.redirect).toHaveBeenCalledWith("/");
  });
  it("rejects forged callback before contacting Google", async () => {
    // Mutation: exchange a token before checking browser state.
    const {routes,req,res} = fixture(); req.query.state = "forged";
    await routes.get("/api/auth/google/callback")![0](req,res);
    expect(external.token).not.toHaveBeenCalled(); expect(req.session.identity).toBeUndefined();
    expect(res.status).toHaveBeenCalledWith(403);
  });
  it("fails closed when signature validation fails", async () => {
    // Mutation: authenticate the unverified payload after verifier rejects.
    external.verify.mockRejectedValue(new Error("synthetic signature failure"));
    const {routes,req,res} = fixture();
    await routes.get("/api/auth/google/callback")![0](req,res);
    expect(req.session.identity).toBeUndefined(); expect(res.status).toHaveBeenCalledWith(403);
  });
  it("does not redirect to workspace if session persistence fails", async () => {
    // Mutation: return successful login before server-side session save completes.
    const {routes,req,res} = fixture();
    req.session.save = (cb:any) => cb(new Error("synthetic store failure"));
    await routes.get("/api/auth/google/callback")![0](req,res);
    expect(res.redirect).not.toHaveBeenCalled(); expect(res.status).toHaveBeenCalledWith(403);
  });
});
