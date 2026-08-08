const { Pool, types } = require('pg');

// Return DATE columns as plain 'YYYY-MM-DD' strings instead of JS Date
// objects — pg otherwise applies local-timezone conversion and can shift
// the date by a day.
types.setTypeParser(types.builtins.DATE, (value) => value);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// pg's Pool emits 'error' for problems on an already-idle client (e.g.
// Neon closing a connection that's sitting unused) — completely
// separate from any error a live query would reject with. Without a
// listener here, Node treats that as an unhandled 'error' event and
// crashes the entire process, which on Vercel means the whole
// serverless function dies with no application-level log line at all
// (exactly a silent FUNCTION_INVOCATION_FAILED). This is the standard
// fix: https://node-postgres.com/apis/pool#error
pool.on('error', (err) => {
  console.error('Unexpected error on idle PG client', err);
});

module.exports = pool;
