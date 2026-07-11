-- The bundled Keycloak realm maps its workspace roles to this bootstrap tenant.
-- Existing installations keep all current workspaces; this insert is idempotent.
INSERT INTO "workspaces" (
  "id",
  "name",
  "default_locale",
  "created_at",
  "updated_at"
)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'Social Publisher',
  'zh-CN',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("id") DO NOTHING;
