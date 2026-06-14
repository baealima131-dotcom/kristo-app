# V1 In-App Notifications — Reference

**Status:** Feature-complete for TestFlight / App Review (in-app only; no push).  
**Primary UI:** `More → Notifications` (`/more/notifications`)  
**Storage:** `kristo_notifications` (Neon Postgres in production; `data/notifications.json` locally).  
**Persistence baseline:** commit `ee5abea` — all notifications use `createNotification()` → `notificationDb.ts` (no in-memory global store).

---

## Implemented notification types

### Dedicated `NotificationType` values (emitted)

| Type | Trigger (route / action) | Audience |
|------|--------------------------|----------|
| `MinistryMemberAdded` | `POST /api/church/ministry-members` | Added user |
| `MinistryMemberRemoved` | `DELETE /api/church/ministry-members` | Removed user |
| `MinistryMemberRoleChanged` | `PATCH /api/church/ministry-members` | Affected user |
| `MembershipRejected` | `POST /api/church/memberships/[id]/reject` | Requester |
| `ChurchProfileUpdated` | `PATCH /api/church/profile` | All active members |
| `ContentReportReceived` | `POST /api/church/feed/report` | Pastor, Church_Admin, media hosts (not reporter) |
| `ContentAutoHiddenAdmin` | Auto-hide moderation | Admins + media hosts |
| `ContentAutoHiddenAuthor` | Auto-hide moderation | Post author |
| `ChurchAnnouncementPosted` | `POST /api/church/announcements` | Active members (except author) |
| `ChurchTestimonyPosted` | `POST /api/church/feed` create_post | Active members (except author) |
| `ChurchPrayerRequestPosted` | `POST /api/church/feed` create_post | Active members (except author) |
| `ChurchMediaPosted` | `POST /api/church/feed` create_post | Active members (except author) |
| `FeedCommentOnPost` | `POST /api/church/feed` add_comment | Post author |
| `FeedReplyToComment` | `POST /api/church/feed` add_reply | Parent comment author |
| `PrayerRequestPrayedFor` | `POST /api/church/feed` toggle_like (prayer posts) | Prayer author |
| `TrustedMediaHostAdded` | `POST/DELETE /api/church/media-hosts` | Host + pastor |
| `TrustedMediaHostRemoved` | `POST/DELETE /api/church/media-hosts` | Host + pastor |
| `ChurchSubscriptionActivated` | `PATCH /api/church/media` activate | Pastor |
| `ChurchSubscriptionExpiringSoon` | Subscription reconcile on `GET /api/church/media` | Pastor |
| `ChurchSubscriptionExpired` | Subscription reconcile on `GET /api/church/media` | Pastor |
| `LiveEventScheduled` | `POST /api/church/feed` media-schedule create | Pastor + live hosts |
| `LiveSlotAssigned` | `POST /api/church/feed` update-schedule-slots | Assigned user |
| `LiveSlotCancelled` | `POST /api/church/feed` unclaim / slot diff | Previously assigned user |

### Runtime string types (not in enum; persisted as `type` column)

| Type | Trigger | Audience |
|------|---------|----------|
| `MinistryChatMessageCreated` | `POST /api/church/ministry-chat` | Ministry members (except sender) |

### `Generic` (legacy V1 — still emitted)

| Title / context | Route | Suggested V2 type |
|-----------------|-------|-------------------|
| New membership request | `POST /api/church/memberships/request` | `MembershipRequestReceived` |
| Membership request sent | membership request routes | `MembershipRequestSubmitted` |
| Membership approved ✅ | `POST /api/church/memberships/[id]/approve` | `MembershipApproved` |
| You joined a church | `POST /api/church/invites/action` | `MembershipJoined` |
| You left the church | `POST /api/church/membership/leave` | `MembershipLeft` |
| Church role updated / Role updated | `PATCH /api/church/members`, memberships/role | `ChurchRoleUpdated` |
| Church membership updated (removed) | `DELETE /api/church/members` | `MembershipRemoved` |
| Church invite received | `POST /api/church/invites` | `ChurchInviteReceived` (hidden in More UI) |
| Role request approved/denied | `POST /api/church/security/role-reviews` | `RoleReviewResolved` |
| Pastor is LIVE | `POST /api/church/live` | `LiveStreamStarted` |
| Schedule updated | `POST /api/church/feed` schedule slot edit | `MinistryScheduleUpdated` |

### Enum values never emitted

- `MinistryLeaderAssigned`
- `MinistryLeaderRemoved`

---

## Notification categories (UI)

Mapped in `apps/mobile/src/lib/notificationDisplay.ts` → badge label, Ionicons icon, accent color.

| Category | Types / heuristics | Icon |
|----------|-------------------|------|
| **Admin** | `ContentReportReceived`, `ContentAutoHiddenAdmin`, Generic “membership request” | `shield-checkmark-outline` |
| **Safety** | `ContentAutoHiddenAuthor`, `MembershipRejected` | `alert-circle-outline` |
| **Ministry** | `MinistryMember*`, `MinistryChatMessageCreated` | `people-outline` |
| **Live** | `LiveEvent*`, `LiveSlot*`, Generic “live” / “schedule updated” | `radio-outline` |
| **Prayer** | `ChurchPrayerRequestPosted`, `PrayerRequestPrayedFor` | `heart-outline` |
| **Subscription** | `ChurchSubscription*` | `card-outline` |
| **Feed** | Announcements, testimony, media, comments, replies, `ChurchProfileUpdated` | `newspaper-outline` |
| **General** | Remaining Generic (approved, role updated, joined, left, invite, etc.) | `notifications-outline` |

