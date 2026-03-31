/**
 * Example: Print a shipping label from a template.
 *
 * Usage:
 *   LABELINN_API_KEY=sk_test_xxx node examples/print-shipping-label.js
 */

const LabelInn = require('labelinn');

async function main() {
  const client = new LabelInn(process.env.LABELINN_API_KEY);

  // 1. Find an online printer
  const { printers } = await client.fleet.list({ status: 'online' });
  if (printers.length === 0) {
    console.log('No printers online. Connect a printer in the LabelInn app first.');
    return;
  }
  const printer = printers[0];
  console.log(`Using printer: ${printer.name} (${printer.id})`);

  // 2. List available designs
  const { designs } = await client.designs.list();
  console.log(`Found ${designs.length} design(s)`);

  if (designs.length === 0) {
    // 3a. No designs — print raw ZPL
    console.log('No designs found. Printing a test ZPL label...');
    const job = await client.print.create({
      printer_id: printer.id,
      payload_type: 'zpl',
      payload_data: '^XA^FO50,50^ADN,36,20^FDHello from LabelInn API!^FS^XZ',
      job_name: 'API Test Label',
    });
    console.log(`Job ${job.id} → ${job.status}`);
    return;
  }

  // 3b. Use the first design as a template
  const design = designs[0];
  const vars = await client.designs.listVariables(design.id);
  console.log(`Design "${design.name}" has ${vars.variables?.length || 0} variable(s)`);

  // 4. Print the template with sample data
  const sampleData = {};
  for (const v of vars.variables || []) {
    sampleData[v.key || v.name] = `Sample ${v.key || v.name}`;
  }

  const job = await client.print.create({
    printer_id: printer.id,
    payload_type: 'template',
    design_id: design.id,
    data: sampleData,
    job_name: 'Shipping Label Example',
  });

  console.log(`✓ Print job submitted!`);
  console.log(`  Job ID: ${job.id}`);
  console.log(`  Status: ${job.status}`);
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
