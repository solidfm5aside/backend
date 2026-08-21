import 'dotenv/config';
import http from 'http';
import app from './app';
import connectDB from './config/db';
import { initSocket } from './sockets/socket';
import logger from './utils/logger';
import { validateEnv } from '@/utils/env.validator';

// Validate environment variables
validateEnv();

const port = process.env.PORT || 5000;

const server = http.createServer(app);

// Initialize Socket.io
initSocket(server);

// Connect to Database and start server
const startServer = async () => {
  await connectDB();
  
  server.listen(port, () => {
    logger.info(`Server running on port ${port}`);
  });
};

startServer();

// Handle unhandled promise rejections
process.on('unhandledRejection', (err: Error) => {
  logger.error(`Unhandled Rejection: ${err.message}`);
  server.close(() => process.exit(1));
});
