#!/usr/bin/env node
'use strict';

/**
 * LabelInn CLI — quick testing tool for the LabelInn API
 *
 * Usage:
 *   npx labelinn test                        # verify your API key
 *   npx labelinn printers                    # list printers
 *   npx labelinn printers <id> --status      # get printer status
 *   npx labelinn print <printer_id> --zpl "^XA^FO50,50^ADN,36,20^FDHello^FS^XZ"
 *   npx labelinn print <printer_id> --image-url https://...
 *   npx labelinn print <printer_id> --design <design_id> --data '{"sku":"A1"}'
 *   npx labelinn jobs                        # list recent jobs
 *   npx labelinn jobs <id>                   # get job detail
 *   npx labelinn designs                     # list designs
 *   npx labelinn webhooks                    # list webhooks
 */

const LabelInn = require('../lib/index.js');

const HELP = `
LabelInn CLI v1.2.0 — Developer testing tool

SETUP:
  Set your API key as an environment variable:
    export LABELINN_API_KEY=sk_test_xxxxx     (Linux/Mac)
    $env:LABELINN_API_KEY="sk_test_xxxxx"     (PowerShell)

COMMANDS:
  test                                 Verify API key & connectivity

  login                                Save API key for future commands
  login --key <key>                    Save key non-interactively
  login status                         Check saved credentials
  login logout                         Remove saved credentials

  printers                             List all printers
  printers <id>                        Get printer details
  printers <id> --status               Get printer status only
  printers <id> --identify             Flash/beep the printer
  printers <id> --update --name <n>    Update printer name
  printers <id> --media <json>         Set media definition (JSON)

  discover                             Start printer auto-discovery
  discover --device <id>               Discover on a specific device
  discover status <sessionId>          Poll discovery results
  discover add <sessionId> --address <addr>  Add printer to fleet

  groups                               List printer groups
  groups <id>                          Get group details
  groups add --name <n> [--printers id1,id2]  Create a group
  groups rm <id>                       Delete a group

  print <printer_id> [options]         Submit a print job
    --zpl <string>                       Raw ZPL payload
    --image-url <url>                    HTTPS image URL
    --design <design_id>                 Template design ID
    --data <json>                        Template variables (JSON)
    --copies <n>                         Number of copies
    --name <name>                        Job name
    --priority <p>                       low, normal, high, urgent
    --schedule <iso>                     Schedule for later (ISO 8601)

  jobs                                 List recent print jobs
  jobs <id>                            Get job details
  jobs <id> --cancel                   Cancel a queued job
  jobs <id> --retry                    Retry a failed job
  jobs <id> --reprint                  Reprint a completed job
  batch <file.json>                    Batch print from JSON file

  designs                              List designs
  designs <id>                         Get design details
  designs <id> --revisions             List revision history

  webhooks                             List webhooks
  webhooks add <url> [events...]       Subscribe to events
  webhooks rm <id>                     Delete a webhook
  webhooks test <id>                   Send test ping
  webhooks update <id> [--events e1,e2] [--enabled true|false]
  webhooks deliveries <id>             List delivery history

  connect                              Data Connect commands
  connect sources                      List connector sources
  connect sources <id>                 Get source details
  connect sources create --name <n> [--format csv|json|xml]
  connect sources rm <id>              Delete a source
  connect ingest <source_id> --file <path>  Ingest data from file
  connect ingest <source_id> --data <json>  Ingest inline JSON data
  connect test-parse --file <path>     Parse without storing
  connect schema <source_id>           Get detected schema
  connect records <source_id>          List ingested records
  connect mappings <source_id>         Get field mappings
  connect print <source_id> --design <id> --printer <id>  Print from connector

OPTIONS:
  --key <key>        API key (overrides LABELINN_API_KEY)
  --base-url <url>   Override base URL
  --json             Output raw JSON
  -h, --help         Show this help

EXAMPLES:
  npx labelinn test
  npx labelinn print prt_abc123 --zpl "^XA^FO50,50^ADN,36,20^FDHello^FS^XZ"
  npx labelinn print prt_abc123 --design dsg_ship --data '{"name":"Ali","barcode":"TR12345"}' --priority high
  npx labelinn printers prt_abc123 --media '{"width_mm":100,"height_mm":50}'
  npx labelinn printers prt_abc123 --identify
  npx labelinn groups add --name "Warehouse" --printers prt_1,prt_2
  npx labelinn jobs --json
`.trim();

