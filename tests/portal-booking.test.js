const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const portals = ['Admin/Admin.html', 'Manager/Manager.html', 'Staff/Staff.html'];
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function extract(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, signature);
  const end = source.indexOf('\n}', start);
  assert.notEqual(end, -1, signature);
  return source.slice(start, end + 2);
}

for (const portal of portals) {
  test(`${portal}: package modal opens with the guest limit field`, async () => {
    const html = read(portal);
    const elements = {};
    for (const id of ['mn-modal-title', 'mn-name', 'mn-price', 'mn-min', 'mn-max', 'mn-assets-container', 'mn-dishes-container', 'mn-freebies-container']) {
      assert.ok(html.includes(`id="${id}"`), `Missing ${id}`);
      elements[id] = { value: '', innerHTML: '', textContent: '' };
    }
    let opened = '';
    let message = '';
    const context = {
      API: '', assetsList: [], dishesList: [],
      document: { getElementById: (id) => elements[id] },
      fetch: async () => ({ ok: true, json: async () => [] }),
      updateAssetEmptyMsg() {}, updateDishEmptyMsg() {}, updateFreebieEmptyMsg() {},
      openModal(id) { opened = id; }, notify(text) { message = text; }, editPackageId: null
    };
    vm.runInNewContext(extract(html, 'async function openMenuModal(packageId)'), context);
    await context.openMenuModal();
    assert.equal(opened, 'menu-modal');
    opened = '';
    context.fetch = async () => ({ ok: false });
    await context.openMenuModal(1);
    assert.equal(opened, '');
    assert.match(message, /Could not load/);
  });

  test(`${portal}: package save includes the selected guest limit`, async () => {
    const html = read(portal);
    const values = { 'mn-name': 'Gold', 'mn-price': '1000', 'mn-min': '25', 'mn-max': '100' };
    let request;
    let closed = false;
    const context = {
      API: '', packagesList: [], editPackageId: null,
      document: { getElementById: (id) => ({ value: values[id] }), querySelectorAll: () => [] },
      fetch: async (url, options) => { request = { url, body: JSON.parse(options.body) }; return { ok: true }; },
      closeModal() { closed = true; }, renderMenuCards() {}, notify() {}
    };
    vm.runInNewContext(extract(html, 'async function saveMenu()'), context);
    await context.saveMenu();
    assert.equal(request.url, '/packages');
    assert.equal(request.body.min_guests, 25);
    assert.equal(request.body.max_guests, 100);
    assert.equal(closed, true);
  });

  test(`${portal}: sync replaces stale customer details with server values`, async () => {
    const html = read(portal);
    const row = {
      id: 8, clientName: 'Updated Client', phone: '09123456789', email: 'test@example.invalid',
      eventType: 'Wedding', eventDate: '2030-01-02', eventTime: '10:30:00',
      guests: 65, package: 'Gold', address: 'Updated venue', status: 'pending',
      notes: 'Updated notes', additional_request: 'Extra table', additional_cost: '100',
      paymentProof: 'receipt.png', paymentStatus: 'unpaid'
    };
    const existing = { id: 'DB-8', client: 'Old', guests: 1, date: '2029-01-01', venue: 'Old venue' };
    let saves = 0;
    const context = {
      API: '', packagesList: [{ name: 'Gold', price: 1000 }],
      data: { bookings: [existing], deletedBookingIds: [] },
      fetch: async () => ({ ok: true, json: async () => [row] }),
      saveData() { saves++; }
    };
    vm.runInNewContext(extract(html, 'function paymentFieldsFromRow(row)') + '\n' + extract(html, 'async function syncFromAPI()'), context);
    await context.syncFromAPI();
    assert.equal(existing.client, row.clientName);
    assert.equal(existing.phone, row.phone);
    assert.equal(existing.email, row.email);
    assert.equal(existing.event, row.eventType);
    assert.equal(existing.date, row.eventDate);
    assert.equal(existing.time, '10:30');
    assert.equal(existing.guests, 65);
    assert.equal(existing.venue, row.address);
    assert.equal(existing.package, row.package);
    assert.equal(existing.notes, row.notes);
    assert.equal(existing.addReq, row.additional_request);
    assert.equal(existing.addCost, 100);
    assert.equal(existing.paid, false);
    assert.equal(saves, 1);
    let warning = '';
    context.console = { error() {} };
    context.notify = (message) => { warning = message; };
    context.fetch = async () => ({ ok: false });
    await context.syncFromAPI();
    assert.match(warning, /refresh bookings.*out of date/i);
  });
}

