import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

const integration = process.env['RUN_DATABASE_INTEGRATION'] === 'true' ? describe : describe.skip;
const prisma = new PrismaClient();
const workspaceIds: string[] = [];

integration('PostgreSQL tenant and OAuth constraints', () => {
  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    if (workspaceIds.length > 0) {
      await prisma.workspace.deleteMany({ where: { id: { in: workspaceIds } } });
    }
    await prisma.$disconnect();
  });

  it('rejects cross-workspace ownership and multiple active token versions', async () => {
    const workspaceA = await createWorkspace('A');
    const workspaceB = await createWorkspace('B');
    const appA = await createApp(workspaceA.id, 'X', 'app-a');
    const appB = await createApp(workspaceB.id, 'X', 'app-b');
    const accountA = await createAccount(workspaceA.id, appA.id, 'remote-a');
    const accountB = await createAccount(workspaceB.id, appB.id, 'remote-b');

    await expect(createAccount(workspaceB.id, appA.id, 'cross-tenant')).rejects.toBeDefined();

    const contentA = await prisma.content.create({
      data: { workspaceId: workspaceA.id, title: 'Workspace A content' },
    });
    const versionA = await prisma.contentVersion.create({
      data: {
        workspaceId: workspaceA.id,
        contentId: contentA.id,
        versionNo: 1,
        body: 'body',
        checksum: 'a'.repeat(64),
      },
    });
    await expect(
      prisma.publication.create({
        data: {
          workspaceId: workspaceB.id,
          contentVersionId: versionA.id,
          socialAccountId: accountB.id,
          platform: 'X',
          status: 'DRAFT',
          idempotencyKey: randomUUID(),
          text: 'must fail',
          settings: {},
        },
      })
    ).rejects.toBeDefined();

    const publicationA = await prisma.publication.create({
      data: {
        workspaceId: workspaceA.id,
        contentVersionId: versionA.id,
        socialAccountId: accountA.id,
        platform: 'X',
        status: 'DRAFT',
        idempotencyKey: randomUUID(),
        text: 'valid tenant references',
        settings: {},
      },
    });
    await expect(
      prisma.publicationAttempt.create({
        data: {
          publicationId: publicationA.id,
          attemptNo: 1,
          stage: 'PUBLISH',
          status: 'STARTED',
          traceId: randomUUID(),
          startedAt: new Date(),
        },
      })
    ).rejects.toBeDefined();

    const connection = await prisma.oAuthConnection.create({
      data: {
        workspaceId: workspaceA.id,
        platformAppId: appA.id,
        socialAccountId: accountA.id,
        providerSubject: 'subject-a',
        status: 'ACTIVE',
        grantedScopes: ['tweet.write'],
      },
    });
    await createTokenVersion(workspaceA.id, appA.id, connection.id, 1);
    await expect(
      createTokenVersion(workspaceA.id, appA.id, connection.id, 2)
    ).rejects.toBeDefined();
  });
});

async function createWorkspace(label: string) {
  const workspace = await prisma.workspace.create({ data: { name: `Integration ${label}` } });
  workspaceIds.push(workspace.id);
  return workspace;
}

function createApp(workspaceId: string, platform: 'X', name: string) {
  return prisma.platformApp.create({
    data: {
      workspaceId,
      platform,
      name,
      environment: 'DEVELOPMENT',
      publicClientId: `${name}-client`,
      redirectUri: 'https://publisher.example.test/oauth/callback',
      scopes: [],
      status: 'ACTIVE',
    },
  });
}

function createAccount(workspaceId: string, platformAppId: string, remoteId: string) {
  return prisma.socialAccount.create({
    data: {
      workspaceId,
      platformAppId,
      platform: 'X',
      remoteId,
      displayName: remoteId,
      status: 'ACTIVE',
      capabilities: {},
    },
  });
}

function createTokenVersion(
  workspaceId: string,
  platformAppId: string,
  connectionId: string,
  versionNo: number
) {
  return prisma.oAuthTokenVersion.create({
    data: {
      workspaceId,
      platformAppId,
      connectionId,
      versionNo,
      status: 'ACTIVE',
      ciphertext: Buffer.from('ciphertext'),
      encryptedDek: Buffer.from('wrapped-key'),
      nonce: Buffer.alloc(12, 1),
      authTag: Buffer.alloc(16, 2),
      kekVersion: 'test-key-v1',
      scopes: ['tweet.write'],
      refreshable: true,
      createdBy: 'integration-test',
    },
  });
}
