-- Add Store / Tag Sales domain (revenue model).
-- Keeps physical tag inventory, orders and payments separate from the privacy
-- gateway. Money stored as integer paise.

-- Products catalogue
CREATE TABLE "products" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "sku" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_sku_key" ON "products"("sku");
CREATE INDEX "products_active_idx" ON "products"("active");
CREATE INDEX "products_sku_idx" ON "products"("sku");

-- Orders: add access_token (opaque guest token) and make user_id nullable
ALTER TABLE "orders" ADD COLUMN "access_token" TEXT;
ALTER TABLE "orders" ALTER COLUMN "user_id" DROP NOT NULL;

CREATE UNIQUE INDEX "orders_access_token_key" ON "orders"("access_token");
CREATE INDEX "orders_access_token_idx" ON "orders"("access_token");

-- Order items: add product_id reference to products
ALTER TABLE "order_items" ADD COLUMN "product_id" UUID;
CREATE INDEX "order_items_product_id_idx" ON "order_items"("product_id");

-- Delivery snapshot (one per order)
CREATE TABLE "addresses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address_lines" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postal_code" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "addresses_order_id_key" ON "addresses"("order_id");
CREATE INDEX "addresses_order_id_idx" ON "addresses"("order_id");

-- Payment reconciliation
CREATE TABLE "payments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_order_id" TEXT NOT NULL,
    "provider_payment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "amount_paise" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "payments_provider_order_id_key" ON "payments"("provider_order_id");
CREATE UNIQUE INDEX "payments_provider_payment_id_key" ON "payments"("provider_payment_id");
CREATE INDEX "payments_order_id_idx" ON "payments"("order_id");

-- Physical stock
CREATE TABLE "inventory" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "product_id" UUID NOT NULL,
    "quantity_on_hand" INTEGER NOT NULL DEFAULT 0,
    "quantity_reserved" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "inventory_product_id_key" ON "inventory"("product_id");

-- Physical QR tags (serial numbers separate from public tokens)
CREATE TABLE "physical_tags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "serial_number" TEXT NOT NULL,
    "tag_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "order_item_id" UUID,

    CONSTRAINT "physical_tags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "physical_tags_serial_number_key" ON "physical_tags"("serial_number");
CREATE UNIQUE INDEX "physical_tags_tag_id_key" ON "physical_tags"("tag_id");
CREATE UNIQUE INDEX "physical_tags_order_item_id_key" ON "physical_tags"("order_item_id");
CREATE INDEX "physical_tags_order_item_id_idx" ON "physical_tags"("order_item_id");

-- Shipments
CREATE TABLE "shipments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "order_id" UUID NOT NULL,
    "carrier" TEXT NOT NULL,
    "tracking_number" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "shipped_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "shipments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "shipments_tracking_number_key" ON "shipments"("tracking_number");
CREATE INDEX "shipments_order_id_idx" ON "shipments"("order_id");

-- Refunds
CREATE TABLE "refunds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "payment_id" UUID NOT NULL,
    "provider_refund_id" TEXT NOT NULL,
    "amount_paise" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT now(),

    CONSTRAINT "refunds_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "refunds_provider_refund_id_key" ON "refunds"("provider_refund_id");
CREATE INDEX "refunds_payment_id_idx" ON "refunds"("payment_id");

-- Foreign keys
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL;

ALTER TABLE "addresses" ADD CONSTRAINT "addresses_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;

ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;

ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;

ALTER TABLE "physical_tags" ADD CONSTRAINT "physical_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE;
ALTER TABLE "physical_tags" ADD CONSTRAINT "physical_tags_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL;

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE;

ALTER TABLE "inventory" ADD CONSTRAINT "inventory_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE;

ALTER TABLE "physical_tags" ADD CONSTRAINT "physical_tags_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE;
ALTER TABLE "physical_tags" ADD CONSTRAINT "physical_tags_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "order_items"("id") ON DELETE SET NULL;

ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE;

ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE CASCADE;
