import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { connectDatabase } from './config/database';
import { setupSocketHandlers } from './sockets/socketHandler';
import { errorHandler } from './middleware/errorHandler';
import { logger } from './utils/logger';

// Routes
import authRoutes from './routes/auth';
import userRoutes from './routes/users';
import ambulanceRoutes from './routes/ambulances';
import bookingRoutes from './routes/bookings';
import tripRoutes from './routes/trips';
import hospitalRoutes from './routes/hospitals';
import driverRoutes from './routes/drivers';
import notificationRoutes from './routes/notifications';
import analyticsRoutes from './routes/analytics';
import adminRoutes from './routes/admin';
import aiRoutes from './routes/ai';

dotenv.config();

const app = express();
const httpServer = createServer(app);

// Socket.IO with CORS
export const io = new SocketIOServer(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true,
  },
  pingTimeout: 60000,
  pingInterval: 25000,
});

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000'),
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100'),
  message: { success: false, message: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Middleware
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined', { stream: { write: (msg) => logger.info(msg.trim()) } }));
app.use('/api/', limiter);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    environment: process.env.NODE_ENV 
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/ambulances', ambulanceRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/trips', tripRoutes);
app.use('/api/hospitals', hospitalRoutes);
app.use('/api/drivers', driverRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/ai', aiRoutes);

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.originalUrl} not found` });
});

// Global error handler
app.use(errorHandler);

// Setup Socket.IO handlers
setupSocketHandlers(io);

// Start server
const PORT = parseInt(process.env.PORT || '5000');

async function startServer() {
  try {
    await connectDatabase();
    httpServer.listen(PORT, () => {
      logger.info(`🚑 SABS Backend running on port ${PORT}`);
      logger.info(`📡 Socket.IO ready`);
      logger.info(`🌍 Environment: ${process.env.NODE_ENV}`);
    });
  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, httpServer };
