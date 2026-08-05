// User management + login business logic. Session/cookie mechanics
// live in lib/auth.js; this file only talks to the users table.
const { hashPassword, verifyPassword, httpError } = require('./auth');

const ROLES = ['admin', 'user'];
const USER_COLUMNS = 'id, username, role, created_at';

async function login(pool, body) {
  const username = ((body && body.username) || '').trim();
  const password = (body && body.password) || '';
  if (!username || !password) throw httpError(400, 'username and password are required');

  const result = await pool.query('SELECT id, username, role, password_hash FROM users WHERE username = $1', [username]);
  const user = result.rows[0];
  // Same error either way — don't reveal whether the username exists.
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    throw httpError(401, 'invalid username or password');
  }
  return { id: user.id, username: user.username, role: user.role };
}

async function listUsers(pool) {
  const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users ORDER BY username`);
  return { status: 200, body: result.rows };
}

async function createUser(pool, body) {
  const username = ((body && body.username) || '').trim();
  const password = (body && body.password) || '';
  const role = (body && body.role) || 'user';

  if (!username || !password) throw httpError(400, 'username and password are required');
  if (password.length < 4) throw httpError(400, 'password must be at least 4 characters');
  if (!ROLES.includes(role)) throw httpError(400, `role must be one of: ${ROLES.join(', ')}`);

  const passwordHash = await hashPassword(password);
  try {
    const result = await pool.query(
      `INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING ${USER_COLUMNS}`,
      [username, passwordHash, role]
    );
    return { status: 201, body: result.rows[0] };
  } catch (error) {
    if (error.code === '23505') throw httpError(409, 'username already exists');
    throw error;
  }
}

async function deleteUser(pool, id, currentUserId) {
  if (String(id) === String(currentUserId)) {
    throw httpError(400, 'cannot delete your own account');
  }

  const target = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
  if (target.rowCount === 0) throw httpError(404, 'user not found');

  if (target.rows[0].role === 'admin') {
    const adminCount = await pool.query("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'");
    if (parseInt(adminCount.rows[0].n, 10) <= 1) {
      throw httpError(400, 'cannot delete the last remaining admin');
    }
  }

  await pool.query('DELETE FROM users WHERE id = $1', [id]);
  return { status: 204, body: null };
}

module.exports = { login, listUsers, createUser, deleteUser, ROLES };
