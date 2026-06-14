# Subscription Sandbox Verification Checklist

**Purpose:** Confirm end-to-end church subscription on a **real device** before marking Subscription P0 **LAUNCH READY**.  
**Prerequisite commit:** `5ec9c63` — `church_premium` single source of truth  
**When to run:** iOS sandbox Apple ID + `premium_monthly` or `premium_yearly` available (ASC approved or StoreKit config attached)

---

## Before you start

- [ ] Build includes commit `5ec9c63` or later
- [ ] Pastor test account signed in with a **churchId**
- [ ] Church media profile exists (Media Studio setup complete)
- [ ] Sandbox Apple ID signed in on device (**Settings → App Store → Sandbox Account**)
- [ ] Production backend has `REVENUECAT_SECRET_API_KEY` set (for server verification on deployed API)
- [ ] Optional: run dashboard verifier locally before device test:
  ```bash
  REVENUECAT_SECRET_API_KEY=sk_... node scripts/verify-revenuecat-dashboard.mjs
  ```

**Log capture:** Keep Xcode console or Metro logs open. Filter for: `KRISTO_RC_`, `KRISTO_CHURCH_SUBSCRIPTION`, `KRISTO_SUBSCRIPTION`, `402`.

---

## Test run

| # | Check | Pass | Fail | Notes |
|---|-------|:----:|:----:|-------|
| 1 | **Purchase succeeds** | ☐ | ☐ | |
| 2 | **RevenueCat sync succeeds** | ☐ | ☐ | |
| 3 | **Server verification succeeds** | ☐ | ☐ | |
| 4 | **Church subscription activates** | ☐ | ☐ | |
| 5 | **Media Studio unlocks** | ☐ | ☐ | |
| 6 | **Trusted Hosts unlock** | ☐ | ☐ | |
| 7 | **Slots unlock** | ☐ | ☐ | |
| 8 | **Storage unlock** | ☐ | ☐ | |
| 9 | **App restart retains activation** | ☐ | ☐ | |
| 10 | **No 402 subscription errors** | ☐ | ☐ | |

**Tester:** _______________  
**Date:** _______________  
**Device / iOS:** _______________  
**Build / commit:** _______________  
**Church ID tested:** _______________  
**Plan purchased:** ☐ Monthly ☐ Yearly  

---

## Step-by-step

### 1. Purchase succeeds

**Action:** Pastor → **More → Premium → Plans** → choose Monthly or Yearly → **Subscribe** → complete sandbox purchase.

**Pass when:**
- StoreKit sheet completes without error
- Alert: **“Success”** / **“Monthly/Yearly subscription is now active”**
- No **“Purchase failed”** or **“Purchase cancelled”** (unless you intentionally cancelled)

**Logs to see:**
- `KRISTO_SUBSCRIPTION_PURCHASE_SUCCESS`
- No `Purchase failed` alert

---

### 2. RevenueCat sync succeeds

**Pass when:**
- Logs show RC configured and logged in with **churchId** (not userId)

**Logs to see:**
- `KRISTO_RC_CONFIG_SUCCESS`
- `KRISTO_RC_LOGIN_SUCCESS`
- `KRISTO_RC_AFTER_CUSTOMER_INFO` (or customer info refresh after purchase)
- Optional: `KRISTO_SUBSCRIPTION_ENTITLEMENT_ACTIVE` with `productId: premium_monthly` or `premium_yearly`

**Fail signals:**
- `KRISTO_RC_CONFIG_FAILED`
- `KRISTO_REVENUECAT_OFFERINGS_UNAVAILABLE` / error code 23 (ASC products not ready)

---

### 3. Server verification succeeds

**Pass when:**
- Server accepts activation; **no** entitlement mismatch

**Logs to see:**
- `KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_OK`  
  **or** checkout note: **“Media tools are now unlocked”**
- **Not:** `KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_REJECTED`
- **Not:** `reason: "no-entitlement"` or `reason: "no-secret"`

**If sync delayed:** Tap **Sync / Unlock Media Tools** on checkout — should still reach `ACTIVATION_OK`.

