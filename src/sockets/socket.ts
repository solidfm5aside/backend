import { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import logger from '@/utils/logger';

export let io: Server;

export const initSocket = (server: HttpServer) => {
  io = new Server(server, {
    cors: {
      origin: process.env.CLIENT_URL || 'http://localhost:3000',
      methods: ['GET', 'POST']
    }
  });

  const adminNamespace = io.of('/admin');
  const publicNamespace = io.of('/public');

  adminNamespace.on('connection', (socket) => {
    logger.info(`Admin client connected: ${socket.id}`);
    
    socket.on('disconnect', () => {
      logger.info(`Admin client disconnected: ${socket.id}`);
    });
  });

  publicNamespace.on('connection', (socket) => {
    logger.info(`Public client connected: ${socket.id}`);
    
    socket.on('join:match', (matchId: string) => {
      socket.join(`match:${matchId}`);
      logger.info(`Client ${socket.id} joined match room: ${matchId}`);
    });

    socket.on('leave:match', (matchId: string) => {
      socket.leave(`match:${matchId}`);
      logger.info(`Client ${socket.id} left match room: ${matchId}`);
    });

    socket.on('disconnect', () => {
      logger.info(`Public client disconnected: ${socket.id}`);
    });
  });

  logger.info('Socket.io initialized');
  return io;
};

export const broadcastMatchUpdate = (matchId: string, data: any) => {
  if (io) {
    io.of('/public').to(`match:${matchId}`).emit('match:updated', data);
    io.of('/public').emit('match:list:updated', data); // For general list updates
  }
};

export const broadcastGoal = (matchId: string, goalData: any) => {
  if (io) {
    io.of('/public').to(`match:${matchId}`).emit('goal:scored', goalData);
  }
};