// ── Arg Parsing ──

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      args.flags.help = true;
    } else if (a === '--json') {
      args.flags.json = true;
    } else if (a === '--status') {
      args.flags.status = true;
    } else if (a === '--cancel') {
      args.flags.cancel = true;
    } else if (a === '--identify') {
      args.flags.identify = true;
    } else if (a === '--update') {
      args.flags.update = true;
    } else if (a === '--retry') {
      args.flags.retry = true;
    } else if (a === '--reprint') {
      args.flags.reprint = true;
    } else if (a === '--revisions') {
      args.flags.revisions = true;
    } else if (a.startsWith('--') && i + 1 < argv.length) {
      const key = a.slice(2);
      args.flags[key] = argv[++i];
    } else {
      args._.push(a);
    }
    i++;
  }
  return args;
}

function getClient(flags) {
  const apiKey = flags.key || process.env.LABELINN_API_KEY || getStoredKey();
  if (!apiKey) {
    console.error('Error: No API key. Run "labelinn login", set LABELINN_API_KEY, or use --key <key>');
    process.exit(1);
  }
  const opts = {};
  if (flags['base-url']) opts.baseUrl = flags['base-url'];
  return new LabelInn(apiKey, opts);
}

function output(data, flags) {
  if (flags.json) {
    console.log(JSON.stringify(data, null, 2));
  } else {
    // Clean internal keys for display
    const clean = { ...data };
    delete clean._rateLimit;
    delete clean._idempotent;
    console.log(JSON.stringify(clean, null, 2));
  }
}

function getCredentialsPath() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const path = require('path');
  return path.join(home, '.labelinn', 'credentials.json');
}

function getStoredKey() {
  const fs = require('fs');
  const credPath = getCredentialsPath();
  try {
    const config = JSON.parse(fs.readFileSync(credPath, 'utf8'));
    return config.api_key || '';
  } catch {
    return '';
  }
}

async function cmdLogin(args, flags) {
  const fs = require('fs');
  const path = require('path');
  const readline = require('readline');
  const credPath = getCredentialsPath();
  const credDir = path.dirname(credPath);

  const subCmd = args._[1];

  if (subCmd === 'status') {
    try {
      const config = JSON.parse(fs.readFileSync(credPath, 'utf8'));
      const key = config.api_key || '';
      const prefix = key.length > 15 ? key.substring(0, 15) + '...' : key;
      const mode = key.startsWith('sk_test_') ? 'TEST' : 'LIVE';
      console.log(`Logged in: ${prefix}`);
      console.log(`  Mode: ${mode}`);
      console.log(`  Config: ${credPath}`);
    } catch {
      console.log('Not logged in. Run: labelinn login');
    }
    return;
  }

  if (subCmd === 'logout') {
    try {
      fs.unlinkSync(credPath);
      console.log('Logged out. Credentials removed.');
    } catch {
      console.log('Not logged in.');
    }
    return;
  }

  let apiKey = flags.key;
  if (!apiKey) {
    console.log('Enter your LabelInn API key.');
    console.log('  Get one at: https://labelinn.com → Settings → API Keys');
    console.log();

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    apiKey = await new Promise((resolve) => {
      rl.question('API Key: ', (answer) => {
        rl.close();
        resolve(answer.trim());
      });
    });
  }

  if (!apiKey) {
    console.error('Error: No API key provided.');
    process.exit(1);
  }
  if (!apiKey.startsWith('sk_live_') && !apiKey.startsWith('sk_test_')) {
    console.error('Error: API key must start with sk_live_ or sk_test_');
    process.exit(1);
  }

  // Test the key
  console.log('Verifying key...');
  const client = new LabelInn(apiKey);
  const result = await client.fleet.list();
  const printers = result.printers || result;
  const count = Array.isArray(printers) ? printers.length : 0;

  // Save credentials
  fs.mkdirSync(credDir, { recursive: true });
  fs.writeFileSync(credPath, JSON.stringify({ api_key: apiKey }, null, 2), 'utf8');

  const mode = apiKey.startsWith('sk_test_') ? 'TEST (sandbox)' : 'LIVE';
  console.log(`✓ Logged in! Mode: ${mode}, ${count} printer(s) found.`);
  console.log(`  Credentials saved to ${credPath}`);
  console.log('  You can now run commands without --key flag.');
}

