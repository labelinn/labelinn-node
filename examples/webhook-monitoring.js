/**
 * Example: Monitor printers via webhooks.
 *
 * Usage:
 *   LABELINN_API_KEY=sk_test_xxx node examples/webhook-monitoring.js
 */

const LabelInn = require('labelinn');

async function main() {
  const client = new LabelInn(process.env.LABELINN_API_KEY);

  // Create a webhook subscription
  const webhook = await client.webhooks.create({
    url: 'https://yourapp.com/webhooks/labelinn',
    events: [
      'print.job.completed',
      'print.job.failed',
      'printer.status.changed',
      'printer.supply.low',
    ],
    description: 'Production monitoring',
  });

  console.log('Webhook created:');
  console.log(`  ID:     ${webhook.id}`);
  console.log(`  URL:    ${webhook.url}`);
  console.log(`  Secret: ${webhook.signing_secret}`);
  console.log('');
  console.log('Save the signing secret! It will not be shown again.');
  console.log('');

  // List all webhooks
  const { webhooks } = await client.webhooks.list();
  console.log(`Total webhooks: ${webhooks.length}`);

  // Send a test ping
  await client.webhooks.test(webhook.id);
  console.log(`Test ping sent to ${webhook.url}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
