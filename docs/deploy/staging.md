# Staging server runbook

Status: **not provisioned yet.** This runbook sets up one staging server with the existing Docker image: PostgreSQL 16, the one-shot migration, the web app and Caddy for HTTPS. The staging contract and the smoke test are in [`docs/ai/staging.md`](../ai/staging.md); the app's variables are described in [`.env.example`](../../.env.example), and `ATLAS_DOMAIN` is used only by the overlay and Caddy.

Files:

| File | Purpose |
|---|---|
| `deploy/compose.server.yml` | Overlay on `docker-compose.yml`: Caddy on ports 80/443, no database or app port on the host, restart policies, log rotation (5 × 10 MB per container), `TRUST_PROXY=1`, `PUBLIC_BASE_URL`, AI price variables |
| `deploy/Caddyfile` | HTTPS for `ATLAS_DOMAIN`; Caddy obtains and renews the certificate |
| `deploy/server.env.example` | Settings template with the hybrid AI configuration; copied to `deploy/server.env` (git-ignored) on the server |
| `deploy/compose.sh` | `docker compose` with the base file, the overlay and `deploy/server.env` |
| `deploy/backup.sh` | Database dump and uploads archive into `deploy/backups/<UTC time>/` (git-ignored) |

## What the owner provides

| Item | Requirement |
|---|---|
| Server | Ubuntu 24.04 or 26.04 LTS, public IPv4, SSH key login. Estimate: 2 vCPU, 4 GB RAM (the image is built on the server), 40 GB disk |
| Domain | A host name such as `staging-api.<your domain>` with a DNS **A** record pointing at the server |
| AI keys | `GEMINI_API_KEY` (text) and `OPENAI_API_KEY` (clothing photos) from billing-enabled accounts, each with a spending limit or budget alert set at the provider. Never a Gemini free-tier key: its content may be read by reviewers and used to improve Google's products |
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

Ports that Docker publishes bypass ufw. The overlay therefore publishes only 80 and 443; PostgreSQL and the app are reachable only inside the Compose network. The overlay uses Compose's `!reset` tag; it was checked with Docker Compose v5.3.1, so use the current Compose plugin that the script installs.

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

Set `ATLAS_DOMAIN` to the host name only (no `https://`). Keep the file on the server; never copy it into the repository, a chat or a ticket.

## 3. Start

```bash
deploy/compose.sh up -d --build
deploy/compose.sh ps
curl -fsS "https://<ATLAS_DOMAIN>/api/health"
```

Order: PostgreSQL starts, `migrate` applies the Prisma migrations and exits, `web` starts (healthcheck on `/api/health`), Caddy obtains the certificate. The web container refuses to start when a secret or the AI configuration is invalid: `deploy/compose.sh logs web` names the variable. Caddy's certificate problems (DNS not pointing here, port 80 closed) show in `deploy/compose.sh logs caddy`.

## 4. Smoke test (from a development machine)

The staging target runs real providers, so the smoke runs in real mode ([`docs/ai/staging.md`](../ai/staging.md)); one run costs about 5 billable AI requests:

```bash
cd apps/web
STAGING_BASE_URL=https://<ATLAS_DOMAIN> STAGING_SMOKE_PROVIDER=real STAGING_SMOKE_REAL_PROVIDER_OPT_IN=1 \
  bunx playwright test -c playwright.staging.config.ts
```

Record the date, the providers and the models with each run.

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
deploy/compose.sh up -d --build
```

`migrate` runs again before `web` restarts; the app is unavailable for the restart (usually seconds). There is one web container: rate limits are kept in memory, so do not scale it out.

## 7. Backups and restore

```bash
deploy/backup.sh    # writes deploy/backups/<UTC time>/atlas.dump and uploads.tgz
```

Copy each backup off the server (for example with `scp`). A daily cron entry: `0 3 * * * /path/to/atlas/deploy/backup.sh >> /path/to/backup.log 2>&1`. On production the backups hold personal data and need the same protection as the database.

Restore (replaces the current data):

```bash
deploy/compose.sh stop web caddy
deploy/compose.sh exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner' < deploy/backups/<time>/atlas.dump
deploy/compose.sh up -d
deploy/compose.sh exec -T web sh -c 'tar -xzf - -C /app/storage/uploads' < deploy/backups/<time>/uploads.tgz
```

The backup and restore commands have not been run against a live stack yet: test them once on staging before relying on them.

## Before production (not covered here)

- **Hosting location.** Uzbekistan's Law on Personal Data, Article 27-1 (added by law ZRU-666 of 14 January 2021, in force since 15 April 2021), requires personal data of Uzbek citizens to be stored on technical means physically located in Uzbekistan and registered in the State Register of personal databases ([Mondaq summary](https://mondaq.com/data-protection/1197754/the-law-on-personal-data-has-been-amended)). The production host, and the clothing photos and texts sent to the AI providers abroad, need legal review.
- **Legal texts.** The privacy policy and terms of use are in the app as drafts (`apps/web/src/lib/legal/documents.ts`, `LEGAL_DRAFT`): public at `/privacy` and `/terms`, in the mobile app, and registration records the accepted version and the 18+ confirmation (the Gemini API terms forbid apps likely to be accessed by people under 18). Counsel fills the `[placeholders]` and approves them; then `LEGAL_DRAFT` becomes false and `LEGAL_VERSION` changes.
- The release signing key, off-server backups and log monitoring ([`docs/ai/monitoring.md`](../ai/monitoring.md)).