function bookingForm(fetch, saveBooking) {
  const window = { saveBooking };
  const document = { getElementById: () => null, querySelectorAll: () => [] };
  vm.runInNewContext(read('Admin/booking-form.js'), { window, document, fetch, console, Date, Promise });
  return window;
}

test('shared booking create sends customer details and server failures are not saved locally', async () => {
  let submitted;
  const form = bookingForm(async (url, options) => {
    submitted = { url, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ bookingId: 42 }) };
  });
  const booking = { client: 'Test Client', venue: 'Test venue', event: 'Wedding', package: 'Gold', date: '2030-01-02', time: '10:30', phone: '09123456789', email: 'test@example.invalid', guests: 65, notes: 'Notes', addReq: 'Extra table', addCost: 100 };
  assert.equal(await form.createSharedBooking(booking), 'DB-42');
  assert.equal(submitted.url, '/bookings/internal');
  assert.equal(submitted.body.eventTime, '10:30');
  assert.equal(submitted.body.email, booking.email);
  assert.equal(submitted.body.additionalRequest, booking.addReq);
  assert.equal(submitted.body.additionalCost, 100);
  const failing = bookingForm(async () => ({ ok: false, json: async () => ({ error: 'Denied' }) }));
  await assert.rejects(failing.createSharedBooking(booking), /Denied/);
  const unavailable = bookingForm(async () => { throw new Error('Offline'); });
  await assert.rejects(unavailable.createSharedBooking(booking), /Refresh the list before trying again/);
});

test('database bookings sort newest first regardless of local creation timestamps', () => {
  const form = bookingForm(async () => {});
  const rows = [{ id: 'DB-2', createdAt: Date.now() }, { id: 'DB-10' }, { id: 'DB-4' }];
  rows.sort(form.compareBookingNewest);
  assert.deepEqual(rows.map((row) => row.id), ['DB-10', 'DB-4', 'DB-2']);
});

test('booking save prevents duplicate submissions while a request is pending', async () => {
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const form = bookingForm(async () => {}, () => { calls++; return pending; });
  const first = form.saveBooking();
  form.saveBooking();
  await Promise.resolve();
  assert.equal(calls, 1);
  release();
  await first;
  await form.saveBooking();
  assert.equal(calls, 2);
});

for (const portal of portals) {
  test(`${portal}: team booking is saved to the shared server, not just local storage`, async () => {
    const html = read(portal);
    const values = {
      'bk-client': 'Test Client', 'bk-phone': '09123456789', 'bk-email': 'test@example.invalid',
      'bk-event': 'Wedding', 'bk-date': '2030-01-02', 'bk-time': '10:30', 'bk-guests': '65',
      'bk-package': 'Gold', 'bk-venue': 'Test venue', 'bk-amount': '1100', 'bk-dp': '220',
      'bk-addreq': 'Extra table', 'bk-addcost': '100', 'bk-status': 'Pending', 'bk-notes': 'Notes'
    };
    const data = { bookings: [], clients: [] };
    let submitted;
    const context = {
      window: { isRealName: () => true, createSharedBooking: async (booking) => { submitted = { ...booking }; return 'DB-42'; } },
      document: { getElementById: (id) => ({ value: values[id], classList: { contains: () => false } }) },
      data, editIdx: { booking: -1 }, uid: () => 'LOCAL',
      saveData() {}, closeModal() {}, renderBookings() {}, renderCalendar() {}, notify() {},
      syncInventoryFromAPI: async () => {}, setTimeout() {}
    };
    vm.runInNewContext(extract(html, 'async function saveBooking()'), context);
    await context.saveBooking();
    assert.equal(submitted.email, values['bk-email']);
    assert.equal(submitted.time, values['bk-time']);
    assert.equal(submitted.addReq, values['bk-addreq']);
    assert.equal(data.bookings[0].id, 'DB-42');

    data.bookings.length = 0;
    context.window.createSharedBooking = async () => {
      data.bookings.push({ id: 'DB-42', client: 'Synced first' });
      return 'DB-42';
    };
    await context.saveBooking();
    assert.equal(data.bookings.length, 1);
    assert.equal(data.bookings[0].client, values['bk-client']);

    data.bookings.length = 0;
    context.window.createSharedBooking = async () => { throw new Error('Server unavailable'); };
    await context.saveBooking();
    assert.equal(data.bookings.length, 0);
  });
}

