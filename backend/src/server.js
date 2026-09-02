import config from './config/index.js';
import { connectDb } from './config/db.js';
import { createApp } from './app.js';

async function bootstrap() {
  await connectDb();

  // Phase 6.1: seed the global chart of accounts (idempotent upserts).
  // Scoped accounts (vendor/store payables) are created lazily on first post.
  try {
    const { default: ledgerService } = await import('./services/ledger.service.js');
    await ledgerService.ensureChartOfAccounts();
    const txn = await ledgerService.transactionsSupported();
    console.log(`[ledger] chart of accounts ready — transactions ${txn ? 'ENABLED' : 'DISABLED (standalone mongod; verify sweep covers the gap)'}`);
  } catch (err) {
    console.error('[ledger] chart of accounts bootstrap failed:', err.message);
  }

  // Phase 6.2: seed a resolvable TCS/TDS timeline (idempotent — skipped once
  // any row exists). Seed values are placeholders pending CA confirmation;
  // rates are effective-dated data, never constants.
  try {
    const { default: taxService } = await import('./services/tax.service.js');
    const seeded = await taxService.seedStatutoryRates();
    if (!seeded.skipped) console.log(`[tax] seeded ${seeded.seeded} statutory rate rows (VERIFY with a CA before go-live)`);
  } catch (err) {
    console.error('[tax] statutory rate bootstrap failed:', err.message);
  }

  // Phase 6.5: seed the vocabulary this market actually types (idempotent).
  try {
    const { default: searchService } = await import('./services/search.service.js');
    const seeded = await searchService.seedSynonyms();
    if (!seeded.skipped) console.log(`[search] seeded ${seeded.seeded} synonym groups (gulab/rose, mogra/jasmine, …)`);
  } catch (err) {
    console.error('[search] synonym bootstrap failed:', err.message);
  }

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
