import { useEffect, useState } from "react";
import { api } from "../api.ts";
import type { Settings } from "../api.ts";
import { useSession } from "../App.tsx";

/** Install-wide branding. Stored in the database so one image serves any
 *  pool; the PWA manifest and icon are generated from these values. */
export function SettingsAdmin() {
  const { settings, reloadSettings } = useSession();
  const [s, setS] = useState<Settings>(settings);
  const [saved, setSaved] = useState(false);
  useEffect(() => setS(settings), [settings]);

  const save = async () => {
    await api.put("/admin/settings", s);
    await reloadSettings();
    setSaved(true);
  };
  const field = (k: keyof Settings) => ({
    value: s[k],
    onChange: (e: { target: { value: string } }) => {
      setSaved(false);
      setS({ ...s, [k]: e.target.value });
    },
  });

  return (
    <div className="card stack form">
      <label>App name<input {...field("appName")} /></label>
      <label>Short name <span className="muted small">(under the home-screen icon)</span><input {...field("shortName")} /></label>
      <label>Sign-in message<input {...field("welcome")} /></label>
      <label className="row">
        Accent color <input type="color" {...field("accentColor")} />
      </label>
      <label>
        Icon URL <span className="muted small">(optional square PNG, 512px; blank uses a generated letter icon)</span>
        <input {...field("iconUrl")} placeholder="https://…/icon.png" />
      </label>
      <div className="row">
        <button onClick={save}>Save</button>
        {saved && <span className="muted">Saved. Installed apps pick this up next launch.</span>}
      </div>
    </div>
  );
}
