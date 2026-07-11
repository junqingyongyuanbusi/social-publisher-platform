import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync('prisma/schema.prisma', 'utf8');
const migration = readFileSync(
  'prisma/migrations/20260710131500_initial_schema/migration.sql',
  'utf8'
);

describe('database security and delivery invariants', () => {
  it('binds OAuth token versions and media relationships to workspace-owned resources', () => {
    expect(schema).toContain('model OAuthConnection');
    expect(schema).toContain('model OAuthTokenVersion');
    expect(schema).toContain(
      '@relation(fields: [workspaceId, platformAppId, connectionId], references: [workspaceId, platformAppId, id]'
    );
    expect(schema).toContain(
      '@relation(fields: [workspaceId, contentVersionId], references: [workspaceId, id])'
    );
    expect(schema).toContain(
      '@relation(fields: [workspaceId, mediaAssetId], references: [workspaceId, id])'
    );
  });

  it('allows only one active version and exactly one attempt credential', () => {
    expect(migration).toContain('credential_versions_one_active_per_stream_key');
    expect(migration).toContain('oauth_token_versions_one_active_per_connection_key');
    expect(migration).toContain('publication_attempts_exactly_one_credential_check');
    expect(migration).toContain(
      'num_nonnulls("credential_version_id", "oauth_token_version_id") = 1'
    );
  });

  it('constrains encrypted envelope and media metadata shape at the database boundary', () => {
    expect(migration).toContain('credential_versions_envelope_shape_check');
    expect(migration).toContain('oauth_token_versions_envelope_shape_check');
    expect(migration).toContain('media_assets_metadata_shape_check');
    expect(migration).toContain('publication_media_position_check');
  });
});