---

## Deep-link destinations

Implemented on tap (mark read → navigate). No route → expand/collapse only.

| Type / heuristic | Destination |
|------------------|-------------|
| `ContentReportReceived`, `ContentAutoHiddenAdmin` | `/more/media-reports` |
| `TrustedMediaHostAdded`, `TrustedMediaHostRemoved` | `/more/media` |
| `ChurchSubscription*` | `/more/media` |
| `LiveEventScheduled`, `LiveSlotAssigned`, `LiveSlotCancelled` | `/more/live-slots` |
| `ChurchProfileUpdated` | `/church/overview` |
| Generic “New membership request” | `/church/members?tab=requests` |
| `MinistryChatMessageCreated` (when `ministryId` set) | `/more/my-church-room/messages/[ministryId]` |

**Deferred (needs `postId` / metadata):** feed comment, reply, prayer engagement, testimony/media/announcement posts, author auto-hide.

---

## Admin-only notifications

Targeted to Pastor / Church_Admin / System_Admin / media hosts (never whole-church fan-out):

- `ContentReportReceived`
- `ContentAutoHiddenAdmin`
- Generic **New membership request** (per admin user)
- `TrustedMediaHostAdded` / `Removed` (pastor copy)
- `ChurchSubscription*` (pastor only)
- `LiveEventScheduled` (pastor copy)

**Church Admin inbox tab** (Pastor / Church_Admin / System_Admin only): optional `scope=churchAdmin` lists **all** church notifications including other members’ targeted rows — opt-in oversight, not the default view.

---

## Member-only / personal notifications

Visible in default **`scope=forMe`** (`targetUserId = viewer` or untargeted broadcast):

- `FeedCommentOnPost`, `FeedReplyToComment`, `PrayerRequestPrayedFor` (post/comment author)
- `LiveSlotAssigned`, `LiveSlotCancelled`
- `ContentAutoHiddenAuthor`
- `TrustedMediaHostAdded` / `Removed` (host copy)
- `MinistryMemberAdded` / `Removed` / `RoleChanged`
- `MinistryChatMessageCreated`
- `MembershipRejected`, membership approved/sent/joined/left Generic
- Church content fan-out copies (`ChurchAnnouncementPosted`, testimony, prayer, media) — one row per member

Members **do not** see the Church Admin tab. Overview unread badge uses **forMe** count only.

---

## Idempotency (duplicate protection)

**Deterministic `id` on create** (retries return existing row):

- Content reports & auto-hide
- Church announcements & feed post fan-out
- Feed engagement (comment, reply, prayer)
- Media host & subscription
- Live schedule & slot assignment/cancellation

**No deterministic `id` (retries can duplicate)** — acceptable V1 debt; document for V2 hardening:

- All **Generic** membership / role / invite / live / schedule emitters
- `MinistryMember*` / `MinistryChatMessageCreated` (each chat message intentionally new)
- `ChurchProfileUpdated` (each profile save)
- `MembershipRejected`
- `POST /api/church/notifications` manual create

---

## Privacy / scope rules

| Scope | Filter | Used for |
|-------|--------|----------|
| `forMe` (default) | `target_user_id IS NULL OR target_user_id = viewer` | List, unread badge, overview stats, mark-all default |
| `churchAdmin` (opt-in) | All rows for `church_id` | Pastor/admin secondary tab only |

Private member notifications (comments, prayers, slot assignment, etc.) use explicit `targetUserId`. They **do not** appear in another member’s For Me inbox. Pastors see others’ targeted notifications **only** on the Church Admin tab.

---

## Known V2 items

- **Push notifications** (APNs / FCM)
- **Notification settings** (per-category mute, email prefs)
- **DM / direct message notifications** (outside ministry chat)
- **Advanced routing** — feed post deep-links (`postId`, `commentId`, `announcementId` metadata)
- **Dedicated types** for remaining `Generic` emitters (see table above)
- **Deterministic IDs** for ministry, profile, membership, live-go-live, schedule-updated
- **`LiveEventReminder`** — requires cron/worker (not faked in V1)
- **RevenueCat webhook + subscription cron** for billing-aligned expiry alerts
- **Web dashboard** notification page types list (still ministry-only subset)

---

## QA sign-off (iPhone)

- [ ] More → Notifications: empty state, categories, icons, unread count
- [ ] Pastor: For Me / Church Admin tabs; mark-all scoped; unread matches tab
- [ ] Member: no admin tab; personal notifications only
- [ ] Deep-links: reports, media, live slots, members requests, overview
- [ ] `/church/notifications` redirects to More
- [ ] No `KRISTO_NOTIFICATIONS_*` console logs

When all pass → **V1 Notifications feature-complete** for TestFlight / App Review.
