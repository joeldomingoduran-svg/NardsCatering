// Shared operational expansions across Admin, Manager, and Staff portals:
// 1) Real-time Inventory expiration & perishables, disposal, readiness & stock movement log
// 2) Manager -> Admin approval queue for all inventory & asset mutations
// 3) Catering Assets Damaged section (report damage, repair, write off)
// 4) Expanded Business Reports (Sales + Inventory/Expiry/Damaged + Financial Projections)
// 5) Per-booking Liquidation modal, Printable Event Sheet & Admin Booking Advisory toggle
(function () {
  'use strict';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    return typeof window.fmtMoney === 'function'
      ? window.fmtMoney(n)
      : ('₱' + Number(n || 0).toLocaleString('en-PH'));
  }

  function apiBase() {
    return typeof window.API === 'string' ? window.API : '';
  }

  function currentUser() {
    try { return JSON.parse(sessionStorage.getItem('nards_internal_user') || 'null') || {}; } catch (e) { return {}; }
  }

  function manilaTodayStr() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Manila' });
  }

  window.getExpiryInfo = function (ing) {
    if (!ing || !ing.isPerishable) {
      return { key: 'none', label: 'Non-Perishable', cls: '', style: 'background:#f2eee6;color:#655a4a' };
    }
    const exp = String(ing.expiryDate || '').slice(0, 10);
    if (!exp) {
      return { key: 'missing', label: 'No Expiry Set', cls: 'badge-warning', daysLeft: null };
    }
    const todayMs = new Date(manilaTodayStr() + 'T00:00:00Z').getTime();
    const expMs = new Date(exp + 'T00:00:00Z').getTime();
    const daysLeft = Math.round((expMs - todayMs) / 86400000);
    if (daysLeft < 0) {
      return { key: 'expired', label: 'Expired (' + Math.abs(daysLeft) + 'd ago)', cls: 'badge-danger', daysLeft };
    }
    if (daysLeft === 0) {
      return { key: 'expired', label: 'Expires Today!', cls: 'badge-danger', daysLeft: 0 };
    }
    if (daysLeft <= 3) {
      return { key: 'soon', label: 'Expiring in ' + daysLeft + 'd', cls: 'badge-warning', daysLeft };
    }
    return { key: 'fresh', label: 'Fresh (' + daysLeft + 'd left)', cls: 'badge-success', daysLeft };
  };

  function collectedAmount(b) {
    if (!b || b.status === 'Cancelled') return 0;
    const total = Number(b.amount) || 0;
    if (b.status === 'Completed') return total;
    if (b.paid) {
      if (b.paymentOption === 'down') return Math.min(total, Number(b.amountDue || b.dp) || 0);
      return total;
    }
    return 0;
  }

  function balanceAmount(b) {
    if (!b || b.status === 'Cancelled' || b.status === 'Completed') return 0;
    if (b.status !== 'Confirmed') return 0;
    return Math.max(0, (Number(b.amount) || 0) - collectedAmount(b));
  }

  window.bookingCollectedAmount = collectedAmount;
  window.bookingBalanceAmount = balanceAmount;

  window.notifyStockShortages = function (response) {
    if (response && Array.isArray(response.stockShortages) && response.stockShortages.length) {
      const list = response.stockShortages.map(function (s) {
        return s.ingredient + ' (need ' + s.required + ', had ' + s.available + ')';
      }).join(', ');
      if (window.notify) {
        window.notify('Booking confirmed with insufficient stock for: ' + list + '. Please restock soon.', '⚠️');
      }
    }
  };

  /* --------------------------------------------------- 1. Liquidation Modal */
  window.openLiquidationModal = async function (bookingId) {
    const bookings = window.data && Array.isArray(window.data.bookings) ? window.data.bookings : [];
    const booking = bookings.find(function (b) { return b.id === bookingId; });
    if (!booking || !String(booking.id).startsWith('DB-')) {
      if (window.notify) window.notify('Save the booking to the database before recording liquidation.', '⚠️');
      return;
    }
    const dbId = String(booking.id).replace(/^DB-/, '');
    const currentExpense = Number(booking.expenseAmount) || 0;
    const currentNotes = String(booking.liquidationNotes || '');

    let expenseValue = currentExpense;
    let notesValue = currentNotes;
    if (window.Swal) {
      const result = await window.Swal.fire({
        title: 'Event Liquidation & Expenses',
        html:
          '<div style="text-align:left">' +
          '<p style="font-size:13px;color:#666;margin:0 0 10px"><strong>' + esc(booking.client) + '</strong> &mdash; ' + esc(booking.event) + ' (' + esc(booking.date || '') + ')</p>' +
          '<label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Total Event Expenses (&#8369;)</label>' +
          '<input id="swal-liq-expense" type="number" min="0" step="0.01" value="' + currentExpense + '" style="width:100%;padding:9px 10px;border:1px solid #d5cfc6;border-radius:8px;box-sizing:border-box;margin-bottom:10px">' +
          '<label style="display:block;font-size:12px;font-weight:700;margin-bottom:4px">Liquidation Breakdown / Notes (optional)</label>' +
          '<textarea id="swal-liq-notes" rows="3" maxlength="500" placeholder="e.g. Market ingredients ₱18,000, Crew allowance ₱4,500, Vehicle rental ₱2,000" style="width:100%;padding:9px 10px;border:1px solid #d5cfc6;border-radius:8px;box-sizing:border-box">' + esc(currentNotes) + '</textarea>' +
          '</div>',
        showCancelButton: true,
        confirmButtonText: 'Save Liquidation',
        confirmButtonColor: '#8d6a36',
        preConfirm: function () {
          const val = Number(document.getElementById('swal-liq-expense').value);
          if (!Number.isFinite(val) || val < 0) {
            window.Swal.showValidationMessage('Enter a valid expense amount (0 or greater).');
            return false;
          }
          return {
            expense_amount: Math.round(val * 100) / 100,
            liquidation_notes: document.getElementById('swal-liq-notes').value.trim()
          };
        }
      });
      if (!result.isConfirmed || !result.value) return;
      expenseValue = result.value.expense_amount;
      notesValue = result.value.liquidation_notes;
    } else {
      const raw = window.prompt('Enter total event expenses (PHP):', String(currentExpense));
      if (raw === null) return;
      expenseValue = Number(raw);
      if (!Number.isFinite(expenseValue) || expenseValue < 0) return;
      notesValue = window.prompt('Liquidation notes (optional):', currentNotes) || '';
    }

    try {
      const res = await fetch(apiBase() + '/bookings/' + encodeURIComponent(dbId) + '/liquidation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ expense_amount: expenseValue, liquidation_notes: notesValue })
      });
      const out = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (window.notify) window.notify(out.error || 'Could not save liquidation.', '❌');
        return;
      }
      booking.expenseAmount = Number(out.expense_amount) || 0;
      booking.liquidationNotes = out.liquidation_notes || '';
      booking.liquidationUpdatedBy = out.liquidation_updated_by || '';
      if (typeof window.saveData === 'function') window.saveData();
      if (typeof window.renderSalesAnalytics === 'function') window.renderSalesAnalytics();
      if (typeof window.renderReports === 'function') window.renderReports();
      if (typeof window.renderBookings === 'function') window.renderBookings();
      const modal = document.getElementById('confirm-modal');
      if (modal && modal.classList.contains('open') && typeof window.showConfirmation === 'function') {
        window.showConfirmation(booking);
      }
      if (window.notify) window.notify('Event liquidation saved.', '✅');
    } catch (e) {
      if (window.notify) window.notify('Could not reach the server.', '❌');
    }
  };

  /* -------------------------------------- 2. Inventory Filter, Expiry & Log */
  let inventoryMode = 'items'; // 'items' | 'log' | 'approvals'
  let inventoryPerishableFilter = 'all'; // 'all' | 'perishable' | 'expiring'
  let assetMode = 'active'; // 'active' | 'archive' | 'damaged' | 'log'

  function ensureInventoryEnhancements() {
    const user = currentUser();
    const isAdmin = user.role === 'admin';
    const viewInv = document.getElementById('view-inventory');
    if (viewInv && !document.getElementById('inventory-log-btn')) {
      const headerBtns = viewInv.querySelector('.section-header > div');
      const archiveBtn = document.getElementById('inventory-archive-btn');
      if (headerBtns && archiveBtn) {
        const logBtn = document.createElement('button');
        logBtn.className = 'btn btn-outline';
        logBtn.id = 'inventory-log-btn';
        logBtn.type = 'button';
        logBtn.textContent = 'Stock In / Out Log';
        logBtn.addEventListener('click', function () { setInvMode(inventoryMode === 'log' ? 'items' : 'log'); });
        archiveBtn.after(logBtn);

        if (isAdmin) {
          const appBtn = document.createElement('button');
          appBtn.className = 'btn btn-outline';
          appBtn.id = 'inventory-approvals-btn';
          appBtn.type = 'button';
          appBtn.textContent = 'Pending Approvals (0)';
          appBtn.addEventListener('click', function () { setInvMode(inventoryMode === 'approvals' ? 'items' : 'approvals'); });
          logBtn.after(appBtn);
        }
      }

      const alertsEl = document.getElementById('inv-alerts');
      if (alertsEl && !document.getElementById('inv-approval-banner')) {
        if (isAdmin) {
          const appBanner = document.createElement('div');
          appBanner.id = 'inv-approval-banner';
          alertsEl.before(appBanner);
        } else if (user.role === 'manager') {
          const mgrNote = document.createElement('div');
          mgrNote.className = 'approval-banner';
          mgrNote.innerHTML = '<div><strong>Manager Approval Policy:</strong> All ingredient and catering asset changes (create, edit, restock, damage, disposal, archive) are queued for Administrator approval.</div>';
          alertsEl.before(mgrNote);
        }
        const readyDiv = document.createElement('div');
        readyDiv.id = 'inv-readiness-banner';
        readyDiv.style.marginBottom = '14px';
        alertsEl.after(readyDiv);
      }

      const viewAssetsEl = document.getElementById('view-assets');
      if (viewAssetsEl && isAdmin && !document.getElementById('assets-approval-banner')) {
        const assetHeader = viewAssetsEl.querySelector('.section-header');
        if (assetHeader) {
          const aBanner = document.createElement('div');
          aBanner.id = 'assets-approval-banner';
          assetHeader.after(aBanner);
        }
      }

      const searchBar = viewInv.querySelector('.search-bar');
      if (searchBar && !document.getElementById('inv-perish-pills')) {
        const pills = document.createElement('div');
        pills.className = 'filter-pills';
        pills.id = 'inv-perish-pills';
        pills.innerHTML =
          '<button type="button" class="filter-pill active" data-pf="all">All Items</button>' +
          '<button type="button" class="filter-pill" data-pf="perishable">Perishables Only</button>' +
          '<button type="button" class="filter-pill" data-pf="expiring">Expiring Soon &amp; Expired</button>';
        pills.addEventListener('click', function (e) {
          const btn = e.target.closest('[data-pf]');
          if (!btn) return;
          inventoryPerishableFilter = btn.dataset.pf;
          pills.querySelectorAll('.filter-pill').forEach(function (b) {
            b.classList.toggle('active', b === btn);
          });
          if (typeof window.renderInventory === 'function') window.renderInventory();
        });
        searchBar.after(pills);
      }

      const activeSec = document.getElementById('inventory-active-section');
      if (activeSec && !document.getElementById('inventory-log-section')) {
        const theadRow = activeSec.querySelector('thead tr');
        if (theadRow) {
          theadRow.innerHTML = '<th>Ingredient &amp; Category</th><th>Current Stock</th><th>Min / Good</th><th>Perishable &amp; Expiry</th><th>Stock Level</th><th>Status</th><th>Last Updated</th><th>Actions</th>';
        }

        const logCard = document.createElement('div');
        logCard.className = 'card';
        logCard.id = 'inventory-log-section';
        logCard.style.display = 'none';
        logCard.innerHTML =
          '<div class="card-title" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
            '<span>Stock In / Stock Out Movement History</span>' +
            '<select id="inv-log-type-filter" style="padding:7px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px">' +
              '<option value="">All Items (Ingredients + Assets)</option>' +
              '<option value="ingredient">Ingredients Only</option>' +
              '<option value="asset">Catering Assets Only</option>' +
            '</select>' +
          '</div>' +
          '<div class="table-wrap"><table><thead>' +
            '<tr><th>Date &amp; Time</th><th>Type</th><th>Item</th><th>Change</th><th>Before &rarr; After</th><th>Reason</th><th>Recorded By</th></tr>' +
          '</thead><tbody id="inventory-log-tbody"><tr><td colspan="7">Loading movements...</td></tr></tbody></table></div>';
        activeSec.after(logCard);
        logCard.querySelector('#inv-log-type-filter').addEventListener('change', function () {
          loadMovementLog('inventory-log-tbody', this.value);
        });

        if (isAdmin) {
          const appCard = document.createElement('div');
          appCard.className = 'card';
          appCard.id = 'inventory-approvals-section';
          appCard.style.display = 'none';
          appCard.innerHTML =
            '<div class="card-title" style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">' +
              '<span>Manager Inventory &amp; Asset Approval Queue</span>' +
              '<select id="inv-app-status-filter" style="padding:7px 12px;border:1px solid var(--border);border-radius:8px;font-size:13px">' +
                '<option value="pending">Pending Requests</option>' +
                '<option value="">All History</option>' +
                '<option value="approved">Approved</option>' +
                '<option value="rejected">Rejected</option>' +
              '</select>' +
            '</div>' +
            '<div class="table-wrap"><table><thead>' +
              '<tr><th>Requested</th><th>Manager</th><th>Module</th><th>Requested Change</th><th>Status</th><th>Actions</th></tr>' +
            '</thead><tbody id="inventory-approvals-tbody"><tr><td colspan="6">Loading approvals...</td></tr></tbody></table></div>';
          logCard.after(appCard);
          appCard.querySelector('#inv-app-status-filter').addEventListener('change', function () {
            loadApprovalsList(this.value);
          });
        }
      }
    }

    const viewAssets = document.getElementById('view-assets');
    if (viewAssets && !document.getElementById('assets-damaged-btn')) {
      const headerBtns = viewAssets.querySelector('.section-header > div');
      const archiveBtn = document.getElementById('assets-archive-btn');
      if (headerBtns && archiveBtn) {
        const dmgBtn = document.createElement('button');
        dmgBtn.className = 'btn btn-outline';
        dmgBtn.id = 'assets-damaged-btn';
        dmgBtn.type = 'button';
        dmgBtn.textContent = 'Damaged Assets (0)';
        dmgBtn.addEventListener('click', function () { setAssetMode(assetMode === 'damaged' ? 'active' : 'damaged'); });

        const aLogBtn = document.createElement('button');
        aLogBtn.className = 'btn btn-outline';
        aLogBtn.id = 'assets-log-btn';
        aLogBtn.type = 'button';
        aLogBtn.textContent = 'Asset Movements';
        aLogBtn.addEventListener('click', function () { setAssetMode(assetMode === 'log' ? 'active' : 'log'); });

        archiveBtn.after(dmgBtn);
        dmgBtn.after(aLogBtn);
      }

      const activeSec = document.getElementById('assets-active-section');
      if (activeSec) {
        const theadRow = activeSec.querySelector('thead tr');
        if (theadRow) {
          theadRow.innerHTML = '<th>Asset Name</th><th>Usable Qty</th><th>Damaged Qty</th><th>Unit</th><th>Actions</th>';
        }
      }

      const archiveSec = document.getElementById('assets-archive-section');
      if (archiveSec && !document.getElementById('assets-damaged-section')) {
        const dmgCard = document.createElement('div');
        dmgCard.className = 'card';
        dmgCard.id = 'assets-damaged-section';
        dmgCard.style.display = 'none';
        dmgCard.style.marginTop = '16px';
        dmgCard.innerHTML =
          '<div class="card-title">Damaged Catering Assets</div>' +
          '<div class="table-wrap"><table><thead>' +
            '<tr><th>Asset Name</th><th>Usable Qty</th><th>Damaged Qty</th><th>Unit</th><th>Damage Notes</th><th>Actions</th></tr>' +
          '</thead><tbody id="assets-damaged-tbody"></tbody></table></div>';
        archiveSec.after(dmgCard);

        const aCard = document.createElement('div');
        aCard.className = 'card';
        aCard.id = 'assets-log-section';
        aCard.style.display = 'none';
        aCard.style.marginTop = '16px';
        aCard.innerHTML =
          '<div class="card-title">Catering Asset Stock In / Out Log</div>' +
          '<div class="table-wrap"><table><thead>' +
            '<tr><th>Date &amp; Time</th><th>Type</th><th>Asset</th><th>Change</th><th>Before &rarr; After</th><th>Reason</th><th>Recorded By</th></tr>' +
          '</thead><tbody id="assets-log-tbody"><tr><td colspan="7">Loading movements...</td></tr></tbody></table></div>';
        dmgCard.after(aCard);
      }
    }
  }

  function setInvMode(mode) {
    inventoryMode = mode;
    const activeSec = document.getElementById('inventory-active-section');
    const logSec = document.getElementById('inventory-log-section');
    const appSec = document.getElementById('inventory-approvals-section');
    const pills = document.getElementById('inv-perish-pills');
    const logBtn = document.getElementById('inventory-log-btn');
    const appBtn = document.getElementById('inventory-approvals-btn');

    if (activeSec) activeSec.style.display = mode === 'items' ? 'block' : 'none';
    if (pills) pills.style.display = mode === 'items' ? 'flex' : 'none';
    if (logSec) logSec.style.display = mode === 'log' ? 'block' : 'none';
    if (appSec) appSec.style.display = mode === 'approvals' ? 'block' : 'none';
    if (logBtn) logBtn.className = 'btn ' + (mode === 'log' ? 'btn-primary' : 'btn-outline');
    if (appBtn) appBtn.className = 'btn ' + (mode === 'approvals' ? 'btn-primary' : 'btn-outline');

    if (mode === 'log') {
      const f = document.getElementById('inv-log-type-filter');
      loadMovementLog('inventory-log-tbody', f ? f.value : '');
    } else if (mode === 'approvals') {
      const af = document.getElementById('inv-app-status-filter');
      loadApprovalsList(af ? af.value : 'pending');
    }
  }

  function setAssetMode(mode) {
    assetMode = mode;
    const activeSec = document.getElementById('assets-active-section');
    const archSec = document.getElementById('assets-archive-section');
    const dmgSec = document.getElementById('assets-damaged-section');
    const logSec = document.getElementById('assets-log-section');
    const activeBtn = document.getElementById('assets-active-btn');
    const archBtn = document.getElementById('assets-archive-btn');
    const dmgBtn = document.getElementById('assets-damaged-btn');
    const logBtn = document.getElementById('assets-log-btn');

    if (activeSec) activeSec.style.display = mode === 'active' ? 'block' : 'none';
    if (archSec) archSec.style.display = mode === 'archive' ? 'block' : 'none';
    if (dmgSec) dmgSec.style.display = mode === 'damaged' ? 'block' : 'none';
    if (logSec) logSec.style.display = mode === 'log' ? 'block' : 'none';

    if (activeBtn) activeBtn.className = 'btn ' + (mode === 'active' ? 'btn-primary' : 'btn-outline');
    if (archBtn) archBtn.className = 'btn ' + (mode === 'archive' ? 'btn-primary' : 'btn-outline');
    if (dmgBtn) dmgBtn.className = 'btn ' + (mode === 'damaged' ? 'btn-primary' : 'btn-outline');
    if (logBtn) logBtn.className = 'btn ' + (mode === 'log' ? 'btn-primary' : 'btn-outline');

    if (mode === 'log') loadMovementLog('assets-log-tbody', 'asset');
  }

  async function loadMovementLog(tbodyId, itemType) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    try {
      const qs = itemType ? '?item_type=' + encodeURIComponent(itemType) : '';
      const res = await fetch(apiBase() + '/inventory/movements' + qs, { cache: 'no-store' });
      const rows = await res.json().catch(function () { return []; });
      if (!res.ok) throw new Error(rows.error || 'Could not load movements.');
      const fmtDt = window.NardsUI && window.NardsUI.fmtDateTime
        ? window.NardsUI.fmtDateTime
        : function (v) { return String(v || '-'); };
      tbody.innerHTML = rows.length ? rows.map(function (r) {
        const diff = Number(r.change_qty) || 0;
        const badgeCls = diff >= 0 ? 'badge-success' : 'badge-danger';
        const diffLabel = (diff >= 0 ? '+' : '') + diff;
        const typeLabel = r.item_type === 'asset' ? 'Asset' : 'Ingredient';
        return '<tr>' +
          '<td style="font-size:12px;white-space:nowrap">' + esc(fmtDt(r.created_at)) + '</td>' +
          '<td><span class="badge badge-gold">' + esc(typeLabel) + '</span></td>' +
          '<td><strong>' + esc(r.item_name) + '</strong></td>' +
          '<td><span class="badge ' + badgeCls + '">' + esc(diffLabel) + '</span></td>' +
          '<td>' + esc(r.previous_qty) + ' &rarr; <strong>' + esc(r.new_qty) + '</strong></td>' +
          '<td>' + esc(r.reason) + '</td>' +
          '<td style="font-size:12px;color:var(--text-muted)">' + esc(r.actor || 'system') + '</td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="7">No stock movements recorded yet.</td></tr>';
    } catch (e) {
      tbody.innerHTML = '<tr><td colspan="7">' + esc(e.message || 'Could not load movements.') + '</td></tr>';
    }
  }

  async function loadApprovalsList(statusFilter) {
    const user = currentUser();
    if (user.role !== 'admin') return;
    try {
      const pRes = await fetch(apiBase() + '/inventory/approvals?status=pending', { cache: 'no-store' });
      const pendingRows = pRes.ok ? await pRes.json() : [];
      const count = Array.isArray(pendingRows) ? pendingRows.length : 0;
      const appBtn = document.getElementById('inventory-approvals-btn');
      if (appBtn) appBtn.textContent = 'Pending Approvals (' + count + ')';
      const bannerHtml = count > 0
        ? '<div class="approval-banner"><div><strong>&#128276; ' + count + ' Manager Inventory Request' + (count === 1 ? '' : 's') + ' Pending Approval</strong><br><span style="font-size:13px">Review and approve/reject Manager stock changes before they take effect.</span></div><button type="button" class="btn btn-primary btn-sm" data-open-approvals="1">Review Pending Requests</button></div>'
        : '';
      ['inv-approval-banner', 'assets-approval-banner'].forEach(function (bid) {
        const banner = document.getElementById(bid);
        if (!banner) return;
        banner.innerHTML = bannerHtml;
        const openBtn = banner.querySelector('[data-open-approvals]');
        if (openBtn) {
          openBtn.addEventListener('click', function () {
            if (typeof window.openPendingApprovals === 'function') window.openPendingApprovals();
          });
        }
      });

      const tbody = document.getElementById('inventory-approvals-tbody');
      if (!tbody) return;
      const qs = statusFilter ? '?status=' + encodeURIComponent(statusFilter) : '';
      const res = await fetch(apiBase() + '/inventory/approvals' + qs, { cache: 'no-store' });
      const rows = res.ok ? await res.json() : [];
      const fmtDt = window.NardsUI && window.NardsUI.fmtDateTime
        ? window.NardsUI.fmtDateTime
        : function (v) { return String(v || '-'); };
      tbody.innerHTML = rows.length ? rows.map(function (r) {
        const stCls = r.status === 'approved' ? 'badge-success' : r.status === 'rejected' ? 'badge-danger' : 'badge-warning';
        return '<tr>' +
          '<td style="font-size:12px;white-space:nowrap">' + esc(fmtDt(r.created_at)) + '</td>' +
          '<td><strong>' + esc(r.requested_by) + '</strong></td>' +
          '<td><span class="badge badge-gold">' + esc(r.target_type === 'asset' ? 'Asset' : 'Ingredient') + '</span></td>' +
          '<td>' + esc(r.summary) + (r.review_notes ? '<br><small style="color:var(--text-muted)">Note: ' + esc(r.review_notes) + '</small>' : '') + '</td>' +
          '<td><span class="badge ' + stCls + '">' + esc(r.status) + '</span></td>' +
          '<td>' + (r.status === 'pending'
            ? '<div class="ops-actions"><button type="button" class="btn btn-success btn-sm" data-app-id="' + r.id + '" data-dec="approved">Approve</button><button type="button" class="btn btn-danger btn-sm" data-app-id="' + r.id + '" data-dec="rejected">Reject</button></div>'
            : '<small style="color:var(--text-muted)">By ' + esc(r.reviewed_by || '-') + '</small>') + '</td>' +
        '</tr>';
      }).join('') : '<tr><td colspan="6">No inventory approval requests found.</td></tr>';

      tbody.querySelectorAll('[data-app-id]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          reviewInventoryApproval(Number(btn.dataset.appId), btn.dataset.dec);
        });
      });
    } catch (e) {}
  }

  async function reviewInventoryApproval(id, decision) {
    let notes = '';
    if (window.Swal) {
      const res = await window.Swal.fire({
        title: (decision === 'approved' ? 'Approve' : 'Reject') + ' this inventory request?',
        input: 'text',
        inputLabel: 'Notes (optional)',
        showCancelButton: true,
        confirmButtonText: decision === 'approved' ? 'Approve & Apply' : 'Reject Request',
        confirmButtonColor: decision === 'approved' ? '#2d7a3a' : '#b42318'
      });
      if (!res.isConfirmed) return;
      notes = String(res.value || '').trim();
    }
    try {
      const res = await fetch(apiBase() + '/inventory/approvals/' + id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ decision, reviewNotes: notes })
      });
      const out = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (window.notify) window.notify(out.error || 'Could not review request.', '❌');
        return;
      }
      if (window.notify) window.notify(out.message || ('Request ' + decision + '.'), '✅');
      if (typeof window.syncInventoryFromAPI === 'function') await window.syncInventoryFromAPI();
      if (typeof window.fetchAssets === 'function') await window.fetchAssets();
      if (typeof window.renderInventory === 'function') window.renderInventory();
      if (typeof window.renderAssets === 'function') window.renderAssets();
      const af = document.getElementById('inv-app-status-filter');
      loadApprovalsList(af ? af.value : 'pending');
    } catch (e) {
      if (window.notify) window.notify('Could not reach the server.', '❌');
    }
  }

  window.openDisposeModal = async function (idx) {
    const ing = window.data && window.data.inventory && window.data.inventory[idx];
    if (!ing || !Number(ing.id)) return;
    if (Number(ing.stock) <= 0) {
      if (window.notify) window.notify('No remaining stock to dispose.', '⚠️');
      return;
    }
    let qty = Number(ing.stock);
    let reason = 'Expired / Spoiled stock disposed';
    if (window.Swal) {
      const res = await window.Swal.fire({
        title: 'Dispose Expired / Spoiled Stock',
        html:
          '<p style="font-size:13px;color:#666;margin:0 0 10px"><strong>' + esc(ing.name) + '</strong> (Available: ' + ing.stock + ' ' + esc(ing.unit || '') + ')</p>' +
          '<label style="display:block;text-align:left;font-size:12px;font-weight:700;margin-bottom:4px">Quantity to Dispose</label>' +
          '<input id="swal-disp-qty" type="number" min="1" max="' + ing.stock + '" value="' + ing.stock + '" style="width:100%;padding:8px 10px;border:1px solid #d5cfc6;border-radius:8px;box-sizing:border-box;margin-bottom:10px">' +
          '<label style="display:block;text-align:left;font-size:12px;font-weight:700;margin-bottom:4px">Reason</label>' +
          '<input id="swal-disp-reason" type="text" maxlength="180" value="Expired / Spoiled stock disposed" style="width:100%;padding:8px 10px;border:1px solid #d5cfc6;border-radius:8px;box-sizing:border-box">',
        showCancelButton: true,
        confirmButtonText: 'Confirm Disposal',
        confirmButtonColor: '#b42318',
        preConfirm: function () {
          const q = parseInt(document.getElementById('swal-disp-qty').value, 10);
          if (!Number.isInteger(q) || q < 1 || q > Number(ing.stock)) {
            window.Swal.showValidationMessage('Enter a quantity between 1 and ' + ing.stock + '.');
            return false;
          }
          return { quantity: q, reason: document.getElementById('swal-disp-reason').value.trim() || 'Expired / Spoiled stock disposed' };
        }
      });
      if (!res.isConfirmed || !res.value) return;
      qty = res.value.quantity;
      reason = res.value.reason;
    }
    try {
      const res = await fetch(apiBase() + '/inventory/' + ing.id + '/dispose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ quantity: qty, reason })
      });
      const out = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (window.notify) window.notify(out.error || 'Could not dispose stock.', '❌');
        return;
      }
      if (res.status === 202 || out.pendingApproval) {
        if (window.notify) window.notify(out.message || 'Disposal submitted for Administrator approval.', '⏳');
        return;
      }
      if (typeof window.syncInventoryFromAPI === 'function') await window.syncInventoryFromAPI();
      if (typeof window.renderInventory === 'function') window.renderInventory();
      if (window.notify) window.notify(out.message || 'Stock disposed.', '✅');
    } catch (e) {
      if (window.notify) window.notify('Could not reach the server.', '❌');
    }
  };

  window.openDamageAssetModal = async function (assetId) {
    const assets = Array.isArray(window.assetsList) ? window.assetsList : [];
    const asset = assets.find(function (a) { return a.id === assetId; });
    if (!asset || Number(asset.quantity) <= 0) {
      if (window.notify) window.notify('No usable stock left to mark damaged.', '⚠️');
      return;
    }
    let qty = 1;
    let notes = '';
    if (window.Swal) {
      const res = await window.Swal.fire({
        title: 'Report Damaged Asset',
        html:
          '<p style="font-size:13px;color:#666;margin:0 0 10px"><strong>' + esc(asset.name) + '</strong> (Usable: ' + asset.quantity + ' ' + esc(asset.unit || 'pcs') + ')</p>' +
          '<label style="display:block;text-align:left;font-size:12px;font-weight:700;margin-bottom:4px">Damaged Quantity</label>' +
          '<input id="swal-dmg-qty" type="number" min="1" max="' + asset.quantity + '" value="1" style="width:100%;padding:8px 10px;border:1px solid #d5cfc6;border-radius:8px;box-sizing:border-box;margin-bottom:10px">' +
          '<label style="display:block;text-align:left;font-size:12px;font-weight:700;margin-bottom:4px">Damage Notes</label>' +
          '<input id="swal-dmg-notes" type="text" maxlength="300" placeholder="e.g. Broken leg after event" style="width:100%;padding:8px 10px;border:1px solid #d5cfc6;border-radius:8px;box-sizing:border-box">',
        showCancelButton: true,
        confirmButtonText: 'Report Damage',
        confirmButtonColor: '#b42318',
        preConfirm: function () {
          const q = parseInt(document.getElementById('swal-dmg-qty').value, 10);
          if (!Number.isInteger(q) || q < 1 || q > Number(asset.quantity)) {
            window.Swal.showValidationMessage('Enter a quantity between 1 and ' + asset.quantity + '.');
            return false;
          }
          return { qty: q, notes: document.getElementById('swal-dmg-notes').value.trim() || 'Reported damaged' };
        }
      });
      if (!res.isConfirmed || !res.value) return;
      qty = res.value.qty;
      notes = res.value.notes;
    }
    try {
      const res = await fetch(apiBase() + '/assets/' + assetId + '/damage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ qty, notes })
      });
      const out = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (window.notify) window.notify(out.error || 'Could not report damage.', '❌');
        return;
      }
      if (res.status === 202 || out.pendingApproval) {
        if (window.notify) window.notify(out.message || 'Submitted for Administrator approval.', '⏳');
        return;
      }
      if (typeof window.renderAssets === 'function') await window.renderAssets();
      if (window.notify) window.notify(out.message || 'Damage recorded.', '✅');
    } catch (e) {
      if (window.notify) window.notify('Could not reach the server.', '❌');
    }
  };

  window.resolveAssetDamage = async function (assetId, action) {
    const assets = Array.isArray(window.assetsList) ? window.assetsList : [];
    const asset = assets.find(function (a) { return a.id === assetId; });
    if (!asset || Number(asset.damaged_qty) <= 0) return;
    let qty = Number(asset.damaged_qty);
    if (window.Swal) {
      const res = await window.Swal.fire({
        title: (action === 'repair' ? 'Repair & Return to Stock' : 'Write Off Damaged Assets'),
        input: 'number',
        inputLabel: 'Quantity (max ' + asset.damaged_qty + ')',
        inputValue: asset.damaged_qty,
        inputAttributes: { min: 1, max: asset.damaged_qty, step: 1 },
        showCancelButton: true,
        confirmButtonText: action === 'repair' ? 'Mark Repaired' : 'Write Off',
        confirmButtonColor: action === 'repair' ? '#2d7a3a' : '#b42318',
        inputValidator: function (val) {
          const n = Number(val);
          if (!Number.isInteger(n) || n < 1 || n > Number(asset.damaged_qty)) return 'Enter between 1 and ' + asset.damaged_qty;
        }
      });
      if (!res.isConfirmed) return;
      qty = Number(res.value);
    }
    try {
      const res = await fetch(apiBase() + '/assets/' + assetId + '/damage/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, qty })
      });
      const out = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        if (window.notify) window.notify(out.error || 'Could not update damaged asset.', '❌');
        return;
      }
      if (res.status === 202 || out.pendingApproval) {
        if (window.notify) window.notify(out.message || 'Submitted for Administrator approval.', '⏳');
        return;
      }
      if (typeof window.renderAssets === 'function') await window.renderAssets();
      if (window.notify) window.notify(out.message || 'Updated.', '✅');
    } catch (e) {
      if (window.notify) window.notify('Could not reach the server.', '❌');
    }
  };

  window.loadInventoryReadiness = async function () {
    const box = document.getElementById('inv-readiness-banner');
    if (!box) return;
    try {
      const res = await fetch(apiBase() + '/inventory/readiness?days=14', { cache: 'no-store' });
      const data = await res.json().catch(function () { return null; });
      if (!res.ok || !data) return;
      if (!data.upcomingEvents) {
        box.innerHTML = '<div class="alert" style="background:#f6f1e7;border:1px solid #e5d7be;color:#654f2b"><span class="alert-icon">&#128197;</span><div><strong>Upcoming Event Stock Readiness:</strong> No confirmed events scheduled in the next 14 days.</div></div>';
        return;
      }
      if (data.shortages && data.shortages.length) {
        const list = data.shortages.slice(0, 6).map(function (s) {
          return esc(s.name) + ' (need ' + s.required_qty + ', current ' + s.current_stock + ')';
        }).join(', ');
        box.innerHTML = '<div class="alert alert-danger"><span class="alert-icon">&#9888;&#65039;</span><div><strong>Stock Forecast Warning (' + data.upcomingEvents + ' upcoming confirmed event' + (data.upcomingEvents === 1 ? '' : 's') + '):</strong> Restock needed for ' + list + '.</div></div>';
      } else {
        box.innerHTML = '<div class="alert" style="background:#edf7f0;border:1px solid #bce0c7;color:#1e5c31"><span class="alert-icon">&#9989;</span><div><strong>Upcoming Event Readiness (' + data.upcomingEvents + ' confirmed event' + (data.upcomingEvents === 1 ? '' : 's') + ' in next 14 days):</strong> Current ingredient and asset stocks are sufficient.</div></div>';
      }
    } catch (e) {}
  };

  /* ------------------------------------------ 3. Enhanced Business Reports */
  function ensureReportsSections() {
    const viewRep = document.getElementById('view-reports');
    if (!viewRep) return;
    const grid = viewRep.querySelector('.stats-grid');
    if (grid && !document.getElementById('rep-profit-15')) {
      grid.style.gridTemplateColumns = 'repeat(5,1fr)';
      grid.insertAdjacentHTML('beforeend',
        '<div class="stat-card stat-accent"><div class="stat-label">Net Profit (15%)</div><div class="stat-value" id="rep-profit-15">&#8369;0</div></div>' +
        '<div class="stat-card stat-accent"><div class="stat-label">Event Expenses</div><div class="stat-value" id="rep-expenses">&#8369;0</div></div>'
      );
    }
    if (!document.getElementById('rep-liquidation-card')) {
      const card = document.createElement('div');
      card.className = 'card';
      card.id = 'rep-liquidation-card';
      card.style.marginTop = '20px';
      card.innerHTML =
        '<div class="card-title">Sales &amp; Per-Event Liquidation (Completed Events)</div>' +
        '<div class="table-wrap"><table><thead>' +
          '<tr><th>Booking ID</th><th>Date</th><th>Client &amp; Event</th><th>Gross Sale</th><th>Expenses</th><th>15% Profit</th><th>Actual Net</th><th>Notes</th></tr>' +
        '</thead><tbody id="rep-liquidation-tbody"></tbody></table></div>';
      viewRep.appendChild(card);

      const invCard = document.createElement('div');
      invCard.className = 'card';
      invCard.id = 'rep-inv-detail-card';
      invCard.style.marginTop = '20px';
      invCard.innerHTML =
        '<div class="card-title">Inventory, Perishables &amp; Damaged Assets Report</div>' +
        '<div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">' +
          '<div class="stat-card"><div class="stat-label">Perishable Items</div><div class="stat-value" id="rep-perish-count">0</div></div>' +
          '<div class="stat-card"><div class="stat-label">Expiring / Expired</div><div class="stat-value" id="rep-expiring-count">0</div></div>' +
          '<div class="stat-card"><div class="stat-label">Damaged Asset Units</div><div class="stat-value" id="rep-damaged-count">0</div></div>' +
          '<div class="stat-card"><div class="stat-label">Total Stock Cost Value</div><div class="stat-value" id="rep-inv-value">&#8369;0</div></div>' +
        '</div>' +
        '<div class="table-wrap"><table><thead>' +
          '<tr><th>Item</th><th>Category</th><th>Stock</th><th>Perishable / Expiry</th><th>Stock Status</th><th>Supplier</th></tr>' +
        '</thead><tbody id="rep-inv-detail-tbody"></tbody></table></div>';
      viewRep.appendChild(invCard);

      const projCard = document.createElement('div');
      projCard.className = 'card';
      projCard.id = 'rep-proj-card';
      projCard.style.marginTop = '20px';
      projCard.innerHTML =
        '<div class="card-title">Financial Projections &amp; Pipeline Outlook</div>' +
        '<div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:10px">' +
          '<div class="stat-card stat-accent"><div class="stat-label">Confirmed Pipeline Sales</div><div class="stat-value" id="rep-proj-confirmed">&#8369;0</div></div>' +
          '<div class="stat-card"><div class="stat-label">Pending Pipeline</div><div class="stat-value" id="rep-proj-pending">&#8369;0</div></div>' +
          '<div class="stat-card stat-accent"><div class="stat-label">Next-Month Projected Sales</div><div class="stat-value" id="rep-proj-next">&#8369;0</div></div>' +
          '<div class="stat-card stat-accent"><div class="stat-label">Projected 15% Net Profit</div><div class="stat-value" id="rep-proj-profit">&#8369;0</div></div>' +
        '</div>' +
        '<p id="rep-proj-note" style="margin:6px 0 0;font-size:13px;color:var(--text-muted)"></p>';
      viewRep.appendChild(projCard);
    }

    const sheet = document.getElementById('reports-print-sheet');
    if (sheet && !document.getElementById('rep-print-liquidation')) {
      sheet.insertAdjacentHTML('beforeend',
        '<h2>Completed Event Sales &amp; Liquidation</h2>' +
        '<table class="report-print-table"><thead>' +
          '<tr><th>Booking ID</th><th>Date</th><th>Client</th><th>Event</th><th>Gross Sale</th><th>Expenses</th><th>15% Profit</th><th>Actual Net</th></tr>' +
        '</thead><tbody id="rep-print-liquidation"></tbody></table>' +
        '<h2>Financial Projections</h2>' +
        '<table class="report-print-table"><thead>' +
          '<tr><th>Confirmed Pipeline</th><th>Pending Pipeline</th><th>Next-Month Projected Sales</th><th>Projected 15% Profit</th></tr>' +
        '</thead><tbody id="rep-print-projections"></tbody></table>'
      );
    }
  }

  /* ---------------------------------------- 4. Admin Booking Advisory Card */
  function ensureAdvisoryCard() {
    const viewStaff = document.getElementById('view-staff');
    const user = currentUser();
    if (!viewStaff || user.role !== 'admin' || document.getElementById('booking-advisory-card')) return;
    const card = document.createElement('div');
    card.className = 'card';
    card.id = 'booking-advisory-card';
    card.style.padding = '18px';
    card.style.marginBottom = '16px';
    card.innerHTML =
      '<h3 style="margin-top:0">Customer News &amp; Online Booking Advisory</h3>' +
      '<p style="margin:0 0 12px;font-size:13px;color:var(--text-muted)">Control the News &amp; Advisories announcement on the customer site and pause or open online reservations.</p>' +
      '<div class="form-group" style="margin-bottom:10px"><label style="display:flex;align-items:center;gap:8px;cursor:pointer"><input id="adv-active" type="checkbox" style="width:auto"> Show "Online Bookings Temporarily Unavailable" Advisory (Pause Customer Booking Form)</label></div>' +
      '<div class="form-group" style="margin-bottom:10px"><label for="adv-title">Advisory Headline</label><input id="adv-title" type="text" maxlength="140"></div>' +
      '<div class="form-group" style="margin-bottom:12px"><label for="adv-message">Professional Advisory Message</label><textarea id="adv-message" rows="4" maxlength="1500"></textarea></div>' +
      '<button type="button" class="btn btn-primary" id="adv-save-btn">Save Advisory</button>';
    viewStaff.prepend(card);

    fetch(apiBase() + '/settings/booking-advisory', { cache: 'no-store' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (adv) {
        if (!adv) return;
        document.getElementById('adv-active').checked = Boolean(adv.active);
        document.getElementById('adv-title').value = adv.title || '';
        document.getElementById('adv-message').value = adv.message || '';
      }).catch(function () {});

    document.getElementById('adv-save-btn').addEventListener('click', async function () {
      const active = document.getElementById('adv-active').checked;
      const title = document.getElementById('adv-title').value.trim();
      const message = document.getElementById('adv-message').value.trim();
      try {
        const res = await fetch(apiBase() + '/settings/booking-advisory', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ active, title, message })
        });
        const out = await res.json().catch(function () { return {}; });
        if (window.notify) window.notify(res.ok ? (out.message || 'Advisory updated.') : (out.error || 'Could not save advisory.'), res.ok ? '✅' : '❌');
      } catch (e) {
        if (window.notify) window.notify('Could not reach the server.', '❌');
      }
    });
  }

  /* ---------------------------------------- 5. Printable Event Sheet */
  window.printBookingEventSheet = function (booking) {
    if (!booking) return;
    const pkgs = Array.isArray(window.packagesList) ? window.packagesList : [];
    const pkg = pkgs.find(function (p) { return p.name === booking.package; });
    const team = Array.isArray(booking.assignedEmployees) ? booking.assignedEmployees : [];
    const total = Number(booking.amount) || 0;
    const dp = Number(booking.dp) || Math.round(total * 0.2);
    const expenses = Number(booking.expenseAmount) || 0;
    const profit15 = Number((total * 0.15).toFixed(2));
    const actualNet = Number((total - expenses).toFixed(2));
    const dishesHtml = pkg && Array.isArray(pkg.dishes) && pkg.dishes.length
      ? pkg.dishes.map(function (d) { return '<li>' + esc(d.name) + ' <small>(' + esc(d.category) + ')</small></li>'; }).join('')
      : '<li>See package configuration</li>';
    const assetsHtml = pkg && Array.isArray(pkg.assets) && pkg.assets.length
      ? pkg.assets.map(function (a) { return '<li>&#9744; ' + esc(a.name) + ' &times; ' + esc(a.qty_required) + ' ' + esc(a.unit || 'pcs') + '</li>'; }).join('')
      : '<li>No package assets listed</li>';
    const freebiesHtml = pkg && Array.isArray(pkg.freebies) && pkg.freebies.length
      ? pkg.freebies.map(function (f) { return '<li>' + esc(f.name) + '</li>'; }).join('')
      : '<li>None</li>';
    const teamHtml = team.length
      ? team.map(function (m) { return '<li>' + esc(m.name) + ' &mdash; ' + esc(m.job_role || 'Crew') + '</li>'; }).join('')
      : '<li>No crew assigned yet</li>';

    const win = window.open('', '_blank', 'width=860,height=740');
    if (!win) {
      if (window.notify) window.notify('Allow pop-ups to open the printable Event Sheet.', '⚠️');
      return;
    }
    win.document.write(
      '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Event Sheet - ' + esc(booking.id) + '</title>' +
      '<style>body{font-family:Segoe UI,Arial,sans-serif;color:#222;margin:28px;line-height:1.45}' +
      '.hdr{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #8d6a36;padding-bottom:10px;margin-bottom:18px}' +
      '.brand{font-size:22px;font-weight:700;color:#6c4f24}.meta{text-align:right;font-size:12px;color:#666}' +
      '.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 20px;margin-bottom:16px;font-size:13px}' +
      '.box{border:1px solid #ddd;border-radius:8px;padding:12px;margin-bottom:14px}' +
      '.box h3{margin:0 0 8px;font-size:14px;color:#6c4f24;text-transform:uppercase;letter-spacing:.4px}' +
      'ul{margin:0;padding-left:18px;font-size:13px}li{margin:2px 0}' +
      'table{width:100%;border-collapse:collapse;font-size:13px}td,th{border:1px solid #ddd;padding:6px 8px;text-align:left}' +
      '@media print{button{display:none!important}}</style></head><body>' +
      '<div class="hdr"><div><div class="brand">Nard\'s Catering &amp; Setup</div><div>Event Operations &amp; Liquidation Sheet</div></div>' +
      '<div class="meta"><strong>' + esc(booking.id) + '</strong><br>Status: ' + esc(booking.status) + '<br>Printed: ' + esc(new Date().toLocaleString('en-PH')) + '</div></div>' +
      '<div class="grid">' +
        '<div><strong>Client:</strong> ' + esc(booking.client) + '</div>' +
        '<div><strong>Phone:</strong> ' + esc(booking.phone) + '</div>' +
        '<div><strong>Event:</strong> ' + esc(booking.event) + ' (' + esc(booking.guests || 0) + ' pax)</div>' +
        '<div><strong>Date &amp; Time:</strong> ' + esc(booking.date) + ' ' + esc(booking.time || '') + '</div>' +
        '<div style="grid-column:1/-1"><strong>Venue / Address:</strong> ' + esc(booking.venue || 'TBD') + '</div>' +
        '<div><strong>Package:</strong> ' + esc(booking.package || 'TBD') + '</div>' +
        '<div><strong>Payment:</strong> ' + (booking.paid ? 'Paid' : booking.paymentProof ? 'Receipt Submitted' : 'Unpaid') + (booking.gcashRef ? ' (Ref: ' + esc(booking.gcashRef) + ')' : '') + '</div>' +
      '</div>' +
      '<div class="grid">' +
        '<div class="box"><h3>Menu Dishes</h3><ul>' + dishesHtml + '</ul></div>' +
        '<div class="box"><h3>Catering Assets Dispatch &amp; Return Checklist</h3><ul>' + assetsHtml + '</ul></div>' +
        '<div class="box"><h3>Freebies / Inclusions</h3><ul>' + freebiesHtml + '</ul></div>' +
        '<div class="box"><h3>Assigned Crew (' + team.length + ')</h3><ul>' + teamHtml + '</ul></div>' +
      '</div>' +
      (booking.addReq || booking.notes ? '<div class="box"><h3>Special Requests &amp; Notes</h3>' +
        (booking.addReq ? '<div><strong>Additional Request:</strong> ' + esc(booking.addReq) + '</div>' : '') +
        (booking.notes ? '<div><strong>Notes:</strong> ' + esc(booking.notes) + '</div>' : '') + '</div>' : '') +
      '<div class="box"><h3>Financial &amp; Liquidation Summary</h3><table><thead><tr><th>Total Contract</th><th>20% Down Payment</th><th>Recorded Expenses</th><th>Est. 15% Profit</th><th>Actual Net (After Expenses)</th></tr></thead>' +
      '<tbody><tr><td>' + esc(money(total)) + '</td><td>' + esc(money(dp)) + '</td><td>' + esc(money(expenses)) + '</td><td>' + esc(money(profit15)) + '</td><td><strong>' + esc(money(actualNet)) + '</strong></td></tr></tbody></table>' +
      (booking.liquidationNotes ? '<p style="font-size:12px;margin:8px 0 0"><strong>Liquidation Notes:</strong> ' + esc(booking.liquidationNotes) + '</p>' : '') +
      '</div>' +
      '<div style="text-align:right;margin-top:16px"><button onclick="window.print()" style="padding:8px 16px;background:#8d6a36;color:#fff;border:0;border-radius:6px;cursor:pointer">Print Event Sheet</button></div>' +
      '</body></html>'
    );
    win.document.close();
  };

  /* ------------------------------------------- 6. Hook existing portal APIs */
  function installHooks() {
    ensureInventoryEnhancements();
    ensureReportsSections();
    ensureAdvisoryCard();

    if (typeof window.setInventoryArchiveView === 'function' && !window.setInventoryArchiveView._wrappedOps) {
      const origArch = window.setInventoryArchiveView;
      window.setInventoryArchiveView = function () {
        setInvMode('items');
        return origArch.apply(this, arguments);
      };
      window.setInventoryArchiveView._wrappedOps = true;
    }

    if (typeof window.setAssetArchiveView === 'function' && !window.setAssetArchiveView._wrappedOps) {
      const origAssetArch = window.setAssetArchiveView;
      window.setAssetArchiveView = function (showArchive) {
        setAssetMode(showArchive ? 'archive' : 'active');
        return origAssetArch.apply(this, arguments);
      };
      window.setAssetArchiveView._wrappedOps = true;
    }

    window.renderInventory = function () {
      ensureInventoryEnhancements();
      const invList = window.data && Array.isArray(window.data.inventory) ? window.data.inventory : [];
      const search = (document.getElementById('inv-search')?.value || '').toLowerCase();
      const arch = Boolean(window.inventoryArchiveView);
      const items = invList.filter(function (i) {
        if (Boolean(i.archived) !== arch) return false;
        if (!arch && inventoryPerishableFilter === 'perishable' && !i.isPerishable) return false;
        if (!arch && inventoryPerishableFilter === 'expiring') {
          const ex = window.getExpiryInfo(i);
          if (ex.key !== 'expired' && ex.key !== 'soon') return false;
        }
        return !search || String(i.name || '').toLowerCase().includes(search) || String(i.category || '').toLowerCase().includes(search) || String(i.supplier || '').toLowerCase().includes(search);
      });

      const tbody = document.getElementById('inventory-tbody');
      if (tbody) {
        const archivedCount = invList.filter(function (i) { return Boolean(i.archived); }).length;
        const emptyHtml = arch
          ? '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">&#129474;</div><p>No archived ingredients.</p></div></td></tr>'
          : (!search && inventoryPerishableFilter === 'all' && archivedCount > 0
              ? '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">&#129474;</div><p>No active ingredients.</p><p style="font-size:12.5px;color:var(--text-muted);margin-top:4px">You have <strong>' + archivedCount + '</strong> archived ingredient(s) in the Archive tab.</p><button type="button" class="btn btn-outline btn-sm" style="margin-top:10px" onclick="setInventoryArchiveView(true)">Open Archive (' + archivedCount + ')</button></div></td></tr>'
              : '<tr><td colspan="8"><div class="empty-state"><div class="empty-icon">&#129474;</div><p>No matching ingredients found.</p></div></td></tr>');
        tbody.innerHTML = items.length ? items.map(function (i) {
          const realIdx = invList.indexOf(i);
          const s = typeof window.stockStatus === 'function' ? window.stockStatus(i) : { label: 'OK', cls: 'badge-success', fillCls: 'fill-success', pct: 100 };
          const ex = window.getExpiryInfo(i);
          const expPill = ex.cls
            ? '<span class="badge ' + ex.cls + '">' + esc(ex.label) + '</span>'
            : '<span class="badge" style="' + (ex.style || '') + '">' + esc(ex.label) + '</span>';
          const expDateLine = i.isPerishable && i.expiryDate ? '<br><small style="color:var(--text-muted)">Exp: ' + esc(i.expiryDate) + '</small>' : '';
          const metaLine = esc(i.category || 'Other') + (i.supplier ? ' &middot; ' + esc(i.supplier) : '') + (Number(i.costPerUnit) > 0 ? ' &middot; ' + money(i.costPerUnit) + '/' + esc(i.unit || 'pc') : '');
          const actionsHtml = arch
            ? '<button class="btn btn-success btn-sm" onclick="restoreIngredient(' + realIdx + ')">Restore</button>'
            : '<div class="ops-actions">' +
                '<button class="btn btn-success btn-sm" onclick="openRestockModal(' + realIdx + ')">+ Restock</button>' +
                '<button class="btn btn-outline btn-sm" onclick="openIngredientModal(' + realIdx + ')">Edit</button>' +
                (i.isPerishable && Number(i.stock) > 0 && (ex.key === 'expired' || ex.key === 'soon')
                  ? '<button class="btn btn-warning btn-sm" style="background:#b45309;color:#fff;border:0" onclick="openDisposeModal(' + realIdx + ')">Dispose</button>' : '') +
                '<button class="btn btn-danger btn-sm" onclick="deleteIngredient(' + realIdx + ')">Archive</button>' +
              '</div>';
          return '<tr>' +
            '<td><strong>' + esc(i.name) + '</strong><br><small style="color:var(--text-muted)">' + metaLine + '</small></td>' +
            '<td><strong>' + esc(i.stock) + '</strong> ' + esc(i.unit || '') + '</td>' +
            '<td>' + esc(i.min) + ' / ' + esc(i.good) + '</td>' +
            '<td>' + expPill + expDateLine + '</td>' +
            '<td style="min-width:110px"><div style="font-size:12px;color:var(--text-muted)">' + Math.round(s.pct) + '%</div><div class="progress-bar"><div class="progress-fill ' + s.fillCls + '" style="width:' + s.pct + '%"></div></div></td>' +
            '<td>' + (arch ? '<span class="badge badge-warning">Archived</span>' : '<span class="badge ' + s.cls + '">' + esc(s.label) + '</span>') + '</td>' +
            '<td style="font-size:12px;color:var(--text-muted)">' + esc(arch ? (i.archivedAt || i.updated || '-') : (i.updated || '-')) + '</td>' +
            '<td>' + actionsHtml + '</td>' +
          '</tr>';
        }).join('') : emptyHtml;
      }

      const activeBtn = document.getElementById('inventory-active-btn');
      const archBtn = document.getElementById('inventory-archive-btn');
      if (activeBtn) activeBtn.className = 'btn ' + (!arch && inventoryMode === 'items' ? 'btn-primary' : 'btn-outline');
      if (archBtn) archBtn.className = 'btn ' + (arch && inventoryMode === 'items' ? 'btn-primary' : 'btn-outline');

      const activeInventory = invList.filter(function (i) { return !i.archived; });
      const critical = activeInventory.filter(function (i) { return typeof window.stockStatus === 'function' && window.stockStatus(i).key === 'critical'; });
      const low = activeInventory.filter(function (i) { return typeof window.stockStatus === 'function' && window.stockStatus(i).key === 'low'; });
      const expired = activeInventory.filter(function (i) { return window.getExpiryInfo(i).key === 'expired' && Number(i.stock) > 0; });
      const expiring = activeInventory.filter(function (i) { return window.getExpiryInfo(i).key === 'soon' && Number(i.stock) > 0; });
      let html = '';
      if (expired.length) html += '<div class="alert alert-danger"><span class="alert-icon">&#9200;</span><div><strong>Expired Perishables!</strong> ' + expired.map(function (i) { return esc(i.name) + ' (' + esc(i.expiryDate) + ')'; }).join(', ') + ' — dispose or replace before event prep.</div></div>';
      if (expiring.length) html += '<div class="alert alert-warning"><span class="alert-icon">&#9888;&#65039;</span><div><strong>Expiring Soon (within 3 days):</strong> ' + expiring.map(function (i) { return esc(i.name) + ' (' + esc(i.expiryDate) + ')'; }).join(', ') + '.</div></div>';
      if (critical.length) html += '<div class="alert alert-danger"><span class="alert-icon">&#128680;</span><div><strong>Critical Stock!</strong> ' + critical.map(function (i) { return esc(i.name); }).join(', ') + ' — needs immediate restocking.</div></div>';
      if (low.length) html += '<div class="alert alert-warning"><span class="alert-icon">&#9888;&#65039;</span><div><strong>Low Stock Warning:</strong> ' + low.map(function (i) { return esc(i.name); }).join(', ') + ' are running low.</div></div>';
      const alertsBox = document.getElementById('inv-alerts');
      if (alertsBox) alertsBox.innerHTML = html;

      window.loadInventoryReadiness();
      loadApprovalsList('pending');
      if (inventoryMode === 'log') {
        const f = document.getElementById('inv-log-type-filter');
        loadMovementLog('inventory-log-tbody', f ? f.value : '');
      }
    };
    window.renderInventory._wrappedOps = true;

    window.renderAssets = async function () {
      ensureInventoryEnhancements();
      if (typeof window.fetchAssets === 'function') await window.fetchAssets();
      const assets = Array.isArray(window.assetsList) ? window.assetsList : [];
      const search = (document.getElementById('asset-search')?.value || '').toLowerCase();
      const active = assets.filter(function (a) { return !Number(a.is_archived) && (!search || String(a.name || '').toLowerCase().includes(search)); });
      const archived = assets.filter(function (a) { return Number(a.is_archived); });
      const damaged = assets.filter(function (a) { return !Number(a.is_archived) && Number(a.damaged_qty) > 0; });

      const tbody = document.getElementById('assets-tbody');
      if (tbody) {
        tbody.innerHTML = active.length ? active.map(function (a) {
          const dmgBadge = Number(a.damaged_qty) > 0
            ? '<span class="badge badge-danger">' + Number(a.damaged_qty) + ' damaged</span>'
            : '<span style="color:var(--text-muted)">0</span>';
          return '<tr>' +
            '<td><strong>' + esc(a.name) + '</strong></td>' +
            '<td><strong>' + esc(a.quantity) + '</strong></td>' +
            '<td>' + dmgBadge + '</td>' +
            '<td>' + esc(a.unit || 'pcs') + '</td>' +
            '<td><div class="ops-actions">' +
              '<button class="btn btn-outline btn-sm" onclick="openAssetModal(' + a.id + ')">Edit</button>' +
              (Number(a.quantity) > 0 ? '<button class="btn btn-outline btn-sm" style="color:#b42318;border-color:#f3c6c3" onclick="openDamageAssetModal(' + a.id + ')">Report Damage</button>' : '') +
              '<button class="btn btn-danger btn-sm" onclick="deleteAsset(' + a.id + ')">Archive</button>' +
            '</div></td>' +
          '</tr>';
        }).join('') : '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">&#129681;</div><p>No assets yet. Add your first catering asset.</p></div></td></tr>';
      }

      const archBody = document.getElementById('assets-archive-tbody');
      if (archBody) {
        archBody.innerHTML = archived.length ? archived.map(function (a) {
          return '<tr><td><strong>' + esc(a.name) + '</strong></td><td>' + esc(a.quantity) + '</td><td>' + esc(a.unit) + '</td><td style="font-size:12px;color:var(--text-muted)">Archived</td><td><button class="btn btn-success btn-sm" onclick="restoreAsset(' + a.id + ')">Restore</button></td></tr>';
        }).join('') : '<tr><td colspan="5"><div class="empty-state"><div class="empty-icon">&#128230;</div><p>No archived assets.</p></div></td></tr>';
      }

      const dmgBtn = document.getElementById('assets-damaged-btn');
      if (dmgBtn) dmgBtn.textContent = 'Damaged Assets (' + damaged.length + ')';
      const dmgBody = document.getElementById('assets-damaged-tbody');
      if (dmgBody) {
        dmgBody.innerHTML = damaged.length ? damaged.map(function (a) {
          return '<tr>' +
            '<td><strong>' + esc(a.name) + '</strong></td>' +
            '<td>' + esc(a.quantity) + '</td>' +
            '<td><span class="badge badge-danger">' + esc(a.damaged_qty) + '</span></td>' +
            '<td>' + esc(a.unit || 'pcs') + '</td>' +
            '<td>' + esc(a.damage_notes || '-') + '</td>' +
            '<td><div class="ops-actions">' +
              '<button class="btn btn-success btn-sm" onclick="resolveAssetDamage(' + a.id + ', \'repair\')">Mark Repaired</button>' +
              '<button class="btn btn-danger btn-sm" onclick="resolveAssetDamage(' + a.id + ', \'writeoff\')">Write Off</button>' +
            '</div></td>' +
          '</tr>';
        }).join('') : '<tr><td colspan="6"><div class="empty-state"><div class="empty-icon">&#9989;</div><p>No damaged assets reported.</p></div></td></tr>';
      }

      if (assetMode === 'log') loadMovementLog('assets-log-tbody', 'asset');
      else setAssetMode(window.assetArchiveView ? 'archive' : (assetMode === 'damaged' ? 'damaged' : 'active'));
      loadApprovalsList('pending');
    };
    window.renderAssets._wrappedOps = true;

    if (typeof window.renderReports === 'function' && !window.renderReports._wrappedOps) {
      const origRenderRep = window.renderReports;
      window.renderReports = function () {
        ensureReportsSections();
        origRenderRep.apply(this, arguments);
        const bookings = window.data && Array.isArray(window.data.bookings) ? window.data.bookings : [];
        const inv = window.data && Array.isArray(window.data.inventory) ? window.data.inventory.filter(function (i) { return !i.archived; }) : [];
        const assets = Array.isArray(window.assetsList) ? window.assetsList.filter(function (a) { return !Number(a.is_archived); }) : [];

        const completedBookings = bookings.filter(function (b) { return b.status === 'Completed'; });
        const confirmedBookings = bookings.filter(function (b) { return b.status === 'Confirmed' && !b.archived; });
        const pendingBookings = bookings.filter(function (b) { return b.status === 'Pending' && !b.archived; });

        const totalRev = completedBookings.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
        const totalExp = completedBookings.reduce(function (s, b) { return s + (Number(b.expenseAmount) || 0); }, 0);
        const profit15 = Number((totalRev * 0.15).toFixed(2));
        const completedCount = completedBookings.length;
        const avg = completedCount ? Math.round(totalRev / completedCount) : 0;

        const setTxt = function (id, txt) { var el = document.getElementById(id); if (el) el.textContent = txt; };
        setTxt('rep-total-rev', money(totalRev));
        setTxt('rep-completed', String(completedCount));
        setTxt('rep-avg', money(avg));
        setTxt('rep-profit-15', money(profit15));
        setTxt('rep-expenses', money(totalExp));
        setTxt('rep-print-total-rev', money(totalRev));
        setTxt('rep-print-completed', String(completedCount));
        setTxt('rep-print-avg', money(avg));

        // Inventory + Perishables + Damaged summary in Reports
        const perishCount = inv.filter(function (i) { return i.isPerishable; }).length;
        const expSoonOrExpired = inv.filter(function (i) { const k = window.getExpiryInfo(i).key; return (k === 'expired' || k === 'soon') && Number(i.stock) > 0; }).length;
        const dmgUnits = assets.reduce(function (s, a) { return s + (Number(a.damaged_qty) || 0); }, 0);
        const stockVal = inv.reduce(function (s, i) { return s + (Number(i.stock) || 0) * (Number(i.costPerUnit) || 0); }, 0);
        setTxt('rep-perish-count', String(perishCount));
        setTxt('rep-expiring-count', String(expSoonOrExpired));
        setTxt('rep-damaged-count', String(dmgUnits));
        setTxt('rep-inv-value', money(Number(stockVal.toFixed(2))));

        const invTbody = document.getElementById('rep-inv-detail-tbody');
        if (invTbody) {
          invTbody.innerHTML = inv.length ? inv.map(function (i) {
            const st = typeof window.stockStatus === 'function' ? window.stockStatus(i) : { label: 'OK', cls: 'badge-success' };
            const ex = window.getExpiryInfo(i);
            return '<tr><td><strong>' + esc(i.name) + '</strong></td><td>' + esc(i.category || 'Other') + '</td><td>' + esc(i.stock) + ' ' + esc(i.unit || '') + '</td><td>' + esc(ex.label) + (i.expiryDate ? ' (' + esc(i.expiryDate) + ')' : '') + '</td><td><span class="badge ' + st.cls + '">' + esc(st.label) + '</span></td><td>' + esc(i.supplier || '-') + '</td></tr>';
          }).join('') : '<tr><td colspan="6">No active inventory items.</td></tr>';
        }

        // Financial Projections
        const confirmedPipeline = confirmedBookings.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
        const pendingPipeline = pendingBookings.reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
        const now = new Date();
        const nextMonthDate = new Date(now.getFullYear(), now.getMonth() + 1, 1);
        const nextPrefix = nextMonthDate.getFullYear() + '-' + String(nextMonthDate.getMonth() + 1).padStart(2, '0');
        const nextMonthConfirmed = confirmedBookings.filter(function (b) { return String(b.date || '').slice(0, 7) === nextPrefix; }).reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0);
        const recentMonths = new Set();
        for (let m = 1; m <= 3; m++) {
          const d = new Date(now.getFullYear(), now.getMonth() - m, 1);
          recentMonths.add(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
        }
        const trailingAvg = Math.round(completedBookings.filter(function (b) { return recentMonths.has(String(b.date || '').slice(0, 7)); }).reduce(function (s, b) { return s + (Number(b.amount) || 0); }, 0) / 3);
        const projectedNextSales = nextMonthConfirmed + Math.round(pendingPipeline * 0.5) + (nextMonthConfirmed ? 0 : trailingAvg);
        const projected15Profit = Number((projectedNextSales * 0.15).toFixed(2));

        setTxt('rep-proj-confirmed', money(confirmedPipeline));
        setTxt('rep-proj-pending', money(pendingPipeline));
        setTxt('rep-proj-next', money(projectedNextSales));
        setTxt('rep-proj-profit', money(projected15Profit));
        setTxt('rep-proj-note', 'Based on ' + confirmedBookings.length + ' confirmed event(s) in pipeline, 50% conversion weight on ' + pendingBookings.length + ' pending request(s), and trailing 3-month completed average (' + money(trailingAvg) + '/mo).');

        const printProj = document.getElementById('rep-print-projections');
        if (printProj) {
          printProj.innerHTML = '<tr><td>' + esc(money(confirmedPipeline)) + '</td><td>' + esc(money(pendingPipeline)) + '</td><td>' + esc(money(projectedNextSales)) + '</td><td>' + esc(money(projected15Profit)) + '</td></tr>';
        }

        const liqBody = document.getElementById('rep-liquidation-tbody');
        const printLiq = document.getElementById('rep-print-liquidation');
        const sorted = completedBookings.slice().sort(function (a, b) { return String(b.date || '').localeCompare(String(a.date || '')); });
        if (liqBody) {
          liqBody.innerHTML = sorted.length ? sorted.map(function (b) {
            const amt = Number(b.amount) || 0;
            const exp = Number(b.expenseAmount) || 0;
            const p15 = Number((amt * 0.15).toFixed(2));
            const net = Number((amt - exp).toFixed(2));
            return '<tr>' +
              '<td><span class="badge badge-gold">' + esc(b.id) + '</span></td>' +
              '<td>' + esc(b.date || '-') + '</td>' +
              '<td><strong>' + esc(b.client) + '</strong><br><span style="font-size:12px;color:var(--text-muted)">' + esc(b.event) + '</span></td>' +
              '<td>' + esc(money(amt)) + '</td>' +
              '<td>' + esc(money(exp)) + '</td>' +
              '<td>' + esc(money(p15)) + '</td>' +
              '<td><strong>' + esc(money(net)) + '</strong></td>' +
              '<td style="font-size:12px">' + esc(b.liquidationNotes || '-') + '</td>' +
            '</tr>';
          }).join('') : '<tr><td colspan="8">No completed events recorded yet.</td></tr>';
        }
        if (printLiq) {
          printLiq.innerHTML = sorted.length ? sorted.map(function (b) {
            const amt = Number(b.amount) || 0;
            const exp = Number(b.expenseAmount) || 0;
            const p15 = Number((amt * 0.15).toFixed(2));
            const net = Number((amt - exp).toFixed(2));
            return '<tr><td>' + esc(b.id) + '</td><td>' + esc(b.date || '-') + '</td><td>' + esc(b.client) + '</td><td>' + esc(b.event) + '</td><td>' + esc(money(amt)) + '</td><td>' + esc(money(exp)) + '</td><td>' + esc(money(p15)) + '</td><td>' + esc(money(net)) + '</td></tr>';
          }).join('') : '<tr><td colspan="8">No completed events recorded yet.</td></tr>';
        }
      };
      window.renderReports._wrappedOps = true;
    }

    if (typeof window.showConfirmation === 'function' && !window.showConfirmation._wrappedOps) {
      const origShow = window.showConfirmation;
      window.showConfirmation = function (booking) {
        const res = origShow.apply(this, arguments);
        const actions = document.querySelector('#confirm-modal .modal-actions');
        if (actions && booking) {
          const oldSheet = actions.querySelector('[data-op="event-sheet"]');
          if (oldSheet) oldSheet.remove();
          const btnSheet = document.createElement('button');
          btnSheet.type = 'button';
          btnSheet.className = 'btn btn-outline';
          btnSheet.dataset.op = 'event-sheet';
          btnSheet.textContent = 'Print Event Sheet';
          btnSheet.addEventListener('click', function () { window.printBookingEventSheet(booking); });
          actions.appendChild(btnSheet);

          const oldLiq = actions.querySelector('[data-op="liquidation"]');
          if (oldLiq) oldLiq.remove();
          const canLiq = !window.NardsUI || window.NardsUI.can('bookings.manage') || window.NardsUI.can('reports.view') || window.NardsUI.can('sales.view');
          if (canLiq && String(booking.id || '').startsWith('DB-') && ['Confirmed', 'Completed'].includes(booking.status)) {
            const btnLiq = document.createElement('button');
            btnLiq.type = 'button';
            btnLiq.className = 'btn btn-outline';
            btnLiq.dataset.op = 'liquidation';
            btnLiq.textContent = 'Event Liquidation';
            btnLiq.addEventListener('click', function () { window.openLiquidationModal(booking.id); });
            actions.appendChild(btnLiq);
          }
        }
        return res;
      };
      window.showConfirmation._wrappedOps = true;
    }
  }

  window.loadApprovalsList = loadApprovalsList;
  window.openPendingApprovals = function () {
    if (typeof window.navigate === 'function') window.navigate('inventory');
    setInvMode('approvals');
  };

  installHooks();
  if (currentUser().role === 'admin') {
    loadApprovalsList('pending');
    setInterval(function () {
      if (!document.hidden) loadApprovalsList('pending');
    }, 15000);
  }
})();

