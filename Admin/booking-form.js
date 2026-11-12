// Booking form rules shared by the Admin, Manager and Staff portals:
// business-hours scheduling, package guest limits, automatic package pricing and email validation.
(function () {
  'use strict';

  var OPEN = '08:00', CLOSE = '18:00';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (v) { return window.NardsUI ? window.NardsUI.esc(v) : String(v); };

  window.createSharedBooking = async function (booking) {
    var response;
    try {
      response = await fetch('/bookings/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientName: booking.client, address: booking.venue, eventType: booking.event,
          package: booking.package, eventDate: booking.date, eventTime: booking.time,
          phone: booking.phone, email: booking.email, guests: booking.guests,
          notes: booking.notes, additionalRequest: booking.addReq, additionalCost: booking.addCost
        })
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

  function checkTime(show) {
    var input = $('bk-time');
    if (!input) return true;
    var message = '';
    if (!input.value) {
      message = 'Select the event time.';
    } else {
      var m = toMinutes(input.value);
      if (!(m >= toMinutes(OPEN) && m <= toMinutes(CLOSE))) message = 'Event time must be within business hours (' + fmt12(OPEN) + ' - ' + fmt12(CLOSE) + '). Midnight is not available.';
      else if (m % 30 !== 0) message = 'Choose a 30-minute slot, for example 10:00 or 10:30.';
      else if (checkDate(false) && $('bk-date').value === todayStr() && m <= new Date().getHours() * 60 + new Date().getMinutes()) message = 'That time has already passed today.';
      else if (slotTaken()) message = 'This time slot is already booked for the selected date. Choose another time.';
    }
    if (show || !message) setError(input, message);
    return !message;
  }

  function slotTaken() {
    var date = $('bk-date').value, time = $('bk-time').value, own = editingBooking();
    if (!date || !time) return false;
    try {
      return data.bookings.some(function (b) {
        return b !== own && !b.archived && b.date === date && String(b.time || '').slice(0, 5) === time && ['Pending', 'Confirmed'].indexOf(b.status) !== -1;
      });
    } catch (e) { return false; }
  }

  function checkGuests(show, clamp) {
    var input = $('bk-guests');
    if (!input || input.tagName === 'SELECT') return true;
    var pkg = selectedPackage(), max = maxGuests(pkg), value = Number(input.value);
    var message = '';
    if (input.value !== '' && (!Number.isInteger(value) || value < 1)) message = 'Enter a whole number of guests (1 or more).';
    else if (max && value > max) {
      message = (pkg.name + ' allows a maximum of ' + max + ' guests.');
      if (clamp) input.value = max;
    }
    if (show || !message) setError(input, message);
    return !message;
  }

  /* --------------------------------------------------------------- Pricing */
  function recalc() {
    var priceEl = $('bk-pkgprice'), totalEl = $('bk-amount');
    if (!priceEl || !totalEl) return;
    var pkg = selectedPackage();
    var price = pkg ? Number(pkg.price) || 0 : 0;
    var extra = Math.max(0, Number($('bk-addcost') && $('bk-addcost').value) || 0);
    priceEl.value = pkg ? price : '';
    var total = pkg ? price + extra : '';
    totalEl.value = total;
    // Down payment follows the customer rule: 20% of the total.
    if ($('bk-dp')) $('bk-dp').value = total === '' ? '' : Math.round(total * 0.2);
  }

  function onPackageChange() {
    var pkg = selectedPackage(), guests = $('bk-guests'), max = maxGuests(pkg);
    if (guests && guests.tagName !== 'SELECT') {
      if (max) guests.setAttribute('max', max); else guests.removeAttribute('max');
      var min = pkg ? Number(pkg.min_guests || pkg.minGuests || 0) : 0;
      hint(guests, pkg ? ('Package guests: ' + (min ? 'min ' + min : 'any') + (max ? ', max ' + max : ', no maximum')) : 'Select a package to see its guest limit.');
      checkGuests(true, true);
    }
    recalc();
  }

  /* ----------------------------------------------------------------- Setup */
  function prepareFields() {
    var date = $('bk-date'), time = $('bk-time');
    if (date) date.min = todayStr();
    if (time) { time.min = OPEN; time.max = CLOSE; time.step = 1800; hint(time, 'Business hours: ' + fmt12(OPEN) + ' - ' + fmt12(CLOSE) + ' (30-minute slots).'); }
    var email = $('bk-email');
    if (email) email.setAttribute('autocomplete', 'off');
    ['bk-date', 'bk-time', 'bk-guests', 'bk-email', 'bk-package', 'bk-addcost'].forEach(function (id) {
      var el = $(id);
      if (el) el.classList.remove('invalid');
    });
    document.querySelectorAll('#booking-modal .field-error').forEach(function (e) { e.classList.remove('show'); e.textContent = ''; });
    onPackageChange();
  }

  function bind() {
    var map = { 'bk-date': ['change', function () { checkDate(true); checkTime(false); }], 'bk-time': ['change', function () { checkTime(true); }],
      'bk-guests': ['input', function () { checkGuests(true, true); }], 'bk-email': ['blur', function () { checkEmail(true); }],
      'bk-package': ['change', onPackageChange], 'bk-addcost': ['input', recalc] };
    Object.keys(map).forEach(function (id) { if ($(id)) $(id).addEventListener(map[id][0], map[id][1]); });
    if ($('bk-email')) $('bk-email').addEventListener('input', function () { if (this.classList.contains('invalid')) checkEmail(true); });
    if ($('bk-time')) $('bk-time').addEventListener('input', function () { if (this.classList.contains('invalid')) checkTime(true); });
    ['bk-amount', 'bk-dp', 'bk-pkgprice'].forEach(function (id) { if ($(id)) $(id).readOnly = true; });
  }

  var originalOpen = window.openBookingModal;
  if (typeof originalOpen === 'function') {
    window.openBookingModal = async function (idx) {
      var result = await originalOpen.apply(this, arguments);
      prepareFields();
      var b = editingBooking();
      if (b) {
        if ($('bk-addreq')) $('bk-addreq').value = b.addReq || '';
        if ($('bk-addcost')) $('bk-addcost').value = b.addCost || '';
        recalc();
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
    var badge = b.paid
      ? '<span class="badge badge-success">\u2713 Paid</span>'
      : b.paymentProof ? '<span class="badge badge-gold">Receipt submitted</span>' : '<span class="badge badge-danger">Unpaid</span>';
    if (!b.paymentProof) return badge;
    var url = esc(b.paymentProof).replace(/'/g, '&#39;');
    var label = b.paid ? '\uD83E\uDDFE View receipt' : '\uD83D\uDD0E Review receipt';
    return badge + '<div class="receipt-status"><button type="button" class="btn-receipt' + (b.paid ? '' : ' pending') + '" onclick="openReceiptModal(\'' + url + '\')" title="' + (b.paid ? 'Payment verified. Open the receipt' : 'Receipt submitted. Open to verify') + '">' + label + '</button></div>';
  };

  bind();
  prepareFields();
})();
