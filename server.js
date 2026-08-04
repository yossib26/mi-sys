const http = require('http');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('DATABASE_URL environment variable is required.');
  process.exit(1);
}

const client = new Client({ connectionString });
const indexHtml = fs.readFileSync(path.join(__dirname, 'index.html'));

async function startServer() {
  await client.connect();

  const server = http.createServer(async (req, res) => {
    if (req.url === '/api/status') {
      try {
        const result = await client.query('SELECT NOW() AS current_time');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          status: 'connected',
          current_time: result.rows[0].current_time
        }, null, 2));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'error', message: error.message }, null, 2));
      }
      return;
    }

    if (req.url === '/' || req.url === '/index.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(indexHtml);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  });

  server.listen(3000, () => {
    console.log('Server running on http://localhost:3000');
  });
}

startServer().catch((error) => {
  console.error('DB connection failed:', error.message);
  process.exit(1);
});
