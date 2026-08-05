// User management + login business logic. Session/cookie mechanics
// live in lib/auth.js; this file only talks to the users table.
const { hashPassword, verifyPassword, httpError } = require('./auth');

const ROLES = ['admin', 'user'];

// 'brands' is a JSON array of {id, name} — irrelevant for admins
// (they're unrestricted regardless) but that's what a 'user' account
// can see/manage. COALESCE keeps it '[]' instead of null when empty.
const USER_COLUMNS = `
  u.id, u.username, u.role, u.created_at,
  COALESCE(
    (SELECT json_agg(json_build_object('id', b.id, 'name', b.name) ORDER BY b.name)
     FROM user_brands ub JOIN brands b ON b.id = ub.brand_id WHERE ub.user_id = u.id),
    '[]'
  ) AS brands
`;

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

// null = unrestricted (admin). An array (possibly empty) = a 'user'
// account, scoped to exactly those brand ids.
async function getBrandScope(pool, user) {
  if (!user || user.role === 'admin') return null;
  const result = await pool.query('SELECT brand_id FROM user_brands WHERE user_id = $1', [user.id]);
  return result.rows.map((row) => row.brand_id);
}

async function listUsers(pool) {
  const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users u ORDER BY u.username`);
  return { status: 200, body: result.rows };
}

// Deliberately narrow: username and role are fixed at creation time.
// Only the password (optional — omit to leave it unchanged) and the
// brand assignment (only meaningful for 'user' accounts) can change.
async function updateUser(pool, id, body) {
  const target = await pool.query('SELECT role FROM users WHERE id = $1', [id]);
  if (target.rowCount === 0) throw httpError(404, 'user not found');

  if (body && body.password) {
    if (body.password.length < 4) throw httpError(400, 'password must be at least 4 characters');
    const passwordHash = await hashPassword(body.password);
    await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, id]);
  }

  if (Array.isArray(body && body.brand_ids)) {
    try {
      await pool.query('DELETE FROM user_brands WHERE user_id = $1', [id]);
      if (body.brand_ids.length > 0) {
        const values = body.brand_ids.map((_, i) => `($1, $${i + 2})`).join(', ');
        await pool.query(`INSERT INTO user_brands (user_id, brand_id) VALUES ${values}`, [id, ...body.brand_ids]);
      }
    } catch (error) {
      if (error.code === '23503') throw httpError(400, 'one or more brand_ids do not exist');
      throw error;
    }
  }

  const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
  return { status: 200, body: result.rows[0] };
}

async function createUser(pool, body) {
  const username = ((body && body.username) || '').trim();
  const password = (body && body.password) || '';
  const role = (body && body.role) || 'user';
  const brandIds = Array.isArray(body && body.brand_ids) ? body.brand_ids : [];

  if (!username || !password) throw httpError(400, 'username and password are required');
  if (password.length < 4) throw httpError(400, 'password must be at least 4 characters');
  if (!ROLES.includes(role)) throw httpError(400, `role must be one of: ${ROLES.join(', ')}`);

  const passwordHash = await hashPassword(password);
  let userId;
  try {
    const inserted = await pool.query(
      'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3) RETURNING id',
      [username, passwordHash, role]
    );
    userId = inserted.rows[0].id;
  } catch (error) {
    if (error.code === '23505') throw httpError(409, 'username already exists');
    throw error;
  }

  if (role === 'user' && brandIds.length > 0) {
    try {
      const values = brandIds.map((_, i) => `($1, $${i + 2})`).join(', ');
      await pool.query(`INSERT INTO user_brands (user_id, brand_id) VALUES ${values}`, [userId, ...brandIds]);
    } catch (error) {
      if (error.code !== '23503') throw error; // ignore bad brand ids, user is already created
    }
  }

  const result = await pool.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [userId]);
  return { status: 201, body: result.rows[0] };
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

module.exports = { login, listUsers, createUser, updateUser, deleteUser, getBrandScope, ROLES };
