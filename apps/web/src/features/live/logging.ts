import { LoggerNames, getLogger } from 'livekit-client';

/**
 * When the server deliberately closes a connection (teacher removes someone, a second device takes over,
 * the class ends), the video library reports its data channels closing as errors. Nothing is wrong, so we
 * show those as warnings; every other library error still appears as an error.
 */
const EXPECTED_ON_DISCONNECT = [/DataChannel error on/i];

type Method = (...args: unknown[]) => void;
type Factory = (method: string, level: unknown, name: unknown) => Method;
let installed = false;

export function softenExpectedLiveKitErrors() {
  if (installed) return;
  installed = true;
  for (const name of Object.values(LoggerNames)) {
    const logger = getLogger(name) as unknown as { methodFactory: Factory; setLevel: (l: unknown) => void; getLevel: () => unknown };
    const original = logger.methodFactory;
    logger.methodFactory = (method, level, loggerName) => {
      const raw = original(method, level, loggerName);
      if (method !== 'error') return raw;
      const warn = original('warn', level, loggerName);
      return (msg, ...rest) => (EXPECTED_ON_DISCONNECT.some((r) => r.test(String(msg))) ? warn(msg, ...rest) : raw(msg, ...rest));
    };
    logger.setLevel(logger.getLevel());
  }
}
