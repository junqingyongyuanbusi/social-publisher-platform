-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Platform" AS ENUM ('X', 'FACEBOOK', 'INSTAGRAM');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('DRAFT', 'VALIDATING', 'VALIDATION_FAILED', 'SCHEDULED', 'QUEUED', 'PUBLISHING', 'RETRY_WAITING', 'RESULT_UNKNOWN', 'RECONCILING', 'REAUTH_REQUIRED', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CredentialStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVOKED', 'EXPIRED');

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
    "platform" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "public_client_id" TEXT NOT NULL,
    "api_version" TEXT,
    "redirect_uri" TEXT NOT NULL,
    "scopes" TEXT[],
    "status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credential_versions" (
    "id" UUID NOT NULL,
    "platform_app_id" UUID,
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
    "status" TEXT NOT NULL,
    "granted_scopes" TEXT[],
    "capabilities" JSONB NOT NULL,
    "token_expires_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "social_accounts_pkey" PRIMARY KEY ("id")
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
    "credential_version_id" UUID NOT NULL,
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

-- CreateIndex
CREATE UNIQUE INDEX "platform_apps_workspace_id_platform_name_key" ON "platform_apps"("workspace_id", "platform", "name");

-- CreateIndex
CREATE UNIQUE INDEX "credential_versions_platform_app_id_credential_type_version_key" ON "credential_versions"("platform_app_id", "credential_type", "version_no");

-- CreateIndex
CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "audit_events"("workspace_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_target_type_target_id_idx" ON "audit_events"("target_type", "target_id");

-- CreateIndex
CREATE UNIQUE INDEX "social_accounts_workspace_id_platform_remote_id_key" ON "social_accounts"("workspace_id", "platform", "remote_id");

-- CreateIndex
CREATE UNIQUE INDEX "content_versions_content_id_version_no_key" ON "content_versions"("content_id", "version_no");

-- CreateIndex
CREATE INDEX "publications_status_scheduled_at_idx" ON "publications"("status", "scheduled_at");

-- CreateIndex
CREATE UNIQUE INDEX "publications_workspace_id_idempotency_key_key" ON "publications"("workspace_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "publications_platform_social_account_id_remote_post_id_key" ON "publications"("platform", "social_account_id", "remote_post_id");

-- CreateIndex
CREATE UNIQUE INDEX "publication_attempts_publication_id_attempt_no_stage_key" ON "publication_attempts"("publication_id", "attempt_no", "stage");

-- AddForeignKey
ALTER TABLE "platform_apps" ADD CONSTRAINT "platform_apps_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credential_versions" ADD CONSTRAINT "credential_versions_platform_app_id_fkey" FOREIGN KEY ("platform_app_id") REFERENCES "platform_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "social_accounts" ADD CONSTRAINT "social_accounts_platform_app_id_fkey" FOREIGN KEY ("platform_app_id") REFERENCES "platform_apps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "content_versions" ADD CONSTRAINT "content_versions_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_content_version_id_fkey" FOREIGN KEY ("content_version_id") REFERENCES "content_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_social_account_id_fkey" FOREIGN KEY ("social_account_id") REFERENCES "social_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_attempts" ADD CONSTRAINT "publication_attempts_credential_version_id_fkey" FOREIGN KEY ("credential_version_id") REFERENCES "credential_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
