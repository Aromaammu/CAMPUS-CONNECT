import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// Minimal .env loader (no extra dependency). Real environment variables win.
const envFile = join(__dirname, '..', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = process.env;
const isProd = env.NODE_ENV === 'production';

function required(name: string, devDefault: string): string {
  const v = env[name];
  if (v) return v;
  if (isProd) throw new Error(`Missing environment variable ${name}`);
  return devDefault;
}

export const config = {
  isProd,
  isTest: env.NODE_ENV === 'test' || env.CC_MODE === 'e2e',
  port: Number(env.PORT || 3000),
  appUrl: env.APP_URL || 'http://localhost:5173',
  databaseUrl: required('DATABASE_URL', 'postgresql://cc:cc_local_dev@127.0.0.1:5433/cc_dev'),
  jwtSecret: required('JWT_SECRET', 'dev-only-secret-change-me-in-production-0123456789'),
  accessTokenMinutes: 15,
  refreshMaxDays: 30,
  storageDir: env.STORAGE_DIR || join(__dirname, '..', '..', '..', '.data', 'uploads'),
  /** capture = store in the test mailbox only. Real providers are added at launch. */
  mailMode: (env.MAIL_MODE || 'capture') as 'capture' | 'smtp',
  smtpUrl: env.SMTP_URL || '',
  mailFrom: env.MAIL_FROM || 'Campus Connect <no-reply@campusconnect.local>',
  smsMode: (env.SMS_MODE || 'capture') as 'capture' | 'live',
  smsAccessToken: env.SMS_ACCESS_TOKEN || '',
  smsSender: env.SMS_SENDER || '',
  smsApiUrl: env.SMS_API_URL || '',
  /** capture = push recorded in the test mailbox; live = sent to browsers (needs VAPID keys). */
  pushMode: (env.PUSH_MODE || (isProd ? 'live' : 'capture')) as 'capture' | 'live',
  livekitUrl: env.LIVEKIT_URL || 'ws://localhost:7880',
  livekitPublicUrl: env.LIVEKIT_PUBLIC_URL || env.LIVEKIT_URL || 'ws://localhost:7880',
  livekitKey: required('LIVEKIT_API_KEY', 'devkey'),
  livekitSecret: required('LIVEKIT_API_SECRET', 'secret_dev_livekit_key_0123456789abcdef'),
  /** livekit = real class server; fake = in-memory stand-in used by the API integration tests. */
  liveMode: (env.LIVE_MODE || (env.NODE_ENV === 'test' ? 'fake' : 'livekit')) as 'livekit' | 'fake',
  /** fake = sample recording files (Windows dev); egress = real LiveKit Egress (Linux). */
  recordingMode: (env.RECORDING_MODE || 'fake') as 'fake' | 'egress',
  vapidPublic: env.VAPID_PUBLIC_KEY || '',
  vapidPrivate: env.VAPID_PRIVATE_KEY || '',
  vapidSubject: env.VAPID_SUBJECT || 'mailto:support@campusconnect.local',
  webDist: env.WEB_DIST || join(__dirname, '..', '..', 'web', 'dist'),
  disableJobs: env.DISABLE_JOBS === '1',
};
