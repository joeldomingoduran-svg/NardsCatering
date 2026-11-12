(function () {
  let employees = [];
  let editingId = null;
  const $ = (id) => document.getElementById(id);
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  window.loadEmployees = async function () {
    try {
      const res = await fetch('/employees');
      employees = await res.json();
      if (!res.ok) throw new Error(employees.error || 'Could not load employees.');
      render();
    } catch (error) {
      if ($('employees-tbody')) $('employees-tbody').innerHTML = `<tr><td colspan="6">${esc(error.message)}</td></tr>`;
    }
  };

  function render() {
    const query = ($('employee-search')?.value || '').trim().toLowerCase();
    const rows = employees.filter((e) => !query || `${e.name} ${e.address}`.toLowerCase().includes(query));
    $('employees-tbody').innerHTML = rows.length ? rows.map((e) => `<tr>
      <td><strong>${esc(e.name)}</strong></td><td>${e.age}</td><td>${esc(e.address)}</td><td>${esc(e.job_role)}</td>
      <td><span class="status-pill ${Number(e.is_active) ? 'active' : 'inactive'}">${Number(e.is_active) ? 'Active' : 'Inactive'}</span></td>
      <td><div class="role-actions"><button class="icon-action" onclick="openEmployeeModal(${e.id})">Edit</button><button class="icon-action ${Number(e.is_active) ? 'danger' : 'success'}" onclick="toggleEmployee(${e.id},${Number(e.is_active) ? 0 : 1})">${Number(e.is_active) ? 'Deactivate' : 'Activate'}</button></div></td>
    </tr>`).join('') : '<tr><td colspan="6">No employees found.</td></tr>';
  }

  window.openEmployeeModal = function (id) {
    editingId = id || null;
    const e = employees.find((x) => x.id === id);
    $('employee-modal-title').textContent = e ? 'Edit employee' : 'Add employee';
    $('employee-name').value = e?.name || ''; $('employee-age').value = e?.age || '';
    $('employee-address').value = e?.address || ''; $('employee-job-role').value = e?.job_role || '';
    openModal('employee-modal');
  };
  window.saveEmployee = async function () {
    const body = { name: $('employee-name').value, age: Number($('employee-age').value), address: $('employee-address').value, jobRole: $('employee-job-role').value };
    const res = await fetch(editingId ? `/employees/${editingId}` : '/employees', { method: editingId ? 'PUT' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) return notify(out.error || 'Could not save employee.', '❌');
    closeModal('employee-modal'); notify(editingId ? 'Employee updated.' : 'Employee added.', '✅'); loadEmployees();
  };
  window.toggleEmployee = async function (id, active) {
    const res = await fetch(`/employees/${id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ is_active: Boolean(active) }) });
    const out = await res.json().catch(() => ({})); notify(res.ok ? out.message : (out.error || 'Could not update employee.'), res.ok ? '✅' : '❌'); if (res.ok) loadEmployees();
  };
  window.filterEmployees = render;
})();
