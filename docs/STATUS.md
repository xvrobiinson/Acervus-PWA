# Acervus Finance PWA: status (2026-10-30)

## Decisions confirmed by the owner
- Several separate businesses with self-service sign-up; whoever creates a business is its admin.
- Roles: Admin, Collector and Viewer (`convex/lib/access.ts`).
- Passwordless email codes (sent through Brevo), plus Continue with Google (working since 2026-10-29). Changed from email and password on 2026-10-28.
- Offline: create clients, payments, expenses and income. Everything else needs a connection.
- ID photos: Convex storage, admins only, never cached, exported or printed.
- Desktop: two-way live sync with the PWA, chosen 2026-10-28 (`DESKTOP-SYNC-PLAN.md`). Phases 0–4 done (desktop 0.7.0 released 2026-10-30); phase 5, the import, done 2026-10-30 (the desktop books are the business "VZ Capital Group"); each phase needs approval.
- Live at https://acervus-finance-pwa.vz-labs.workers.dev (Convex production `proper-pony-55`), deployed by GitHub Actions on every push to `main`. Code is in the private GitHub repo `xvrobiinson/Acervus-Finance-PWA`.

## Implemented
- **Engine** (`shared/domain`): port of the desktop engine and services logic.
- **Backend** (`convex/`):
  - multi-tenant schema;
  - Better Auth (email codes, Google, per-account and safe per-IP rate limits, and since 2026-11-04 at most 30 new accounts an hour across the app, counted on codes sent to addresses with no account yet, so existing users are never held up);
  - authorization on every function;
  - clients, loans (with edited schedules), payments (4 allocation modes), late fees and waivers, defaults;
  - capital, expenses, income, transfers, adjustments;
  - settings and wording, logo, members, invitations;
  - audit log, idempotent operations, stale and conflict detection, hourly late-fee job;
  - admin-only photo endpoint.
- **App** (`src/`):
  - sign-in and sign-up with an email code, invitations, create business;
  - Overview (KPIs, growth chart, needs attention, recent payments);
  - Clients (search, profile, ID photo);
  - Loans (filters, detail with installments or interest periods, payments, waivers, default, delete);
  - loan form with schedule preview and editor;
  - payment form with live split preview and quick amounts;
  - Money (accounts, movements, all entry forms);
  - Reports (returns, capital and gain, loans by status, monthly cash flow);
  - change History, Sync center, Settings (device, businesses: open, create, delete; business, receipts, formats, defaults, logo, wording, people, CSV/JSON export);
  - payment and loan receipts (US Letter) with print/PDF and download;
  - English and Spanish; light and dark; phone-first layout (tab bar and "+" button; side rail on wide screens).
- **Offline:**
  - service worker precache with an update prompt;
  - last copy per user and business in IndexedDB;
  - IndexedDB outbox, ordered and idempotent, with review/confirm/discard and a discard journal;
  - offline and pending banners.
- **Hosting:** `wrangler.jsonc` (Workers static assets, SPA fallback, no preview URLs), security headers with CSP, PWA manifest and icons.
- **CI/CD:** `.github/workflows/deploy.yml`: every push to `main` runs typecheck and tests, deploys Convex (building the app against it), then publishes to Cloudflare. No preview deployments.

## Test results (all run locally)
| Suite | Result |
|---|---|
| Engine: desktop unit tests ported | 47 / 47 pass |
| Engine: differential test vs the desktop's Rust engine | 200 loans / 50 portfolios (committed) pass; 3,000 / 750 batch run once, no differences; a deliberately broken rounding rule makes them fail |
| Backend (convex-test): auth, isolation, roles, invitations, workflows, idempotency, stale/conflict, late fees, cash rules | 13 / 13 pass |
| Offline outbox (fake IndexedDB): lost replies, refusals, session expiry, ordering, rebase, discard journal | 9 / 9 pass |
| `npm run typecheck` (app + Convex), `npm run build` | pass (176 KB gzipped JS) |
| `wrangler deploy --dry-run` | config valid |
| Real stack, local backend (`scripts/smoke-auth.mjs`): code requested → code in the Convex log → wrong code refused → sign-in with the code creates the account → used code refused → Convex token → anonymous calls refused → business/loan/payment → retried operation recorded once → sign-out → token refused | 12 / 12 pass (2026-10-28) |
| Browser (jev-qa, `tests/qa/email-code-*.qa`): email screen, code screen, wrong code message, sign-up with name, no password fields | 2 / 2 flows pass (2026-10-28) |
| Real app in headless Edge, phone viewport (`scripts/screenshots.mjs`): screens render; **offline payment saved on the device, shown pending, synced after reconnecting, recorded once and marked offline on the server** | pass |

