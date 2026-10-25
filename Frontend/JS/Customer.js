const mainNav = document.getElementById('main-nav');
const mobileNav = document.getElementById('mobile-nav');
const navToggle = document.getElementById('nav-toggle');
const scrollTopBtn = document.getElementById('scrollTop');

const customerAuthModal = document.getElementById('customerAuthModal');
const customerAuthBtn = document.getElementById('customerAuthBtn');
const mobileCustomerAuthBtn = document.getElementById('mobileCustomerAuthBtn');
const customerAuthClose = document.getElementById('customerAuthClose');
const customerAuthMessage = document.getElementById('customerAuthMessage');
const customerLoginForm = document.getElementById('customerLoginForm');
const customerSignupForm = document.getElementById('customerSignupForm');
const authTabs = document.querySelectorAll('.auth-tab');
const authPanels = {
  login: document.getElementById('loginTabPanel'),
  signup: document.getElementById('signupTabPanel')
};

function openCustomerAuth(mode = 'login') {
  if (!customerAuthModal) return;
  customerAuthModal.classList.add('open');
  customerAuthModal.setAttribute('aria-hidden', 'false');
  authTabs.forEach(tab => {
    const isActive = tab.dataset.authTab === mode;
    tab.classList.toggle('active', isActive);
  });
  Object.entries(authPanels).forEach(([key, panel]) => {
    panel.classList.toggle('active', key === mode);
  });
  if (customerAuthMessage) {
    customerAuthMessage.textContent = '';
    customerAuthMessage.className = 'customer-auth-message';
  }
}

function closeCustomerAuth() {
  if (!customerAuthModal) return;
  customerAuthModal.classList.remove('open');
  customerAuthModal.setAttribute('aria-hidden', 'true');
}

if (customerAuthBtn) customerAuthBtn.addEventListener('click', () => openCustomerAuth('login'));
if (mobileCustomerAuthBtn) mobileCustomerAuthBtn.addEventListener('click', () => openCustomerAuth('login'));
if (customerAuthClose) customerAuthClose.addEventListener('click', closeCustomerAuth);
if (customerAuthModal) {
  customerAuthModal.addEventListener('click', (event) => {
    if (event.target.dataset.closeAuth === 'true') closeCustomerAuth();
  });
}
authTabs.forEach(tab => {
  tab.addEventListener('click', () => openCustomerAuth(tab.dataset.authTab));
});

function setCustomerSession(client) {
  sessionStorage.setItem('nards_customer_session', JSON.stringify(client));
  const authButton = document.getElementById('customerAuthBtn');
  if (authButton) {
    authButton.textContent = client.name ? `Hi, ${client.name.split(' ')[0]}` : client.email;
  }
}

function clearCustomerSession() {
  sessionStorage.removeItem('nards_customer_session');
  const authButton = document.getElementById('customerAuthBtn');
  if (authButton) authButton.textContent = 'Login / Sign Up';
}

function showCustomerAuthMessage(message, type = 'error') {
  if (!customerAuthMessage) return;
  customerAuthMessage.textContent = message;
  customerAuthMessage.className = `customer-auth-message ${type}`;
}

async function customerLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('loginCustomerEmail').value.trim();
  const password = document.getElementById('loginCustomerPassword').value;

  if (!email || !password) {
    showCustomerAuthMessage('Please enter your Gmail and password.', 'error');
    return;
  }

  try {
    const response = await fetch('/clients/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Login failed.');
    }

    setCustomerSession(result.client);
    closeCustomerAuth();
    showCustomerAuthMessage('Login successful.', 'success');
    customerLoginForm.reset();
  } catch (error) {
    showCustomerAuthMessage(error.message || 'Unable to login right now.', 'error');
  }
}

async function customerSignupSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('signupCustomerName').value.trim();
  const email = document.getElementById('signupCustomerEmail').value.trim();
  const password = document.getElementById('signupCustomerPassword').value;

  if (!name || !email || !password) {
    showCustomerAuthMessage('Please complete all sign-up fields.', 'error');
    return;
  }

  if (!/^[^\s@]+@gmail\.com$/i.test(email)) {
    showCustomerAuthMessage('Please use a valid Gmail address ending in @gmail.com.', 'error');
    return;
  }

  if (password.length < 6) {
    showCustomerAuthMessage('Password must be at least 6 characters long.', 'error');
    return;
  }

  try {
    const response = await fetch('/clients/signup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, password })
    });
    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error || 'Sign up failed.');
    }

    setCustomerSession(result.client);
    customerSignupForm.reset();
    closeCustomerAuth();
  } catch (error) {
    showCustomerAuthMessage(error.message || 'Unable to create account right now.', 'error');
  }
}

