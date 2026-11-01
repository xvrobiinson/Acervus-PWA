# Backups

Every night at 03:17 (Curaçao and Santo Domingo time), GitHub copies all of
the production cloud data: every business, client, loan, payment and setting,
the sign-in accounts, and the stored files (logos, photos). The copy is
locked with your backup password and kept for 90 days
(`.github/workflows/backup.yml`).

The repository is public, so anyone signed in to GitHub can download a
locked copy. Without the password it is unreadable. **Keep the password in
a password manager. If it is lost, the copies can't be opened.**

A restore of a real copy was tested on 2026-11-01: every one of the 26
tables (including the sign-in accounts, with the same IDs and dates) and
every stored file came back identical.

## One-time setup: the backup key

The job has its own Convex key, separate from the one that deploys the app.

1. Open https://dashboard.convex.dev, the project, the **Production** deployment, then **Settings**.
2. Under **Deploy keys**, click **Generate a deploy key**. Name it `nightly-backup` and tick only `deployment:backups:create` and `deployment:backups:download`. Copy the key.
3. On GitHub: **Settings** > **Secrets and variables** > **Actions** > **New repository secret**. Name: `CONVEX_BACKUP_KEY`. Secret: the key.

## One-time setup: the backup password

1. Make a long password, at least 20 characters. Five or six random words
   work well. Save it in your password manager as "Acervus backup password".
2. On GitHub, open the PWA repository and go to **Settings** (top bar) >
   **Secrets and variables** (left side) > **Actions**.
3. Click **New repository secret**. Name: `BACKUP_PASSWORD`. Secret: the
   password. Click **Add secret**.
4. Go to the **Actions** tab, click **Nightly backup** on the left, then
   **Run workflow** > **Run workflow** to make the first copy now. It
   should turn green in about two minutes.

## Checking the backups run

- **Actions** tab > **Nightly backup** lists every night's run. A green
  check means a copy was made and checked.
- If a night fails, GitHub emails you.
- GitHub pauses nightly jobs in public repositories after 60 days with no
  new commits. If that happens, the **Actions** tab shows a banner; click
  **Enable workflow**.

## Getting a copy back

1. **Actions** > **Nightly backup** > click a night's run > under
   **Artifacts**, click its name (`acervus-backup-YYYY-MM-DD`). A ZIP
   downloads.
2. Unzip it. Inside is `acervus-backup-YYYY-MM-DD.zip.gpg`.
3. Open **Git Bash** in that folder (right-click > Open Git Bash here) and
   run:

   ```
   gpg --output backup.zip --decrypt acervus-backup-YYYY-MM-DD.zip.gpg
   ```

   Type the backup password when asked. `backup.zip` is the unlocked copy.
   It holds everyone's financial data: delete it when you're done.

## Restoring it into the live app

**This replaces all the live data with the copy.** Everything entered since
that night is lost. Ask for help before doing this.

1. First take a copy of the data as it is now, in case you need it back:

   ```
   npx convex export --prod --include-file-storage --path before-restore.zip
   ```

2. Then restore, from the PWA project folder:

   ```
   npx convex import --prod --replace-all backup.zip
   ```

The copy holds data only. Code, environment variables and scheduled jobs
come from the repository and the Convex dashboard, so they stay as they are.