---

### 4. Church subscription activates

**Action:** Open **Media Studio** (`More → Media` or church overview).

**Pass when:**
- Status strip: **“Church subscription active”** (checkmark)
- Green ready dot on dashboard
- Premium card shows **“Active”**
- Subscription gate card is **hidden**

**API signal (optional):** `GET /api/church/media` → `subscriptionActive: true`, `canUseMediaTools: true`

---

### 5. Media Studio unlocks

**Pass when:**
- **Post → Video** card hint: **“Ready”** (not “Locked”)
- Tapping Post opens video composer (no subscription alert)
- No **“Premium subscription required”** gate blocking the dashboard tools area

---

### 6. Trusted Hosts unlock

**Pass when:**
- **Trusted Hosts** card is **visible** on Media Studio grid
- Tap opens `/more/media/select-hosts` (member picker)
- Not hidden behind subscription gate

---

### 7. Slots unlock

**Pass when:**
- **Slots** card is **visible**
- Tap navigates to schedule/meeting tool (no subscription alert)
- No **“Subscription required to schedule…”** blocking alert

---

### 8. Storage unlock

**Pass when:**
- **Media → Storage** and **Church → Storage** cards are **visible**
- Both open storage screens without subscription alert

---

### 9. App restart retains activation

**Action:** Force-quit Kristo → reopen → sign in as same pastor → open Media Studio.

**Pass when:**
- Still **“Church subscription active”**
- Trusted Hosts, Slots, Storage, Post Ready **remain unlocked**
- No return to locked / “Subscription required” state

---

### 10. No 402 subscription errors remain

**Pass when:** Throughout the full flow (purchase + restart + one tool action each):

- No HTTP **402** on `PATCH /api/church/media` (`activate_church_subscription`)
- No user-facing **“Subscription could not be verified with the App Store”**
- No persistent **“sync still completing”** after 2 minutes and a manual Sync tap

**Logs — must NOT appear:**
- `KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_REJECTED`
- `reason: "no-entitlement"`
- `reason: "no-secret"`
- `revenuecat-http-404` (church never purchased in RC — OK only before step 1)

---

## Verdict

| Outcome | Criteria |
|---------|----------|
| **LAUNCH READY** | All 10 checks **Pass** |
| **NOT READY** | Any check **Fail** — record notes below, do not ship subscription to production |

**Overall:** ☐ **LAUNCH READY** ☐ **NOT READY**

### Failure notes

```
(check #, what happened, relevant log lines)


```

---

## After LAUNCH READY

1. **Mark Subscription P0:** LAUNCH READY (maintenance mode — no subscription code changes unless bugs)
2. **Commit and push audit docs:**
   - `docs/SUBSCRIPTION_LAUNCH_READINESS.md`
   - `docs/V1_MEDIA_STUDIO_AUDIT.md`
3. **Move Media Studio + Subscription to maintenance mode**
4. **Then begin** (in order):
   - Dashboard cleanup (Media ID, Create Live relabel, guest stubs)
   - Reports queue polish
   - Home Feed polish
   - App Review build preparation

---

## Quick reference — success log sequence

```
KRISTO_RC_CONFIG_SUCCESS
KRISTO_RC_LOGIN_SUCCESS
KRISTO_SUBSCRIPTION_PURCHASE_SUCCESS
KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_START
KRISTO_CHURCH_SUBSCRIPTION_ACTIVATION_OK
KRISTO_MEDIA_ACCESS_REFRESH_AFTER_PURCHASE  → canUseMediaTools: true
```

## Quick reference — P0 failure patterns (pre-fix)

| Symptom | Likely cause |
|---------|----------------|
| Purchase OK, tools locked, `no-entitlement` | Entitlement ID mismatch (fixed in `5ec9c63`) |
| `no-secret` | `REVENUECAT_SECRET_API_KEY` missing on server |
| Offerings error 23 | ASC products not approved / StoreKit config missing |
| Success alert but locked after restart | Activation never persisted; check `ACTIVATION_OK` |
