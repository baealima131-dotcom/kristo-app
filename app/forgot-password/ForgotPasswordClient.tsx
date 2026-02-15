"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

export default function ForgotPasswordClient() {
  const sp = useSearchParams();
  const next = useMemo(() => sp.get("next") || "/dashboard", [sp]);

  const [identifier, setIdentifier] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [okMsg, setOkMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setOkMsg("");

    if (!identifier.trim()) {
      setErr("Weka email yako.");
      return;
    }

    // TODO: connect to custom API when ready:
    // POST /api/auth/forgot-password { email }
    setSaving(true);
    await new Promise((r) => setTimeout(r, 500));
    setSaving(false);

    setOkMsg("Kwa sasa password reset iko kwenye matengenezo. Tafadhali jaribu tena baadaye.");
  }

  return (
    <main className="vip-auth">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <div className="vip-wrap">
        <div className="vip-head">
          <div>
            <div className="vip-kicker">Kristo App</div>
            <h1 className="vip-title">Recover account</h1>
            <p className="vip-subtitle">Ukitumia email yako, tunaweza kukusaidia kurudisha account. (Custom reset: inakuja)</p>
          </div>

          <Link className="vip-link" href={`/login?next=${encodeURIComponent(next)}`}>
            ← <span>Back to login</span>
          </Link>
        </div>

        <div className="vip-card">
          {err ? (
            <div className="vip-alert">
              <div className="vip-alert-title">Kuna tatizo</div>
              <div className="vip-alert-body">{err}</div>
            </div>
          ) : null}

          {okMsg ? (
            <div
              className="vip-alert"
              style={{
                borderColor: "rgba(120,255,160,0.22)",
                background: "rgba(120,255,160,0.08)",
              }}
            >
              <div className="vip-alert-title">Sawa</div>
              <div className="vip-alert-body">{okMsg}</div>
            </div>
          ) : null}

          <form onSubmit={onSubmit} className="vip-form">
            <label className="vip-label">Email</label>
            <input
              className="vip-input"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              inputMode="email"
            />

            <button className={cn("vip-btn", saving && "is-loading")} disabled={saving}>
              {saving ? "Sending..." : "Send code"}
            </button>

            <div className="vip-foot">
              <span className="vip-dim">Tip: kama hujui email, utahitaji msaada wa admin wa app.</span>
            </div>
          </form>
        </div>
      </div>
    </main>
  );
}
