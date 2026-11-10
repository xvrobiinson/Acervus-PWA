# Accounts, members and permissions: audit (roadmap 44)

Written 2026-11-10 from the code as it stands (both apps, uncommitted v0.14
work included). Documentation only: nothing here changes the apps. It is the
starting point for roles (45), platform administrators (46), the `/admin`
dashboard (47) and seat limits (48).

## Who is who

- **Account (sign-in).** Better Auth inside Convex (`convex/auth.ts`): a
  one-time code by email, or Google. The account is the Better Auth `user`;
  its id is the JWT `subject` every function sees. Sessions last 14 days.
  The email must be verified (`requireIdentity` refuses otherwise).
- **Business (workspace).** A `businesses` row. Everything in the books
  carries `businessId`.
- **Membership.** A `members` row (business, user, email, name, role,
  active). Roles today: `admin`, `collector`, `viewer`
  (`convex/lib/access.ts`):

  | Need     | Who            | Used for |
  |----------|----------------|----------|
  | `read`   | all three      | the books, the team list, messages |
  | `record` | admin, collector | new clients, payments, expenses and income, a collector's Undo |
  | `manage` | admin          | everything else: loans, edits, deletes, capital, settings, team, invites, restore |

- **Collectors' reach.** A collector sees and records only for clients
  assigned to them (`canSee` in `lib/team.ts`): the snapshot leaves the rest
  out, and recording a payment on another client's loan is refused as "not
  found". Seven switches per collector (`members.collectorView`) hide
  amounts, rates, contact details and so on; contact details and ID
  numbers never reach their device when off.
- **The person's own things.** `userPrefs` (Overview figures, Interest
  earned's period, the welcome tour, and since 2026-11-10 their name and
  profile photo) belong to the account, not to a business.

## How each function checks the caller

Every public function starts with one of these, before it reads anything:

- `requireIdentity(ctx)`: signed in, email verified.
- `requireMember(ctx, businessId, need)`: signed in, an active member of
  that business, with a role that allows `need`. A missing business and a
  business that isn't theirs give the same "forbidden", so ids can't be
  probed. Records then go through `ownRecord`, which refuses an id from
  another business as "not found".

