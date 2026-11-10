import { Global, Injectable, Logger, Module, OnModuleInit } from '@nestjs/common';
import { NotifyService } from '../modules/notifications/notify.service';
import { ConnectedSocket, MessageBody, OnGatewayConnection, SubscribeMessage, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { ACCESS_COOKIE, readCookie, verifyAccessToken } from './auth';
import { PrismaService } from './prisma.service';

/**
 * Live updates to the browser (CLAUDE.md §3): new messages, typing, read receipts, notifications.
 * Every signed-in tab joins a private room "u:<userId>"; the server decides who receives what.
 * In production several servers share rooms through the Redis adapter (Phase 10).
 */
@WebSocketGateway({ path: '/socket.io', serveClient: false, cors: false })
export class RealtimeGateway implements OnGatewayConnection {
  private log = new Logger('Realtime');
  @WebSocketServer() server!: Server;
  constructor(private prisma: PrismaService) {}

  handleConnection(socket: Socket) {
    const token = readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE) ?? (socket.handshake.auth?.token as string | undefined);
    const userId = token ? verifyAccessToken(token) : null;
    if (!userId) {
      socket.emit('auth-expired');
      socket.disconnect(true);
      return;
    }
    socket.data.userId = userId;
    void socket.join(`u:${userId}`);
  }

  /** "Someone is typing…" goes to the other members of the conversation only. */
  @SubscribeMessage('typing')
  async typing(@ConnectedSocket() socket: Socket, @MessageBody() body: { conversationId?: string }) {
    const userId = socket.data.userId as string | undefined;
    if (!userId || typeof body?.conversationId !== 'string') return;
    const members = await this.prisma.conversationMember.findMany({ where: { conversationId: body.conversationId }, select: { userId: true } });
    if (!members.some((m) => m.userId === userId)) return;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    for (const m of members) if (m.userId !== userId) this.server.to(`u:${m.userId}`).emit('typing', { conversationId: body.conversationId, userId, name: user?.name });
  }

  toUsers(userIds: string[], event: string, payload: unknown) {
    if (!this.server) return;
    const ids = [...new Set(userIds)];
    if (!ids.length) return;
    this.server.to(ids.map((id) => `u:${id}`)).emit(event, payload);
  }
}

@Injectable()
export class Realtime {
  constructor(private gw: RealtimeGateway) {}
  toUsers(userIds: string[], event: string, payload: unknown) {
    try { this.gw.toUsers(userIds, event, payload); } catch (e) { new Logger('Realtime').warn((e as Error).message); }
  }
}

@Global()
@Module({ providers: [RealtimeGateway, Realtime], exports: [Realtime] })
export class RealtimeModule implements OnModuleInit {
  constructor(private notify: NotifyService, private rt: Realtime) {}
  /** Every in-app notification also pops up live in open tabs. */
  onModuleInit() {
    this.notify.addHook((userIds, input) => this.rt.toUsers(userIds, 'notification', { type: input.type, title: input.title, body: input.body ?? null, link: input.link ?? null }));
  }
}
