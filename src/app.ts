import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import logger from '@/utils/logger';

import authRoutes from '@/routes/auth.routes';
import teamRoutes from '@/routes/team.routes';
import playerRoutes from '@/routes/player.routes';
import tournamentRoutes from '@/routes/tournament.routes';
import matchRoutes from '@/routes/match.routes';
import standingsRoutes from '@/routes/standings.routes';
import paymentRoutes from '@/routes/payment.routes';
import dashboardRoutes from '@/routes/dashboard.routes';

const app = express();

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: process.env.CLIENT_URL || 'http://localhost:3000',
  credentials: true
}));
app.use(express.json());
app.use(morgan('combined', { stream: { write: (message) => logger.http(message.trim()) } }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX || '100'),
  message: 'Too many requests from this IP, please try again after 15 minutes'
});
app.use('/api', limiter);

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/teams', teamRoutes);
app.use('/api/v1/players', playerRoutes);
app.use('/api/v1/tournament', tournamentRoutes);
app.use('/api/v1/matches', matchRoutes);
app.use('/api/v1/standings', standingsRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);

// Root route
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ 
    message: 'Welcome to CodeJude Football Tournament API',
    version: '1.0.0',
    docs: '/health'
  });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: any, req: Request, res: Response, next: any) => {
  logger.error(err.stack);
  
  const statusCode = err.statusCode || 500;
  const message = process.env.NODE_ENV === 'production' 
    ? 'Internal Server Error' 
    : err.message;

  res.status(statusCode).json({
    success: false,
    message: err.message || 'An unexpected error occurred',
    statusCode,
    timestamp: new Date().toISOString(),
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

export default app;
