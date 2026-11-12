const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { hashPassword, verifyPassword } = require('../Backend/Model/passwordUtils');

const controllerPath = require.resolve('../Backend/Controller/staffController');
const dependencies = {
  db: require.resolve('../Backend/Model/db'),
  auth: require.resolve('../Backend/Middleware/authMiddleware'),
  audit: require.resolve('../Backend/Model/audit')
};

function controllerWith(database) {
  const mocks = {
    [dependencies.db]: database,
    [dependencies.auth]: { createAuthToken: (user) => `token-${user.role}` },
    [dependencies.audit]: { writeAudit: async () => {} }
  };
  const previous = new Map();
  for (const [id, exports] of Object.entries(mocks)) {
    previous.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  }
  delete require.cache[controllerPath];
  const controller = require(controllerPath);
  delete require.cache[controllerPath];
  for (const [id, module] of previous) {
    if (module) require.cache[id] = module;
    else delete require.cache[id];
  }
  return controller;
}

function response() {
  return {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

test('shared login succeeds repeatedly for each role and rejects invalid or disabled accounts', async () => {
  const password = 'FixturePassword1!';
  const hash = await hashPassword(password);
  let user;
  const database = {
    async query(sql) {
      if (sql.includes('FROM StaffUsers u')) return [[user]];
      if (sql.includes('INSERT INTO LoginHistory')) return [{ affectedRows: 1 }];
      throw new Error('Unexpected query');
    }
  };
  const controller = controllerWith(database);
  for (const role of ['admin', 'manager', 'staff']) {
    user = { id: 1, name: 'Test User', username: 'test-user', password: hash, role, is_active: 1, role_active: 1 };
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = response();
      await controller.login({ body: { username: 'test-user', password } }, res);
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.user.role, role);
      assert.equal(res.body.token, `token-${role}`);
      assert.equal(res.body.user.password, undefined);
    }
    for (const inactive of [{ is_active: 0 }, { role_active: 0 }]) {
      const saved = user;
      user = { ...user, ...inactive };
      const res = response();
      await controller.login({ body: { username: 'test-user', password } }, res);
      assert.equal(res.statusCode, 401);
      user = saved;
    }
    const invalid = response();
    await controller.login({ body: { username: 'test-user', password: 'wrong-password' } }, invalid);
    assert.equal(invalid.statusCode, 401);
  }
  user = undefined;
  const missing = response();
  await controller.login({ body: { username: 'missing-user', password } }, missing);
  assert.equal(missing.statusCode, 401);
  user = { id: 1, username: 'test-user', password, role: 'admin', is_active: 1, role_active: 1 };
  const legacy = response();
  await controller.login({ body: { username: 'test-user', password } }, legacy);
  assert.equal(legacy.statusCode, 401);
  const empty = response();
  await controller.login({ body: { username: '', password } }, empty);
  assert.equal(empty.statusCode, 400);
});

test('login history failures are reported rather than returning a successful login', async () => {
  const hash = await hashPassword('FixturePassword1!');
  const controller = controllerWith({
    async query(sql) {
      if (sql.includes('FROM StaffUsers u')) {
        return [[{ id: 1, username: 'test-user', password: hash, role: 'staff', is_active: 1, role_active: 1 }]];
      }
      throw new Error('Login history unavailable');
    }
  });
  const res = response();
  await controller.login({ body: { username: 'test-user', password: 'FixturePassword1!' } }, res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.token, undefined);
});

function bootstrapDatabase(env, existingAdmin = false) {
  const inserts = [];
  const warnings = [];
  class Pool {
    on() {}
    async query(sql, values) {
      if (sql.includes('information_schema.columns')) return { rows: [{ '?column?': 1 }], rowCount: 1 };
      if (sql.includes('SELECT id FROM "StaffUsers"')) return { rows: existingAdmin ? [{ id: 1 }] : [], rowCount: existingAdmin ? 1 : 0 };
      if (sql.includes('INSERT INTO "StaffUsers"')) inserts.push(values);
      return { rows: [], rowCount: 0 };
    }
  }
  const source = fs.readFileSync(path.join(__dirname, '..', 'Backend', 'Model', 'db.js'), 'utf8');
  const module = { exports: {} };
  const mockRequire = (name) => {
    if (name === 'pg') return { Pool };
    if (name === './passwordUtils') return { hashPassword };
    if (name === './permissions') return { seedPermissions: async () => {} };
    if (name === '../Controller/dropdownsController') return { seedDropdowns: async () => {} };
    throw new Error(`Unexpected dependency ${name}`);
  };
  vm.runInNewContext(source, {
    module, require: mockRequire,
    process: { env: { DATABASE_URL: 'postgres://localhost/isolated-test', ...env } },
    console: { log() {}, warn(message) { warnings.push(message); }, error() {} },
    URL
  });
  return { pool: module.exports, inserts, warnings };
}

