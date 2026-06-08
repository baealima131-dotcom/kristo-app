"use client";

import "@/lib/webSessionBootstrap";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  hasValidWebSession,
  inspectWebSessionStorage,
  persistWebSessionFromLogin,
  webAuthFetch,
} from "@/lib/webSession";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type IdentifierType = "email" | "phone";

export default function Page() {
  const router = useRouter();
  const sp = useSearchParams();
  const next = useMemo(() => sp.get("redirect_url") || sp.get("next") || "/dashboard", [sp]);

  const [checking, setChecking] = useState(true);

  const [step, setStep] = useState<"creds" | "otp">("creds");
  const [identifierType, setIdentifierType] = useState<IdentifierType>("email");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");

  const [showPw, setShowPw] = useState(false);

  const [challengeId, setChallengeId] = useState("");
  const [code, setCode] = useState("");

  const [saving, setSaving] = useState(false);
  const [resending, setResending] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  const [err, setErr] = useState("");
  const [hint, setHint] = useState("");

  // Countdown timer for resend (30s)
  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => {
      setCooldown((s) => (s <= 1 ? 0 : s - 1));
    }, 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  // Only auto-redirect when localStorage already has a valid header token session.
  // Cookie-only sessions are ignored — they fail on Vercel after instance rotation.
  useEffect(() => {
    let on = true;
    (async () => {
      if (!hasValidWebSession()) {
        console.log("KRISTO_WEB_SESSION_LOAD", {
          found: false,
          reason: "sign-in-auto-check-skipped-no-local-session",
        });
        if (on) setChecking(false);
        return;
      }

      try {
        const r = await webAuthFetch("/api/auth/me", { cache: "no-store" });
        const d = await r.json().catch(() => ({}));
        if (on && r.ok && d?.ok) {
          router.replace(next);
          return;
        }
      } catch {}
      if (on) setChecking(false);
    })();
    return () => {
      on = false;
    };
  }, [router, next]);

  async function startLogin(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setHint("");

    if (!identifier.trim()) return setErr(identifierType === "email" ? "Weka email." : "Weka phone number.");
    if (!password) return setErr("Weka password.");

    try {
      setSaving(true);

      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: "start",
          identifierType,
          identifier: identifier.trim(),
          password,
        }),
      });
      const d = await r.json().catch(() => ({}));

      if (!r.ok || d?.ok === false) {
        setErr(String(d?.error || "Imeshindikana. Jaribu tena."));
        return;
      }

      // Step2: password-only => ok true + cookie set
      if (d?.mode === "password") {
        const saved = persistWebSessionFromLogin(d);
        if (!saved) {
          setErr("Could not save web session. Check console for KRISTO_WEB_SESSION_SAVE_FAILED.");
          return;
        }
        console.log("KRISTO_WEB_SESSION_SAVE", {
          phase: "pre-redirect",
          storage: inspectWebSessionStorage(),
        });
        router.replace(next);
        return;
      }

      // Step3: OTP required
      setChallengeId(String(d.challengeId || ""));
      setStep("otp");
      setCode("");
      setCooldown(0);

      const sentTo = String(d.sentTo || "");
      const devCode = d.devCode ? String(d.devCode) : "";
      setHint(sentTo ? `Code imetumwa: ${sentTo}${devCode ? ` (DEV: ${devCode})` : ""}` : devCode ? `DEV code: ${devCode}` : "");
    } catch (e: any) {
      setErr(e?.message || "Imeshindikana. Jaribu tena.");
    } finally {
      setSaving(false);
    }
  }

  async function resendCode() {
    setErr("");
    setHint("");

    if (!challengeId) return setErr("Challenge haipo. Rudi nyuma uanze tena.");
    if (cooldown > 0) return;

    // Start local cooldown immediately to prevent spamming
    setCooldown(30);

    try {
      setResending(true);
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ step: "resend", challengeId }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.ok === false) {
        setErr(String(d?.error || "Imeshindikana. Jaribu tena."));
        return;
      }
      const sentTo = String(d.sentTo || "");
      const devCode = d.devCode ? String(d.devCode) : "";
      setHint(sentTo ? `Code imetumwa tena: ${sentTo}${devCode ? ` (DEV: ${devCode})` : ""}` : devCode ? `DEV code: ${devCode}` : "");
    } catch (e: any) {
      setErr(e?.message || "Imeshindikana. Jaribu tena.");
    } finally {
      setResending(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setErr("");

    if (!code.trim()) return setErr("Weka verification code.");

    try {
      setSaving(true);
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          step: "verify",
          challengeId,
          code: code.trim(),
        }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d?.ok === false) {
        setErr(String(d?.error || "Code imekataa. Jaribu tena."));
        return;
      }
      const saved = persistWebSessionFromLogin(d);
      if (!saved) {
        setErr("Could not save web session. Check console for KRISTO_WEB_SESSION_SAVE_FAILED.");
        return;
      }
      console.log("KRISTO_WEB_SESSION_SAVE", {
        phase: "pre-redirect",
        storage: inspectWebSessionStorage(),
      });
      router.replace(next);
    } catch (e: any) {
      setErr(e?.message || "Imeshindikana. Jaribu tena.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="vip-auth">
      <div className="vip-ambient" aria-hidden="true" />
      <div className="vip-grain" aria-hidden="true" />

      <div className="vip-wrap">
        <div className="vip-head vip-head-spaced">
          <div>
            <div className="vip-kicker">Kristo App</div>
            <h1 className="vip-title">Sign in</h1>
            <p className="vip-subtitle">Email/Phone + Password (na OTP baada ya 24h)</p>
          </div>

          <Link className="vip-link" href="/sign-up">
            New here? <span>Create account</span>
          </Link>
        </div>

        <div className="vip-card">
          {checking ? (
            <div className="vip-loading">
              <div className="vip-section-title">Checking session…</div>
              <div className="vip-dim">If you’re already signed in (≤ 12h), we’ll redirect you.</div>
            </div>
          ) : (
            <>
              {err ? (
                <div className="vip-alert">
                  <div className="vip-alert-title">Kuna tatizo</div>
                  <div className="vip-alert-body">{err}</div>
                </div>
              ) : null}

              {hint ? <div className="vip-toast">{hint}</div> : null}

              {step === "creds" ? (
                <form onSubmit={startLogin} className="vip-form">
                  <div className="vip-section">
                    <div className="vip-section-title">Account</div>

                    <div className="vip-tabs" role="tablist" aria-label="Choose sign-in method">
                      <button
                        type="button"
                        className={cn("vip-tab", identifierType === "email" && "is-active")}
                        onClick={() => setIdentifierType("email")}
                        role="tab"
                        aria-selected={identifierType === "email"}
                      >
                        Email
                      </button>
                      <button
                        type="button"
                        className={cn("vip-tab", identifierType === "phone" && "is-active")}
                        onClick={() => setIdentifierType("phone")}
                        role="tab"
                        aria-selected={identifierType === "phone"}
                      >
                        Phone
                      </button>
                      <div className={cn("vip-tab-pill", identifierType === "phone" && "is-right")} aria-hidden="true" />
                    </div>

                    <label className="vip-label">{identifierType === "email" ? "Email" : "Phone number"}</label>
                    <input
                      className="vip-input"
                      value={identifier}
                      onChange={(e) => setIdentifier(e.target.value)}
                      placeholder={identifierType === "email" ? "you@example.com" : "+15555550123"}
                      autoComplete={identifierType === "email" ? "email" : "tel"}
                      inputMode={identifierType === "email" ? "email" : "tel"}
                    />

                    <label className="vip-label mt">Password</label>
                    <div className="vip-password">
                      <input
                        className="vip-input vip-password-input"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Password"
                        type={showPw ? "text" : "password"}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="vip-eye"
                        onClick={() => setShowPw((v) => !v)}
                        aria-label={showPw ? "Hide password" : "Show password"}
                      >
                        {showPw ? "🙈" : "👁️"}
                      </button>
                    </div>

                    <div className="vip-row">
                      <Link className="vip-soft" href="/sign-in?reset=1">
                        Forgot password?
                      </Link>
                      <span className="vip-dim">Auto ≤ 12h • OTP &gt; 24h</span>
                    </div>
                  </div>

                  <button className={cn("vip-btn", saving && "is-loading")} disabled={saving}>
                    {saving ? "Continuing..." : "Continue"}
                  </button>

                  <div className="vip-foot">
                    <Link className="vip-soft" href="/">
                      ← Back home
                    </Link>
                    <span className="vip-dim">Welcome back</span>
                  </div>
                </form>
              ) : (
                <form onSubmit={verifyOtp} className="vip-form">
                  <div className="vip-section">
                    <div className="vip-section-title">Verification</div>

                    <div className="vip-otp-card">
                      <div className="vip-otp-top">
                        <div className="vip-otp-title">Enter code</div>
                        <button
                          type="button"
                          className="vip-otp-back"
                          onClick={() => {
                            setStep("creds");
                            setCode("");
                            setChallengeId("");
                            setHint("");
                            setCooldown(0);
                          }}
                        >
                          ← Back
                        </button>
                      </div>

                      <label className="vip-label">Verification code</label>
                      <input
                        className="vip-input vip-otp-input"
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="6 digits"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                      />

                      <div className="vip-otp-actions">
                        <button
                          type="button"
                          className={cn("vip-ghost", (resending || cooldown > 0) && "is-loading")}
                          onClick={resendCode}
                          disabled={resending || saving || cooldown > 0}
                        >
                          {resending ? "Resending..." : cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
                        </button>

                        <div className="vip-otp-note">Ukipokea code kwenye Email/Phone, weka hapa.</div>
                      </div>
                    </div>
                  </div>

                  <button className={cn("vip-btn", saving && "is-loading")} disabled={saving}>
                    {saving ? "Signing in..." : "Sign in"}
                  </button>

                  <div className="vip-foot">
                    <Link className="vip-soft" href="/">
                      ← Back home
                    </Link>
                    <span className="vip-dim">OTP verified</span>
                  </div>
                </form>
              )}
            </>
          )}
        </div>
      </div>

      <style jsx global>{`
        .vip-head-spaced { margin-bottom: 14px; }
        .vip-loading { display: grid; gap: 8px; }

        .vip-toast{
          margin-bottom: 10px;
          padding: 10px 12px;
          border-radius: 14px;
          border: 1px solid rgba(255,215,130,0.18);
          background: rgba(255,215,130,0.08);
          color: rgba(255,255,255,0.92);
          font-size: 13px;
          line-height: 1.25;
        }

        .vip-row{
          display:flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-top: 6px;
        }

        /* Password with eye */
        .vip-password{ position: relative; }
        .vip-password-input{ padding-right: 44px; }
        .vip-eye{
          position: absolute;
          top: 50%;
          right: 8px;
          transform: translateY(-50%);
          border: 1px solid rgba(255, 255, 255, 0.14);
          background: rgba(0, 0, 0, 0.20);
          color: rgba(255, 255, 255, 0.92);
          border-radius: 12px;
          width: 36px;
          height: 36px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        /* VIP reminder button */
        .vip-ghost{
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.18);
          color: rgba(255,255,255,0.90);
          border-radius: 12px;
          padding: 10px 12px;
          cursor: pointer;
          font-weight: 900;
          white-space: nowrap;
        }

        /* VIP Tabs (Email/Phone) */
        .vip-tabs{
          position: relative;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
          padding: 6px;
          border-radius: 16px;
          border: 1px solid rgba(255,255,255,0.12);
          background: rgba(0,0,0,0.18);
          overflow: hidden;
        }
        .vip-tab{
          position: relative;
          z-index: 2;
          border: 1px solid transparent;
          background: transparent;
          color: rgba(255,255,255,0.86);
          font-weight: 900;
          border-radius: 12px;
          padding: 10px 10px;
          cursor: pointer;
          min-height: 44px;
        }
        .vip-tab.is-active{ color: rgba(10,10,16,0.96); }
        .vip-tab-pill{
          position:absolute;
          inset: 6px;
          width: calc(50% - 4px);
          border-radius: 12px;
          background: rgba(255,215,130,0.92);
          box-shadow: 0 10px 30px rgba(0,0,0,0.35);
          transform: translateX(0);
          transition: transform .18s ease;
        }
        .vip-tab-pill.is-right{ transform: translateX(calc(100% + 8px)); }

        /* OTP card */
        .vip-otp-card{
          padding: 14px;
          border-radius: 16px;
          border: 1px dashed rgba(255,215,130,0.35);
          background: rgba(255,215,130,0.06);
          display: grid;
          gap: 10px;
        }
        .vip-otp-top{
          display:flex;
          align-items:center;
          justify-content: space-between;
          gap: 12px;
        }
        .vip-otp-title{ font-weight: 900; letter-spacing: 0.02em; }
        .vip-otp-back{
          border: 1px solid rgba(255,255,255,0.14);
          background: rgba(0,0,0,0.18);
          color: rgba(255,255,255,0.88);
          border-radius: 12px;
          padding: 8px 10px;
          cursor: pointer;
          font-weight: 900;
          white-space: nowrap;
        }
        .vip-otp-input{
          font-weight: 900;
          letter-spacing: 0.22em;
          text-align: center;
        }
        .vip-otp-actions{
          display:grid;
          gap: 10px;
        }
        .vip-otp-note{
          font-size: 12px;
          opacity: 0.72;
          line-height: 1.25;
        }

        /* smoother loading */
        .vip-btn.is-loading{
          position: relative;
          opacity: 0.92;
          pointer-events: none;
        }
        .vip-btn.is-loading::after{
          content: "";
          width: 16px;
          height: 16px;
          border-radius: 999px;
          border: 2px solid rgba(255,255,255,0.35);
          border-top-color: rgba(255,215,130,0.95);
          position: absolute;
          right: 14px;
          top: 50%;
          transform: translateY(-50%);
          animation: vipspin .75s linear infinite;
        }
        @keyframes vipspin{ to { transform: translateY(-50%) rotate(360deg); } }
      `}</style>
    </main>
  );
}
