-- Indexes on the columns the images and outfit entries are found by: an
-- item's images (every wardrobe list and read), an outfit's entries, and the
-- rows that go with a deleted item or outfit (ON DELETE CASCADE). Without
-- them each of these read the whole table.
-- Indexes only: no row changes, and the Next.js API and older builds work
-- with or without them.

-- CreateIndex
CREATE INDEX "WardrobeImage_wardrobeItemId_idx" ON "WardrobeImage"("wardrobeItemId");

-- CreateIndex
CREATE INDEX "OutfitItem_outfitId_idx" ON "OutfitItem"("outfitId");

-- CreateIndex
CREATE INDEX "OutfitItem_wardrobeItemId_idx" ON "OutfitItem"("wardrobeItemId");
