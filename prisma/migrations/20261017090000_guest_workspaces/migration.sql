ALTER TABLE "users"
ADD COLUMN "isGuest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "guestExpiresAt" TIMESTAMP(3);

CREATE INDEX "users_isGuest_guestExpiresAt_idx"
ON "users"("isGuest", "guestExpiresAt");
