import { Injectable } from '@nestjs/common';
import type { Platform } from '@social/domain';
import type { PlatformAdapter } from '@social/platform-contract';
import { FacebookAdapter } from '@social/platform-facebook';
import { InstagramAdapter } from '@social/platform-instagram';
import { XAdapter } from '@social/platform-x';

@Injectable()
export class PlatformRegistry {
  private readonly adapters = new Map<Platform, PlatformAdapter>([
    ['x', new XAdapter()],
    ['facebook', new FacebookAdapter()],
    ['instagram', new InstagramAdapter()],
  ]);

  list(): readonly PlatformAdapter[] {
    return [...this.adapters.values()];
  }

  get(platform: Platform): PlatformAdapter {
    const adapter = this.adapters.get(platform);
    if (!adapter) throw new Error(`Unsupported platform: ${platform}`);
    return adapter;
  }
}
