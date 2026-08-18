const logger = require('./logger');

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

/** Whether persistence is configured and active. */
const enabled = !!(REDIS_URL && REDIS_TOKEN);

/** Seconds of inactivity after which a saved room expires. */
const ROOM_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

if (!enabled) {
  logger.info('Persistence disabled (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN not set)');
}

/**
 * @param {string[]} command Redis command and arguments.
 * @returns {Promise<unknown>}
 */
async function redisCommand(command) {
  const path = command.map((part) => encodeURIComponent(part)).join('/');
  const response = await fetch(`${REDIS_URL}/${path}`, {
    headers: { Authorization: `Bearer ${REDIS_TOKEN}` },
  });
  if (!response.ok) {
    throw new Error(`Redis request failed: ${response.status}`);
  }
  const body = await response.json();
  return body.result;
}

/**
 * Load a previously saved room's variables.
 * @param {string} roomId
 * @returns {Promise<Record<string, string|number>|null>}
 */
async function loadRoom(roomId) {
  if (!enabled) return null;
  try {
    const raw = await redisCommand(['GET', `cloud:${roomId}`]);
    return raw ? JSON.parse(/** @type {string} */ (raw)) : null;
  } catch (error) {
    logger.error('Failed to load room from persistence: ' + error);
    return null;
  }
}

/**
 * Save a room's variables.
 * @param {string} roomId
 * @param {Record<string, string|number>} variables
 */
async function saveRoom(roomId, variables) {
  if (!enabled) return;
  try {
    await redisCommand(['SET', `cloud:${roomId}`, JSON.stringify(variables), 'EX', String(ROOM_TTL_SECONDS)]);
  } catch (error) {
    logger.error('Failed to save room to persistence: ' + error);
  }
}

module.exports = { enabled, loadRoom, saveRoom };
