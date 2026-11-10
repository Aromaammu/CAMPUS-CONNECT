import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { AccessToken, DataPacket_Kind, RoomServiceClient, TrackSource, TrackType, WebhookReceiver, type VideoGrant, type WebhookEvent } from 'livekit-server-sdk';
import { config } from '../../config';

export interface LiveTrack { sid: string; source: 'microphone' | 'camera' | 'screen_share' | 'screen_share_audio' | 'unknown'; muted: boolean }
export interface LiveParticipant { identity: string; name: string; metadata: string; attributes: Record<string, string>; tracks: LiveTrack[] }
export interface Permission { canPublish: boolean; canSubscribe: boolean; canPublishData: boolean; canPublishSources: ('microphone' | 'camera' | 'screen_share' | 'screen_share_audio')[]; hidden?: boolean }

/**
 * Everything the API asks of the class server. The real one talks to LiveKit;
 * the fake one (API integration tests) keeps a call log in memory.
 */
export abstract class LiveGateway {
  abstract publicUrl: string;
  abstract token(o: { room: string; identity: string; name: string; metadata: string; perm: Permission; roomAdmin: boolean; attributes?: Record<string, string> }): Promise<string>;
  abstract ensureRoom(room: string, maxParticipants: number, metadata: string): Promise<void>;
  abstract setRoomMetadata(room: string, metadata: string): Promise<void>;
  abstract participants(room: string): Promise<LiveParticipant[]>;
  abstract muteTrack(room: string, identity: string, trackSid: string): Promise<void>;
  abstract updateParticipant(room: string, identity: string, o: { permission?: Permission; attributes?: Record<string, string> }): Promise<void>;
  abstract remove(room: string, identity: string): Promise<void>;
  abstract send(room: string, topic: string, payload: unknown, to?: string[]): Promise<void>;
  abstract closeRoom(room: string): Promise<void>;
  abstract receiveWebhook(body: string, auth: string | undefined): Promise<WebhookEvent>;
}

const SOURCE_TO_LK = { microphone: TrackSource.MICROPHONE, camera: TrackSource.CAMERA, screen_share: TrackSource.SCREEN_SHARE, screen_share_audio: TrackSource.SCREEN_SHARE_AUDIO } as const;
const LK_TO_SOURCE = (s: TrackSource, type: TrackType): LiveTrack['source'] =>
  s === TrackSource.MICROPHONE ? 'microphone' : s === TrackSource.CAMERA ? 'camera' : s === TrackSource.SCREEN_SHARE ? 'screen_share' : s === TrackSource.SCREEN_SHARE_AUDIO ? 'screen_share_audio' : type === TrackType.AUDIO ? 'microphone' : 'unknown';

function grantFor(room: string, perm: Permission, roomAdmin: boolean): VideoGrant {
  return {
    room, roomJoin: true, roomAdmin, canSubscribe: perm.canSubscribe, canPublish: perm.canPublish, canPublishData: perm.canPublishData,
    canPublishSources: perm.canPublishSources.map((s) => SOURCE_TO_LK[s]), canUpdateOwnMetadata: false, hidden: perm.hidden ?? false,
  };
}

@Injectable()
export class LiveKitGateway extends LiveGateway {
  private log = new Logger('LiveKit');
  publicUrl = config.livekitPublicUrl;
  private client = new RoomServiceClient(config.livekitUrl.replace(/^ws/, 'http'), config.livekitKey, config.livekitSecret);
  private receiver = new WebhookReceiver(config.livekitKey, config.livekitSecret);

