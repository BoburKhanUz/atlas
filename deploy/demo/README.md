# Demo account

`lookly demo-seed` creates the store reviewers' demo account from clothing photos and
a manifest with their attributes. It makes no AI call: the attributes are written by
hand, so the demo wardrobe is exactly what was prepared.

## Prepare

1. Photograph 8–20 clothes one by one, on a plain light background, in daylight
   (JPEG, PNG or WebP; at most 8 MB; each side 256–8000 px). Put them in
   `deploy/demo/photos/`.
2. Copy `manifest.example.json` to `manifest.json` (in this folder) and describe each
   photo. Every value is a catalog id (`apps/api/internal/catalog/catalog.json`); the
   command checks them with the server's own catalog rules: the subcategory belongs to
   the category, at least one colour (at most 5) and one season, the name 1–60
   characters, at most 5 preferred styles and 8 favourite colours, 1–60 items, each
   photo once, its path relative to the manifest and inside its folder.
3. The account comes from the environment, never from a file in the repository:
   `DEMO_EMAIL` and `DEMO_PASSWORD` (8 characters to 72 bytes, as at registration).
   The password is never printed.

`photos/` and `manifest.json` are git-ignored: the photos may show real clothes and
stay out of the repository.

## Run

```sh
lookly demo-seed --manifest deploy/demo/manifest.json                  # dry run
lookly demo-seed --manifest deploy/demo/manifest.json --apply          # create
lookly demo-seed --manifest deploy/demo/manifest.json --apply --reset  # replace the wardrobe
```

- The dry run reads the manifest and puts every photo through the upload's image
  pipeline; it writes nothing and does not touch the database.
- The command reads the server's configuration (`DATABASE_URL`, the storage settings
  and the rest) and does not run where it is not valid.
- Exit 0 ok, 1 a failure (an invalid manifest or photo, a wardrobe already there), 2 a
  usage or configuration error.

On a server, run it in the API's image with the server's settings, from the repository
root. Give the account through the environment: `-e NAME` without a value passes the
variable on, so the password is never on a command line (nor in the shell history or
the process list), and `read -rs` reads it without showing it:

```sh
chmod -R a+rX deploy/demo        # the image's user (uid 65532) reads the bind mount
read -r DEMO_EMAIL; read -rs DEMO_PASSWORD; export DEMO_EMAIL DEMO_PASSWORD
deploy/compose.sh run --rm --no-deps -v "$PWD/deploy/demo:/demo:ro" -e DEMO_EMAIL -e DEMO_PASSWORD \
  api demo-seed --manifest /demo/manifest.json                # dry run
deploy/compose.sh run --rm --no-deps -v "$PWD/deploy/demo:/demo:ro" -e DEMO_EMAIL -e DEMO_PASSWORD \
  api demo-seed --manifest /demo/manifest.json --apply
unset DEMO_PASSWORD
```

`--no-deps` leaves the running services alone (the database must be up); the `api`
service gives the command the server's settings and the uploads volume, so the photos
land where the server reads them (or in the R2 bucket).

## What it writes

- **A new account**: as a registration makes one: the user (the manifest's name), a
  profile, preferences (language `uz`, the manifest's preferred styles and favourite
  colours) and the current legal version accepted with 18+ confirmed.
- **An existing account** keeps its id; its name, password and preferences are
  updated, a missing profile, preferences or consent is made. A changed password ends
  its sessions (signed-in reviewers sign in again); the same password keeps them.
- **The wardrobe**: an account that already has items is refused (exit 1) and nothing
  changes, unless `--reset` is given: then the earlier items are deleted and their
  files removed. Each item is made as an upload makes one: the photo through the image
  pipeline (decided by its bytes, metadata such as the GPS position removed, the
  display and thumbnail variants made), the three files stored, the rows written with
  the manifest's attributes and the analysis `demo-seed` / `manual` / `demo-seed-1`.
  A failure removes that item's files and stops the run; the items before it stay,
  and the command says how many were made: run it again with `--apply --reset`.
