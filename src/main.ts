import { App } from './app';

async function main() {
  const app = new App();
  await app.run();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

