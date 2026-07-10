import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
} from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { OidcAccessTokenVerifier } from './oidc-verifier.js';

const issuer = 'https://identity.example.com';
const audience = 'social-publisher-api';
let privateKey: CryptoKey;
let jwk: JWK;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  jwk = { ...(await exportJWK(pair.publicKey)), kid: 'test-key-1', use: 'sig', alg: 'RS256' };
});

function verifier() {
  return new OidcAccessTokenVerifier(
    { issuer, audience, jwksUri: `${issuer}/jwks`, maxTokenAgeSeconds: 3_600 },
    createLocalJWKSet({ keys: [jwk] })
  );
}

async function token(overrides: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const tokenIssuer = typeof overrides['iss'] === 'string' ? overrides['iss'] : issuer;
  const tokenAudience = typeof overrides['aud'] === 'string' ? overrides['aud'] : audience;
  const { iss: _issuer, aud: _audience, ...claims } = overrides;
  return new SignJWT({
    social_workspaces: [{ workspaceId: 'workspace-1', role: 'admin' }],
    email: 'admin@example.com',
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1', typ: 'at+jwt' })
    .setIssuer(tokenIssuer)
    .setAudience(tokenAudience)
    .setSubject('user-1')
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .sign(privateKey);
}

describe('OidcAccessTokenVerifier', () => {
  it('verifies signature and maps strict workspace memberships', async () => {
    await expect(verifier().verify(await token())).resolves.toMatchObject({
      subject: 'user-1',
      issuer,
      email: 'admin@example.com',
      memberships: [{ workspaceId: 'workspace-1', role: 'admin' }],
    });
  });

  it('rejects the wrong issuer or audience', async () => {
    await expect(
      verifier().verify(await token({ iss: 'https://attacker.example' }))
    ).rejects.toMatchObject({
      code: 'auth_token_invalid',
    });
    await expect(verifier().verify(await token({ aud: 'another-api' }))).rejects.toMatchObject({
      code: 'auth_token_invalid',
    });
  });

  it('rejects duplicate, malformed, or absent workspace membership claims', async () => {
    await expect(
      verifier().verify(
        await token({
          social_workspaces: [
            { workspaceId: 'workspace-1', role: 'viewer' },
            { workspaceId: 'workspace-1', role: 'owner' },
          ],
        })
      )
    ).rejects.toMatchObject({ code: 'auth_memberships_invalid' });
    await expect(verifier().verify(await token({ social_workspaces: [] }))).rejects.toMatchObject({
      code: 'auth_memberships_invalid',
    });
  });

  it('rejects expired tokens and tokens older than the configured maximum', async () => {
    const now = Math.floor(Date.now() / 1000);
    const expired = await new SignJWT({
      social_workspaces: [{ workspaceId: 'workspace-1', role: 'viewer' }],
    })
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key-1' })
      .setIssuer(issuer)
      .setAudience(audience)
      .setSubject('user-1')
      .setIssuedAt(now - 4_000)
      .setExpirationTime(now - 10)
      .sign(privateKey);
    await expect(verifier().verify(expired)).rejects.toMatchObject({ code: 'auth_token_invalid' });
  });

  it('requires HTTPS endpoints in production', () => {
    expect(
      () =>
        new OidcAccessTokenVerifier({
          issuer: 'http://identity.local',
          audience,
          jwksUri: 'http://identity.local/jwks',
          production: true,
        })
    ).toThrowError(expect.objectContaining({ code: 'auth_issuer_invalid' }));
  });
});
