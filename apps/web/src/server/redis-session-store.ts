import type { BrowserSessionStore } from '@social/auth';
import type { Redis } from 'ioredis';

export class RedisBrowserSessionStore implements BrowserSessionStore {
  constructor(private readonly redis: Redis) {}

  async put(key: string, value: string, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, value, 'EX', ttlSeconds);
  }

  get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  take(key: string): Promise<string | null> {
    return this.redis.getdel(key);
  }

  async delete(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async acquireLock(key: string, owner: string, ttlSeconds: number): Promise<boolean> {
    return (await this.redis.set(key, owner, 'EX', ttlSeconds, 'NX')) === 'OK';
  }

  async releaseLock(key: string, owner: string): Promise<void> {
    await this.redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      owner
    );
  }
}