function table(rows, columns) {
  if (!rows || rows.length === 0) {
    console.log('(none)');
    return;
  }
  // Simple table output
  const widths = {};
  for (const col of columns) {
    widths[col] = col.length;
    for (const row of rows) {
      const val = String(row[col] ?? '');
      widths[col] = Math.max(widths[col], val.length);
    }
  }
  const header = columns.map(c => c.toUpperCase().padEnd(widths[c])).join('  ');
  console.log(header);
  console.log(columns.map(c => '─'.repeat(widths[c])).join('  '));
  for (const row of rows) {
    console.log(columns.map(c => String(row[c] ?? '').padEnd(widths[c])).join('  '));
  }
}

// ── Commands ──

async function cmdTest(client, flags) {
  console.log(`Mode: ${client.isTestMode ? 'TEST (sandbox)' : 'LIVE'}`);
  console.log('Checking connectivity...');

  try {
    const result = await client.fleet.list();
    const printers = result.printers || result;
    const count = Array.isArray(printers) ? printers.length : 0;
    console.log(`✓ Connected! Found ${count} printer(s).`);
    if (result._rateLimit) {
      console.log(`  Rate limit: ${result._rateLimit.remaining}/${result._rateLimit.limit} remaining`);
    }
  } catch (err) {
    console.error(`✗ Failed: ${err.message}`);
    if (err.code) console.error(`  Code: ${err.code}`);
    process.exit(1);
  }
}

async function cmdPrinters(client, args, flags) {
  const printerId = args._[1];
  if (printerId) {
    if (flags.status) {
      const result = await client.fleet.status(printerId);
      output(result, flags);
    } else if (flags.identify) {
      await client.fleet.identify(printerId);
      console.log(`✓ Identify command sent to printer ${printerId}`);
    } else if (flags.media) {
      let mediaParams;
      try {
        mediaParams = JSON.parse(flags.media);
      } catch {
        console.error('Error: --media must be valid JSON, e.g. \'{"width_mm":100,"height_mm":50}\'');
        process.exit(1);
      }
      const result = await client.fleet.setMedia(printerId, mediaParams);
      if (flags.json) {
        output(result, flags);
      } else {
        console.log(`✓ Media definition updated on ${printerId}`);
      }
    } else if (flags.update) {
      const params = {};
      if (flags.name) params.name = flags.name;
      const result = await client.fleet.update(printerId, params);
      if (flags.json) {
        output(result, flags);
      } else {
        console.log(`✓ Printer ${printerId} updated`);
      }
    } else {
      const result = await client.fleet.get(printerId);
      output(result, flags);
    }
  } else {
    const result = await client.fleet.list();
    const printers = result.printers || result;
    if (flags.json) {
      output(result, flags);
    } else {
      table(Array.isArray(printers) ? printers : [], ['id', 'name', 'status', 'model', 'connection']);
    }
  }
}

async function cmdGroups(client, args, flags) {
  const subCmd = args._[1];
  if (subCmd === 'add') {
    const params = {};
    if (flags.name) params.name = flags.name;
    if (flags.printers) params.printer_ids = flags.printers.split(',');
    if (flags.description) params.description = flags.description;
    const result = await client.fleet.groups.create(params);
    if (flags.json) {
      output(result, flags);
    } else {
      console.log(`✓ Group created: ${result.id}`);
    }
  } else if (subCmd === 'rm') {
    const id = args._[2];
    if (!id) { console.error('Usage: labelinn groups rm <id>'); process.exit(1); }
    await client.fleet.groups.delete(id);
    console.log(`✓ Group ${id} deleted`);
  } else if (subCmd) {
    const result = await client.fleet.groups.get(subCmd);
    output(result, flags);
  } else {
    const result = await client.fleet.groups.list();
    const groups = result.groups || result;
    if (flags.json) {
      output(result, flags);
    } else {
      table(Array.isArray(groups) ? groups : [], ['id', 'name', 'printer_count']);
    }
  }
}

