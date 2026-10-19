# Demo account

`scripts/demo-seed.ts` creates the demo account from clothing photos and a
manifest with their attributes. It makes no AI call: the attributes are
written by hand, so the demo wardrobe is exactly what was prepared.

1. Photograph 8–20 clothes one by one, on a plain light background, in
   daylight (JPEG, PNG or WebP; at most 8 MB; the shortest side at least
   256 px). Put them in `demo/photos/`.
2. Copy `manifest.example.json` to `manifest.json` and describe each photo.
   Every value is a catalog id (`src/lib/ai/catalog.ts`); the script checks
   them with the API's own schemas.
3. Set the account in the environment, never in a file in the repository:
   `DEMO_EMAIL` and `DEMO_PASSWORD` (at least 8 characters). Use the server's
   `DATABASE_URL` and storage settings.
4. Check, then write:

   ```sh
   bun scripts/demo-seed.ts --manifest demo/manifest.json           # dry run
   bun scripts/demo-seed.ts --manifest demo/manifest.json --apply   # create
   bun scripts/demo-seed.ts --manifest demo/manifest.json --apply --reset  # replace the wardrobe
   ```

The demo user accepts the current legal version and confirms 18+ like a
registration. Running it again updates the name, password and preferences;
`--reset` deletes the earlier demo items and their images first. Photos and
`manifest.json` are git-ignored: they may show real clothes and stay out of
the repository.
