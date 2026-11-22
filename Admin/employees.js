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

  window.bookingAssignedBadgeHtml = function (booking) {
    const team = Array.isArray(booking?.assignedEmployees) ? booking.assignedEmployees : [];
    if (!team.length) return '';
    const preview = team.slice(0, 2).map((m) => esc(m.name)).join(', ') + (team.length > 2 ? ` +${team.length - 2}` : '');
    return `<div class="booking-team-chip" title="${esc(team.map((m) => `${m.name} (${m.job_role || 'Crew'})`).join(', '))}">&#128101; ${preview}</div>`;
  };

  function ensureTeamModal() {
    if ($('booking-team-modal')) return;
    const div = document.createElement('div');
    div.className = 'modal-overlay';
    div.id = 'booking-team-modal';
    div.innerHTML = `<div class="modal role-modal-card">
      <div class="modal-title"><span id="bt-modal-title">Assigned Employees</span><button class="modal-close" onclick="closeModal('booking-team-modal')">&#10005;</button></div>
      <p id="bt-modal-sub" class="role-modal-help"></p>
      <div id="bt-view-section"></div>
      <div id="bt-edit-section" style="display:none">
        <div class="form-group" style="margin-bottom:8px"><input id="bt-search" type="text" placeholder="Search employee name or role..."></div>
        <div class="booking-team-list" id="bt-checklist"></div>
      </div>
      <div class="modal-actions" id="bt-modal-actions"></div>
    </div>`;
    div.addEventListener('click', (e) => { if (e.target === div) closeModal('booking-team-modal'); });
    document.body.appendChild(div);
  }

  window.openBookingTeamModal = async function (booking, options = {}) {
    if (!booking) return;
    ensureTeamModal();
    const mode = options.mode === 'confirm' ? 'confirm' : 'view';
    const canEdit = Boolean(options.canEdit);
    const dbId = String(booking.id || '').replace(/^DB-/, '');
    const titleEl = $('bt-modal-title');
    const subEl = $('bt-modal-sub');
    const viewSec = $('bt-view-section');
    const editSec = $('bt-edit-section');
    const checklistEl = $('bt-checklist');
    const searchEl = $('bt-search');
    const actionsEl = $('bt-modal-actions');

    titleEl.textContent = mode === 'confirm' ? 'Confirm Booking & Assign Employees' : 'Assigned Employees';
    subEl.textContent = `${booking.client || ''} — ${booking.event || 'Event'}${booking.date ? ' on ' + booking.date : ''}`;
    viewSec.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Loading assigned employees...</p>';
    editSec.style.display = 'none';
    actionsEl.replaceChildren();
    openModal('booking-team-modal');

    let activeEmployees = [];
    let assigned = Array.isArray(booking.assignedEmployees) ? booking.assignedEmployees.slice() : [];
    try {
      const [teamRes, empRes] = await Promise.all([
        dbId ? fetch(`/employees/booking/${dbId}/team`, { cache: 'no-store' }) : Promise.resolve(null),
        (mode === 'confirm' || canEdit) ? fetch('/employees', { cache: 'no-store' }) : Promise.resolve(null)
      ]);
      if (teamRes && teamRes.ok) assigned = await teamRes.json();
      if (empRes && empRes.ok) {
        const all = await empRes.json();
        activeEmployees = Array.isArray(all) ? all.filter((e) => Number(e.is_active)) : [];
      }
    } catch (e) {}

    const selected = new Set(assigned.map((m) => Number(m.id)));

    function renderChecklist() {
      const q = (searchEl.value || '').trim().toLowerCase();
      const filtered = activeEmployees.filter((e) => !q || `${e.name} ${e.job_role}`.toLowerCase().includes(q));
      checklistEl.innerHTML = filtered.length
        ? filtered.map((e) => `<div class="booking-team-item">
            <label><input type="checkbox" value="${e.id}" ${selected.has(Number(e.id)) ? 'checked' : ''}><span>${esc(e.name)}</span></label>
            <small>${esc(e.job_role || 'Crew')}</small>
          </div>`).join('')
        : '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:13px">No active employees found. Add crew in the Employees tab.</div>';
      checklistEl.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
        cb.addEventListener('change', () => {
          const id = Number(cb.value);
          if (cb.checked) selected.add(id); else selected.delete(id);
        });
      });
    }

    function renderViewList() {
      viewSec.innerHTML = assigned.length
        ? `<div class="booking-team-list">${assigned.map((m) => `<div class="booking-team-item" style="cursor:default">
            <strong style="color:var(--dark);font-size:14px">${esc(m.name)}</strong>
            <span class="badge badge-gold">${esc(m.job_role || 'Crew')}</span>
          </div>`).join('')}</div>`
        : '<div style="padding:16px;text-align:center;color:var(--text-muted);font-size:13px;border:1px dashed var(--border);border-radius:10px">No employees assigned to this booking yet.</div>';
    }

    function addBtn(label, cls, fn) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', () => fn(b));
      actionsEl.appendChild(b);
    }

    searchEl.value = '';
    searchEl.oninput = renderChecklist;

    if (mode === 'confirm') {
      viewSec.style.display = 'none';
      editSec.style.display = 'block';
      renderChecklist();
      addBtn('Cancel', 'btn btn-outline', () => closeModal('booking-team-modal'));
      addBtn('Confirm Booking & Assign', 'btn btn-success', async (btn) => {
        btn.disabled = true;
        btn.textContent = 'Confirming...';
        try {
          const ids = [...selected];
          const ok = options.onConfirm ? await options.onConfirm(ids) : true;
          if (ok) closeModal('booking-team-modal');
        } finally {
          btn.disabled = false;
          btn.textContent = 'Confirm Booking & Assign';
        }
      });
    } else {
      let editingTeam = false;
      function showReadMode() {
        editingTeam = false;
        viewSec.style.display = 'block';
        editSec.style.display = 'none';
        renderViewList();
        actionsEl.replaceChildren();
        addBtn('Close', 'btn btn-outline', () => closeModal('booking-team-modal'));
        if (canEdit && activeEmployees.length) {
          addBtn(assigned.length ? 'Edit Employees' : '+ Assign Employees', 'btn btn-primary', showEditMode);
        }
      }
      function showEditMode() {
        editingTeam = true;
        viewSec.style.display = 'none';
        editSec.style.display = 'block';
        renderChecklist();
        actionsEl.replaceChildren();
        addBtn('Back', 'btn btn-outline', showReadMode);
        addBtn('Save Employees', 'btn btn-success', async (btn) => {
          btn.disabled = true;
          btn.textContent = 'Saving...';
          try {
            const ids = [...selected];
            const res = await fetch(`/employees/booking/${dbId}/team`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ employeeIds: ids })
            });
            const out = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(out.error || 'Could not save assigned employees.');
            assigned = activeEmployees.filter((e) => selected.has(Number(e.id))).map((e) => ({ id: e.id, name: e.name, job_role: e.job_role }));
            booking.assignedEmployees = assigned;
            if (options.onSaved) await options.onSaved(assigned);
            if (window.notify) window.notify('Assigned employees updated.', '✅');
            showReadMode();
          } catch (err) {
            if (window.notify) window.notify(err.message, '❌');
          } finally {
            btn.disabled = false;
            btn.textContent = 'Save Employees';
          }
        });
      }
      showReadMode();
    }
  };
})();
