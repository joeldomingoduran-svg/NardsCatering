const form = document.getElementById('loginForm');
const usernameEl = document.getElementById('username');
const passwordEl = document.getElementById('password');
const loginRoleEl = document.getElementById('loginRole');
const errorMsg = document.getElementById('error-msg');
const errorText = document.getElementById('error-text');
const loginBtn = document.getElementById('loginBtn');
const togglePw = document.getElementById('togglePw');
const API_BASE = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '3000' && window.location.port !== '' ? 'http://localhost:3000' : '';

togglePw.addEventListener('click', () => {
  const hidden = passwordEl.type === 'password';
  passwordEl.type = hidden ? 'text' : 'password';
  togglePw.textContent = hidden ? '🙈' : '👁';
  passwordEl.focus();
});

[usernameEl, passwordEl].forEach(inp => {
  inp.addEventListener('input', () => {
    inp.classList.remove('error');
    errorMsg.classList.remove('show');
  });
});
loginRoleEl.addEventListener('change', () => errorMsg.classList.remove('show'));

form.addEventListener('submit', async function (e) {
  e.preventDefault();
  const username = usernameEl.value.trim();
  const password = passwordEl.value;

  loginBtn.disabled = true;
  loginBtn.innerHTML = '<span class="spinner"></span>Signing in...';

  try {
    const response = await fetch(`${API_BASE}/staff/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role: loginRoleEl.value })
    });
    const rawResponse = await response.text();
    let result;
    try {
      result = JSON.parse(rawResponse);
    } catch (parseError) {
      throw new Error('Cannot reach the backend. Start the Node server and open http://localhost:3000/login.');
    }
    if (!response.ok) {
      throw new Error(result.error || 'Invalid username or password.');
    }
    if (!result.user || result.user.role !== loginRoleEl.value) {
      throw new Error('The selected account type does not match this account.');
    }
    sessionStorage.setItem('nards_internal_token', result.token);
    sessionStorage.setItem('nards_internal_user', JSON.stringify(result.user));
    loginBtn.innerHTML = 'Redirecting...';
    window.location.href = '/admin';
  } catch (error) {
    loginBtn.disabled = false;
    loginBtn.innerHTML = 'Sign In';
    alert(error.message || 'Login failed. Please try again.');
    errorText.textContent = error.message;
    errorMsg.classList.add('show');
    usernameEl.classList.add('error');
    passwordEl.classList.add('error');
    passwordEl.value = '';
    passwordEl.focus();
  }
});
