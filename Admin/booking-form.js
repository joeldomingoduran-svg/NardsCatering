// Booking form rules shared by the Admin, Manager and Staff portals:
// business-hours scheduling, package guest limits, automatic package pricing and email validation.
(function () {
  'use strict';

  var OPEN = '08:00', CLOSE = '18:00';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) { return window.NardsUI ? window.NardsUI.esc(v) : String(v); };

  window.createSharedBooking = async function (booking) {
    var payload = {
      clientName: booking.client, address: booking.venue, eventType: booking.event,
      package: booking.package, eventDate: booking.date, eventTime: booking.time,
      phone: booking.phone, email: booking.email, guests: booking.guests,
      notes: booking.notes, additionalRequest: booking.addReq, additionalCost: booking.addCost
    };
    if (booking.addGuests !== undefined) payload.additionalGuests = booking.addGuests;
    var response;
    try {
      response = await fetch('/bookings/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (error) {
      console.error('Booking submission failed:', error);
      throw new Error('Could not verify whether the booking was saved. Refresh the list before trying again.');
    }
    var result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Could not save booking.');
    if (!Number.isInteger(Number(result.bookingId)) || Number(result.bookingId) < 1) {
      throw new Error('Booking was submitted, but the server did not return its ID. Refresh the list before trying again.');
    }
    return 'DB-' + result.bookingId;
  };

  window.compareBookingNewest = function (a, b) {
    var aDb = /^DB-(\d+)$/.exec(String(a.id || ''));
    var bDb = /^DB-(\d+)$/.exec(String(b.id || ''));
    if (aDb && bDb) return Number(bDb[1]) - Number(aDb[1]);
    if (aDb || bDb) return aDb ? -1 : 1;
    return (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0);
  };

  function todayStr() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function toMinutes(t) {
    var m = /^(\d{2}):(\d{2})/.exec(t || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : NaN;
  }
  function fmt12(t) {
    var m = toMinutes(t), h = Math.floor(m / 60), mm = m % 60;
    return (h % 12 || 12) + ':' + String(mm).padStart(2, '0') + ' ' + (h >= 12 ? 'PM' : 'AM');
  }
  function peso(n) { return '\u20B1' + Number(n || 0).toLocaleString('en-PH'); }

  function packages() {
    try { if (typeof packagesList !== 'undefined' && packagesList.length) return packagesList; } catch (e) {}
    try { return data.menus || []; } catch (e) { return []; }
  }
  function selectedPackage() {
    var name = $('bk-package') && $('bk-package').value;
    return packages().find(function (p) { return p.name === name; }) || null;
  }
  function maxGuests(pkg) { return pkg ? Number(pkg.max_guests || pkg.maxGuests || 0) : 0; }

  function errorBox(input) {
    if (!input) return null;
    var box = input.parentNode.querySelector('.field-error');
    if (!box) {
      box = document.createElement('span');
      box.className = 'field-error';
      box.setAttribute('role', 'alert');
      input.parentNode.appendChild(box);
    }
    return box;
  }
  function setError(input, message) {
    var box = errorBox(input);
    if (!box) return;
    box.textContent = message || '';
    box.classList.toggle('show', Boolean(message));
    input.classList.toggle('invalid', Boolean(message));
  }
  function hint(input, text) {
    if (!input) return;
    var h = input.parentNode.querySelector('.field-hint');
    if (!h) {
      h = document.createElement('span');
      h.className = 'field-hint';
      input.parentNode.insertBefore(h, input.parentNode.querySelector('.field-error'));
    }
    h.textContent = text;
  }

  /* ------------------------------------------------------------- Validators */
  window.isValidEmail = function (value) {
    return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(String(value || '').trim());
  };

  function checkEmail(show) {
    var input = $('bk-email');
    if (!input) return true;
    var value = input.value.trim();
    var ok = !value || window.isValidEmail(value);
    if (show || ok) setError(input, ok ? '' : 'Enter a valid email address, for example name@email.com.');
    return ok;
  }

  function editingBooking() {
    try { return editIdx.booking >= 0 ? data.bookings[editIdx.booking] : null; } catch (e) { return null; }
  }

  function checkDate(show) {
    var input = $('bk-date');
    if (!input || !input.value) return true;
    var original = editingBooking();
    var unchanged = original && original.date === input.value;
    var ok = unchanged || input.value >= todayStr();
    if (show || ok) setError(input, ok ? '' : 'Past dates cannot be selected. Choose today or a later date.');
    return ok;
  }

  function parseBusinessTime(rawVal) {
    var raw = String(rawVal || '').trim().toLowerCase();
    if (!raw) return null;
    var h, mm = 0;
    var m24 = /^([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?$/.exec(raw);
    if (m24 && !/(am|pm)$/.test(raw)) {
      h = Number(m24[1]);
      mm = Number(m24[2]);
    } else {
      var m12 = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/.exec(raw);
      if (!m12) return null;
      h = Number(m12[1]);
      mm = Number(m12[2] || 0);
      var mer = m12[3];
      if (mer === 'am') { if (h === 12) h = 0; }
      else if (mer === 'pm') { if (h < 12) h += 12; }
      else if (h >= 1 && h <= 6) { h += 12; }
    }
    var mins = h * 60 + mm;
    if (mins < toMinutes(OPEN) || mins > toMinutes(CLOSE)) return null;
    return String(h).padStart(2, '0') + ':' + String(mm).padStart(2, '0');
  }

  function checkTime(show) {
    var input = $('bk-time');
    if (!input) return true;
    var message = '';
    var normalized = parseBusinessTime(input.value);
    if (!input.value || !String(input.value).trim()) {
      message = 'Enter the event time (8:00 AM - 6:00 PM).';
    } else if (!normalized) {
      message = 'Event time must be between ' + fmt12(OPEN) + ' and ' + fmt12(CLOSE) + ' (e.g. 9:00 AM, 2:00 PM).';
    } else {
      if (show) input.value = normalized;
      var m = toMinutes(normalized);
      if (checkDate(false) && $('bk-date').value === todayStr() && m <= new Date().getHours() * 60 + new Date().getMinutes()) message = 'That time has already passed today.';
      else if (slotTaken(normalized)) message = 'This time slot is already booked for the selected date. Choose another time.';
    }
    if (show || !message) setError(input, message);
    return !message;
  }

  function slotTaken(timeVal) {
    var date = $('bk-date').value, time = timeVal || parseBusinessTime($('bk-time').value) || $('bk-time').value, own = editingBooking();
    if (!date || !time) return false;
    try {
      return data.bookings.some(function (b) {
        return b !== own && !b.archived && b.date === date && String(b.time || '').slice(0, 5) === time && ['Pending', 'Confirmed'].indexOf(b.status) !== -1;
      });
    } catch (e) { return false; }
  }

  function checkGuests(show) {
    var addEl = $('bk-addguests');
    if (addEl) {
      var raw = String(addEl.value || '').trim();
      var val = Number(raw);
      var msg = raw !== '' && (!Number.isInteger(val) || val < 0) ? 'Additional guests must be 0 or a whole number.' : '';
      if (show || !msg) setError(addEl, msg);
      return !msg;
    }
    var input = $('bk-guests');
    if (!input || input.tagName === 'SELECT') return true;
    var value = Number(input.value);
    var message = '';
    if (input.value !== '' && (!Number.isInteger(value) || value < 0)) message = 'Enter a whole number of guests.';
    if (show || !message) setError(input, message);
    return !message;
  }

  /* --------------------------------------------------------------- Pricing */
  function recalc() {
    var priceEl = $('bk-pkgprice'), totalEl = $('bk-amount');
    if (!priceEl || !totalEl) return;
    var pkg = selectedPackage();
    var price = pkg ? Number(pkg.price) || 0 : 0;
    var addEl = $('bk-addguests');
    var addGuests = addEl ? Math.max(0, Math.trunc(Number(addEl.value) || 0)) : 0;
    var basePax = pkg ? (Number(pkg.max_guests || pkg.maxGuests || pkg.min_guests || pkg.minGuests || 0) || 0) : 0;
    if (addEl && $('bk-guests')) {
      $('bk-guests').value = pkg ? (basePax + addGuests || 1) : (addGuests || 0);
    }
    var guestExtraFee = addGuests * 350;
    var extra = Math.max(0, Number($('bk-addcost') && $('bk-addcost').value) || 0);
    var adjustedPkgPrice = pkg ? (price + guestExtraFee) : '';
    priceEl.value = adjustedPkgPrice;
    var total = pkg ? (adjustedPkgPrice + extra) : '';
    totalEl.value = total;
    // Down payment follows the customer rule: 20% of the total.
    if ($('bk-dp')) $('bk-dp').value = total === '' ? '' : Math.round(total * 0.2);
  }

  function onPackageChange() {
    var pkg = selectedPackage(), addEl = $('bk-addguests');
    if (addEl) {
      var basePax = pkg ? (Number(pkg.max_guests || pkg.maxGuests || pkg.min_guests || pkg.minGuests || 0) || 0) : 0;
      hint(addEl, pkg ? ('Includes ' + (basePax ? basePax + ' pax' : 'package capacity') + '. Optional extra guests: \u20b1350/person.') : 'Optional additional guests (\u20b1350 per person).');
      checkGuests(false);
    }
    recalc();
  }

  /* ----------------------------------------------------------------- Setup */
  function prepareFields() {
    var date = $('bk-date'), time = $('bk-time');
    if (date) date.min = todayStr();
    if (time) { hint(time, 'Type or choose a time between ' + fmt12(OPEN) + ' and ' + fmt12(CLOSE) + '.'); }
    var email = $('bk-email');
    if (email) email.setAttribute('autocomplete', 'off');
    ['bk-date', 'bk-time', 'bk-addguests', 'bk-guests', 'bk-email', 'bk-package', 'bk-addcost'].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.remove('invalid');
    });
    document.querySelectorAll('#booking-modal .field-error').forEach(function (e) { e.classList.remove('show'); e.textContent = ''; });
    onPackageChange();
  }

  function bind() {
    var map = { 'bk-date': ['change', function () { checkDate(true); checkTime(false); }], 'bk-time': ['blur', function () { checkTime(true); }],
      'bk-addguests': ['input', function () { checkGuests(true); recalc(); }],
      'bk-guests': ['input', function () { checkGuests(true); }], 'bk-email': ['blur', function () { checkEmail(true); }],
      'bk-package': ['change', onPackageChange], 'bk-addcost': ['input', recalc] };
    Object.keys(map).forEach(function (id) { if ($(id)) $(id).addEventListener(map[id][0], map[id][1]); });
    if ($('bk-email')) $('bk-email').addEventListener('input', function () { if (this.classList.contains('invalid')) checkEmail(true); });
    if ($('bk-time')) $('bk-time').addEventListener('input', function () { if (this.classList.contains('invalid')) checkTime(false); });
    ['bk-amount', 'bk-dp', 'bk-pkgprice'].forEach(function (id) { if ($(id)) $(id).readOnly = true; });
  }

  var originalOpen = window.openBookingModal;
  if (typeof originalOpen === 'function') {
    window.openBookingModal = async function (idx) {
      var result = await originalOpen.apply(this, arguments);
      prepareFields();
      var b = editingBooking();
      if (b) {
        if ($('bk-addguests')) $('bk-addguests').value = b.addGuests || '';
        if ($('bk-addreq')) $('bk-addreq').value = b.addReq || '';
        if ($('bk-addcost')) $('bk-addcost').value = b.addCost || '';
        recalc();
      } else if ($('bk-addguests')) {
        $('bk-addguests').value = '';
      }
      return result;
    };
  }

  var originalSave = window.saveBooking;
  if (typeof originalSave === 'function') {
    var saving = false;
    window.saveBooking = function () {
      if (saving) {
        if (window.notify) window.notify('A booking is already being saved. Please wait.', '\u26A0\uFE0F');
        return;
      }
      // Run every check so each problem is flagged, then stop on the first failure.
      var results = [checkEmail(true), checkDate(true), checkTime(true), checkGuests(true, false)];
      if (!selectedPackage() && $('bk-package')) {
        setError($('bk-package'), 'Select a package.');
        results.push(false);
      } else if ($('bk-package')) setError($('bk-package'), '');
      if (results.indexOf(false) !== -1) {
        if (window.notify) window.notify('Please fix the highlighted fields.', '\u26A0\uFE0F');
        return;
      }
      saving = true;
      return Promise.resolve().then(() => originalSave.apply(this, arguments)).finally(function () { saving = false; });
    };
  }

  /* ----------------------------------------------- Payment column and receipt */
  // Paid bookings get a clear "view receipt" action; unpaid ones with a receipt are flagged for review.
  window.paymentCell = function (b) {
    if (!b.paymentProof) {
      return b.paid
        ? '<span class="badge badge-success">Paid</span>'
        : '<span class="badge badge-danger">Unpaid</span>';
    }
    var url = esc(b.paymentProof).replace(/'/g, '&#39;');
    if (b.paid) {
      return '<button type="button" class="badge badge-success" style="border:0;cursor:pointer" onclick="openReceiptModal(\'' + url + '\')" title="Payment verified. View receipt">Paid &middot; Receipt</button>';
    }
    return '<button type="button" class="badge badge-gold" style="border:0;cursor:pointer" onclick="openReceiptModal(\'' + url + '\')" title="Receipt submitted. Click to review">Review Receipt</button>';
  };

  bind();
  prepareFields();
})();