async function cmdPrint(client, args, flags) {
  const printerId = args._[1];
  if (!printerId) {
    console.error('Usage: labelinn print <printer_id> [--zpl|--image-url|--design] ...');
    process.exit(1);
  }

  const params = { printer_id: printerId };

  if (flags.zpl) {
    params.payload_type = 'zpl';
    params.payload_data = flags.zpl;
  } else if (flags['image-url']) {
    params.payload_type = 'image';
    params.image_url = flags['image-url'];
  } else if (flags.design) {
    params.payload_type = 'template';
    params.design_id = flags.design;
    if (flags.data) {
      try {
        params.data = JSON.parse(flags.data);
      } catch {
        console.error('Error: --data must be valid JSON');
        process.exit(1);
      }
    }
  } else {
    console.error('Error: Specify --zpl, --image-url, or --design');
    process.exit(1);
  }

  if (flags.copies) params.copies = parseInt(flags.copies, 10);
  if (flags.name) params.job_name = flags.name;
  if (flags.priority) params.priority = flags.priority;
  if (flags.schedule) params.print_at = flags.schedule;

  const opts = {};
  if (flags['idempotency-key']) opts.idempotencyKey = flags['idempotency-key'];

  const job = await client.print.create(params, opts);
  if (flags.json) {
    output(job, flags);
  } else {
    console.log(`✓ Print job submitted`);
    console.log(`  Job ID:  ${job.id}`);
    console.log(`  Status:  ${job.status}`);
    if (job._idempotent) console.log('  (Idempotent — duplicate request)');
  }
}

async function cmdJobs(client, args, flags) {
  const jobId = args._[1];
  if (jobId) {
    if (flags.cancel) {
      await client.print.cancel(jobId);
      console.log(`✓ Job ${jobId} cancelled`);
    } else if (flags.retry) {
      const result = await client.print.retry(jobId);
      if (flags.json) {
        output(result, flags);
      } else {
        console.log(`✓ Retry job created: ${result.id}`);
      }
    } else if (flags.reprint) {
      const overrides = {};
      if (flags.copies) overrides.copies = parseInt(flags.copies, 10);
      const result = await client.print.reprint(jobId, overrides);
      if (flags.json) {
        output(result, flags);
      } else {
        console.log(`✓ Reprint job created: ${result.id}`);
      }
    } else {
      const result = await client.print.get(jobId);
      output(result, flags);
    }
  } else {
    const query = {};
    if (flags.status) query.status = flags.status;
    if (flags.printer) query.printer_id = flags.printer;
    if (flags.limit) query.limit = parseInt(flags.limit, 10);

    const result = await client.print.list(query);
    const jobs = result.jobs || result;
    if (flags.json) {
      output(result, flags);
    } else {
      table(Array.isArray(jobs) ? jobs : [], ['id', 'status', 'printer_id', 'payload_type', 'created_at']);
    }
  }
}

async function cmdDesigns(client, args, flags) {
  const designId = args._[1];
  if (designId) {
    if (flags.revisions) {
      const result = await client.designs.revisions(designId);
      output(result, flags);
    } else {
      const result = await client.designs.get(designId);
      output(result, flags);
    }
  } else {
    const result = await client.designs.list();
    const designs = result.designs || result;
    if (flags.json) {
      output(result, flags);
    } else {
      table(Array.isArray(designs) ? designs : [], ['id', 'name', 'width_mm', 'height_mm']);
    }
  }
}

async function cmdBatch(client, args, flags) {
  const filePath = args._[1];
  if (!filePath) {
    console.error('Usage: labelinn batch <file.json>');
    console.error('  File should contain a JSON array of job objects, or { "jobs": [...] }');
    process.exit(1);
  }

  const fs = require('fs');
  let raw;
  try {
    raw = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    console.error(`Error: Cannot read file "${filePath}": ${err.message}`);
    process.exit(1);
  }

  let jobs;
  try {
    const parsed = JSON.parse(raw);
    jobs = Array.isArray(parsed) ? parsed : (parsed.jobs || parsed);
    if (!Array.isArray(jobs)) throw new Error('Not an array');
  } catch (err) {
    console.error(`Error: File must contain a JSON array of jobs, or { "jobs": [...] }`);
    process.exit(1);
  }

  if (jobs.length === 0) {
    console.error('Error: Jobs array is empty');
    process.exit(1);
  }
  if (jobs.length > 100) {
    console.error(`Error: Max 100 jobs per batch (got ${jobs.length})`);
    process.exit(1);
  }

  const result = await client.print.batch(jobs);
  if (flags.json) {
    output(result, flags);
  } else {
    console.log(`✓ Batch submitted: ${result.total_jobs || jobs.length} jobs`);
    console.log(`  Successful: ${result.successful ?? '?'}`);
    console.log(`  Failed:     ${result.failed ?? '?'}`);
    if (result.batch_id) console.log(`  Batch ID:   ${result.batch_id}`);
  }
}

