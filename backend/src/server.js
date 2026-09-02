import config from './config/index.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';

async function bootstrap() {
  await connectDb();

  const app = createApp();
  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[app] ${config.appName} listening on :${config.port} (${config.env})`);
  });

  const shutdown = async (signal) => {
    // eslint-disable-next-line no-console
    console.log(`[app] ${signal} received, shutting down...`);
    server.close(async () => {
      const { disconnectDb } = await import('./config/db.js');
      await disconnectDb();
      process.exit(0);
    });
    // force-exit if graceful shutdown hangs
    setTimeout(() => process.exit(1), 10000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[app] failed to start:', err);
  process.exit(1);
});
