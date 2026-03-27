import { runEmailAlertJob } from '@/lib/filing-alerts';

async function main() {
  const result = await runEmailAlertJob();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack || error.message : String(error);
  console.error(message);
  process.exit(1);
});
