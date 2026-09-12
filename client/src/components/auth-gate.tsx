import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { queryClient } from "@/lib/queryClient";

type AuthState = {authenticated:boolean;configured:boolean;email?:string};

/** No workspace child mounts or data queries start until the server confirms identity. */
export function AuthGate({children}:{children:ReactNode}) {
  const [auth,setAuth] = useState<AuthState | null>(null);
  const [error,setError] = useState("");
  const [loggingOut,setLoggingOut] = useState(false);
  const previousEmail = useRef<string | undefined>(undefined);
  const check = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/session",{credentials:"include",cache:"no-store"});
      if (!response.ok) throw new Error("Sign-in status is unavailable. Try again.");
      const next:AuthState = await response.json();
      if (!next.authenticated || previousEmail.current !== next.email) queryClient.clear();
      previousEmail.current = next.email;
      setAuth(next); setError("");
    } catch {
      queryClient.clear(); setAuth(null);
      setError("Could not verify your sign-in. Check your connection and try again.");
    }
  },[]);
  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(),60_000);
    const refresh = () => void check();
    window.addEventListener("focus",refresh);
    window.addEventListener("auth-expired",refresh);
    return () => { window.clearInterval(timer); window.removeEventListener("focus",refresh); window.removeEventListener("auth-expired",refresh); };
  },[check]);
  const logout = async () => {
    setLoggingOut(true);
    try {
      const response = await fetch("/api/auth/logout",{method:"POST",credentials:"include"});
      if (!response.ok && response.status !== 401) throw new Error("Logout failed");
      queryClient.clear(); previousEmail.current = undefined;
      setAuth({authenticated:false,configured:true});
      // Remount all local form and document state after leaving the workspace.
      window.location.replace("/");
    } catch { setError("Could not sign out. Try again."); }
    finally { setLoggingOut(false); }
  };
  if (!auth?.authenticated) return (
    <main className="min-h-screen flex items-center justify-center bg-background text-foreground p-6">
      <section className="w-full max-w-sm space-y-4 rounded-xl border p-6">
        <h1 className="text-xl font-semibold">Workspace sign-in</h1>
        {error ? <><p role="alert" className="text-sm">{error}</p><button className="rounded-md border px-4 py-2" onClick={() => void check()}>Try again</button></>
          : !auth ? <p role="status" className="text-sm">Checking sign-in…</p>
          : !auth.configured ? <p className="text-sm">Sign-in is not configured yet. Contact the workspace administrator.</p>
          : <><p className="text-sm text-muted-foreground">Use your approved Google account to continue.</p><a className="inline-flex rounded-md bg-primary px-4 py-2 text-primary-foreground" href="/api/auth/google">Continue with Google</a></>}
      </section>
    </main>
  );
  return <>
    {children}
    <div className="fixed bottom-2 left-2 z-50 flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-md border bg-background px-2 py-1 text-xs shadow-sm">
      <span className="truncate max-w-40" title={auth.email}>{auth.email}</span>
      <button onClick={() => void logout()} disabled={loggingOut} className="shrink-0 underline">{loggingOut ? "Signing out…" : "Sign out"}</button>
      {error && <span role="alert">{error}</span>}
    </div>
  </>;
}
