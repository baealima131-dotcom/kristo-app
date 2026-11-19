# Retiring legacy session tokens (plan — nothing here is executed yet)

## What "legacy" means

`verifySessionToken` (app/api/auth/_lib/sessionToken.ts) accepts, in order:

| Signer | Kind | Why it is still accepted |
|---|---|---|
| `KRISTO_SESSION_SECRET` | current | every sign-in issues these |
| `KRISTO_SESSION_SECRET_PREVIOUS` | legacy (rotation) | lets a secret rotation not sign anyone out |
| `KRISTO_OTP_SECRET` | legacy | tokens issued before the dedicated secret existed |
| `RESEND_API_KEY` | legacy | same; **this key was uploaded with past CLI deploys**, so anyone holding a copy can forge a token for any user while it is accepted |

The last two are only accepted while `KRISTO_SESSION_LEGACY_VERIFY` is not `"0"`.
Retiring legacy tokens = setting `KRISTO_SESSION_LEGACY_VERIFY=0` in production.
It is reversible in one env change + redeploy.

## Already in place (integration branch)

- Every request served on a legacy token logs `KRISTO_AUTH_LEGACY_TOKEN_ACCEPTED { userId, legacySecretLabel }`.
- OTP challenges are no longer signed with `RESEND_API_KEY` (new OTP tokens cannot be forged with it).
- `/api/auth/session/renew` never converts a legacy token into a current one (409
  `legacy_token_not_renewable`, no sign-out). The previous dedicated secret is renewable.
- Apps from this build sign out cleanly on a `401 { reauth: true }` instead of failing screen by screen.

## Stages

1. **Measure (no user impact).** After this build is live, count distinct `userId`s in
   `KRISTO_AUTH_LEGACY_TOKEN_ACCEPTED` per day for 14 days, split by `legacySecretLabel` and by app
   version where known. Goal: know exactly who would be signed out.
2. **Ship the clean sign-out path.** Make sure the current store builds (iOS + Android) include the
   `reauth` handling, so a retired token sends people to the sign-in screen with a clear message
   instead of broken screens. Older store apps (1.0.2 / 1.0.3) do not have it: they need the
   "please update / sign in again" message they already show for rejected sessions.
3. **Nudge.** In-app notice for users still on legacy tokens ("sign in again to keep your account
   secure"); signing in issues a current token. Re-measure.
4. **Retire.** When the daily count is near zero (or a date is agreed): set
   `KRISTO_SESSION_LEGACY_VERIFY=0`, redeploy, watch `KRISTO_AUTH_HEADER_REJECTED` with
   `reason: bad-signature` and support messages for 72 h. Rollback = unset the variable + redeploy.
5. **Rotate.** After retirement, rotate `RESEND_API_KEY` at Resend (it was exposed) and remove
   `KRISTO_OTP_SECRET` from session verification entirely in code.

## Decision owner

Each stage that changes production (env vars, deploys, key rotation) needs the owner's explicit
go-ahead. Stages 1–3 do not sign anyone out.
