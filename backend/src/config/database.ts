import mongoose from 'mongoose';
import { logger } from '../utils/logger';

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sabs_db';
  
  mongoose.set('strictQuery', false);
  
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
    });
    logger.info(`✅ MongoDB connected: ${mongoose.connection.host}`);
    logger.info(`📦 Database: ${mongoose.connection.name}`);
  } catch (error) {
    logger.error('❌ MongoDB connection failed:', error);
    throw error;
  }

  mongoose.connection.on('disconnected', () => {
    logger.warn('MongoDB disconnected. Attempting to reconnect...');
  });

  mongoose.connection.on('reconnected', () => {
    logger.info('MongoDB reconnected.');
  });

  mongoose.connection.on('error', (err) => {
    logger.error('MongoDB error:', err);
  });
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.connection.close();
  logger.info('MongoDB connection closed.');
}