async function cmdConnect(client, args, flags) {
  const subCmd = args._[1];

  if (subCmd === 'sources') {
    const sourceArg = args._[2];
    if (sourceArg === 'create') {
      if (!flags.name) { console.error('Usage: labelinn connect sources create --name <n> [--format csv|json|xml]'); process.exit(1); }
      const params = { name: flags.name };
      if (flags.format) params.format = flags.format;
      if (flags.description) params.description = flags.description;
      const result = await client.connect.createSource(params);
      if (flags.json) { output(result, flags); }
      else {
        console.log(`✓ Source created`);
        console.log(`  ID:     ${result.id}`);
        console.log(`  Name:   ${result.name}`);
        console.log(`  Format: ${result.format || 'auto'}`);
      }
    } else if (sourceArg === 'rm') {
      const id = args._[3];
      if (!id) { console.error('Usage: labelinn connect sources rm <id>'); process.exit(1); }
      await client.connect.deleteSource(id);
      console.log(`✓ Source ${id} deleted`);
    } else if (sourceArg) {
      // Get specific source
      const result = await client.connect.getSource(sourceArg);
      if (flags.json) { output(result, flags); }
      else {
        console.log(`Source: ${result.name || result.id}`);
        console.log(`  ID:           ${result.id}`);
        console.log(`  Format:       ${result.format || '?'}`);
        console.log(`  Records:      ${result.record_count ?? '?'}`);
        console.log(`  Active:       ${result.is_active}`);
        if (result.created_at) console.log(`  Created:      ${result.created_at}`);
      }
    } else {
      // List sources
      const result = await client.connect.listSources();
      const sources = Array.isArray(result) ? result : (result.sources || []);
      if (flags.json) { output(result, flags); }
      else { table(sources, ['id', 'name', 'format', 'record_count', 'is_active']); }
    }
  } else if (subCmd === 'ingest') {
    const sourceId = args._[2];
    if (!sourceId) { console.error('Usage: labelinn connect ingest <source_id> --file <path> | --data <json>'); process.exit(1); }
    let payload;
    if (flags.file) {
      const fs = require('fs');
      payload = fs.readFileSync(flags.file, 'utf-8');
    } else if (flags.data) {
      payload = flags.data;
    } else {
      console.error('Provide --file <path> or --data <json>'); process.exit(1);
    }
    const params = { source_id: sourceId, payload };
    if (flags.format) params.format = flags.format;
    const result = await client.connect.ingest(params);
    if (flags.json) { output(result, flags); }
    else {
      console.log(`✓ Ingested ${result.records_count ?? '?'} records into ${result.source_id}`);
      console.log(`  Format: ${result.format || '?'}`);
    }
  } else if (subCmd === 'test-parse') {
    let payload;
    if (flags.file) {
      const fs = require('fs');
      payload = fs.readFileSync(flags.file, 'utf-8');
    } else if (flags.data) {
      payload = flags.data;
    } else {
      console.error('Provide --file <path> or --data <json>'); process.exit(1);
    }
    const params = { payload };
    if (flags.format) params.format = flags.format;
    const result = await client.connect.testParse(params);
    if (flags.json) { output(result, flags); }
    else {
      console.log(`Format: ${result.format}`);
      console.log(`Records: ${(result.records || []).length}`);
      if (result.schema) {
        console.log('Schema:');
        table(result.schema, ['path', 'type', 'sample']);
      }
    }
  } else if (subCmd === 'schema') {
    const sourceId = args._[2];
    if (!sourceId) { console.error('Usage: labelinn connect schema <source_id>'); process.exit(1); }
    const result = await client.connect.getSchema(sourceId);
    if (flags.json) { output(result, flags); }
    else {
      const fields = result.fields || result.schema || [];
      table(fields, ['path', 'type', 'sample']);
    }
  } else if (subCmd === 'records') {
    const sourceId = args._[2];
    if (!sourceId) { console.error('Usage: labelinn connect records <source_id>'); process.exit(1); }
    const result = await client.connect.listRecords(sourceId, flags.limit ? parseInt(flags.limit) : undefined);
    output(result, flags);
  } else if (subCmd === 'mappings') {
    const sourceId = args._[2];
    if (!sourceId) { console.error('Usage: labelinn connect mappings <source_id>'); process.exit(1); }
    const result = await client.connect.getMappings(sourceId);
    output(result, flags);
  } else if (subCmd === 'print') {
    const sourceId = args._[2];
    if (!sourceId || !flags.design || !flags.printer) {
      console.error('Usage: labelinn connect print <source_id> --design <id> --printer <id> [--copies n]');
      process.exit(1);
    }
    const params = { source_id: sourceId, design_id: flags.design, printer_id: flags.printer };
    if (flags.copies) params.copies = parseInt(flags.copies);
    const result = await client.connect.print(params);
    if (flags.json) { output(result, flags); }
    else {
      console.log(`✓ Print jobs created: ${result.count ?? (result.job_ids || []).length}`);
      if (result.job_ids) console.log(`  Job IDs: ${result.job_ids.join(', ')}`);
    }
  } else {
    console.log('Data Connect commands:');
    console.log('  connect sources                    List sources');
    console.log('  connect sources <id>               Get source details');
    console.log('  connect sources create --name <n>  Create a source');
    console.log('  connect sources rm <id>            Delete a source');
    console.log('  connect ingest <id> --file <path>  Ingest data');
    console.log('  connect test-parse --file <path>   Parse without storing');
    console.log('  connect schema <id>                Get schema');
    console.log('  connect records <id>               List records');
    console.log('  connect mappings <id>              Get mappings');
    console.log('  connect print <id> --design <d> --printer <p>  Print');
  }
}

