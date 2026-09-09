/**
 * OpenTelemetry instrumentation — distributed tracing for Flower Market.
 *
 * Auto-instruments:
 *   - HTTP requests (Express)
 *   - MongoDB queries (mongoose)
 *   - External HTTP calls (fetch/axios)
 *   - Custom spans for business operations
 *
 * Setup:
 *   import './observability/otel.js';  // MUST be first import in server.js
 *
 * Environment variables:
 *   OTEL_ENABLED=true                 — enable tracing
 *   OTEL_SERVICE_NAME=flowermarket    — service name
 *   OTEL_EXPORTER_URL=http://otel-collector:4318 — collector URL
 *   OTEL_SAMPLE_RATE=0.1              — sample 10% of traces
 */

const OTEL_ENABLED = process.env.OTEL_ENABLED === 'true';

if (OTEL_ENABLED) {
  try {
    const { NodeSDK } = await import('@opentelemetry/sdk-node');
    const { getNodeAutoInstrumentations } = await import('@opentelemetry/auto-instrumentations-node');
    const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-http');
    const { OTLPMetricExporter } = await import('@opentelemetry/exporter-metrics-otlp-http');
    const { PeriodicExportingMetricReader } = await import('@opentelemetry/sdk-metrics');
    const { Resource } = await import('@opentelemetry/resources');
    const { SemanticResourceAttributes } = await import('@opentelemetry/semantic-conventions');
    const { TraceIdRatioBasedSampler } = await import('@opentelemetry/sdk-trace-base');

    const serviceName = process.env.OTEL_SERVICE_NAME || 'flowermarket';
    const exporterUrl = process.env.OTEL_EXPORTER_URL || 'http://localhost:4318';
    const sampleRate = parseFloat(process.env.OTEL_SAMPLE_RATE || '0.1');

    const traceExporter = new OTLPTraceExporter({
      url: `${exporterUrl}/v1/traces`,
    });

    const metricExporter = new OTLPMetricExporter({
      url: `${exporterUrl}/v1/metrics`,
    });

    const sdk = new NodeSDK({
      resource: new Resource({
        [SemanticResourceAttributes.SERVICE_NAME]: serviceName,
        [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version || '1.0.0',
        [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV || 'development',
      }),
      traceExporter,
      metricReader: new PeriodicExportingMetricReader({
        exporter: metricExporter,
        exportIntervalMillis: 30000,
      }),
      sampler: new TraceIdRatioBasedSampler(sampleRate),
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-mongodb': { enabled: true },
          '@opentelemetry/instrumentation-http': { enabled: true },
          '@opentelemetry/instrumentation-express': { enabled: true },
        }),
      ],
    });

    sdk.start();

    process.on('SIGTERM', () => {
      sdk.shutdown()
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });

    // eslint-disable-next-line no-console
    console.log(`[otel] tracing enabled — service=${serviceName}, sample=${sampleRate}, exporter=${exporterUrl}`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[otel] failed to initialize:', err.message);
  }
} else {
  // eslint-disable-next-line no-console
  console.log('[otel] tracing disabled (set OTEL_ENABLED=true to enable)');
}
