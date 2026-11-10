# Acervus Finance as a SaaS: plan (2026-11-09)

Status: **planning only.** Nothing in this document is built. It turns
the owner's SaaS brief of 2026-11-09 into phases, written against what the
code does today. Prices are proposals; the seat limits are owner decisions
(see "Plans"). Roadmap items: `docs/STATUS.md` 44–51.

## What exists today (read from the code, 2026-11-09)

- **Workspaces are "businesses".** `businesses` (name, time zone, creator,
  record counter). A person can create up to 3 a day
  (`convex/businesses.ts`) and belong to several; the apps switch between
  them.
- **Memberships.** `members` (business, Better Auth user id, email, name,
  role, active, joined, removed, `collectorView` switches). Roles:
  `admin`, `collector`, `viewer` (`convex/schema.ts`). Whoever creates a
  business is its first admin; a business can never lose its last admin.
- **Invitations.** `invites` (business, email, role, hashed single-use
  token, expiry, accepted, revoked); 30 per business a day, acceptance
  20 an hour per person.
- **Server-side checks.** Every query and mutation calls
  `requireMember(ctx, businessId, need)` with `read` (all roles), `record`
  (admin, collector: clients, payments, expenses, income) or `manage`
  (admin: everything else). `ownRecord` refuses records of another
  business with the same error as a missing one (`convex/lib/access.ts`).
- **Collectors today.** See only the clients given to them
  (`clients.collectorId`), plus what their seven `collectorView` switches
  allow. Their payments wait in `pendingPayments` until an admin confirms
  them. They can add clients (a client a collector adds is theirs). They
  never see capital, the business's totals, Money or Reports.
- **Authentication.** Better Auth (`@convex-dev/better-auth` 0.12.6,
  `better-auth` 1.6.33): passwordless email codes and Google sign-in; no
  passwords exist, so none can ever be shown. New accounts capped at 30 an
  hour (`convex/auth.ts`).
- **History.** `changeLog` records every change to the books (clients,
  loans, payments, capital, entries, late fees, settings, members) with who
  and when. It is per business; there is no platform-wide audit log.
- **Leaving.** Deleting your own account waits 7 days and keeps the
  business's records ("Former team member"); a business can be deleted by
  its admin; CSV/JSON export in Settings; nightly encrypted backups of all
  data (`docs/BACKUPS.md`).
- **Not present at all:** plans, subscriptions, trials, billing, seat
  counts, any limit on clients or loans, platform administrators, an
  `/admin` route, support access. Pricing appears nowhere in the apps or
  the landing page.
- **Two kinds of client.** The PWA (online, with an offline outbox) and
  the Windows app (a local replica that syncs through the same Convex
  functions; `docs/DESKTOP-SYNC-PLAN.md`). Every rule below must hold for
  both, so it must live in the Convex functions, never in either app.

## Plans (owner decisions of 2026-11-09)

Seat limits, collector seats as a separate quota and individual logins
for every employee are **owner-approved product decisions**. Prices are
**proposed launch prices, subject to final approval**.

| | Free | Pro | Business |
|---|---|---|---|
| Price (proposed) | $0 / month | $29 / month | $79 / month |
| Workspaces | 1 | 1 | 1 |
| Administrative seats (Owner included) | 1 | 3 | 10 |
| Collector seats (separate quota) | 2 | 5 | 25 |
| Clients | up to 10 | unlimited | unlimited |
| Loans | up to 10 | unlimited | unlimited |

- Annual billing at **15% off** and a **30-day Pro trial**: owner decisions
  ("remain unchanged"). Not found anywhere in the repository yet, so this
  document is now where they are written down.
- Feature differences between plans beyond seats and limits (customizable
  receipts, advanced reports and exports, employee activity history,
  multi-branch later) were proposed in the first brief; which features sit
  in which plan is an **open decision** (see the list at the end).

### Seats

- **Administrative seats:** Owner, Admin, Manager, Accountant.
- **Collector seats:** Collector.
- Every employee has their own account (Better Auth user). A collector
  account is never shared or anonymous.
