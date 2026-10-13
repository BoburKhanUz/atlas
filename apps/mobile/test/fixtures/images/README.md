# Image test fixtures

Generated with ImageMagick 6 (`convert`), except `sample.heic`.

| File | Content | Command |
|---|---|---|
| `plain_landscape.jpg` | 640×480; red 160×120 block top-left, blue block bottom-right; no metadata | `convert -size 640x480 xc:white -fill red -draw "rectangle 0,0 159,119" -fill blue -draw "rectangle 480,360 639,479" -quality 92 plain_landscape.jpg` |
| `rotated_cw90_reference.jpg` | the same pixels rotated 90° clockwise (what EXIF orientation 6 must produce): 480×640, red block top-right | `convert plain_landscape.jpg -rotate 90 -strip -quality 92 rotated_cw90_reference.jpg` |
| `tiny.jpg` | 200×200 grey (below the 256 px minimum) | `convert -size 200x200 xc:gray -quality 90 tiny.jpg` |
| `plain.png` | 640×480 PNG, red block top-left | `convert -size 640x480 xc:white -fill red -draw "rectangle 0,0 159,119" plain.png` |
| `selfie_portrait.jpg` | 600×800 synthetic selfie (face, skin, even light) that passes the backend's colour-profile photo-quality checks; no metadata | `selfie()` from `apps/web/tests/unit/ai/selfie-fixtures.ts` (seeded, deterministic), saved with sharp as JPEG quality 92 |
| `sample.heic` | a real HEIC photo, 300×400 (`ispe`), ftyp `heic`, brands `mif1 miaf` | `grill_chicken.heic` from the Flutter engine test resources (BSD-3-Clause, The Flutter Authors) |

EXIF test data (orientation, GPS, XMP) is added in the tests themselves
(`test/support/jpeg_fixtures.dart`), never stored here.