test('all portals use a single notification bell with an activity section', () => {
  const shared = read('Admin/portal-ui.js');
  assert.match(shared, /id="alerts-list"/);
  assert.doesNotMatch(shared, /alerts-btn/);
  for (const portal of portals) {
    const html = read(portal);
    assert.equal((html.match(/id="notif-bell-btn"/g) || []).length, 1);
    assert.match(html, /id="event-notification-modal"/);
  }
});

test('combined notification panel shows activity and opens linked views', async () => {
  const source = read('Admin/portal-ui.js').replace(/^  /gm, '');
  const list = { innerHTML: '', addEventListener(type, handler) { this[type] = handler; } };
  const readButton = { addEventListener(type, handler) { this[type] = handler; } };
  const section = {
    innerHTML: '',
    querySelector(selector) { return selector === '.alerts-list' ? list : readButton; }
  };
  const bell = { setAttribute() {}, appendChild(child) { this.badge = child; } };
  let attached = false;
  const modal = { querySelector: () => ({ before() { attached = true; } }) };
  let destination = '';
  let closed = false;
  const document = {
    hidden: false,
    getElementById(id) {
      if (id === 'event-notification-modal') return modal;
      if (id === 'notif-bell-btn') return bell;
      if (id === 'alerts-list') return attached ? list : null;
      if (id === 'view-bookings') return {};
      return null;
    },
    createElement(tag) { return tag === 'span' ? {} : section; },
    querySelector(selector) { return selector === '#notif-bell-btn .alerts-badge' ? bell.badge : null; },
    addEventListener() {}
  };
  const context = {
    document, user: { role: 'manager' }, alertState: { lastId: null }, Date,
    window: { closeModal() { closed = true; }, navigate(view) { destination = view; } },
    fetch: async () => ({ ok: true, json: async () => ({ unread: 1, lastRead: 0, notifications: [{ id: 1, title: 'Booking', message: 'New request', link_view: 'bookings', created_at: new Date().toISOString() }] }) }),
    esc: (value) => String(value || ''), toast() {}, setInterval() {}, console
  };
  vm.runInNewContext([
    extract(source, 'function buildAlerts()'),
    extract(source, 'function timeAgo(value)'),
    extract(source, 'function poll()')
  ].join('\n'), context);
  context.buildAlerts();
  await context.poll();
  assert.equal(bell.badge.hidden, false);
  assert.match(list.innerHTML, /New request/);
  list.click({ target: { closest: () => ({ dataset: { view: 'bookings' } }) } });
  assert.equal(closed, true);
  assert.equal(destination, 'bookings');
  context.fetch = async () => ({ ok: false });
  context.console = { error() {} };
  await context.poll();
  assert.equal(list.textContent, 'Could not load activity alerts.');
});

