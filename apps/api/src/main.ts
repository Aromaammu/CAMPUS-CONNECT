import 'reflect-metadata';
import { config } from './config';
import { createApp } from './bootstrap';

async function main() {
  const app = await createApp();
  await app.listen(config.port, '0.0.0.0');
  console.log(`API ready on http://localhost:${config.port}`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