Problems found and fixed while testing:
- Two outbox ops made in the same millisecond could be sent out of order.
- Money figures wrapped onto two lines on narrow phones.
- Sheets were wider than the phone.
- The app trusted a WebSocket that hadn't noticed the network was gone.
- **Better Auth's rate limits would have put all users in one shared bucket**, because Convex HTTP actions passed no client IP.

## Limitations
- Each mutation reads the business's whole ledger, which is fine for small and medium lenders. Very large books would need cached per-loan summaries (Convex transaction read limits).
- Not tested on real Android or iPhone hardware by us; the owner uses it live and tested the installed app's launch on a phone (2026-10-31). The per-IP rate limit depends on what Convex cloud forwards; per-account limits always apply.
- The session token lives in localStorage (the cross-domain plugin's design), mitigated by the CSP.
- Offline: no new loans or edits; receipts only after sync; queued payments aren't counted in figures until accepted; the app must be opened online once per device. iOS needs the app installed to keep offline data reliably.
- Desktop-only features with no PWA equivalent: SQLite backup/restore files (replaced by Convex backups and CSV/JSON export), the Windows file picker, keyboard shortcuts, Diagnostics.
- The receipt page-count note uses the desktop's row measurements (US Letter in Edge). Other browsers may break pages slightly differently.

## To do (in this order)
1. **Collector test.** Done 2026-10-30: open invitations for the signed-in email show an Accept button (welcome screen and Settings › Businesses), and Google sign-in comes back to the invitation. The owner confirmed it works. After it, the business's totals were hidden from collectors and viewers (owner's call): Overview shows active loans, overdue and receivable only, with no growth chart; Money and Reports are admins only (same on the desktop: no Analytics, no totals in the Loans and Payments headers). This hides them on screen; the devices still receive every loan, so the cloud doesn't restrict the data itself.
2. **New design for both apps.** Done 2026-10-30: the owner chose the "Dashboard style" from their examples (glassmorphism and a hero-card style were tried and declined). Violet accent, each figure on its own card with its icon in a colored square, Needs attention and Recent payments as card-style rows under a section heading, a greeting as the Overview title, and the sign-in's night sky behind every screen in dark mode only (the blue day sky was declined for light mode). Desktop: every screen (see its DESIGN.md). PWA: the same palette and pieces in `styles.css`; committed, deploy waiting for the owner's OK.
3. **Desktop release.** Done 2026-10-30: version 0.8 (business list, hidden totals for collectors, the redesign) pushed to `main` on the owner's word.
4. **Branding.** Done 2026-10-30 (owner's answers): About in both apps says "Acervus Finance, by VZ Labs" with the version, contact officialvzlabs@gmail.com, and links to the Terms and the Privacy Policy. VZ Labs is not a registered company, so no legal name or copyright line. No VZ Labs logo inside the apps; the desktop installer carries it (icon and wizard pictures) and names VZ Labs as publisher. Desktop 0.9 renames the program to `acervus.exe` and moves the data folder from `%LOCALAPPDATA%\VZFinance` to `%LOCALAPPDATA%\VZ Labs\Acervus` on first start (never when `ACERVUS_DB` points elsewhere). The GitHub repo is still called VZ-Finance (renaming it is the owner's call).
5. **Terms of Service and Privacy Policy.** Done 2026-10-30 as a plain-language draft (no lawyer, no governing-law clause, not limited to businesses): public pages `/terms` and `/privacy` in English and Spanish, linked from the sign-in pages and Settings › About in both apps. Accepting is by using the app; no checkbox.
6. **Landing page.** Done 2026-10-31: visitors who are not signed in see a marketing page at `/` (screens/landing.tsx): hero with a real screenshot, features, a clickable showcase, benefits, three steps, web and Windows download, FAQ, English and Spanish, light and dark. Screenshots are the desktop app on synthetic demo data (public/landing, not precached). No pricing yet (owner will give plans later), no testimonials or figures. 2026-11-02: every Download (nav bar next to FAQ, phone menu, the Windows card, footer) opens one popup (screens/landing-download.tsx) with the newest version, date and size read from the GitHub release by the worker (/download/windows/info; falls back to the download itself, never invents), a four-step install guide with an honest SmartScreen note, and a Download Installer button that checks the file first and starts one download per click. 2026-11-03: motion, chosen by the owner from two previews. App (src/ui/motion.ts + styles): screens slide in from the side, list rows rise in, taps sink, a confirmed payment slides away, Overview totals count up, charts draw in, loans show a paid-back bar that fills, a saved payment shows a check that draws itself, sync ends with an Up to date check, the bell rings on a new message, the offline banner slides. Landing: headline words rise in with a rotating last word, the screenshot tilts in and trails the scroll, stars twinkle (dark) and clouds drift (light), the nav firms up with link underlines, a reading line along the top, sections rise in, the showcase tab glides, the steps line draws, FAQ answers open smoothly, card icons bounce, the closing box drifts, the main Get started glow breathes. All of it is still with reduced motion. 2026-11-03: launch splash "Rising Bars", picked by the owner from ten previews: the logo's bars grow in turn, the name rises, a line follows the start; it shows from index.html before the app's code loads (public/splash.js, a file because the CSP allows no inline scripts), stays until the app sends `acervus:ready` (src/lib/splash.ts: once no loading screen holds it), always plays its whole 2.2 s intro, even when the screen behind is ready, then zooms open onto it, all over in under 3.5 s; light or dark like the app (splash.js applies the saved theme before the first paint). After signing in (code or Google) the next page plays it in full instead of flashing the landing page; signing out puts it up at once, ends the session under it, and the reloaded sign-in page carries it on without replaying the intro (`splashNext` in src/lib/splash.ts, `acervus.splash` in sessionStorage). Shown before the landing page too (owner asked 2026-11-03); not on the Terms or the Privacy Policy. The app's own loading screen (RisingBars in ui/kit.tsx) is the same picture; after 15 s it still gives way to the "taking longer than usual" message. The manifest's background color is the splash's dark so Android's launch screen leads into it.

