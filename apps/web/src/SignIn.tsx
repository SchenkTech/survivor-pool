import { useState } from "react";
import { api } from "./api.ts";
import { useSession } from "./App.tsx";
import { useApi } from "./hooks.ts";

const ERRORS: Record<string, string> = {
  not_invited: "That Google account hasn't been invited. Ask the pool admin to add your email.",
  expired: "Sign-in took too long. Try again.",
  cancelled: "Sign-in was cancelled.",
  google: "Google sign-in failed. Try again.",
};

export function SignIn() {
  const { settings } = useSession();
  const providers = useApi<{ google: boolean; dev: boolean }>("/auth/providers");
  const params = new URLSearchParams(window.location.search);
  const error = params.get("error");
  const returnTo = params.get("returnTo") ?? "/";
  const [devEmail, setDevEmail] = useState("");
  const [devError, setDevError] = useState<string | null>(null);

  const devSignIn = async () => {
    try {
      await api.post("/auth/dev", { email: devEmail });
      window.location.href = returnTo;
    } catch (e) {
      setDevError((e as Error).message);
    }
  };

  return (
    <div className="signin">
      <img className="signin-icon" src={settings.iconUrl || "/icon.svg"} alt="" />
      <h1>{settings.appName}</h1>
      <p className="muted">{settings.welcome}</p>
      {error && <p className="error">{ERRORS[error] ?? "Sign-in failed."}</p>}

      {providers.data?.google && (
        <a className="button google" href={`/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`}>
          <GoogleG /> Sign in with Google
        </a>
      )}
      {providers.data && !providers.data.google && !providers.data.dev && (
        <p className="error">Sign-in isn't configured on this server yet (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET).</p>
      )}

      {providers.data?.dev && (
        <div className="dev-login">
          <p className="muted small">Development sign-in (DEV_LOGIN=true)</p>
          <div className="row">
            <input type="email" placeholder="invited@email" value={devEmail} onChange={(e) => setDevEmail(e.target.value)} />
            <button onClick={devSignIn}>Sign in</button>
          </div>
          {devError && <p className="error">{devError}</p>}
        </div>
      )}
      <p className="muted small">Invite only. Your admin adds your email first.</p>
    </div>
  );
}

function GoogleG() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
