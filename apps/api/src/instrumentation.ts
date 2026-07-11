import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

const collectorEndpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT']?.replace(/\/$/, '');

if (collectorEndpoint) {
  const sdk = new NodeSDK({
    traceExporter: new OTLPTraceExporter({ url: `${collectorEndpoint}/v1/traces` }),
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${collectorEndpoint}/v1/metrics` }),
      exportIntervalMillis: 15_000,
    }),
    instrumentations: [
      getNodeAutoInstrumentations({
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();

  const shutdown = () => {
    void sdk.shutdown();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}
