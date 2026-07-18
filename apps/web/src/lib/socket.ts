import type { ClientToServerEvents, ServerToClientEvents } from '@poker/contracts';
import { io, type Socket } from 'socket.io-client';

export const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io({
  autoConnect: false,
  withCredentials: true,
  transports: ['polling', 'websocket'],
  tryAllTransports: true,
  timeout: 10_000,
});