  private async call<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      this.log.warn(`${what} failed: ${(e as Error).message}`);
      throw new ServiceUnavailableException('The class server is not reachable. Please try again in a minute.');
    }
  }

  async token(o: Parameters<LiveGateway['token']>[0]) {
    const at = new AccessToken(config.livekitKey, config.livekitSecret, { identity: o.identity, name: o.name, metadata: o.metadata, attributes: o.attributes, ttl: '6h' });
    at.addGrant(grantFor(o.room, o.perm, o.roomAdmin));
    return at.toJwt();
  }

  async ensureRoom(room: string, maxParticipants: number, metadata: string) {
    await this.call('createRoom', () => this.client.createRoom({ name: room, maxParticipants, emptyTimeout: 600, departureTimeout: 300, metadata }));
    await this.setRoomMetadata(room, metadata);
  }

  async setRoomMetadata(room: string, metadata: string) {
    await this.call('updateRoomMetadata', () => this.client.updateRoomMetadata(room, metadata).then(() => undefined));
  }

  async participants(room: string): Promise<LiveParticipant[]> {
    try {
      const list = await this.client.listParticipants(room);
      return list.map((p) => ({
        identity: p.identity, name: p.name, metadata: p.metadata, attributes: { ...p.attributes },
        tracks: p.tracks.map((t) => ({ sid: t.sid, source: LK_TO_SOURCE(t.source, t.type), muted: t.muted })),
      }));
    } catch (e) {
      // A room that isn't running yet simply has nobody in it.
      if (/not found|does not exist/i.test((e as Error).message)) return [];
      throw await this.call('listParticipants', () => Promise.reject(e));
    }
  }

  async muteTrack(room: string, identity: string, trackSid: string) {
    await this.call('mutePublishedTrack', () => this.client.mutePublishedTrack(room, identity, trackSid, true).then(() => undefined));
  }

  async updateParticipant(room: string, identity: string, o: { permission?: Permission; attributes?: Record<string, string> }) {
    await this.call('updateParticipant', () =>
      this.client.updateParticipant(room, identity, {
        attributes: o.attributes,
        permission: o.permission
          ? { canPublish: o.permission.canPublish, canSubscribe: o.permission.canSubscribe, canPublishData: o.permission.canPublishData, canPublishSources: o.permission.canPublishSources.map((s) => SOURCE_TO_LK[s]), hidden: o.permission.hidden ?? false }
          : undefined,
      }).then(() => undefined),
    );
  }

  async remove(room: string, identity: string) {
    await this.call('removeParticipant', () => this.client.removeParticipant(room, identity));
  }

  async send(room: string, topic: string, payload: unknown, to?: string[]) {
    if (to && !to.length) return;
    await this.call('sendData', () => this.client.sendData(room, new TextEncoder().encode(JSON.stringify(payload)), DataPacket_Kind.RELIABLE, { topic, ...(to ? { destinationIdentities: to } : {}) }));
  }

  async closeRoom(room: string) {
    try {
      await this.client.deleteRoom(room);
    } catch (e) {
      this.log.warn(`deleteRoom ${room}: ${(e as Error).message}`);
    }
  }

  receiveWebhook(body: string, auth: string | undefined) {
    return this.receiver.receive(body, auth);
  }
}

/** In-memory class server for API tests: records every call; participants can be planted. */
@Injectable()
export class FakeLiveGateway extends LiveGateway {
  publicUrl = 'ws://fake-live';
  calls: { fn: string; args: unknown[] }[] = [];
  rooms = new Map<string, { metadata: string; participants: LiveParticipant[] }>();
  private receiver = new WebhookReceiver(config.livekitKey, config.livekitSecret);

  private room(name: string) {
    let r = this.rooms.get(name);
    if (!r) this.rooms.set(name, (r = { metadata: '', participants: [] }));
    return r;
  }
  async token(o: Parameters<LiveGateway['token']>[0]) {
    this.calls.push({ fn: 'token', args: [o] });
    const at = new AccessToken(config.livekitKey, config.livekitSecret, { identity: o.identity, name: o.name, metadata: o.metadata, attributes: o.attributes });
    at.addGrant(grantFor(o.room, o.perm, o.roomAdmin));
    return at.toJwt();
  }
  async ensureRoom(room: string, max: number, metadata: string) { this.calls.push({ fn: 'ensureRoom', args: [room, max] }); this.room(room).metadata = metadata; }
  async setRoomMetadata(room: string, metadata: string) { this.calls.push({ fn: 'setRoomMetadata', args: [room, metadata] }); this.room(room).metadata = metadata; }
  async participants(room: string) { return this.room(room).participants; }
  async muteTrack(room: string, identity: string, trackSid: string) { this.calls.push({ fn: 'muteTrack', args: [room, identity, trackSid] }); }
  async updateParticipant(room: string, identity: string, o: { permission?: Permission; attributes?: Record<string, string> }) {
    this.calls.push({ fn: 'updateParticipant', args: [room, identity, o] });
    const p = this.room(room).participants.find((x) => x.identity === identity);
    if (p && o.attributes) p.attributes = { ...p.attributes, ...o.attributes };
  }
  async remove(room: string, identity: string) {
    this.calls.push({ fn: 'remove', args: [room, identity] });
    const r = this.room(room);
    r.participants = r.participants.filter((p) => p.identity !== identity);
  }
  async send(room: string, topic: string, payload: unknown, to?: string[]) { this.calls.push({ fn: 'send', args: [room, topic, payload, to] }); }
  async closeRoom(room: string) { this.calls.push({ fn: 'closeRoom', args: [room] }); this.rooms.delete(room); }
  receiveWebhook(body: string, auth: string | undefined) { return this.receiver.receive(body, auth); }
  reset() { this.calls = []; this.rooms.clear(); }
}