async function cmdDiscover(client, args, flags) {
  const subCmd = args._[1];

  if (subCmd === 'status') {
    const sessionId = args._[2];
    if (!sessionId) { console.error('Usage: labelinn discover status <sessionId>'); process.exit(1); }
    const result = await client.fleet.getDiscoveryStatus(sessionId);
    const data = result.data || result;
    if (flags.json) {
      output(result, flags);
    } else {
      console.log(`Session: ${data.session_id || sessionId}`);
      console.log(`Status:  ${data.status}`);
      const printers = data.printers || [];
      if (printers.length > 0) {
        console.log(`Found ${printers.length} printer(s):`);
        table(printers, ['name', 'address', 'brand', 'connection_type', 'is_thermal']);
      } else {
        console.log('No printers found yet.');
      }
    }
  } else if (subCmd === 'add') {
    const sessionId = args._[2];
    if (!sessionId || !flags.address) {
      console.error('Usage: labelinn discover add <sessionId> --address <addr> [--name <name>]');
      process.exit(1);
    }
    const params = { address: flags.address };
    if (flags.name) params.name = flags.name;
    const result = await client.fleet.addDiscoveredPrinter(sessionId, params);
    const data = result.data || result;
    if (flags.json) {
      output(result, flags);
    } else {
      console.log(`✓ Printer added to fleet`);
      console.log(`  ID:      ${data.id}`);
      console.log(`  Name:    ${data.name}`);
      console.log(`  Status:  ${data.status}`);
    }
  } else {
    // Start discovery
    const params = {};
    if (flags.device) params.device_id = flags.device;
    const result = await client.fleet.startDiscovery(params);
    const data = result.data || result;
    if (flags.json) {
      output(result, flags);
    } else {
      console.log(`✓ Discovery session started`);
      console.log(`  Session ID: ${data.session_id}`);
      console.log(`  Status:     ${data.status}`);
      console.log(`\nPoll results with: labelinn discover status ${data.session_id}`);
    }
  }
}

