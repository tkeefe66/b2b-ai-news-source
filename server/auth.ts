import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Express, Request, RequestHandler } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import type { Pool } from "pg";
import { google } from "googleapis";

export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;
const OAUTH_LIFETIME_MS = 10 * 60 * 1000;

export interface AuthConfig {
  clientId: string; clientSecret: string; sessionSecret: string;
  origin: string; allowedEmails: Set<string>; secure: boolean;
}
interface Identity { email: string; sub: string; createdAt: number }
declare module "express-session" {
  interface SessionData {
    identity?: Identity;
    oauth?: { state: string; nonce: string; verifier: string; createdAt: number };
  }
}
declare global {
  namespace Express { interface Request { auth?: { email: string; sub: string } } }
}

export function readAuthConfig(env: Record<string, string | undefined> = process.env): AuthConfig | null {
  const { AUTH_GOOGLE_CLIENT_ID: clientId, AUTH_GOOGLE_CLIENT_SECRET: clientSecret, SESSION_SECRET: sessionSecret, APP_BASE_URL: baseUrl } = env;
  const emails = (env.ALLOWED_EMAILS ?? "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!clientId || !clientSecret || !sessionSecret || sessionSecret.length < 32 || !baseUrl || !emails.length || emails.some(email => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return null;
  try {
    const url = new URL(baseUrl);
    const secure = url.protocol === "https:";
    const localDev = env.NODE_ENV !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname);
    if ((!secure && !localDev) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return null;
    return { clientId, clientSecret, sessionSecret, origin:url.origin, allowedEmails:new Set(emails), secure };
  } catch { return null; }
}

function validIdentity(req: Request, config: AuthConfig): Identity | undefined {
  const identity = req.session?.identity;
  if (!identity || typeof identity.email !== "string" || !identity.sub || !Number.isFinite(identity.createdAt) || identity.createdAt > Date.now() || Date.now() - identity.createdAt >= SESSION_LIFETIME_MS || !config.allowedEmails.has(identity.email)) return undefined;
  return identity;
}

export function createAccessGuard(config: AuthConfig | null): RequestHandler {
  return (req, res, next) => {
    if (!config) { res.status(503).json({error:"Sign-in is not configured. Contact the workspace administrator."}); return; }
    const identity = validIdentity(req, config);
    if (!identity) {
      if (req.session?.identity) req.session.destroy(() => {});
      res.status(401).json({error:"Sign in to access this workspace."}); return;
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && req.headers.origin !== config.origin) {
      res.status(403).json({error:"Request origin was not accepted. Reload the workspace and try again."}); return;
    }
    req.auth = {email:identity.email,sub:identity.sub};
    next();
  };
}

export function validateGoogleIdentity(payload: {email?: string; email_verified?: boolean; nonce?: string; sub?: string} | undefined, expectedNonce: string, config: AuthConfig): {email:string;sub:string} {
  const email = payload?.email?.toLowerCase();
  if (!payload || !email || payload.email_verified !== true || !payload.sub || payload.nonce !== expectedNonce || !config.allowedEmails.has(email)) throw new Error("Google account is not authorized for this workspace");
  return {email,sub:payload.sub};
}

function sessionSave(req: Request): Promise<void> { return new Promise((resolve,reject) => req.session.save(error => error ? reject(error) : resolve())); }
function sessionRegenerate(req: Request): Promise<void> { return new Promise((resolve,reject) => req.session.regenerate(error => error ? reject(error) : resolve())); }
function matchingState(actual: unknown, expected: string): boolean {
  return typeof actual === "string" && actual.length === expected.length && timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}

export function validateOAuthAttempt(pending: session.SessionData["oauth"], state: unknown, code: unknown): NonNullable<session.SessionData["oauth"]> {
  if (!pending || !matchingState(state,pending.state) || !Number.isFinite(pending.createdAt) || pending.createdAt > Date.now() || Date.now()-pending.createdAt >= OAUTH_LIFETIME_MS || typeof code !== "string" || !code) throw new Error("Invalid OAuth callback");
  return pending;
}

/** Mount before business routes. All approved accounts share this trusted admin workspace.
 * Requires the modeled auth_sessions table; this module never creates schema at runtime.
 */
export function installAuth(app: Express, pool: Pool): RequestHandler {
  const config = readAuthConfig();
  const guard = createAccessGuard(config);
  app.use("/api/auth", (_req,res,next) => { res.setHeader("Cache-Control","no-store"); next(); });
  if (!config) {
    console.error("[auth] Sign-in disabled: required authentication configuration is missing or invalid");
    app.get("/api/auth/session", (_req,res) => { res.json({authenticated:false,configured:false}); });
    app.use("/api/auth", guard);
    return guard;
  }
  const cookieName = config.secure ? "__Host-b2b.sid" : "b2b.sid";
  const PgStore = connectPgSimple(session);
  const store = new PgStore({pool, tableName:"auth_sessions",createTableIfMissing:false});
  store.on("error", () => console.error("[auth] Session store operation failed"));
  app.use(session({
    name:cookieName,secret:config.sessionSecret,store,resave:false,saveUninitialized:false,
    cookie:{httpOnly:true,secure:config.secure,sameSite:"lax",path:"/",maxAge:SESSION_LIFETIME_MS},
  }));
  app.get("/api/auth/session", (req,res) => {
    const identity = validIdentity(req,config);
    res.json(identity ? {authenticated:true,configured:true,email:identity.email} : {authenticated:false,configured:true});
  });

  // Per-process login throttle matches the documented single-replica deployment.
  // If scaled, move this claim into shared storage before increasing replica count.
  const starts = new Map<string,{count:number;until:number}>();
  app.get("/api/auth/google", async (req,res) => {
    const now = Date.now();
    for (const [ip,bucket] of Array.from(starts.entries())) if (bucket.until <= now) starts.delete(ip);
    const key = req.ip ?? "unknown";
    const bucket = starts.get(key) ?? {count:0,until:now + OAUTH_LIFETIME_MS};
    if (bucket.count >= 10 || (!starts.has(key) && starts.size >= 5000)) { res.setHeader("Retry-After","600"); res.status(429).json({error:"Too many sign-in attempts. Try again in ten minutes."}); return; }
    bucket.count++; starts.set(key,bucket);
    try {
      const oauth = new google.auth.OAuth2(config.clientId,config.clientSecret,`${config.origin}/api/auth/google/callback`);
      const state = randomBytes(32).toString("base64url");
      const nonce = randomBytes(32).toString("base64url");
      const verifier = randomBytes(32).toString("base64url");
      req.session.oauth = {state,nonce,verifier,createdAt:Date.now()};
      await sessionSave(req);
      res.redirect(oauth.generateAuthUrl({scope:["openid","email"],state,nonce,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256" as any,prompt:"select_account"}));
    } catch { console.error("[auth] Could not start sign-in"); res.status(503).json({error:"Could not start sign-in. Try again later."}); }
  });
  app.get("/api/auth/google/callback", async (req,res) => {
    try {
      const pending = req.session.oauth;
      delete req.session.oauth;
      await sessionSave(req);
      const attempt = validateOAuthAttempt(pending,req.query.state,req.query.code);
      const oauth = new google.auth.OAuth2(config.clientId,config.clientSecret,`${config.origin}/api/auth/google/callback`);
      const {tokens} = await oauth.getToken({code:req.query.code as string,codeVerifier:attempt.verifier});
      if (!tokens.id_token) throw new Error("Missing identity token");
      const ticket = await oauth.verifyIdToken({idToken:tokens.id_token,audience:config.clientId});
      const actor = validateGoogleIdentity(ticket.getPayload(),attempt.nonce,config);
      await sessionRegenerate(req);
      req.session.identity = {...actor,createdAt:Date.now()};
      req.session.cookie.maxAge = SESSION_LIFETIME_MS;
      await sessionSave(req);
      console.log("[auth] Workspace sign-in succeeded");
      res.redirect("/");
    } catch { console.warn("[auth] Workspace sign-in rejected"); res.status(403).send("Sign-in was not accepted. Use an approved Google account and start again from the workspace."); }
  });
  app.post("/api/auth/logout",guard,(req,res) => {
    req.session.destroy(error => {
      if (error) { console.error("[auth] Logout could not remove session"); res.status(503).json({error:"Logout failed. Try again."}); return; }
      res.clearCookie(cookieName,{httpOnly:true,secure:config.secure,sameSite:"lax",path:"/"});
      res.status(204).end();
    });
  });
  return guard;
}
