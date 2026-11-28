# Staging server runbook

Status: **not provisioned yet** (owner decision 2026-11-28: the deployment to the VPS is a later stage). The stack below was run locally on 2026-11-28 with the files of this repository: `lookly migrate`, the API, the worker, the website and Caddy, checked through Caddy by `deploy/check-stack.py` (also run by CI on every push), and a backup and restore. HTTPS on a real domain and the phone against it are not checked yet. The staging contract is in [`docs/ai/staging.md`](../ai/staging.md); every variable is described in [`deploy/server.env.example`](../../deploy/server.env.example) and [`.env.example`](../../.env.example).

The stack (`docker-compose.yml`): PostgreSQL 16; `migrate` (the Go image, `lookly migrate`, once per start); `api` (`lookly serve`); `worker` (`lookly worker`: reset mail, the purge of a deleted account's images, the hourly cleanup and storage sweep); `web` (the website: landing page, legal pages, the reset-link page); `caddy`, the only published service, which sends `/api/*` to the API and everything else to the website.

Files:

| File | Purpose |
|---|---|
| `deploy/compose.server.yml` | Overlay on `docker-compose.yml`: Caddy on ports 80/443 for `ATLAS_DOMAIN`, no database port on the host, `LOOKLY_ENV` required, `PUBLIC_BASE_URL` from the domain, restart policies, log rotation (5 × 10 MB per container) |
| `deploy/Caddyfile` | The routing, and HTTPS for `ATLAS_DOMAIN`: Caddy obtains and renews the certificate and sends HSTS (the apps set their other security headers) |
| `deploy/server.env.example` | Settings template with the AI configuration (OpenAI only, owner decision 2026-11-27); copied to `deploy/server.env` (git-ignored) on the server |
| `deploy/compose.sh` | `docker compose` with the base file, the overlay and `deploy/server.env` |
| `deploy/check-stack.py` | Checks a running stack through Caddy: routing, security headers, sign-up, an upload and its signed image, a reset request; it creates and deletes one test account |
| `deploy/backup.sh` | Database dump and images archive into `deploy/backups/<UTC time>/` (git-ignored) |

## What the owner provides

| Item | Requirement |
|---|---|
| Server | Ubuntu 24.04 or 26.04 LTS, public IPv4, SSH key login. Estimate: 2 vCPU, 4 GB RAM (the images are built on the server), 40 GB disk |
| Domain | A host name such as `staging-api.<your domain>` with a DNS **A** record pointing at the server |
| AI key | `OPENAI_API_KEY` (text and clothing photos) from a billing-enabled account with a spending limit or budget alert set at the provider. Production does not use Gemini (owner decision 2026-11-27: its terms forbid apps likely to be used by people under 18) |
| Data | Staging holds test accounts and test images only ([`docs/ai/staging.md`](../ai/staging.md)) |

## 1. Prepare the server (once)

```bash
sudo apt update && sudo apt -y upgrade
# Docker Engine with the Compose plugin (https://docs.docker.com/engine/install/ubuntu/)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker "$USER"     # log out and in again
# Firewall: SSH, HTTP (certificate challenge, redirect) and HTTPS
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 443/udp
sudo ufw enable
```

Ports that Docker publishes bypass ufw. The overlay therefore publishes only 80 and 443; PostgreSQL, the API and the website are reachable only inside the Compose network. The overlay uses Compose's `!reset` tag; it was checked with Docker Compose v5.3.1, so use the current Compose plugin that the script installs.

## 2. Code and settings

```bash
git clone https://github.com/BoburKhanUz/atlas.git   # private: use a deploy key or a read-only token
cd atlas
git checkout <branch to deploy>                        # today: claude/kind-lovelace-jcagr9
cp deploy/server.env.example deploy/server.env
chmod 600 deploy/server.env
```

Fill in every empty value in `deploy/server.env`. Generate each secret separately:

```bash
openssl rand -hex 24      # POSTGRES_PASSWORD
openssl rand -base64 48   # JWT_SECRET, then again for MEDIA_SIGNING_SECRET
openssl rand -base64 32   # SESSION_ENC_KEY
```

Set `ATLAS_DOMAIN` to the host name only (no `https://`) and `LOOKLY_ENV` to `staging` (or `production`). Keep the file on the server; never copy it into the repository, a chat or a ticket.

Password reset e-mail: fill in the `SMTP_*` values and `MAIL_FROM` of any SMTP provider, then set `MAIL_TRANSPORT=smtp`. With `MAIL_TRANSPORT=disabled` (the template's value) the rest works and "forgot password" says reset is unavailable. The links point to `https://<ATLAS_DOMAIN>/reset-password`. Check it once after the start: request a reset for your own account; a failed send shows in the log as `password reset request failed` with the reason, for example `unable to verify the first certificate` or an authentication error (the user still sees the neutral answer).

## 3. Start

```bash
deploy/compose.sh up -d --build --wait
deploy/compose.sh ps
curl -fsS "https://<ATLAS_DOMAIN>/api/health"
```

Order: PostgreSQL starts; `migrate` makes or continues the schema and exits; the API and the worker start (each refuses to start when a secret, the storage, the mail or the AI configuration is invalid, and `deploy/compose.sh logs api` names the variable); the website starts; Caddy starts once the API and the website are healthy and obtains the certificate. Certificate problems (DNS not pointing here, port 80 closed) show in `deploy/compose.sh logs caddy`.

## 4. Check it (from a development machine)

```bash
python3 -I deploy/check-stack.py https://<ATLAS_DOMAIN>
```

It needs no key and makes no AI call when the stack's AI is switched off; with the AI on, its one upload is one clothing analysis (one billable request). The smoke with real providers (the stylist, the outfit explanation, the colour profile) comes back with B7.8 ([`docs/ai/staging.md`](../ai/staging.md)).

## 5. Phone build against staging

```bash
cd apps/mobile
cat > config/staging.json <<'JSON'
{ "ATLAS_ENV": "staging", "ATLAS_API_BASE_URL": "https://<ATLAS_DOMAIN>" }
JSON
flutter build apk --release -PallowDebugSigning=true --dart-define-from-file=config/staging.json
adb install -r build/app/outputs/flutter-apk/app-release.apk   # or copy the APK to the phone
```

`config/staging.json` is git-ignored. A debug-signed release build is for the team's own test phones only: never publish or share it outside the team ([`apps/mobile/config/README.md`](../../apps/mobile/config/README.md)).

## 6. Deploy a new version

```bash
git pull
deploy/compose.sh up -d --build --wait
```

`migrate` runs again before the API and the worker restart; requests fail for the seconds the API restarts. Rate limits and the job queue are in PostgreSQL, so nothing is lost on a restart.

## 7. Backups and restore

```bash
deploy/backup.sh    # writes deploy/backups/<UTC time>/atlas.dump and uploads.tgz
```

Copy each backup off the server (for example with `scp`). A daily cron entry: `0 3 * * * /path/to/atlas/deploy/backup.sh >> /path/to/backup.log 2>&1`. On production the backups hold personal data and need the same protection as the database. With `STORAGE_DRIVER=r2` the images are in the bucket, not in `uploads.tgz`.

Restore (replaces the current data):

```bash
deploy/compose.sh stop api worker caddy
deploy/compose.sh exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < deploy/backups/<time>/atlas.dump
deploy/compose.sh run --rm --no-deps -T --entrypoint tar -v atlas_uploads:/uploads postgres -xzf - -C /uploads < deploy/backups/<time>/uploads.tgz
deploy/compose.sh up -d --wait
```

## Before production (not covered here)

- **Hosting location.** Uzbekistan's Law on Personal Data, Article 27-1 (added by law ZRU-666 of 14 January 2021, in force since 15 April 2021), requires personal data of Uzbek citizens to be stored on technical means physically located in Uzbekistan and registered in the State Register of personal databases ([Mondaq summary](https://mondaq.com/data-protection/1197754/the-law-on-personal-data-has-been-amended)). The production host, and the clothing photos and texts sent to the AI providers abroad, need legal review.
- **Legal texts.** The privacy policy and terms of use are in the app as drafts (`apps/web/src/lib/legal/documents.ts`, `LEGAL_DRAFT`): public at `/privacy` and `/terms`, in the mobile app, and registration records the accepted version and the 18+ confirmation (the Gemini API terms forbid apps likely to be accessed by people under 18). Counsel fills the `[placeholders]` and approves them; then `LEGAL_DRAFT` becomes false, `LEGAL_VERSION` (and Go's `legal.Version`) changes and Go's `legal.MinConsentVersion` is raised to it (a Go test requires that once the texts are final), so every existing account accepts the approved texts once: the mobile app shows them for acceptance, and the API answers `CONSENT_REQUIRED` until then.
- The release signing key, off-server backups and log monitoring ([`docs/ai/monitoring.md`](../ai/monitoring.md)).
