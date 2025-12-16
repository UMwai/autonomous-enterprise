/**
 * Environment variable utilities
 */

/**
 * Get environment variable or throw error if not set
 */
export function getEnvOrThrow(key: string): string {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

/**
 * Get environment variable or return default
 */
export function getEnv(key: string, defaultValue: string): string {
  return process.env[key] || defaultValue;
}