if (customerLoginForm) customerLoginForm.addEventListener('submit', customerLoginSubmit);
if (customerSignupForm) customerSignupForm.addEventListener('submit', customerSignupSubmit);

const savedCustomerSession = sessionStorage.getItem('nards_customer_session');
if (savedCustomerSession) {
  try {
    const client = JSON.parse(savedCustomerSession);
    const authButton = document.getElementById('customerAuthBtn');
    if (authButton) authButton.textContent = client.name ? `Hi, ${client.name.split(' ')[0]}` : client.email;
  } catch (error) {
    clearCustomerSession();
  }
}

window.addEventListener('scroll', () => {
  mainNav.classList.toggle('scrolled', window.scrollY > 60);
  scrollTopBtn.classList.toggle('show', window.scrollY > 400);
});

navToggle.addEventListener('click', () => {
  mobileNav.classList.toggle('open');
});

function closeMobileNav() {
  mobileNav.classList.remove('open');
}

document.addEventListener('click', (e) => {
  if (!mainNav.contains(e.target) && !mobileNav.contains(e.target)) {
    mobileNav.classList.remove('open');
  }
});

const revealEls = document.querySelectorAll('.reveal');
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add('visible');
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12 });
revealEls.forEach(el => revealObserver.observe(el));

let customerPackages = [];

async function loadPackages() {
  try {
    const res = await fetch('/packages');
    if (!res.ok) throw new Error();
    customerPackages = await res.json();
  } catch (e) {
    customerPackages = [];
  }

  const grid = document.getElementById('packages-grid');
  if (!customerPackages.length) {
    grid.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:rgba(201,150,58,0.6);padding:32px">No packages available yet.</div>';
  } else {
    grid.innerHTML = customerPackages.map((p, i) => {
      const featured = i === customerPackages.length - 1 ? ' featured' : '';
      const assetStrip = (p.assets || []).length
        ? `<div class="pkg-assets-strip">${(p.assets || []).map(a => `<div class="pkg-asset-item"><span class="pkg-asset-qty">${a.qty_required}</span><span class="pkg-asset-name">&nbsp;${a.name}</span></div>`).join('')}</div>`
        : '';
      const freebieStrip = (p.freebies || []).length
        ? `<div class="pkg-freebies-strip">${(p.freebies || []).map(f => `<span class="pkg-freebie-tag">&#10003; ${f.name}</span>`).join('')}</div>`
        : '';

      const dishMap = {};
      (p.dishes || []).forEach(d => {
        if (!dishMap[d.category]) dishMap[d.category] = [];
        dishMap[d.category].push(d.name);
      });
      const dishHtml = Object.keys(dishMap).length
        ? `<div class="pkg-section-label">&#127869; What's Included</div><div class="pkg-dish-grid">${Object.entries(dishMap).map(([cat, names]) => `<div class="pkg-dish-group"><div class="pkg-dish-cat">${cat}</div>${names.map(n => `<div class="pkg-dish-item">&bull; ${n}</div>`).join('')}</div>`).join('')}</div>`
        : '<div class="pkg-dish-empty">&#127869; Menu details coming soon</div>';

      return `<div class="promo-package${featured}"><div class="promo-header"><span class="pax">${p.name}</span><span class="price">&#8369;${Number(p.price).toLocaleString('en-PH')}</span></div><div class="pkg-min-guests">Min. ${p.min_guests} guests</div>${assetStrip}${freebieStrip}<div class="pkg-divider"></div><div class="pkg-dishes-section">${dishHtml}</div></div>`;
    }).join('');
  }

  const sel = document.getElementById('guest-count');
  sel.innerHTML = '<option value="">Select a package...</option>' + customerPackages.map(p => `<option value="${p.name}" data-price="${p.price}">${p.name} — Min. ${p.min_guests} guests (&#8369;${Number(p.price).toLocaleString('en-PH')})</option>`).join('');
}

const packageSelect = document.getElementById('guest-count');
const totalPriceEl = document.getElementById('totalPrice');
const downPayEl = document.getElementById('downPayment');
const payInfoBox = document.getElementById('payment-info-box');
const RESERVATION_FEE = 1000;

