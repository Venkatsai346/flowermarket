import mongoose from 'mongoose';
import config from './index.js';

/**
 * Mongo connection bootstrap with lifecycle logging.
 * Uses connection events + explicit error surfacing so failures are loud in dev.
 */
export async function connectDb() {
  mongoose.set('strictQuery', true);

  mongoose.connection.on('connected', () => {
    console.log(`[db] MongoDB connected (${config.env})`);
  });
  mongoose.connection.on('error', (err) => {
    console.error('[db] MongoDB connection error:', err.message);
  });
  mongoose.connection.on('disconnected', () => {
    console.warn('[db] MongoDB disconnected');
  });

  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 15000,
    maxPoolSize: 10,
  });
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