async function cmdWebhooks(client, args, flags) {
  const subCmd = args._[1];
  if (subCmd === 'add') {
    const url = args._[2];
    if (!url) { console.error('Usage: labelinn webhooks add <url> [events...]'); process.exit(1); }
    const events = args._.slice(3);
    if (events.length === 0) events.push('print_job.completed', 'print_job.failed');
    const result = await client.webhooks.create({ url, events });
    if (flags.json) {
      output(result, flags);
    } else {
      console.log(`✓ Webhook created`);
      console.log(`  ID:     ${result.id}`);
      console.log(`  URL:    ${result.url}`);
      console.log(`  Events: ${(result.events || events).join(', ')}`);
      if (result.signing_secret) {
        console.log(`  Secret: ${result.signing_secret}`);
        console.log('  (Save this — it won\'t be shown again)');
      }
    }
  } else if (subCmd === 'rm') {
    const id = args._[2];
    if (!id) { console.error('Usage: labelinn webhooks rm <id>'); process.exit(1); }
    await client.webhooks.delete(id);
    console.log(`✓ Webhook ${id} deleted`);
  } else if (subCmd === 'test') {
    const id = args._[2];
    if (!id) { console.error('Usage: labelinn webhooks test <id>'); process.exit(1); }
    const result = await client.webhooks.test(id);
    if (flags.json) {
      output(result, flags);
    } else {
      console.log(`✓ Test ping sent to webhook ${id}`);
    }
  } else if (subCmd === 'update') {
    const id = args._[2];
    if (!id) { console.error('Usage: labelinn webhooks update <id> [--events e1,e2] [--enabled true|false]'); process.exit(1); }
    const params = {};
    if (flags.events) params.events = flags.events.split(',');
    if (flags.enabled !== undefined) params.enabled = flags.enabled === 'true';
    if (flags.url) params.url = flags.url;
    if (flags.description) params.description = flags.description;
    const result = await client.webhooks.update(id, params);
    if (flags.json) {
      output(result, flags);
    } else {
      console.log(`✓ Webhook ${id} updated`);
    }
  } else if (subCmd === 'deliveries') {
    const id = args._[2];
    if (!id) { console.error('Usage: labelinn webhooks deliveries <id>'); process.exit(1); }
    const result = await client.webhooks.deliveries(id);
    if (flags.json) {
      output(result, flags);
    } else {
      const deliveries = Array.isArray(result) ? result : (result.deliveries || result);
      table(Array.isArray(deliveries) ? deliveries : [], ['id', 'event', 'status', 'http_status', 'timestamp']);
    }
  } else {
    const result = await client.webhooks.list();
    const webhooks = result.webhooks || result;
    if (flags.json) {
      output(result, flags);
    } else {
      table(Array.isArray(webhooks) ? webhooks : [], ['id', 'url', 'events']);
    }
  }
}

// ── Main ──

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.flags.help || args._.length === 0) {
    console.log(HELP);
    process.exit(0);
  }

  const command = args._[0];
  let client;

  try {
    // Login command doesn't need existing auth
    if (command === 'login') {
      await cmdLogin(args, args.flags);
      return;
    }

    client = getClient(args.flags);
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }

  try {
    switch (command) {
      case 'discover': await cmdDiscover(client, args, args.flags); break;
      case 'test':     await cmdTest(client, args.flags); break;
      case 'printers': await cmdPrinters(client, args, args.flags); break;
      case 'groups':   await cmdGroups(client, args, args.flags); break;
      case 'print':    await cmdPrint(client, args, args.flags); break;
      case 'jobs':     await cmdJobs(client, args, args.flags); break;
      case 'batch':    await cmdBatch(client, args, args.flags); break;
      case 'designs':  await cmdDesigns(client, args, args.flags); break;
      case 'webhooks': await cmdWebhooks(client, args, args.flags); break;
      case 'connect':  await cmdConnect(client, args, args.flags); break;
      default:
        console.error(`Unknown command: ${command}`);
        console.error('Run "labelinn --help" for usage');
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof LabelInn.LabelInnError) {
      console.error(`API Error [${err.status}] ${err.code}: ${err.message}`);
    } else {
      console.error(`Error: ${err.message}`);
    }
    process.exit(1);
  }
}

main();