| File | Function | Kind | Check |
|------|----------|------|-------|
| account.ts | profile | query | identity |
| | setName | mutation | identity, rate limit 30/min |
| | photoUploadUrl | mutation | identity, rate limit 20/h |
| | setPhoto, removePhoto | mutation | identity; the photo must be a fresh upload (1 h), JPEG/PNG/WebP, 2 MB at most, and no business's logo or anyone else's photo; a refused file is never deleted |
| | status, requestDeletion, cancelDeletion | query/mutation | identity |
| | renameSignIn, runDue, erase, removeSignIn | internal | (scheduled by the server only) |
| auth.ts | getCurrentUser | query | the session (null when signed out) |
| businesses.ts | mine | query | identity (empty when signed out) |
| | create | mutation | identity, rate limit |
| | update, remove, setRole, setCollectorView, removeMember | mutation | member: manage |
| | members | query | member: read |
| | purge | internal | |
| clients.ts | create | mutation | member: record (a collector's new client is theirs) |
| | assign, update, setArchived, remove, photoUploadUrl, setPhoto, removePhoto | mutation | member: manage |
| | photoForAdmin | internal (http `/client-photo`) | member: manage, with the caller's token |
| data.ts | snapshot, changes | query | member: read, then filtered by role and collector |
| desktop.ts | compat | query | none (says which desktop versions may sync; no data) |
| imports.ts | desktopBook | mutation | identity (creates a new business the caller owns) |
| | restoreBook | mutation | member: manage, rate limit |
| invites.ts | create | action | through `store`: member: manage, rate limit |
| | list, revoke | query/mutation | member: manage |
| | preview | query | none, but needs the invitation's secret token (only its hash is stored); shows business name, role and email |
| | accept, acceptPending | mutation | identity, rate limit; the invitation's email must be the caller's |
| | pending | query | identity |
| lateFees.ts | refreshAll, refreshBusiness | internal | (daily job) |
| loans.ts | create, update, remove, markDefaulted, reinstate, setLateFeeWaived | mutation | member: manage |
| messages.ts | mine, markRead | query/mutation | member: read |
| | remindAll, remindBusiness | internal | |
| money.ts | addEntry | mutation | member: record (a transfer between accounts: manage) |
| | addCapital, updateCapital, removeCapital, adjustBalances, updateEntry, removeEntry | mutation | member: manage |
| payments.ts | record | mutation | member: record; the loan's client must be one the caller sees; a collector's payment waits in `pendingPayments` |
| | withdraw | mutation | member: record; only the collector's own, still waiting, within 10 minutes |
| | confirm, reject, update, remove | mutation | member: manage |
| prefs.ts | mine, save | query/mutation | identity (rate limit on save) |
| settings.ts | update, logoUploadUrl, setLogo | mutation | member: manage |
| rateLimit.ts | hit | internal | |

## Where records are created

| Table | Created by |
|-------|-----------|
| businesses, settings, first member | `businesses.create`, `imports.desktopBook` |
| members | `businesses.create`, `invites.accept` / `acceptPending` |
| invites | `invites.store` (from `invites.create`) |
| clients | `clients.create`, imports |
| loans, loanStatusEvents, lateFees | `loans.*`, the daily late-fee job, imports |
| payments | `payments.record` (admins), `payments.confirm` (a collector's, once confirmed), imports |
| pendingPayments | `payments.record` (collectors) |
| capitalTxs, cashEntries | `money.*`, imports |
| changeLog | every change, through `logChange` (who, when, what) |
| operations | `rememberOperation`: each offline change's id, so a change sent twice is saved once |
| messages | team notices (`lib/team.ts`), reminders |
| userPrefs | `prefs.save`, `account.setName` / `setPhoto` |
| accountDeletions | `account.requestDeletion` |
| rateLimits | `hitLimit` |

## The two apps' offline queues

- **Web (PWA).** `src/offline/outbox.ts` keeps changes made offline on the
  device (IndexedDB, per user and business) and sends them later with the
  same functions, each with an operation id. Only new clients, payments,
  expenses and income can wait; everything else needs a connection. The
  server checks them like any other call, at the time they arrive: a
  person removed from the business meanwhile is refused.
- **Windows.** `src/sync/outbox.rs` (SQLite) does the same with the same
  list (`Change::works_offline`), through the same Convex functions with
  the person's session (`src/sync/worker.rs`). The session lives in Windows
  Credential Manager (`src/sync/vault.rs`). The desktop's own role checks
  (`VzApp::can`) only spare the person a refusal; the cloud decides.
  Desktop versions older than `MIN_DESKTOP_VERSION` (0.12.1) are refused.

## Findings

1. **Every public function checks the caller first**, apart from three that
   reveal nothing private: `desktop.compat` (version numbers),
   `invites.preview` (needs the secret token) and `auth.getCurrentUser`
   (the caller's own account). No function trusts a role or user id sent
   by an app.
2. **Hiding is server-side for collectors** (since 2026-11-01): clients not
   assigned to them, and the switched-off details, never leave the cloud.
   For viewers, business totals are hidden on screen only: a viewer's
   device still receives every record (by design, `read`).
3. **Files.** Client ID photos are served only through `/client-photo` with
   an admin's token. Logos and profile photos use Convex's unguessable file
   addresses. Since 2026-11-10 no stored file's id leaves the cloud (the
   snapshot used to carry the logo's `logoId`), and `account.setPhoto`
   takes only a fresh upload that isn't a logo or someone else's photo.
   `clients.setPhoto` and `settings.setLogo` still accept any stored file's
   id from an admin; worth the same checks (small, no change for people).
4. **One role per membership, three fixed roles.** "Owner" doesn't exist:
   any admin can demote or remove another admin, as long as one admin
   stays (`last_admin` in `businesses.setRole` / `removeMember`; deleting
   the account of a sole admin waits too, `account.ts`). Roles (45)
   should add exactly one Owner who can't be removed by others.
5. **Rate limits** cover sign-in codes, new accounts, new businesses,
   invitations, restores, prefs and the profile. Book changes have none
   beyond being a member; fine for now, and worth a per-business limit
   before a public Free plan (49).
6. **No platform administrator exists.** Support can only see a business
   through the Convex dashboard. 46 adds the table, the audit log and the
   time-limited access grant.
7. **Names.** The history and the team list use the membership's name
   (`requireMember` returns `member.name`), which `account.setName` now
   keeps up to date. Accounts made by email code before 2026-11-10 may have
   no name; the apps now show the email once instead of as a name.
