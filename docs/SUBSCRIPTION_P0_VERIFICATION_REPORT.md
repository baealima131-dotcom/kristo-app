# Subscription P0 Verification Report

**Date:** June 2026  
**Status:** Code aligned to `church_premium` — dashboard API verification pending secret key; device sandbox E2E pending manual run

---

## 1. RevenueCat dashboard configuration (answers)

| Question | Answer | Evidence |
|----------|--------|----------|
| **Entitlement identifier** | **`church_premium`** | User launch instruction (App Store Connect setup); mobile has always used `church_premium`; original server (`02b07f7`) used `church_premium`; mistaken regressive commit `c6e0d9d` changed server to `"Premium"` only |
| **Product IDs on entitlement** | **`premium_monthly`**, **`premium_yearly`** | Code constants; `KristoSubscriptions.storekit`; prior RC setup notes |
| **Intro / trial** | **14-day free trial on `premium_monthly` only** | `apps/mobile/storekit/KristoSubscriptions.storekit` → `introductoryOffer`: `paymentMode: free`, `subscriptionPeriod: P14D`; mobile `MONTHLY_INTRO_TRIAL_DAYS = 14`; yearly has no intro |
| **Sandbox vs production entitlement name** | **Same identifier: `church_premium`** | RevenueCat project model: one entitlement `lookup_key` per project; sandbox vs production differs by **store transactions**, not entitlement ID |

### Dashboard live API check

**Not executed in this session** — `REVENUECAT_SECRET_API_KEY` is not available in local `.env` / `.env.local`.

Run when secret is available:

```bash
REVENUECAT_SECRET_API_KEY=sk_... node scripts/verify-revenuecat-dashboard.mjs
```

Optional: `REVENUECAT_PROJECT_ID=proj_...` if multiple projects.

This script confirms entitlement + attached products against code constants.

---

## 2. Root cause of P0 mismatch

| Commit | Change |
|--------|--------|
| `02b07f7` | Introduced server verify with `CHURCH_PREMIUM_ENTITLEMENT = "church_premium"` |
| `c6e0d9d` | **Regression:** changed server to `"Premium"` (1-line change) |
| **This fix** | Restored `church_premium` + shared single source of truth |

Mobile never changed from `church_premium`. Server drift caused production activation to look up the wrong entitlement key.

---

## 3. Code changes made

### Single source of truth

New file: **`lib/churchPremiumRevenueCat.ts`**

```typescript
CHURCH_PREMIUM_ENTITLEMENT = "church_premium"
PREMIUM_MONTHLY_PRODUCT_ID = "premium_monthly"
PREMIUM_YEARLY_PRODUCT_ID = "premium_yearly"
PREMIUM_MONTHLY_INTRO_TRIAL_DAYS = 14
```

### Files changed

| File | Change |
|------|--------|
| `lib/churchPremiumRevenueCat.ts` | **Added** — canonical RC identifiers |
| `app/api/_lib/revenuecat.ts` | Import/re-export from shared lib; removed `"Premium"` |
| `apps/mobile/src/lib/payments/mobileSubscriptions.ts` | Import/re-export from shared lib (no duplicate literals) |
| `scripts/verify-revenuecat-dashboard.mjs` | **Added** — RC v2 dashboard verifier |

### Verification logic proof (lookup key)

Simulated RevenueCat subscriber payload with `church_premium` entitlement:

- Lookup with **`church_premium`** → **match**
- Lookup with **`Premium`** → **no match** (this was the production failure mode)

---

## 4. Sandbox end-to-end verification

### Automated (this session)

| Step | Result |
|------|--------|
| Mobile `tsc --noEmit` | **Pass** |
| Entitlement constants aligned | **Pass** — server + mobile import `lib/churchPremiumRevenueCat.ts` |
| RC dashboard API script | **Blocked** — no `REVENUECAT_SECRET_API_KEY` locally |
| iOS StoreKit sandbox purchase | **Not run** — requires device/simulator + sandbox Apple ID + ASC products approved |

### Manual sandbox checklist (required before launch sign-off)

Run on **physical device or simulator** with `KristoSubscriptions.storekit` or ASC sandbox products:

1. [ ] Pastor opens **More → Premium → Checkout**
2. [ ] Purchase succeeds (sandbox Apple ID)
3. [ ] Logs: `KRISTO_RC_CONFIG_SUCCESS`, `KRISTO_RC_LOGIN_SUCCESS`, `KRISTO_SUBSCRIPTION_PURCHASE_SUCCESS`
4. [ ] Logs: `KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_OK` (not `ACTIVATION_REJECTED` / `no-entitlement`)
5. [ ] Media Studio: **“Church subscription active”**
6. [ ] **Trusted Hosts** card visible
7. [ ] **Slots** card visible
8. [ ] **Media Storage** / **Church Storage** visible
9. [ ] **Post Video** hint shows **Ready**
10. [ ] Force-quit app → reopen → subscription still active

### Production server requirement

Vercel (or host) must have:

```
REVENUECAT_SECRET_API_KEY=sk_...   # Secret API key from RevenueCat dashboard
NODE_ENV=production
# KRISTO_SUBSCRIPTION_BYPASS must NOT be set
```

Without the secret, production activation returns `reason: "no-secret"` → HTTP 402.

---

## 5. Expected results after alignment

| Stage | Expected |
|-------|----------|
| **RevenueCat sync** | `entitlements.active.church_premium` populated after purchase |
| **Server verification** | `verifyChurchPremiumEntitlement(churchId)` → `{ active: true, reason: "verified" }` |
| **Church activation** | `PATCH activate_church_subscription` → `subscriptionActive: true` |
| **Media Studio unlock** | `canUseMediaTools: true`; gated cards visible |

---

## 6. Remaining launch gates

| Gate | Owner | Status |
|------|-------|--------|
| Set `REVENUECAT_SECRET_API_KEY` on production | DevOps | **Pending** |
| Run `scripts/verify-revenuecat-dashboard.mjs` with secret | DevOps | **Pending** |
| ASC products `premium_monthly` / `premium_yearly` approved (or StoreKit config for local) | App Store Connect | Verify status |
| Device sandbox E2E (10-step checklist above) | QA / Pastor test account | **Pending** |
| Deploy code with `church_premium` alignment | Release | **Ready to deploy** |

---

## 7. Do not proceed until

- [ ] Dashboard script passes with live secret
- [ ] One successful sandbox purchase → Media Studio unlock on device
- [ ] Production secret confirmed on Vercel

Only then: dashboard cleanup (Media ID placeholders, Create Live relabel) or Home Feed polish.