packageSelect.addEventListener('change', function () {
  const selected = this.options[this.selectedIndex];
  const price = parseFloat(selected?.dataset?.price || 0);
  if (!price) {
    payInfoBox.style.display = 'none';
    return;
  }
  payInfoBox.style.display = 'flex';
  const baseDownPayment = price * 0.2;
  const netDownPayment = Math.max(baseDownPayment - RESERVATION_FEE, 0);
  totalPriceEl.textContent = 'Total Price: ₱' + price.toLocaleString('en-PH');
  downPayEl.textContent = 'Down Payment (20% less ₱1,000 reservation fee): ₱' + netDownPayment.toLocaleString('en-PH');
});

loadPackages();

let custCalYear = new Date().getFullYear();
let custCalMonth = new Date().getMonth();
let custCalBookedDates = new Set();
let custCalAllBookings = [];

function custCalTodayStr() {
  const n = new Date();
  return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

async function loadCustCalBookings() {
  try {
    const res = await fetch('/bookings');
    if (!res.ok) throw new Error();
    custCalAllBookings = await res.json();
    custCalBookedDates = new Set(custCalAllBookings.filter(r => (r.status || '').toLowerCase() === 'confirmed').map(r => r.eventDate ? r.eventDate.split('T')[0] : '').filter(Boolean));
  } catch (e) {
    custCalAllBookings = [];
    custCalBookedDates = new Set();
  }
  renderCustCalendar();
}

function renderCustCalendar() {
  const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  document.getElementById('cust-cal-month-label').textContent = `${monthNames[custCalMonth]} ${custCalYear}`;
  const grid = document.getElementById('cust-cal-grid');
  const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let html = dayLabels.map(d => `<div class="cust-cal-day-label">${d}</div>`).join('');
  const firstDay = new Date(custCalYear, custCalMonth, 1).getDay();
  const daysInMonth = new Date(custCalYear, custCalMonth + 1, 0).getDate();
  const todayStr = custCalTodayStr();

  for (let i = 0; i < firstDay; i++) html += '<div></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${custCalYear}-${String(custCalMonth + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const isToday = dateStr === todayStr;
    const isBooked = custCalBookedDates.has(dateStr);
    let cls = 'cust-cal-cell';
    if (isToday) cls += ' cust-cal-today';
    if (isBooked) cls += ' cust-cal-booked';
    const dot = isBooked ? '<span class="cust-cal-dot"></span>' : '';
    html += `<div class="${cls}" onclick="custCalSelectDay('${dateStr}')"><span class="cust-cal-num">${d}</span><div class="cust-cal-dots">${dot}</div></div>`;
  }
  grid.innerHTML = html;
}

function custCalPrev() {
  custCalMonth--;
  if (custCalMonth < 0) { custCalMonth = 11; custCalYear--; }
  renderCustCalendar();
}

function custCalNext() {
  custCalMonth++;
  if (custCalMonth > 11) { custCalMonth = 0; custCalYear++; }
  renderCustCalendar();
}

function custCalSelectDay(dateStr) {
  document.querySelectorAll('.cust-cal-cell').forEach(c => c.classList.remove('cust-cal-selected'));
  document.querySelectorAll('.cust-cal-cell').forEach(c => {
    if (c.getAttribute('onclick') === `custCalSelectDay('${dateStr}')`) c.classList.add('cust-cal-selected');
  });

  const detail = document.getElementById('cust-cal-detail');
  const label = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const todayStr = custCalTodayStr();
  const isBooked = custCalBookedDates.has(dateStr);
  const isPast = dateStr < todayStr;

  const dayEvents = custCalAllBookings.filter(r => r.eventDate && r.eventDate.split('T')[0] === dateStr && (r.status || '').toLowerCase() === 'confirmed');

  if (isBooked) {
    const eventLines = dayEvents.map(r => `<div style="font-size:12px;color:var(--muted);margin-top:4px">&#8226; ${r.eventType || 'Event'} &mdash; ${r.guests || 0} pax</div>`).join('');
    detail.innerHTML = `<div class="cust-cal-booked-notice"><span>&#128197;</span><div><strong>${label}</strong><p>This date is already reserved and unavailable.</p>${eventLines}<p class="cust-cal-notice-sub">Please choose another date.</p><button class="cust-cal-book-btn" onclick="location.href='#inquiry'">Pick Another Date</button></div></div>`;
  } else if (isPast) {
    detail.innerHTML = `<div class="cust-cal-avail-notice"><span>&#128198;</span><div><strong>${label}</strong><p>This date has already passed.</p></div></div>`;
  } else {
    detail.innerHTML = `<div class="cust-cal-avail-notice"><span>&#9989;</span><div><strong>${label}</strong><p>This date is available! Book now to reserve your event.</p><button class="cust-cal-book-btn" onclick="document.getElementById('event-date').value='${dateStr}';location.href='#inquiry'">Book This Date</button></div></div>`;
  }
}

