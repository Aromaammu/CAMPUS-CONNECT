import { Global, Injectable, Module } from '@nestjs/common';
import { SETTINGS_DEFAULTS, SettingKey, SettingsMap } from '@cc/shared';
import { PrismaService } from './prisma.service';

/** Every rule number comes from here (CLAUDE.md §6.6). Cached briefly. */
@Injectable()
export class SettingsService {
  private cache: { at: number; map: SettingsMap } | null = null;
  constructor(private prisma: PrismaService) {}

  async all(): Promise<SettingsMap> {
    if (this.cache && Date.now() - this.cache.at < 5000) return this.cache.map;
    const rows = await this.prisma.setting.findMany();
    const map = { ...SETTINGS_DEFAULTS } as unknown as SettingsMap;
    for (const r of rows) if (r.key in SETTINGS_DEFAULTS) (map as Record<string, unknown>)[r.key] = r.value;
    this.cache = { at: Date.now(), map };
    return map;
  }

  async get<K extends SettingKey>(key: K): Promise<SettingsMap[K]> {
    return (await this.all())[key];
  }

  async set(values: Partial<SettingsMap>, userId: string) {
    for (const [key, value] of Object.entries(values)) {
      if (!(key in SETTINGS_DEFAULTS)) continue;
      await this.prisma.setting.upsert({ where: { key }, create: { key, value: value as never, updatedBy: userId }, update: { value: value as never, updatedBy: userId } });
    }
    this.cache = null;
  }

  clearCache() { this.cache = null; }
}

@Global()
@Module({ providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
