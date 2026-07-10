import { Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { PUBLICATION_QUEUE } from './queue-policy.js';

const connection = new Redis(process.env['REDIS_URL'] ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});
const worker = new Worker(
  PUBLICATION_QUEUE,
  async (job) => {
    // The execution pipeline will load an immutable content version and pinned credential version.
    // Platform calls remain disabled until their OAuth modules are implemented and integration-tested.
    throw new Error(`Publishing executor not configured for job ${job.id ?? 'unknown'}`);
  },
  { connection, concurrency: Number(process.env['WORKER_CONCURRENCY'] ?? 5) }
);

worker.on('failed', (job, error) => {
  process.stderr.write(
    JSON.stringify({
      level: 'error',
      event: 'publication_job_failed',
      jobId: job?.id,
      message: error.message,
    }) + '\n'
  );
});

async function shutdown(): Promise<void> {
  await worker.close();
  await connection.quit();
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