loadCustCalBookings();
setInterval(loadCustCalBookings, 2 * 60 * 1000);

const eventDateInput = document.getElementById('event-date');
if (eventDateInput) {
  eventDateInput.min = custCalTodayStr();
}

document.getElementById('inquiryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  btn.disabled = true;
  btn.querySelector('.btn-text').textContent = 'Preparing payment...';

  const data = {
    clientName: document.getElementById('name').value,
    address: document.getElementById('address').value,
    email: document.getElementById('email').value,
    eventType: document.getElementById('event-type').value,
    package: document.getElementById('guest-count').value,
    eventDate: document.getElementById('event-date').value,
    phone: document.getElementById('phone').value,
    notes: document.getElementById('notes').value
  };

  if (data.eventDate && data.eventDate < custCalTodayStr()) {
    const msgEl = document.getElementById('form-message');
    msgEl.className = 'form-message error';
    msgEl.textContent = 'Please select today or a future date.';
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = '✉ Send Booking Request';
    return;
  }

  try {
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = '✉ Send Booking Request';
    openPaymentModal(data);
  } catch (err) {
    const msgEl = document.getElementById('form-message');
    msgEl.className = 'form-message error';
    msgEl.textContent = 'Unable to connect to server. Please try again later.';
    btn.disabled = false;
    btn.querySelector('.btn-text').textContent = '✉ Send Booking Request';
  }
});

let _pendingBookingData = null;
function getReservationFee(formData) { return RESERVATION_FEE; }
function generateRandomQrPayload(formData, amount) {
  const randomToken = Math.random().toString(36).slice(2, 10).toUpperCase();
  return `GCASH|NARDS|${formData.clientName}|${formData.eventDate}|PHP${amount.toFixed(2)}|${Date.now()}|${randomToken}`;
}

function openPaymentModal(formData) {
  const amount = getReservationFee(formData);
  _pendingBookingData = formData;

  const dateLabel = formData.eventDate
    ? new Date(formData.eventDate + 'T00:00:00').toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : '';

  document.getElementById('pay-modal-summary').innerHTML = `
    <div class="pay-summary-row"><span>Guest</span><strong>${formData.clientName}</strong></div>
    <div class="pay-summary-row"><span>Event</span><strong>${formData.eventType}</strong></div>
    <div class="pay-summary-row"><span>Package</span><strong>${formData.package}</strong></div>
    <div class="pay-summary-row"><span>Date</span><strong>${dateLabel}</strong></div>
    <div class="pay-summary-row pay-summary-total"><span>Reservation Fee</span><strong>&#8369;${Number(amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>
    <div class="pay-summary-row"><span>Note</span><strong>&#8369;1,000 will be deducted from your downpayment.</strong></div>
  `;

  const qrPayload = generateRandomQrPayload(formData, amount);
  document.getElementById('gcash-qr-image').src = `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(qrPayload)}`;
  document.getElementById('payment-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
}

function closePaymentModal() {
  document.getElementById('payment-modal').style.display = 'none';
  document.body.style.overflow = '';
}

document.getElementById('pay-modal-close').addEventListener('click', closePaymentModal);
document.getElementById('payment-modal').addEventListener('click', (e) => {
  if (e.target === document.getElementById('payment-modal')) closePaymentModal();
});

document.getElementById('pay-btn').addEventListener('click', async () => {
  const payBtn = document.getElementById('pay-btn');
  const btnText = document.getElementById('pay-btn-text');

  payBtn.disabled = true;
  btnText.textContent = 'Saving booking...';

  try {
    const res = await fetch('/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(_pendingBookingData)
    });
    const result = await res.json();

    if (!res.ok) {
      throw new Error(result.error || 'Booking could not be saved.');
    }

    closePaymentModal();
    document.getElementById('inquiryForm').reset();
    payInfoBox.style.display = 'none';
    loadCustCalBookings();

    const msgEl = document.getElementById('form-message');
    msgEl.className = 'form-message success';
    msgEl.textContent = '✓ Booking received with GCash payment screenshot pending verification.';
  } catch (err) {
    const msgEl = document.getElementById('form-message');
    msgEl.className = 'form-message error';
    msgEl.textContent = err.message || 'Unable to complete booking right now.';
  } finally {
    payBtn.disabled = false;
    btnText.textContent = 'I Have Paid';
  }
});
