-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('OWNER', 'FAMILY_MANAGER', 'FAMILY_VIEWER', 'EMERGENCY_CONTACT', 'SOCIETY_OPERATOR', 'SUPPORT_AGENT', 'ADMIN', 'SUPER_ADMIN');

-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('VEHICLE', 'BIKE', 'HOME_DOOR', 'OFFICE', 'SOCIETY', 'PARKING', 'PROFESSIONAL', 'BUSINESS', 'DELIVERY', 'EQUIPMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "TagType" AS ENUM ('PHYSICAL_QR', 'DIGITAL_QR', 'NFC', 'QR_NFC', 'DOOR', 'VEHICLE', 'BIKE', 'PARKING', 'PROFESSIONAL', 'BUSINESS');

-- CreateEnum
CREATE TYPE "TagStatus" AS ENUM ('CREATED', 'UNASSIGNED', 'ACTIVATION_PENDING', 'ACTIVE', 'SUSPENDED', 'TRANSFER_PENDING', 'TRANSFERRED', 'DEACTIVATED', 'LOST');

-- CreateEnum
CREATE TYPE "AssetEventType" AS ENUM ('TAG_SCAN', 'CALL_STARTED', 'CALL_ENDED', 'SMS_SENT', 'WHATSAPP_SENT', 'MESSAGE_SENT', 'LOCATION_SHARED', 'VEHICLE_IN', 'VEHICLE_OUT', 'EMERGENCY_TRIGGERED', 'TAG_ACTIVATED', 'TAG_DEACTIVATED', 'TAG_TRANSFERRED');

-- CreateEnum
CREATE TYPE "Channel" AS ENUM ('VOICE', 'VIDEO', 'SMS', 'WHATSAPP', 'CHAT', 'PUSH');

-- CreateEnum
CREATE TYPE "CommunicationStatus" AS ENUM ('CREATED', 'PENDING', 'RINGING', 'ACTIVE', 'COMPLETED', 'FAILED', 'REJECTED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'EXPIRED', 'BLOCKED');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('REGISTRATION_CERTIFICATE', 'INSURANCE', 'PUC', 'FASTAG', 'SERVICE_RECORD', 'IDENTITY', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING_SCAN', 'AVAILABLE', 'QUARANTINED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "FamilyPermission" AS ENUM ('VIEW', 'RECEIVE_ALERTS', 'REPLY', 'MANAGE_TAGS', 'EMERGENCY_ONLY');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'CONFIRMED', 'PACKED', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "publicId" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'OWNER',
    "status" "UserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "name_encrypted" TEXT,
    "phone_encrypted" TEXT NOT NULL,
    "phone_lookup_hmac" TEXT NOT NULL,
    "email_encrypted" TEXT,
    "email_lookup_hmac" TEXT,
    "push_token_encrypted" TEXT,
    "platform" TEXT,
    "app_version" TEXT,
    "enabled_channels" TEXT[] DEFAULT ARRAY['VOICE', 'SMS', 'WHATSAPP', 'CHAT']::TEXT[],
    "allow_location_share" BOOLEAN NOT NULL DEFAULT false,
    "allow_video_calls" BOOLEAN NOT NULL DEFAULT false,
    "allow_unknown_callers" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "jti" TEXT NOT NULL,
    "user_agent" TEXT,
    "ip_hash" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "device_public_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "app_version" TEXT,
    "push_token_encrypted" TEXT,
    "risk_state" TEXT NOT NULL DEFAULT 'TRUSTED',
    "last_seen_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "assets" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "asset_type" "AssetType" NOT NULL,
    "display_name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tags" (
    "id" UUID NOT NULL,
    "public_tag_id" TEXT NOT NULL,
    "public_token_hash" TEXT NOT NULL,
    "public_token_encrypted" TEXT NOT NULL,
    "tag_type" "TagType" NOT NULL,
    "status" "TagStatus" NOT NULL DEFAULT 'CREATED',
    "asset_id" UUID,
    "owner_id" UUID NOT NULL,
    "nfc_uid_hash" TEXT,
    "label" TEXT,
    "activated_at" TIMESTAMP(3),
    "deactivated_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_transfers" (
    "id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "otp_sent_to" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicles" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "registration_encrypted" TEXT NOT NULL,
    "registration_lookup_hmac" TEXT NOT NULL,
    "registration_ending" TEXT NOT NULL,
    "make" TEXT,
    "model" TEXT,
    "variant" TEXT,
    "color" TEXT,
    "year" INTEGER,
    "vehicle_type" TEXT,
    "fuel_type" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "insurance_expiry" DATE,
    "puc_expiry" DATE,
    "fastag_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tag_events" (
    "id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "event_type" "AssetEventType" NOT NULL,
    "scanner_session_id" UUID,
    "metadata" JSONB,
    "ip_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tag_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vehicle_events" (
    "id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "tag_id" UUID,
    "event_type" "AssetEventType" NOT NULL,
    "description" TEXT,
    "geo" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vehicle_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scanner_sessions" (
    "id" UUID NOT NULL,
    "public_session_id" TEXT NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "tag_id" UUID NOT NULL,
    "reason_code" TEXT,
    "phone_lookup_hmac" TEXT,
    "phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "ip_hash" TEXT,
    "device_fingerprint_hash" TEXT,
    "user_agent" TEXT,
    "riskScore" INTEGER NOT NULL DEFAULT 0,
    "risk_state" TEXT NOT NULL DEFAULT 'LOW',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scanner_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_sessions" (
    "id" UUID NOT NULL,
    "public_session_id" TEXT NOT NULL,
    "tag_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "scanner_session_id" UUID NOT NULL,
    "channel" "Channel" NOT NULL,
    "status" "CommunicationStatus" NOT NULL DEFAULT 'CREATED',
    "reason_code" TEXT,
    "provider" TEXT,
    "provider_session_id" TEXT,
    "relay_reference" TEXT,
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "requires_otp" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "connected_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "communication_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_sessions" (
    "id" UUID NOT NULL,
    "communication_session_id" UUID NOT NULL,
    "relay_number_reference" TEXT NOT NULL,
    "caller_reference" TEXT NOT NULL,
    "callee_reference" TEXT NOT NULL,
    "provider_call_sid" TEXT,
    "status" TEXT NOT NULL DEFAULT 'INITIATED',
    "durationSeconds" INTEGER NOT NULL DEFAULT 0,
    "recording_reference" TEXT,
    "hangup_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "communication_session_id" UUID NOT NULL,
    "sender_type" TEXT NOT NULL,
    "sender_reference" TEXT NOT NULL,
    "recipient_type" TEXT NOT NULL,
    "recipient_reference" TEXT NOT NULL,
    "channel" "Channel" NOT NULL,
    "body_ciphertext" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "provider_message_id" TEXT,
    "template_key" TEXT,
    "moderation_state" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "subject_hash" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "consumed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name_encrypted" TEXT NOT NULL,
    "relationship_encrypted" TEXT NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "phone_lookup_hmac" TEXT,
    "priority" INTEGER NOT NULL DEFAULT 1,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_profiles" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "blood_group_encrypted" TEXT,
    "insurance_provider_encrypted" TEXT,
    "insurance_policy_encrypted" TEXT,
    "first_responder_note_encrypted" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_alerts" (
    "id" UUID NOT NULL,
    "scanner_session_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "reason_code" TEXT,
    "note" TEXT,
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'RAISED',
    "notified_contact_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "emergency_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_share_requests" (
    "id" UUID NOT NULL,
    "scanner_session_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMP(3),

    CONSTRAINT "location_share_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "location_shares" (
    "id" UUID NOT NULL,
    "public_share_id" TEXT NOT NULL,
    "request_id" UUID,
    "owner_id" UUID NOT NULL,
    "asset_id" UUID,
    "location_ciphertext" TEXT NOT NULL,
    "accuracy_meters" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "view_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "location_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "geofences" (
    "id" UUID NOT NULL,
    "tag_id" UUID NOT NULL,
    "center_ciphertext" TEXT NOT NULL,
    "radius_meters" INTEGER NOT NULL DEFAULT 150,
    "allowed_channels" "Channel"[] DEFAULT ARRAY['CHAT', 'VOICE']::"Channel"[],
    "active_schedule" TEXT,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 60,
    "alert_on_proximity" BOOLEAN NOT NULL DEFAULT false,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_triggered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "geofences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "documents" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "asset_id" UUID,
    "document_type" "DocumentType" NOT NULL,
    "object_key" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "encryption_key_reference" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING_SCAN',
    "scan_finding" TEXT,
    "expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_members" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "name_encrypted" TEXT NOT NULL,
    "relationship_encrypted" TEXT NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "phone_lookup_hmac" TEXT,
    "linked_user_id" UUID,
    "permissions" "FamilyPermission"[] DEFAULT ARRAY['VIEW']::"FamilyPermission"[],
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_memberships" (
    "id" UUID NOT NULL,
    "family_member_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "family_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "societies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "city_encrypted" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "societies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "society_staff" (
    "id" UUID NOT NULL,
    "society_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'SECURITY',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "society_staff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buildings" (
    "id" UUID NOT NULL,
    "society_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "address_ciphertext" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "buildings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flats" (
    "id" UUID NOT NULL,
    "building_id" UUID NOT NULL,
    "flat_number" TEXT NOT NULL,
    "owner_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "residents" (
    "id" UUID NOT NULL,
    "flat_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "residents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_slots" (
    "id" UUID NOT NULL,
    "society_id" UUID NOT NULL,
    "building_id" UUID,
    "flat_id" UUID,
    "slot_code" TEXT NOT NULL,
    "slot_type" TEXT NOT NULL DEFAULT 'RESIDENT',
    "status" TEXT NOT NULL DEFAULT 'AVAILABLE',
    "qr_tag_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "parking_slots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "parking_allocations" (
    "id" UUID NOT NULL,
    "slot_id" UUID NOT NULL,
    "vehicle_id" UUID NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "parking_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "order_number" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "subtotal" INTEGER NOT NULL,
    "tax" INTEGER NOT NULL DEFAULT 0,
    "discount" INTEGER NOT NULL DEFAULT 0,
    "shipping_fee" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL,
    "address_ciphertext" TEXT,
    "provider" TEXT,
    "provider_order_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_items" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "product_code" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unit_price" INTEGER NOT NULL,
    "total" INTEGER NOT NULL,

    CONSTRAINT "order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "plan_code" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "payment_status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "provider_subscription_id" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "cancel_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provider_configs" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "provider_type" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "secret_ref" TEXT,
    "config" JSONB,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assigned_to" UUID,
    "body" TEXT NOT NULL,
    "resolution" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "abuse_reports" (
    "id" UUID NOT NULL,
    "reporter_type" TEXT NOT NULL,
    "reporter_ref" TEXT NOT NULL,
    "tag_id" UUID,
    "scanner_session_id" UUID,
    "reason" TEXT NOT NULL,
    "details" TEXT,
    "risk_score" INTEGER NOT NULL DEFAULT 0,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "action_taken" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "abuse_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rollout_pct" INTEGER NOT NULL DEFAULT 100,
    "rules" JSONB,
    "updated_by" UUID,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actor_user_id" UUID,
    "actor_role" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "outcome" TEXT NOT NULL DEFAULT 'SUCCESS',
    "ip_hash" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_metrics" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "metric" TEXT NOT NULL,
    "dimensions" JSONB,
    "value" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "vehicle_id" UUID,
    "reminder_type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "due_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "handler" TEXT NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "payload_digest" TEXT,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_publicId_key" ON "users"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_lookup_hmac_key" ON "users"("phone_lookup_hmac");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_lookup_hmac_key" ON "users"("email_lookup_hmac");

-- CreateIndex
CREATE INDEX "users_status_idx" ON "users"("status");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_jti_key" ON "refresh_tokens"("jti");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "devices_device_public_id_key" ON "devices"("device_public_id");

-- CreateIndex
CREATE INDEX "assets_owner_id_idx" ON "assets"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_public_tag_id_key" ON "tags"("public_tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "tags_public_token_hash_key" ON "tags"("public_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "tags_nfc_uid_hash_key" ON "tags"("nfc_uid_hash");

-- CreateIndex
CREATE INDEX "tags_owner_id_idx" ON "tags"("owner_id");

-- CreateIndex
CREATE INDEX "tags_status_idx" ON "tags"("status");

-- CreateIndex
CREATE INDEX "tag_transfers_tag_id_idx" ON "tag_transfers"("tag_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_asset_id_key" ON "vehicles"("asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "vehicles_registration_lookup_hmac_key" ON "vehicles"("registration_lookup_hmac");

-- CreateIndex
CREATE INDEX "vehicles_owner_id_idx" ON "vehicles"("owner_id");

-- CreateIndex
CREATE INDEX "vehicles_registration_lookup_hmac_idx" ON "vehicles"("registration_lookup_hmac");

-- CreateIndex
CREATE INDEX "tag_events_tag_id_created_at_idx" ON "tag_events"("tag_id", "created_at");

-- CreateIndex
CREATE INDEX "vehicle_events_vehicle_id_created_at_idx" ON "vehicle_events"("vehicle_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "scanner_sessions_public_session_id_key" ON "scanner_sessions"("public_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "scanner_sessions_session_token_hash_key" ON "scanner_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "scanner_sessions_tag_id_created_at_idx" ON "scanner_sessions"("tag_id", "created_at");

-- CreateIndex
CREATE INDEX "scanner_sessions_ip_hash_idx" ON "scanner_sessions"("ip_hash");

-- CreateIndex
CREATE INDEX "scanner_sessions_expires_at_idx" ON "scanner_sessions"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "communication_sessions_public_session_id_key" ON "communication_sessions"("public_session_id");

-- CreateIndex
CREATE INDEX "communication_sessions_tag_id_created_at_idx" ON "communication_sessions"("tag_id", "created_at");

-- CreateIndex
CREATE INDEX "communication_sessions_owner_id_created_at_idx" ON "communication_sessions"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "communication_sessions_status_idx" ON "communication_sessions"("status");

-- CreateIndex
CREATE UNIQUE INDEX "call_sessions_communication_session_id_key" ON "call_sessions"("communication_session_id");

-- CreateIndex
CREATE INDEX "messages_communication_session_id_created_at_idx" ON "messages"("communication_session_id", "created_at");

-- CreateIndex
CREATE INDEX "otp_challenges_subject_hash_purpose_idx" ON "otp_challenges"("subject_hash", "purpose");

-- CreateIndex
CREATE INDEX "emergency_contacts_owner_id_enabled_idx" ON "emergency_contacts"("owner_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_profiles_asset_id_key" ON "emergency_profiles"("asset_id");

-- CreateIndex
CREATE INDEX "emergency_alerts_owner_id_created_at_idx" ON "emergency_alerts"("owner_id", "created_at");

-- CreateIndex
CREATE INDEX "location_share_requests_owner_id_status_idx" ON "location_share_requests"("owner_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "location_shares_public_share_id_key" ON "location_shares"("public_share_id");

-- CreateIndex
CREATE UNIQUE INDEX "location_shares_request_id_key" ON "location_shares"("request_id");

-- CreateIndex
CREATE INDEX "location_shares_owner_id_idx" ON "location_shares"("owner_id");

-- CreateIndex
CREATE INDEX "location_shares_expires_at_idx" ON "location_shares"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "geofences_tag_id_key" ON "geofences"("tag_id");

-- CreateIndex
CREATE INDEX "documents_owner_id_document_type_idx" ON "documents"("owner_id", "document_type");

-- CreateIndex
CREATE INDEX "family_members_owner_id_idx" ON "family_members"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "family_memberships_family_member_id_user_id_key" ON "family_memberships"("family_member_id", "user_id");

-- CreateIndex
CREATE INDEX "societies_owner_id_idx" ON "societies"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "society_staff_society_id_user_id_key" ON "society_staff"("society_id", "user_id");

-- CreateIndex
CREATE INDEX "buildings_society_id_idx" ON "buildings"("society_id");

-- CreateIndex
CREATE UNIQUE INDEX "flats_building_id_flat_number_key" ON "flats"("building_id", "flat_number");

-- CreateIndex
CREATE UNIQUE INDEX "residents_flat_id_user_id_key" ON "residents"("flat_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "parking_slots_society_id_slot_code_key" ON "parking_slots"("society_id", "slot_code");

-- CreateIndex
CREATE INDEX "parking_allocations_vehicle_id_idx" ON "parking_allocations"("vehicle_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_order_number_key" ON "orders"("order_number");

-- CreateIndex
CREATE INDEX "orders_user_id_created_at_idx" ON "orders"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "subscriptions_user_id_status_idx" ON "subscriptions"("user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "provider_configs_key_key" ON "provider_configs"("key");

-- CreateIndex
CREATE INDEX "support_tickets_status_priority_idx" ON "support_tickets"("status", "priority");

-- CreateIndex
CREATE INDEX "abuse_reports_tag_id_idx" ON "abuse_reports"("tag_id");

-- CreateIndex
CREATE INDEX "abuse_reports_state_idx" ON "abuse_reports"("state");

-- CreateIndex
CREATE INDEX "audit_logs_actor_user_id_created_at_idx" ON "audit_logs"("actor_user_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_resource_type_resource_id_idx" ON "audit_logs"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- CreateIndex
CREATE INDEX "daily_metrics_metric_date_idx" ON "daily_metrics"("metric", "date");

-- CreateIndex
CREATE UNIQUE INDEX "daily_metrics_date_metric_key" ON "daily_metrics"("date", "metric");

-- CreateIndex
CREATE INDEX "reminders_status_due_at_idx" ON "reminders"("status", "due_at");

-- CreateIndex
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events"("received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_handler_provider_event_id_key" ON "webhook_events"("handler", "provider_event_id");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "assets" ADD CONSTRAINT "assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tags" ADD CONSTRAINT "tags_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_transfers" ADD CONSTRAINT "tag_transfers_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_events" ADD CONSTRAINT "tag_events_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tag_events" ADD CONSTRAINT "tag_events_scanner_session_id_fkey" FOREIGN KEY ("scanner_session_id") REFERENCES "scanner_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vehicle_events" ADD CONSTRAINT "vehicle_events_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scanner_sessions" ADD CONSTRAINT "scanner_sessions_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_sessions" ADD CONSTRAINT "communication_sessions_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_sessions" ADD CONSTRAINT "communication_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_sessions" ADD CONSTRAINT "communication_sessions_scanner_session_id_fkey" FOREIGN KEY ("scanner_session_id") REFERENCES "scanner_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_sessions" ADD CONSTRAINT "call_sessions_communication_session_id_fkey" FOREIGN KEY ("communication_session_id") REFERENCES "communication_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_communication_session_id_fkey" FOREIGN KEY ("communication_session_id") REFERENCES "communication_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_profiles" ADD CONSTRAINT "emergency_profiles_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_alerts" ADD CONSTRAINT "emergency_alerts_scanner_session_id_fkey" FOREIGN KEY ("scanner_session_id") REFERENCES "scanner_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_share_requests" ADD CONSTRAINT "location_share_requests_scanner_session_id_fkey" FOREIGN KEY ("scanner_session_id") REFERENCES "scanner_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_shares" ADD CONSTRAINT "location_shares_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "location_share_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_shares" ADD CONSTRAINT "location_shares_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "location_shares" ADD CONSTRAINT "location_shares_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "geofences" ADD CONSTRAINT "geofences_tag_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_members" ADD CONSTRAINT "family_members_linked_user_id_fkey" FOREIGN KEY ("linked_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_memberships" ADD CONSTRAINT "family_memberships_family_member_id_fkey" FOREIGN KEY ("family_member_id") REFERENCES "family_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_memberships" ADD CONSTRAINT "family_memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "societies" ADD CONSTRAINT "societies_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "society_staff" ADD CONSTRAINT "society_staff_society_id_fkey" FOREIGN KEY ("society_id") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "buildings" ADD CONSTRAINT "buildings_society_id_fkey" FOREIGN KEY ("society_id") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "flats" ADD CONSTRAINT "flats_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residents" ADD CONSTRAINT "residents_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residents" ADD CONSTRAINT "residents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_society_id_fkey" FOREIGN KEY ("society_id") REFERENCES "societies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_building_id_fkey" FOREIGN KEY ("building_id") REFERENCES "buildings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_slots" ADD CONSTRAINT "parking_slots_flat_id_fkey" FOREIGN KEY ("flat_id") REFERENCES "flats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_allocations" ADD CONSTRAINT "parking_allocations_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "parking_slots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "parking_allocations" ADD CONSTRAINT "parking_allocations_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
