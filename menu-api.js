
function showPopup(options) {
  if (typeof Swal !== 'undefined') {
    return Swal.fire(options);
  }
  console.warn('SweetAlert2 is not loaded. Popup message:', options.text || options.title || 'Notification');
  return Promise.resolve();
}

const API_BASE = '';

async function fetchMenu() {
  try {
    const res = await fetch(`${API_BASE}/menu`);
    const menu = await res.json();
    
    const menuList = document.getElementById('menu-list');
    menuList.innerHTML = '';
    menu.forEach(item => {
      const li = document.createElement('li');
      li.textContent = `${item.name} - ₱${item.price}`;
      menuList.appendChild(li);
    });
  } catch (err) {
    await showPopup({
      icon: 'error',
      title: 'Failed to load menu',
      text: err.message
    });
  }
}


async function addMenuItem(name, description, price) {
  try {
    const res = await fetch(`${API_BASE}/menu`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, description, price })
    });
    const data = await res.json();
    await showPopup({
      icon: res.ok ? 'success' : 'error',
      title: res.ok ? 'Success' : 'Request failed',
      text: data.message || 'No message returned from server'
    });
    fetchMenu(); 
  } catch (err) {
    await showPopup({
      icon: 'error',
      title: 'Failed to add menu item',
      text: err.message
    });
  }
}


if (window.location.pathname.endsWith('Admin.html')) {
  document.addEventListener('DOMContentLoaded', fetchMenu);
}
