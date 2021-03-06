import logger from './logger';
// import fs from 'fs';

// if (fs.existsSync('now-secrets.json')) {
//   require('now-env');
// }

const ENVIRONMENT = process.env.NOW_ENV; // i'm using env variables from zeit/now
export const prod = ENVIRONMENT === 'production'; // Anything else is treated as 'dev'
export const stage = ENVIRONMENT === 'stage';
export const dev = !prod && !stage;


export const SESSION_SECRET = process.env['SESSION_SECRET'];
export const JWT_SECRET = process.env['JWT_SECRET'];

export const MONGODB_URI = process.env['MONGODB_URI'];
export const MONGODB_SESSIONS_URI = process.env['MONGODB_SESSIONS_URI'];

if (!SESSION_SECRET) {
  logger.error('No client secret. Set SESSION_SECRET environment variable.');
  process.exit(1);
}

if (!JWT_SECRET) {
  logger.error('No jwt secret. Set JWT_SECRET environment variable.');
  process.exit(1);
}

if (!MONGODB_URI) {
  logger.error('No mongo connection string. Set MONGODB_URI environment variable.');
  process.exit(1);
}

if (!MONGODB_SESSIONS_URI) {
  logger.error('No mongo sessions connection string. Set MONGODB_SESSIONS_URI environment variable.');
  process.exit(1);
}

export const USER_CRYPT_SECRET = process.env['USER_CRYPT_SECRET'];
export const USER_CRYPT_SALT = process.env['USER_CRYPT_SALT'];

export const SPOTIFY_SECRET = process.env['SPOTIFY_SECRET'];
export const SPOTIFY_ID = process.env['SPOTIFY_ID'];