test('internal booking route requires authentication and booking-management permission', () => {
  const routes = [];
  const router = {};
  for (const method of ['get', 'post', 'patch', 'put', 'delete']) {
    router[method] = (url, ...handlers) => routes.push({ method, url, handlers });
  }
  const auth = () => {};
  const permission = () => {};
  const controller = new Proxy({}, { get: () => () => {} });
  const module = { exports: {} };
  vm.runInNewContext(read('Backend/Routes/bookings.js'), {
    module,
    require(name) {
      if (name === 'express') return { Router: () => router };
      if (name === '../Controller/bookingsController') return controller;
      if (name === '../Middleware/authMiddleware') return { requireInternalUser: auth };
      if (name === '../Middleware/upload') return { receipt: () => () => {} };
      if (name === '../Model/permissions') return { requirePermission: (key) => { assert.equal(key, 'bookings.manage'); return permission; } };
      throw new Error(`Unexpected dependency ${name}`);
    }
  });
  const internal = routes.find((route) => route.method === 'post' && route.url === '/internal');
  assert.equal(internal.handlers[0], auth);
  assert.equal(internal.handlers[1], permission);
});

test('booking creation persists submitted fields and limits extra charges to internal requests', async () => {
  const inserts = [];
  const pool = {
    async query(sql, values) {
      if (sql.includes('SELECT name, max_guests')) return [[{ name: 'Gold', max_guests: 100 }]];
      if (sql.includes('INSERT INTO Bookings')) { inserts.push({ sql, values }); return [{ insertId: 42 }]; }
      if (sql.includes('SELECT price FROM Packages')) return [[{ price: 1000 }]];
      throw new Error(`Unexpected query: ${sql}`);
    }
  };
  const module = { exports: {} };
  vm.runInNewContext(read('Backend/Controller/bookingsController.js'), {
    module, exports: module.exports, process: { env: {} }, Date, console,
    require(name) {
      if (name === '../Model/db') return pool;
      if (name === '../Model/audit') return { writeAudit: async () => {} };
      if (name === '../Model/validators') return { isRealName: () => true, isValidEmail: () => true, isWithinBusinessHours: () => true };
      if (name === '../Model/notifications') return { notify: async () => {} };
      if (name === '../Model/address') return { validatePhilippineAddress: () => ({ valid: true }) };
      if (name === 'stripe') return () => ({});
      throw new Error(`Unexpected dependency ${name}`);
    }
  });
  const body = { clientName: 'Test Client', address: 'Test venue', eventType: 'Wedding', package: 'Gold', eventDate: '2099-01-02', eventTime: '10:30', phone: '09123456789', email: 'test@example.invalid', guests: 65, notes: 'Notes', additionalRequest: 'Extra table', additionalCost: 100 };
  function response() {
    return { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
  }
  const internal = response();
  await module.exports.createBooking({ body, internalBooking: true, is: () => false }, internal);
  assert.equal(internal.statusCode, 201);
  assert.equal(internal.body.bookingId, 42);
  assert.equal(inserts[0].values[5], '10:30:00');
  assert.equal(inserts[0].values[7], body.email);
  assert.equal(inserts[0].values[8], body.guests);
  assert.equal(inserts[0].values.at(-2), body.additionalRequest);
  assert.equal(inserts[0].values.at(-1), body.additionalCost);
  const customer = response();
  await module.exports.createBooking({ body, is: () => false }, customer);
  assert.equal(customer.statusCode, 201);
  assert.equal(inserts[1].values.at(-2), null);
  assert.equal(inserts[1].values.at(-1), 0);
  const invalid = response();
  await module.exports.createBooking({ body: { ...body, additionalCost: -1 }, internalBooking: true, is: () => false }, invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(inserts.length, 2);
  const tooLong = response();
  await module.exports.createBooking({ body: { ...body, additionalRequest: 'x'.repeat(501) }, internalBooking: true, is: () => false }, tooLong);
  assert.equal(tooLong.statusCode, 400);
  const tooLongUpdate = response();
  await module.exports.updateBooking({ body: { ...body, additionalRequest: 'x'.repeat(501) }, params: { id: 42 } }, tooLongUpdate);
  assert.equal(tooLongUpdate.statusCode, 400);
});
