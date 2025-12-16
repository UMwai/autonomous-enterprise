/**
 * Autonomous Enterprise - Temporal Worker Bootstrap
 *
 * Entry point for the Temporal worker process that executes workflows and activities.
 */

import { config } from 'dotenv';
import pino from 'pino';
import { createWorker } from './temporal/worker.js';

// Load environment variables
config();

// Setup logger
const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss Z',
            ignore: 'pid,hostname',
          },
        }
      : undefined,
});

/**
 * Main worker bootstrap function
 */
async function main() {
  logger.info('Starting Autonomous Enterprise Temporal Worker...');

  try {
    // Create and run the worker
    const worker = await createWorker();

    logger.info(
      {
        taskQueue: worker.options.taskQueue,
        namespace: worker.options.namespace,
        identity: worker.options.identity,
      },
      'Worker created successfully'
    );

    // Graceful shutdown handling
    const shutdownSignals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGQUIT'];

    for (const signal of shutdownSignals) {
      process.on(signal, async () => {
        logger.info({ signal }, 'Received shutdown signal');

        try {
          logger.info('Shutting down worker gracefully...');
          await worker.shutdown();
          logger.info('Worker shutdown complete');
          process.exit(0);
        } catch (error) {
          logger.error({ error }, 'Error during worker shutdown');
          process.exit(1);
        }
      });
    }

    // Handle uncaught errors
    process.on('uncaughtException', (error) => {
      logger.fatal({ error }, 'Uncaught exception');
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.fatal({ reason, promise }, 'Unhandled promise rejection');
      process.exit(1);
    });

    // Run the worker
    logger.info('Worker is running and polling for tasks...');
    await worker.run();

    logger.info('Worker stopped');
  } catch (error) {
    logger.fatal({ error }, 'Failed to start worker');
    process.exit(1);
  }
}

// Start the worker
main().catch((error) => {
  console.error('Fatal error in main():', error);
  process.exit(1);
});
