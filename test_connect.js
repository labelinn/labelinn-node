'use strict';
const LabelInn = require('./lib/index.js');

let passed = 0, failed = 0;
function assert(name, condition) {
  if (condition) { console.log(`  ✓ ${name}`); passed++; }
  else { console.log(`  ✗ ${name}`); failed++; }
}

console.log('=== Node SDK: ConnectResource ===');
const client = new LabelInn('sk_test_dummy_key_for_testing');

assert('client.connect exists', !!client.connect);
assert('connect.ingest is function', typeof client.connect.ingest === 'function');
assert('connect.testParse is function', typeof client.connect.testParse === 'function');
assert('connect.createSource is function', typeof client.connect.createSource === 'function');
assert('connect.listSources is function', typeof client.connect.listSources === 'function');
assert('connect.getSource is function', typeof client.connect.getSource === 'function');
assert('connect.updateSource is function', typeof client.connect.updateSource === 'function');
assert('connect.deleteSource is function', typeof client.connect.deleteSource === 'function');
assert('connect.listRecords is function', typeof client.connect.listRecords === 'function');
assert('connect.getSchema is function', typeof client.connect.getSchema === 'function');
assert('connect.getMappings is function', typeof client.connect.getMappings === 'function');
assert('connect.updateMappings is function', typeof client.connect.updateMappings === 'function');
assert('connect.print is function', typeof client.connect.print === 'function');

// Verify other resources still work
console.log('\n=== Existing Resources ===');
assert('client.print exists', !!client.print);
assert('client.fleet exists', !!client.fleet);
assert('client.designs exists', !!client.designs);
assert('client.webhooks exists', !!client.webhooks);

// Verify CLI dispatch
console.log('\n=== CLI Help ===');
const { execSync } = require('child_process');
const help = execSync('node bin/cli.js --help', { encoding: 'utf-8' });
assert('CLI help contains connect', help.includes('connect'));
assert('CLI help contains sources', help.includes('connect sources'));

console.log(`\nRESULTS: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