7. **Settings redesign, receipt part switches, wider layout.** Done 2026-10-31 (desktop 0.10 and the PWA): Business and Cloud sync (the businesses list in the PWA) stay on the Settings page; the other groups are rows that open in a popup (desktop) or sheet (PWA). Payment receipts print only the optional parts switched on (loan number, amount lent, rate, payment cycle, installments, split, late fees, balance, history), stored as the optional `receiptShow` in the cloud; loan receipts keep every term. Desktop Settings now uses the full width (it was capped at 760px); the other screens already did.
8. **Caribbean guilder and the installed app's start.** Done 2026-10-31: XCG (symbol Cg, shown "Cg 1.250,00" with a space) in both apps and the cloud; amounts are never converted. The installed PWA opens on `/sign-in` (signed-in people go on to the dashboard) and never shows the landing page, which stays at `/` in a browser; the owner tested it on a phone. Desktop 0.11 with XCG waits for the owner's go.
9. **Tested cloud backups.** Convex keeps no automatic backups on the Free plan (owner's plan), so a nightly GitHub job (`.github/workflows/backup.yml`) copies all production data, auth accounts and files, locks the copy with the `BACKUP_PASSWORD` secret (gpg AES-256) and keeps it 90 days. Restore tested 2026-11-01: a real copy restored into a local deployment came back identical (26 of 26 tables, every file); the copies were deleted afterwards. How to get a copy back: docs/BACKUPS.md. The owner added `BACKUP_PASSWORD` on 2026-11-01 and the nightly copies run.
10. **Collectors see only their own clients.** Done 2026-11-01 in the cloud, the PWA and desktop 0.12. Admins give each client (with its loans) to a collector or to themselves (Clients › Assign, or the client's page); a client a collector adds is theirs; clients with no collector are seen by every collector; a business without collectors works as before. The cloud sends a collector only their clients, those loans and payments, the expenses and income they recorded and their own pending payments; never capital, the rest of the income and expenses, teammates' emails or the business-wide history. A collector's payment waits in `pendingPayments` (counts for nothing) until an admin confirms it on To confirm; it then becomes a payment dated the day it was collected, with the same receipt number; a rejection needs a reason. The client gets a receipt stamped Pending confirmation. The bell (`messages`): admins hear about collected payments and, 3 days ahead, about payments due on clients with no collector (hourly job); collectors hear about clients given or taken and confirmed or rejected payments. Tests: convex/collectors.test.ts; screenshots: scripts/collector-shots.mjs (local backend). Desktop 0.12 shows the same (To confirm on Payments, the collector on Clients and each client, pending payments on each loan, Messages in the sidebar, a collector's own view and the pending receipt); a collector's payment is never added to the desktop's books while it waits. MIN_DESKTOP_VERSION is 0.12.0: older desktops are told to update, because a collector's payment on 0.11 would wait unseen.
11. **Delete my account.** Done 2026-11-01 (see below). Still to do: one full test, start to finish.
12. **Reminders and receipts by WhatsApp.** A reminder before an installment is due, and the receipt after a payment, sent to the client.
13. **Try-it demo on the landing page.** Done 2026-11-04 (owner chose "look around" over a server sandbox): "Try the demo" on the landing page opens the app on sample data in that browser tab (`src/demo`: the snapshot is made from `convex/fixtures/desktop-demo.json` by the server's own import and snapshot code). Nothing reaches the server: reads come from the bundle, and every save says it's a demo with "Create a free account". A banner says so; closing the tab or signing in leaves it.
14. **Papiamentu (Curaçao) and Dutch.** Glossary for native-speaker review: https://claude.ai/artifact/TDQKCdjMR8KEtTnbUCQ2fe. Reviewed by a native speaker 2026-11-01 (changes: *pa fia*, *interes i kapital parti*, *saldo pendiente*); Dutch uses *je*. Done 2026-11-01 in both apps (see below), marked Beta until a native speaker reviews the whole app.

16. **Fix: desktop assign, confirm and reject.** Done in desktop 0.12.1 (the call names were missing from the outbox's list).
17. **Collectors see only clients assigned to them.** Done: replaces "unassigned clients are visible to every collector".
18. **What each collector can see.** Done: seven switches per collector under Team (`members.collectorView`). Phone, address, email, ID and notes never reach the device when off; amount lent, rate, history and late fees are hidden on screens and receipts but stay on the device, because balances are worked out there.
19. **Receipt switches apply to every receipt.** Done: loan receipts follow them; the "How payments work" lines go when the amount or rate is off.
20. **Same settings in both apps.** Done: Team, business name and time zone in the desktop; Sign out directly on the PWA's Settings page. PC-only: Google Drive, database backups, Diagnostics, keyboard shortcuts. MIN_DESKTOP_VERSION is 0.12.1, so collectors can't skip the switches on an older desktop.
21. **Animated landing page.** Done 2026-11-03 (motion picked from previews, see 6). 2026-11-05: the hero shows the Windows app recording a US$3,000 payment (src/screens/landing-hero.tsx): real screenshots in public/landing/hero (demo data in US$, English and Spanish, light and dark) with a drawn pointer that clicks Record payment, picks the loan, types the amount, saves ("Payment saved", the overdue figure drops) and opens Payments; pauses out of view, still with reduced motion. The FAQ and the Windows card now say the desktop needs an account (since 0.13).
22. **Animated loading page.** Done 2026-11-03 (the Rising Bars launch splash, see 6).
23. **History in plain words.** PWA done (2026-11-03): each change names its record ("Loan #5 · José Martínez"), every field by its name in the app, values written the way the app shows them, switch groups list only the switches that moved, and the app's own late fee updates fold into one entry per loan (src/lib/history-text.ts). Desktop done (2026-11-04) the same way (src/ui/history.rs): client names in titles, old values struck through, late fees folded, the app's own notes translated.
24. **Desktop Team buttons.** "Remove member" and "Revoke invite" were never clicked in a real test.
25. **"Update available" button (desktop).** Shows only when a newer version exists: "Update available" in the sidebar's footer card next to the version, or a chip in the header. Clicking it opens a window with the new version number, what's new in plain words (English and Spanish, like the rest of the app) and an "Update now" or "Download" button. Added 2026-11-04 at the owner's request. Done 2026-11-04 for desktop 0.13: `/download/windows/info` also gives the installer's SHA-256 and the release's `whats-new.json`; the desktop shows "Update available" in the sidebar's foot and installs after checking the SHA-256.

26. **Desktop: account required, cloud backups, restore for everyone.** Done 2026-11-04 (owner's decisions after two rounds of questions). The desktop needs an account (sign in or create one; Google brings the app back); it always shows a cloud business (welcome screen to create, accept an invitation or choose; sidebar switcher; "Use on this PC" gone); books kept only on a PC are offered once to move into a new business (`imports:desktopBook`, same mapping as `scripts/import-desktop.mjs`). Backups: Google Drive copies are on for accounts whose Google connection has `drive.file` (asked at Google sign-in), others can connect Drive; a daily local copy keeps the newest 7. Restore (admins): `imports:restoreBook` replaces a business's clients, loans, payments, late fees, money records and history with a backup's, checked like an import in one transaction; the team, invitations, settings, logo, each client's collector and ID photo (by record number) and collector payments whose loan is in the backup stay; record numbers carry on after the highest ever given; the desktop saves a copy first and asks for the business name.

27. **Payment method on payments.** Done 2026-11-04 (desktop 0.13): `paidWith` (cash, transfer, card, check, other) on payments and collector payments, chosen when recording or editing (both apps start with the way used last on that device), printed on receipts, named in the history; older apps leave it out and edits from them keep it.

28. **Landing: smaller "what you get after signing up" screenshots.** Done 2026-11-05: the showcase frame is at most 1080px wide (owner picked Medium from a preview of four sizes); the four pictures were retaken in US$ the same day.
29. **Light and dark switch on the landing page and in the apps.** A button at the top of the landing page (and in the apps) to switch between light and dark.
30. **Desktop sidebar: Settings next to Back up.** Move Settings just above or below the Back up button at the sidebar's foot.
31. **Messages as a single icon at the top.** Messages becomes one bell icon at the top instead of a sidebar row; show the owner examples to pick from first.
32. **Interest earned card on the Overview.** A card showing the interest earned, with a filter for Today, This week, This month, This year and All time. Both apps, and it works with Arrange the Overview (can be shown, hidden and moved). Added 2026-11-05 at the owner's request. To decide: whether collectors and viewers see it, since business totals are hidden from them (see 1).

## Planned (upcoming, not started)
- **Custom domain:** serve Acervus Finance from the owner's own domain instead of only the Cloudflare Workers address.
- **Pricing and subscription plans:** plans, prices and billing; then a pricing section on the landing page.

## Waiting on you
1. Deployment, email and Google sign-in are done.

## Papiamentu and Dutch (Beta), 2026-11-01

App and receipts in both apps; the landing page and Terms/Privacy stay English
and Spanish. PWA catalog: `src/lib/translations.json`; desktop catalog:
`src/translations.json` in the desktop repo; both keyed by the English text.
`node scripts/i18n-keys.mjs` lists PWA texts missing from the catalog. A missing
text falls back to Spanish (Papiamentu) or English (Dutch). The language is per
device: the cloud's business language stays `en`/`es`. Machine-assisted
translation, marked Beta until a native speaker has reviewed it.

## Delete my account, 2026-11-01

Settings on both apps. Seven-day wait with Keep; the only admin of a business must
hand over or delete it first; old records show "Former team member". Hourly cron
`delete accounts`. No confirmation email is sent.

## Arrange the Overview, 2026-11-03

The Overview's arrange button (sliders icon) lets each person show or hide
blocks (figures, Growth, Needs attention, Recent payments; collectors: My
recent payments) and figures, put them in their own order, and set blocks to
Half or Full width (two halves sit side by side from 1100px; a phone stacks
everything). The first figure shown is the large one. Moving works by dragging
with a mouse or with the arrows (touch). Reset puts the shipped layout back.
Kept on the device, per person (`acervus.overview.<userId>` in localStorage),
like the Windows app keeps it per PC. Model and tests:
`src/lib/overview-layout.ts`.