test('new administrator bootstrap requires a configured password and stores a hash', async () => {
  const absent = bootstrapDatabase({});
  await absent.pool.ensureStaffUsersTableSchema();
  assert.equal(absent.inserts.length, 0);
  assert.ok(absent.warnings.length);

  const weak = bootstrapDatabase({ ADMIN_INITIAL_PASSWORD: 'weak' });
  await weak.pool.ensureStaffUsersTableSchema();
  assert.equal(weak.inserts.length, 0);
  assert.ok(weak.warnings.length);

  const password = 'FixturePassword1!';
  const configured = bootstrapDatabase({ ADMIN_INITIAL_PASSWORD: password });
  await configured.pool.ensureStaffUsersTableSchema();
  assert.equal(configured.inserts.length, 1);
  assert.notEqual(configured.inserts[0][2], password);
  assert.equal(await verifyPassword(password, configured.inserts[0][2]), true);

  const existing = bootstrapDatabase({ ADMIN_INITIAL_PASSWORD: password }, true);
  await existing.pool.ensureStaffUsersTableSchema();
  assert.equal(existing.inserts.length, 0);
});

function loginPage(fetchImpl) {
  const html = fs.readFileSync(path.join(__dirname, '..', 'Login', 'Login.html'), 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const elements = {};
  for (const id of ['loginForm', 'username', 'password', 'error-msg', 'error-text', 'loginBtn', 'togglePw']) {
    elements[id] = {
      value: '', textContent: '', innerHTML: '', disabled: false,
      classList: { add() {}, remove() {} },
      addEventListener(type, handler) { this[type] = handler; },
      focus() {}
    };
  }
  const storage = {};
  const window = { location: { hostname: 'localhost', port: '3000', href: '' } };
  vm.runInNewContext(script, {
    document: { getElementById: (id) => elements[id] },
    window, fetch: fetchImpl,
    sessionStorage: { setItem(key, value) { storage[key] = value; } }
  });
  return { elements, window, storage };
}

test('login page redirects each role and displays errors even without a dialog library', async () => {
  for (const [role, destination] of [['admin', '/admin'], ['manager', '/manager'], ['staff', '/staff-portal']]) {
    const page = loginPage(async () => ({
      ok: true, text: async () => JSON.stringify({ token: 'fixture-token', user: { role } })
    }));
    page.elements.username.value = 'test-user';
    page.elements.password.value = 'FixturePassword1!';
    await page.elements.loginForm.submit({ preventDefault() {} });
    assert.equal(page.window.location.href, destination);
    assert.equal(page.storage.nards_internal_token, 'fixture-token');
  }
  let attempts = 0;
  const page = loginPage(async () => {
    attempts++;
    return attempts === 1
      ? { ok: false, text: async () => JSON.stringify({ error: 'Invalid username or password.' }) }
      : { ok: true, text: async () => JSON.stringify({ token: 'fixture-token', user: { role: 'staff' } }) };
  });
  page.elements.password.value = 'wrong-password';
  await page.elements.loginForm.submit({ preventDefault() {} });
  assert.equal(page.elements['error-text'].textContent, 'Invalid username or password.');
  assert.equal(page.elements.loginBtn.disabled, false);
  page.elements.password.value = 'FixturePassword1!';
  await page.elements.loginForm.submit({ preventDefault() {} });
  assert.equal(page.window.location.href, '/staff-portal');
});

test('password migration targets staff users and clients using isolated records', async () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'migrate-passwords.js'), 'utf8');
  const updates = [];
  const database = {
    async query(sql, values) {
      if (sql === 'SELECT 1') return [[{ value: 1 }]];
      if (sql.includes('FROM StaffUsers') || sql.includes('FROM Clients')) return [[{ id: 7, password: 'FixturePassword1!' }]];
      if (sql.startsWith('UPDATE ')) { updates.push({ sql, values }); return [{ affectedRows: 1 }]; }
      throw new Error('Unexpected migration query');
    }
  };
  let exit;
  const completed = new Promise((resolve) => { exit = resolve; });
  vm.runInNewContext(source, {
    require(name) {
      if (name === 'dotenv') return { config() {} };
      if (name === './Backend/Model/db') return database;
      if (name === './Backend/Model/passwordUtils') return { hashPassword };
      throw new Error(`Unexpected dependency ${name}`);
    },
    console: { log() {}, error() {} },
    process: { stdout: { write() {} }, exit }
  });
  assert.equal(await completed, 0);
  assert.equal(updates.length, 2);
  assert.match(updates[0].sql, /^UPDATE StaffUsers /);
  assert.match(updates[1].sql, /^UPDATE Clients /);
  for (const update of updates) {
    assert.equal(await verifyPassword('FixturePassword1!', update.values[0]), true);
  }
});
