// scripts/run-sync.js — trigger a full sync run against the running server.
// Usage: node scripts/run-sync.js [--port 8080]

const PORT = process.argv.includes('--port')
  ? process.argv[process.argv.indexOf('--port') + 1]
  : (process.env.PORT || 8080);

const BASE = 'http://localhost:' + PORT;

async function main() {
  console.log('Triggering sync at ' + BASE + '/api/sync …\n');

  let res;
  try {
    res = await fetch(BASE + '/api/sync', { method: 'POST' });
  } catch (e) {
    console.error('Failed to reach server:', e.message);
    console.error('Is the server running? (node src/serve.js)');
    process.exit(1);
  }

  const body = await res.text();
  let result;
  try { result = JSON.parse(body); } catch (_) { result = body; }

  if (res.ok) {
    console.log('Sync complete:');
    console.log('  成功:', result.ok);
    console.log('  失败:', result.failed);
    console.log('  跳过:', result.skipped);
    console.log('  源总数:', result.sources_total);
  } else {
    console.error('Sync failed (' + res.status + '):', result.error || body);
    process.exit(1);
  }
}

main();
