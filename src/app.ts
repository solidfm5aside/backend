import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import logger from '@/utils/logger';
import { getAllowedClientOrigins } from '@/utils/client-origin.util';
import {
  getErrorStack,
  getErrorStatusCode,
  getPublicErrorMessage,
} from '@/utils/http-error.util';

import authRoutes from '@/routes/auth.routes';
import teamRoutes from '@/routes/team.routes';
import playerRoutes from '@/routes/player.routes';
import tournamentRoutes from '@/routes/tournament.routes';
import matchRoutes from '@/routes/match.routes';
import standingsRoutes from '@/routes/standings.routes';
import venueRoutes from '@/routes/venue.routes';
import paymentRoutes from '@/routes/payment.routes';
import dashboardRoutes from '@/routes/dashboard.routes';
import settingRoutes from '@/routes/setting.routes';
import broadcastRoutes from '@/routes/broadcast.routes';


const app = express();
const allowedClientOrigins = getAllowedClientOrigins();

// Middleware
app.use(helmet());
app.use(compression());
app.use(cors({
  origin: allowedClientOrigins,
  credentials: true
}));
app.use(express.json());
app.use((req: Request, res: Response, next: NextFunction) => {
  const unsafeMethod = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method);
  const origin = req.headers.origin;

  if (unsafeMethod && origin && !allowedClientOrigins.includes(origin)) {
    return res.status(403).json({ success: false, message: 'Request origin is not allowed' });
  }

  next();
});
app.use(morgan('combined', { stream: { write: (message: string) => logger.http(message.trim()) } }));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: process.env.NODE_ENV === 'development' ? 10000 : parseInt(process.env.RATE_LIMIT_MAX || '100'),
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again after 15 minutes'
  }
});
app.use('/api', limiter);

// Routes
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/teams', teamRoutes);
app.use('/api/v1/players', playerRoutes);
app.use('/api/v1/tournaments', tournamentRoutes);
app.use('/api/v1/matches', matchRoutes);
app.use('/api/v1/venues', venueRoutes);
app.use('/api/v1/standings', standingsRoutes);
app.use('/api/v1/payments', paymentRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/settings', settingRoutes);
app.use('/api/v1/broadcast', broadcastRoutes);


// Root route
app.get('/', (req: Request, res: Response) => {
  res.status(200).json({ 
    message: 'Welcome to SolidFM Football Tournament API',
    version: '1.0.0',
    docs: '/health'
  });
});

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handling
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const stack = getErrorStack(err);
  logger.error(stack ?? err);
  
  const statusCode = getErrorStatusCode(err);
  const message = getPublicErrorMessage(err);

  res.status(statusCode).json({
    success: false,
    message,
    statusCode,
    timestamp: new Date().toISOString(),
    stack: process.env.NODE_ENV === 'development' ? stack : undefined
  });
});

export default app;