- Both counts are kept and enforced **on the server**: an invitation that
  would go over its quota is refused when sent *and* when accepted; a role
  change that would move someone into a full quota is refused; removing or
  deactivating someone frees the seat. Pending invitations count toward
  the quota (so ten invitations can't be accepted into five seats).
- Seat assignments and role changes go into the workspace's history.

## Phases

The order follows the brief, adjusted to the code: authorization work
comes before anything visible, because the roles and seat rules are
needed by the admin dashboard, the plans and billing alike.

### Phase 1: audit (documentation)
Inventory every Convex query, mutation and action with the `need` it
checks; list the places that create records (clients, loans, members,
invites); list what the Windows app sends (`sync/change.rs`) and the
PWA's offline outbox, since both must meet the same limits. Output: a
table added to this file. No code.

### Phase 2: roles and a permission system (multi-tenancy)
Workspaces and server-side checks already exist; this phase deepens them.
- Replace the three fixed roles with **Owner, Admin, Manager, Accountant,
  Collector** (custom roles later), each a set of permissions rather than
  one of three levels: e.g. `loans.create`, `loans.editTerms`,
  `rates.change`, `payments.record`, `payments.confirm`, `reports.view`,
  `money.view`, `team.manage`, `settings.manage`, `billing.manage`.
  `requireMember(ctx, id, need)` becomes `require(ctx, id, permission)`.
- **Owner**: exactly one per workspace, the person who pays; can transfer
  ownership. Today's "creator is admin" and "never lose the last admin"
  rules carry over.
- **Collector** permissions (owner's list): see assigned clients and loans,
  record payments, see the related payment and collection history, see
  their own collection information. Not: create or change loan terms,
  change rates, manage billing, global reports, manage employees, change
  settings. Today's collector already matches most of this; open: whether
  collectors keep "add clients" and whether their payments keep waiting for
  confirmation.
- Owner/Admin invite, deactivate and reassign collectors (exists today for
  admins: assign clients, remove members, revoke invites).
- **Migration:** today's `admin` → Owner (the creator, or the oldest admin
  if the creator left) + Admin; `collector` → Collector; `viewer` → an open
  decision (Accountant is the closest).
- Both apps check the new permissions; the Windows app needs a new
  version, and `MIN_DESKTOP_VERSION` is raised so older desktops are told
  to update (they would show buttons the server now refuses).

### Phase 3: platform administrators
- A `platformAdmins` table keyed by Better Auth user id, with its own
  roles (e.g. owner, support, read-only). Not a workspace role and not a
  flag a customer can reach.
- Added only outside the app: a Convex internal function run from the
  dashboard or the CLI by the platform owner. No sign-up path, no default
  account, no hard-coded email.
- Every admin function lives in its own Convex module and starts with
  `requirePlatformAdmin(ctx, permission)`. Hiding `/admin` in the app is
  never the protection.
- **Audit log:** a `platformAudit` table (who, what, which customer or
  workspace, before/after, when). Every admin action writes to it in the
  same transaction; it can't be edited or deleted from the app.
- **Support access to a workspace's books** is off by default. It needs a
  time-limited grant the workspace owner gives from their settings, shows
  in their history, and every read under it is audited.

### Phase 4: the `/admin` dashboard
A section of the PWA at `/admin`, shown only when the server says the
person is a platform admin (and every call checks again).
- **Overview:** registered customers; active and inactive accounts; Free,
  Pro and Business counts; trials; expired and suspended; recent sign-ups;
  status at a glance.
- **Customers:** search and filter; profile; workspaces; registered and
  last active; plan and status; billing provider and renewal (when
  billing exists); customer and workspace history.
- **Access:** grant, suspend, restore, revoke; set or change a plan by
  hand; extend a trial or subscription. Every one audited.
- **What it never shows:** passwords (none exist), session tokens, ID
  photos, or a workspace's books unless a support grant is active.
- Needs: "last active" (not tracked today; a light timestamp per member
  updated at most once a day) and suspension (a status the auth and
  `require` checks read).

### Phase 5: team invitations within seat limits
Invitations, acceptance, removal and role changes counted against the two
seat quotas on the server (see "Seats"). Most of the flow exists; the work
is the quotas, the new roles and the screens that explain a full plan
("Your plan has 5 collector seats; 5 are in use").

### Phase 6: subscriptions and entitlements (before any billing)
- A `subscriptions` record per workspace: plan, status (`trialing`,
  `active`, `past_due`, `grace`, `canceled`, `expired`, `suspended`),
  period end, trial end, billing interval (monthly or annual), source
  (`manual`, later the billing provider), provider ids.
- One server function answers "what may this workspace do?" (seats,
  client and loan limits, features). Every mutation that creates
  something asks it. Neither app's state, a URL or a redirect after
  checkout can grant access.
- Trials: 30 days of Pro; at the end, Free unless paid.
- Upgrades take effect at once; downgrades at the end of the paid period.
- Failed payments: a grace period (length to decide), reminders, then
  Free limits.
- Over a limit (after a downgrade or an expiry): **nothing is deleted or
  hidden.** The workspace can read, export and record payments on existing
  loans; it can't add clients, loans or seats beyond the plan until it is
  under the limit or upgrades. Extra members are deactivated, never
  removed, owner's choice of who.
- Cancellation and data retention: export always available; how long a
  canceled or expired workspace's data is kept, then deleted, to decide
  (and to state in the Terms and Privacy Policy).
- Offline: a payment or client queued offline that the server refuses
  because of a limit must come back to the person with a clear message,
  not vanish (the outbox already handles refusals; the wording is new).
- Existing workspaces at launch: see "Open decisions".

### Phase 7: international billing (after a provider approves Acervus)
Providers to evaluate: **Paddle** and **FastSpring** (both act as
Merchant of Record, handling sales tax and VAT). Neither is assumed to
approve Acervus.
- Compare: Merchant of Record approval for a lending-management tool (some
  providers restrict financial services), seller onboarding and identity
  verification, **payouts to the Dominican Republic** (eligibility,
  method, currency, fees), fees per transaction, subscription and trial
  support, annual discounts, the customer checkout in Spanish and English.
- Build after approval: checkout from the app, recurring billing, a
  Convex HTTP action receiving the provider's webhooks with **signature
  verification** and idempotency (each event applied once), activation on
  confirmed payment only, renewals, cancellations, refunds and failed
  payments mapped onto the subscription states of phase 6.

### Phase 8: analytics and more admin tools
Revenue and churn, plan conversion, trial outcomes, usage by plan, and
whatever support needs once real customers arrive.

## Security notes (all phases)

- Every rule lives in Convex functions. The PWA, the Windows app and the
  offline outbox are untrusted callers.
- Platform admin and workspace roles are separate systems; no workspace
  role leads to platform powers.
- The customer data an admin may see is the least needed: account and
  subscription facts, not books.
- Audit records are written in the same transaction as the action.
- Billing webhooks are verified before anything is read from them.
- Rate limits extend to the new functions (admin search, invitations,
  checkout).

## Open decisions for the owner

1. **Workspaces per person.** Plans give 1 workspace, but today one
   person can own several businesses. Is the subscription per workspace
   (recommended: the owner pays per business) or per person? What
   happens to people who already own several?
2. **Existing businesses at launch** (including the owner's own): free
   Pro for a period, or Free limits at once? Recommended: grandfather
   existing businesses on Pro until a set date, since Free's 10 clients
   would lock most of them out of adding records.
3. **Loan limit:** 10 loans in total, or 10 open loans (paid-off loans
   not counted)? Recommended: open loans.
4. **Viewer role:** becomes Accountant (an administrative seat), or stays
   as a read-only role, and does it use a seat?
5. **Collectors adding clients** and **collector payments waiting for
   confirmation:** keep both as today?
6. **Which features belong to which plan** (custom receipts, reports and
   Excel, activity history, WhatsApp, Reports, the Windows app itself).
7. **Trial terms:** card required to start? Only for new workspaces?
8. **Grace period** length after a failed payment, and **data retention**
   after cancellation.
9. **Platform admin route:** `/admin` in the PWA (as briefed), or a
   separate subdomain later for extra isolation.
10. **Billing currency:** USD everywhere, or local prices.
