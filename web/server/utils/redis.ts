// Redis connection utility with auto-detect
import IORedis from 'ioredis';
import { REDIS_URL } from '../config.js';
import { createLogger } from './logger.js';

const log = createLogger('redis');

let connection: IORedis | null = null;

export function getRedisConnection(): IORedis {
  if (!connection) {
    connection = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: null, // Required by BullMQ
      enableReadyCheck: true,
      retryStrategy(times) {
        if (times > 10) {
          log.error('Redis connection failed after 10 retries');
          return null;
        }
        return Math.min(times * 200, 5000);
      },
    });

    connection.on('connect', () => {
      log.info('Connected to Redis');
    });

    connection.on('error', (err) => {
      log.error('Redis connection error', { error: err.message });
    });

    connection.on('close', () => {
      log.warn('Redis connection closed');
    });
  }

  return connection;
}

export async function checkRedisConnection(): Promise<{ connected: boolean; error?: string }> {
  try {
    const redis = getRedisConnection();
    const result = await redis.ping();
    return { connected: result === 'PONG' };
  } catch {
    return {
      connected: false,
      error: `Redis not available at ${REDIS_URL}. ${getRedisInstructions()}`,
    };
  }
}

function getRedisInstructions(): string {
  return [
    'Start Redis with one of:',
    '  brew services start redis',
    '  docker run -d -p 6379:6379 redis:alpine',
    '  redis-server',
  ].join('\n');
}

export async function closeRedisConnection(): Promise<void> {
  if (connection) {
    await connection.quit();
    connection = null;
    log.info('Redis connection closed');
  }
}
