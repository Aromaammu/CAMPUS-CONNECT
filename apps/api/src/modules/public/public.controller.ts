import { Controller, Get, Module } from '@nestjs/common';
import { Public } from '../../common/auth';
import { SettingsService } from '../../common/settings.service';

@Controller('public')
export class PublicController {
  constructor(private settings: SettingsService) {}

  @Public()
  @Get('brand')
  async brand() {
    const s = await this.settings.all();
    return {
      name: s['brand.name'], tagline: s['brand.tagline'], primary: s['brand.primary'], accent: s['brand.accent'],
      supportEmail: s['brand.supportEmail'], supportPhone: s['brand.supportPhone'], legalName: s['org.legalName'], address: s['org.address'],
      grievanceOfficer: s['privacy.grievanceOfficer'], grievanceEmail: s['privacy.grievanceEmail'],
    };
  }

  @Public()
  @Get('health')
  health() {
    return { ok: true, at: new Date().toISOString() };
  }
}

@Module({ controllers: [PublicController] })
export class PublicModule {}
