import { describe, expect, it, vi } from 'vitest';
import { InstagramGraphClient } from './index.js';
describe('InstagramGraphClient', () => {
  it('creates, polls, publishes and verifies an image container', async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      const value = String(url);
      if (value.includes('fields=status_code'))
        return new Response(JSON.stringify({ status_code: 'FINISHED' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      if (value.includes('fields=id'))
        return new Response(
          JSON.stringify({ id: 'media', permalink: 'https://instagram.com/p/code' }),
          { status: 200, headers: { 'content-type': 'application/json' } }
        );
      return new Response(
        JSON.stringify({ id: value.includes('media_publish') ? 'media' : 'container' }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    });
    const client = new InstagramGraphClient({
      apiVersion: 'v23.0',
      fetch: fetch as typeof globalThis.fetch,
    });
    await expect(
      client.createImageContainer('ig', 'token', 'https://signed/image', 'caption')
    ).resolves.toMatchObject({ id: 'container' });
    await expect(client.containerStatus('container', 'token')).resolves.toEqual({
      status: 'FINISHED',
    });
    await expect(client.publishContainer('ig', 'token', 'container')).resolves.toMatchObject({
      id: 'media',
    });
    await expect(client.media('media', 'token')).resolves.toMatchObject({
      permalink: 'https://instagram.com/p/code',
    });
  });
});
