-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('X', 'FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "DeploymentEnvironment" AS ENUM ('DEVELOPMENT', 'STAGING', 'PRODUCTION');

-- CreateEnum
CREATE TYPE "PlatformAppStatus" AS ENUM ('ACTIVE', 'DISABLED');

-- CreateEnum
CREATE TYPE "SocialAccountStatus" AS ENUM ('ACTIVE', 'REAUTH_REQUIRED', 'DISCONNECTED', 'DISABLED');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'VALIDATING', 'VALIDATION_FAILED', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'RETRY_WAITING', 'RESULT_UNKNOWN', 'RECONCILING', 'REAUTH_REQUIRED', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "OAuthConnectionStatus" AS ENUM ('ACTIVE', 'REAUTH_REQUIRED', 'REVOKED', 'ERROR');

-- CreateEnum
CREATE TYPE "OAuthTokenStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO');

-- CreateEnum
CREATE TYPE "MediaSource" AS ENUM ('UPLOAD', 'REMOTE_IMPORT', 'GENERATED');

-- CreateEnum
CREATE TYPE "MediaAssetStatus" AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'PROCESSING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "MediaVariantKind" AS ENUM ('ORIGINAL', 'THUMBNAIL', 'PLATFORM_IMAGE', 'PLATFORM_VIDEO');

-- CreateEnum
CREATE TYPE "MediaVariantStatus" AS ENUM ('PENDING', 'PROCESSING', 'READY', 'FAILED', 'DELETED');

-- CreateEnum
CREATE TYPE "OutboxEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'PUBLISHED', 'DEAD_LETTER');

-- CreateEnum
CREATE TYPE "WebhookInboxStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'RETRY_WAITING', 'PROCESSED', 'IGNORED', 'DEAD_LETTER');

-- CreateTable
CREATE TABLE "workspaces" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "default_locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_apps" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "name" TEXT NOT NULL,
    "environment" "DeploymentEnvironment" NOT NULL,
    "public_client_id" TEXT NOT NULL,
    "api_version" TEXT,
    "redirect_uri" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" "PlatformAppStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_versions" (
    "id" UUID NOT NULL,
    "platform_app_id" UUID NOT NULL,
    "credential_type" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "encrypted_dek" BYTEA NOT NULL,
    "envelope_version" INTEGER NOT NULL DEFAULT 1,
    "cipher_suite" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "nonce" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "kek_version" TEXT NOT NULL,
    "masked_value" TEXT,
    "scopes" TEXT[],
    "expires_at" TIMESTAMP(3),
    "status" "CredentialStatus" NOT NULL,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,

    CONSTRAINT "credential_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "social_accounts" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "platform_app_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "remote_id" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "username" TEXT,
    "status" "SocialAccountStatus" NOT NULL,
    "capabilities" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_connections" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "platform_app_id" UUID NOT NULL,
    "social_account_id" UUID NOT NULL,
    "provider_subject" TEXT NOT NULL,
    "status" "OAuthConnectionStatus" NOT NULL,
    "granted_scopes" TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "oauth_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_token_versions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "platform_app_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "OAuthTokenStatus" NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "encrypted_dek" BYTEA NOT NULL,
    "envelope_version" INTEGER NOT NULL DEFAULT 1,
    "cipher_suite" TEXT NOT NULL DEFAULT 'AES-256-GCM',
    "nonce" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "kek_version" TEXT NOT NULL,
    "scopes" TEXT[],
    "refreshable" BOOLEAN NOT NULL,
    "access_token_expires_at" TIMESTAMP(3),
    "refresh_token_expires_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by" TEXT,

    CONSTRAINT "oauth_token_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contents" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content_versions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "content_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "source_locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "body" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "content_version_id" UUID NOT NULL,
    "social_account_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "status" "PublicationStatus" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "content_locale" TEXT NOT NULL DEFAULT 'zh-CN',
    "scheduled_at" TIMESTAMP(3),
    "settings" JSONB NOT NULL,
    "remote_post_id" TEXT,
    "remote_post_url" TEXT,
    "published_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_attempts" (
    "id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "credential_version_id" UUID,
    "oauth_token_version_id" UUID,
    "attempt_no" INTEGER NOT NULL,
    "stage" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "platform_request_id" TEXT,
    "http_status" INTEGER,
    "error_code" TEXT,
    "error_class" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL,
    "finished_at" TIMESTAMP(3),

    CONSTRAINT "publication_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL,
    "source" "MediaSource" NOT NULL,
    "status" "MediaAssetStatus" NOT NULL,
    "original_filename" TEXT,
    "storage_provider" TEXT NOT NULL,
    "storage_bucket" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "failure_code" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "media_variants" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "platform" "Platform",
    "kind" "MediaVariantKind" NOT NULL,
    "profile" TEXT NOT NULL,
    "status" "MediaVariantStatus" NOT NULL,
    "storage_provider" TEXT NOT NULL,
    "storage_bucket" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "checksum_sha256" TEXT NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "duration_ms" INTEGER,
    "transformation" JSONB NOT NULL,
    "failure_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "media_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_media" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "media_asset_id" UUID NOT NULL,
    "media_variant_id" UUID,
    "position" INTEGER NOT NULL,
    "role" TEXT NOT NULL,
    "alt_text" TEXT,
    "remote_media_id" TEXT,
    "remote_container_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "publication_media_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_version" INTEGER,
    "event_type" TEXT NOT NULL,
    "schema_version" INTEGER NOT NULL DEFAULT 1,
    "deduplication_key" TEXT NOT NULL,
    "trace_id" TEXT,
    "payload" JSONB NOT NULL,
    "status" "OutboxEventStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "occurred_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "locked_by" TEXT,
    "published_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_inbox" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "platform_app_id" UUID NOT NULL,
    "platform" "Platform" NOT NULL,
    "provider_event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "signature_algorithm" TEXT NOT NULL,
    "signature_verified_at" TIMESTAMP(3) NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookInboxStatus" NOT NULL DEFAULT 'RECEIVED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMP(3),
    "locked_by" TEXT,
    "processed_at" TIMESTAMP(3),
    "last_error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhook_inbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_apps_workspace_id_platform_name_key" ON "platform_apps"("workspace_id", "platform", "name");

-- CreateIndex
CREATE UNIQUE INDEX "platform_apps_workspace_id_id_key" ON "platform_apps"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_apps_workspace_id_id_platform_key" ON "platform_apps"("workspace_id", "id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "credential_versions_platform_app_id_credential_type_version_key" ON "credential_versions"("platform_app_id", "credential_type", "version_no");

-- CreateIndex
CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "audit_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_target_type_target_id_idx" ON "audit_events"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_workspace_id_platform_remote_id_key" ON "social_accounts"("workspace_id", "platform", "remote_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_workspace_id_id_key" ON "social_accounts"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_workspace_id_id_platform_key" ON "social_accounts"("workspace_id", "id", "platform");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_workspace_id_id_platform_app_id_key" ON "social_accounts"("workspace_id", "id", "platform_app_id");

-- CreateIndex
CREATE INDEX "oauth_connections_workspace_id_platform_app_id_status_idx" ON "oauth_connections"("workspace_id", "platform_app_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_connections_workspace_id_social_account_id_platform_a_key" ON "oauth_connections"("workspace_id", "social_account_id", "platform_app_id");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_connections_workspace_id_platform_app_id_provider_sub_key" ON "oauth_connections"("workspace_id", "platform_app_id", "provider_subject");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_connections_workspace_id_platform_app_id_id_key" ON "oauth_connections"("workspace_id", "platform_app_id", "id");

-- CreateIndex
CREATE INDEX "oauth_token_versions_workspace_id_platform_app_id_status_idx" ON "oauth_token_versions"("workspace_id", "platform_app_id", "status");

-- CreateIndex
CREATE INDEX "oauth_token_versions_connection_id_status_idx" ON "oauth_token_versions"("connection_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "oauth_token_versions_connection_id_version_no_key" ON "oauth_token_versions"("connection_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "contents_workspace_id_id_key" ON "contents"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "content_versions_content_id_version_no_key" ON "content_versions"("content_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "content_versions_workspace_id_id_key" ON "content_versions"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "publications_status_scheduled_at_idx" ON "publications"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "publications_workspace_id_idempotency_key_key" ON "publications"("workspace_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "publications_platform_social_account_id_remote_post_id_key" ON "publications"("platform", "social_account_id", "remote_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "publications_workspace_id_id_key" ON "publications"("workspace_id", "id");

-- CreateIndex
CREATE INDEX "publication_attempts_oauth_token_version_id_idx" ON "publication_attempts"("oauth_token_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "publication_attempts_publication_id_attempt_no_stage_key" ON "publication_attempts"("publication_id", "attempt_no", "stage");

-- CreateIndex
CREATE INDEX "media_assets_workspace_id_checksum_sha256_idx" ON "media_assets"("workspace_id", "checksum_sha256");

-- CreateIndex
CREATE INDEX "media_assets_workspace_id_status_created_at_idx" ON "media_assets"("workspace_id", "status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_workspace_id_id_key" ON "media_assets"("workspace_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_workspace_id_storage_bucket_storage_key_key" ON "media_assets"("workspace_id", "storage_bucket", "storage_key");

-- CreateIndex
CREATE INDEX "media_variants_workspace_id_media_asset_id_status_idx" ON "media_variants"("workspace_id", "media_asset_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "media_variants_workspace_id_id_media_asset_id_key" ON "media_variants"("workspace_id", "id", "media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "media_variants_workspace_id_media_asset_id_profile_key" ON "media_variants"("workspace_id", "media_asset_id", "profile");

-- CreateIndex
CREATE UNIQUE INDEX "media_variants_workspace_id_storage_bucket_storage_key_key" ON "media_variants"("workspace_id", "storage_bucket", "storage_key");

-- CreateIndex
CREATE INDEX "publication_media_workspace_id_media_asset_id_idx" ON "publication_media"("workspace_id", "media_asset_id");

-- CreateIndex
CREATE UNIQUE INDEX "publication_media_publication_id_position_key" ON "publication_media"("publication_id", "position");

-- CreateIndex
CREATE INDEX "outbox_events_status_available_at_locked_until_idx" ON "outbox_events"("status", "available_at", "locked_until");

-- CreateIndex
CREATE INDEX "outbox_events_workspace_id_aggregate_type_aggregate_id_crea_idx" ON "outbox_events"("workspace_id", "aggregate_type", "aggregate_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_events_workspace_id_deduplication_key_key" ON "outbox_events"("workspace_id", "deduplication_key");

-- CreateIndex
CREATE INDEX "webhook_inbox_status_available_at_locked_until_idx" ON "webhook_inbox"("status", "available_at", "locked_until");

-- CreateIndex
CREATE INDEX "webhook_inbox_workspace_id_platform_received_at_idx" ON "webhook_inbox"("workspace_id", "platform", "received_at");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_inbox_workspace_id_platform_app_id_provider_event_i_key" ON "webhook_inbox"("workspace_id", "platform_app_id", "provider_event_id");

-- AddForeignKey
ALTER TABLE "platform_apps" ADD CONSTRAINT "platform_apps_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_versions" ADD CONSTRAINT "credential_versions_platform_app_id_fkey" FOREIGN KEY ("platform_app_id") REFERENCES "platform_apps"("id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspace_id_platform_app_id_platform_fkey" FOREIGN KEY ("workspace_id", "platform_app_id", "platform") REFERENCES "platform_apps"("workspace_id", "id", "platform") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_workspace_id_platform_app_id_fkey" FOREIGN KEY ("workspace_id", "platform_app_id") REFERENCES "platform_apps"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_connections" ADD CONSTRAINT "oauth_connections_workspace_id_social_account_id_platform__fkey" FOREIGN KEY ("workspace_id", "social_account_id", "platform_app_id") REFERENCES "social_accounts"("workspace_id", "id", "platform_app_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "oauth_token_versions" ADD CONSTRAINT "oauth_token_versions_workspace_id_platform_app_id_connecti_fkey" FOREIGN KEY ("workspace_id", "platform_app_id", "connection_id") REFERENCES "oauth_connections"("workspace_id", "platform_app_id", "id") ON DELETE CASCADE ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_workspace_id_content_id_fkey" FOREIGN KEY ("workspace_id", "content_id") REFERENCES "contents"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_workspace_id_content_version_id_fkey" FOREIGN KEY ("workspace_id", "content_version_id") REFERENCES "content_versions"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_workspace_id_social_account_id_platform_fkey" FOREIGN KEY ("workspace_id", "social_account_id", "platform") REFERENCES "social_accounts"("workspace_id", "id", "platform") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_credential_version_id_fkey" FOREIGN KEY ("credential_version_id") REFERENCES "credential_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_oauth_token_version_id_fkey" FOREIGN KEY ("oauth_token_version_id") REFERENCES "oauth_token_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_variants" ADD CONSTRAINT "media_variants_workspace_id_media_asset_id_fkey" FOREIGN KEY ("workspace_id", "media_asset_id") REFERENCES "media_assets"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_workspace_id_publication_id_fkey" FOREIGN KEY ("workspace_id", "publication_id") REFERENCES "publications"("workspace_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_workspace_id_media_asset_id_fkey" FOREIGN KEY ("workspace_id", "media_asset_id") REFERENCES "media_assets"("workspace_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_media" ADD CONSTRAINT "publication_media_workspace_id_media_variant_id_media_asse_fkey" FOREIGN KEY ("workspace_id", "media_variant_id", "media_asset_id") REFERENCES "media_variants"("workspace_id", "id", "media_asset_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_workspace_id_platform_app_id_platform_fkey" FOREIGN KEY ("workspace_id", "platform_app_id", "platform") REFERENCES "platform_apps"("workspace_id", "id", "platform") ON DELETE CASCADE ON UPDATE CASCADE;

-- Security and execution invariants that Prisma's schema language cannot express.
CREATE UNIQUE INDEX "credential_versions_one_active_per_stream_key"
ON "credential_versions"("platform_app_id", "credential_type")
WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "oauth_token_versions_one_active_per_connection_key"
ON "oauth_token_versions"("connection_id")
WHERE "status" = 'ACTIVE';

ALTER TABLE "publication_attempts"
ADD CONSTRAINT "publication_attempts_exactly_one_credential_check"
CHECK (num_nonnulls("credential_version_id", "oauth_token_version_id") = 1);

ALTER TABLE "credential_versions"
ADD CONSTRAINT "credential_versions_envelope_shape_check"
CHECK (
  octet_length("ciphertext") > 0
  AND octet_length("encrypted_dek") > 0
  AND octet_length("nonce") = 12
  AND octet_length("auth_tag") = 16
  AND "envelope_version" = 1
  AND "cipher_suite" = 'AES-256-GCM'
);

ALTER TABLE "oauth_token_versions"
ADD CONSTRAINT "oauth_token_versions_envelope_shape_check"
CHECK (
  octet_length("ciphertext") > 0
  AND octet_length("encrypted_dek") > 0
  AND octet_length("nonce") = 12
  AND octet_length("auth_tag") = 16
  AND "envelope_version" = 1
  AND "cipher_suite" = 'AES-256-GCM'
);

ALTER TABLE "media_assets"
ADD CONSTRAINT "media_assets_metadata_shape_check"
CHECK (
  "size_bytes" > 0
  AND ("width" IS NULL OR "width" > 0)
  AND ("height" IS NULL OR "height" > 0)
  AND ("duration_ms" IS NULL OR "duration_ms" >= 0)
  AND "checksum_sha256" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "media_variants"
ADD CONSTRAINT "media_variants_metadata_shape_check"
CHECK (
  "size_bytes" > 0
  AND ("width" IS NULL OR "width" > 0)
  AND ("height" IS NULL OR "height" > 0)
  AND ("duration_ms" IS NULL OR "duration_ms" >= 0)
  AND "checksum_sha256" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "publication_media"
ADD CONSTRAINT "publication_media_position_check"
CHECK ("position" >= 0 AND "position" < 10);

ALTER TABLE "outbox_events"
ADD CONSTRAINT "outbox_events_counters_check"
CHECK ("schema_version" > 0 AND "attempts" >= 0);

ALTER TABLE "webhook_inbox"
ADD CONSTRAINT "webhook_inbox_attempts_check"
CHECK ("attempts" >= 0);
