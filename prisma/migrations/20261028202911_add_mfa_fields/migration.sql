-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "mfa_recovery_codes" TEXT,
ADD COLUMN     "mfa_secret" TEXT;

-- CreateTable
CREATE TABLE "qr_size_configs" (
    "id" UUID NOT NULL,
    "size" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "qr_size_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qr_size_configs_size_key" ON "qr_size_configs"("size");
