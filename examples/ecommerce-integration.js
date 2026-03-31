/**
 * Example: E-commerce order fulfillment integration.
 *
 * Demonstrates how to integrate LabelInn with an e-commerce platform
 * to automatically print shipping labels when orders come in.
 *
 * Usage:
 *   LABELINN_API_KEY=sk_test_xxx node examples/ecommerce-integration.js
 */

const LabelInn = require('labelinn');

// Simulate incoming orders from your e-commerce platform
const sampleOrders = [
  {
    id: 'ORD-001',
    customer: 'Ali Yılmaz',
    address: 'Alsancak Mah, İzmir 35220',
    tracking: 'TR100200300',
    weight_kg: 2.5,
  },
  {
    id: 'ORD-002',
    customer: 'Ayşe Demir',
    address: 'Kadıköy, İstanbul 34710',
    tracking: 'TR100200301',
    weight_kg: 1.2,
  },
];

async function main() {
  const client = new LabelInn(process.env.LABELINN_API_KEY);

  // Find the warehouse printer
  const { printers } = await client.fleet.list({ status: 'online' });
  if (printers.length === 0) {
    console.log('No printers online.');
    return;
  }
  const printer = printers[0];

  // Find the shipping label template
  const { designs } = await client.designs.list();
  const shippingTemplate = designs.find(
    (d) => d.name.toLowerCase().includes('shipping') || d.name.toLowerCase().includes('kargo')
  );

  if (!shippingTemplate) {
    console.log('No shipping template found. Create one in the LabelInn app first.');
    console.log('Available designs:', designs.map((d) => d.name).join(', ') || '(none)');
    return;
  }

  console.log(`Using template: ${shippingTemplate.name}`);
  console.log(`Using printer: ${printer.name}`);
  console.log('');

  // Print labels for each order
  for (const order of sampleOrders) {
    const job = await client.print.create(
      {
        printer_id: printer.id,
        payload_type: 'template',
        design_id: shippingTemplate.id,
        data: {
          order_id: order.id,
          customer_name: order.customer,
          address: order.address,
          barcode: order.tracking,
          weight: `${order.weight_kg} kg`,
        },
        job_name: `Shipping: ${order.id}`,
      },
      { idempotencyKey: `ship-${order.id}` }
    );

    console.log(`✓ ${order.id} → ${order.customer} → Job ${job.id} (${job.status})`);
  }

  console.log('');
  console.log(`${sampleOrders.length} shipping labels queued!`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
