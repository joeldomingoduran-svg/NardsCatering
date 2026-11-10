// Shared by the Admin, Manager and Staff portals: sidebar, profile popover, live alerts,
// table filters and CSV/Excel exports. Loaded at the end of each portal page.
(function () {
  'use strict';

  var user = {};
  try { user = JSON.parse(sessionStorage.getItem('nards_internal_user') || 'null') || {}; } catch (e) { user = {}; }
  var ROLE_LABEL = { admin: 'Administrator', manager: 'Manager', staff: 'Staff' };

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------------------------------------------------------- Exports */
  var crcTable = null;
  function crc32(bytes) {
    if (!crcTable) {
      crcTable = [];
      for (var n = 0; n < 256; n++) {
        var c = n;
        for (var k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
        crcTable[n] = c >>> 0;
      }
    }
    var crc = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8);
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  // Minimal ZIP writer (no compression), enough to produce a valid .xlsx workbook.
  function zip(files) {
    var enc = new TextEncoder();
    var chunks = [], central = [], offset = 0;
    function u16(v) { return [v & 255, (v >>> 8) & 255]; }
    function u32(v) { return [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]; }
    files.forEach(function (f) {
      var name = enc.encode(f.name), data = enc.encode(f.content), crc = crc32(data);
      var local = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0));
      chunks.push(new Uint8Array(local), name, data);
      central.push({ name: name, crc: crc, size: data.length, offset: offset });
      offset += local.length + name.length + data.length;
    });
    var centralStart = offset;
    central.forEach(function (e) {
      var rec = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(0), u16(0), u16(0x21), u32(e.crc), u32(e.size), u32(e.size), u16(e.name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(e.offset));
      chunks.push(new Uint8Array(rec), e.name);
      offset += rec.length + e.name.length;
    });
    var end = [].concat(u32(0x06054b50), u16(0), u16(0), u16(central.length), u16(central.length), u32(offset - centralStart), u32(centralStart), u16(0));
    chunks.push(new Uint8Array(end));
    return new Blob(chunks, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  function colName(i) {
    var s = '';
    for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
    return s;
  }

  function xmlText(value) {
    return esc(value).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  // sheets: [{ name, rows: [[cell, ...], ...] }]; the first row is the header.
  function buildXlsx(sheets) {
    var used = {};
    var names = sheets.map(function (s, i) {
      var base = String(s.name || 'Sheet' + (i + 1)).replace(/[\\\/?*\[\]:]/g, ' ').trim().slice(0, 28) || 'Sheet' + (i + 1);
      var name = base, n = 2;
      while (used[name.toLowerCase()]) name = base.slice(0, 25) + ' ' + n++;
      used[name.toLowerCase()] = true;
      return name;
    });
    var files = [
      { name: '[Content_Types].xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' + sheets.map(function (s, i) { return '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'; }).join('') + '</Types>' },
      { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
      { name: 'xl/workbook.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + names.map(function (n, i) { return '<sheet name="' + xmlText(n) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>'; }).join('') + '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + sheets.map(function (s, i) { return '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>'; }).join('') + '<Relationship Id="rId' + (sheets.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
      { name: 'xl/styles.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>' }
    ];
    sheets.forEach(function (s, si) {
      var rows = s.rows.map(function (row, r) {
        return '<row r="' + (r + 1) + '">' + row.map(function (cell, c) {
          var ref = colName(c) + (r + 1), text = String(cell == null ? '' : cell).trim();
          var style = r === 0 ? ' s="1"' : '';
          var plain = text.replace(/^\u20B1\s?/, '').replace(/,/g, '');
          if (r > 0 && /^-?(0|[1-9]\d*)(\.\d+)?$/.test(plain) && plain.length < 16) return '<c r="' + ref + '"><v>' + plain + '</v></c>';
          return '<c r="' + ref + '" t="inlineStr"' + style + '><is><t xml:space="preserve">' + xmlText(text) + '</t></is></c>';
        }).join('') + '</row>';
      }).join('');
      files.push({ name: 'xl/worksheets/sheet' + (si + 1) + '.xml', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + rows + '</sheetData></worksheet>' });
    });
    return zip(files);
  }

  function csvCell(value) {
    var text = String(value == null ? '' : value);
    // Stops spreadsheet apps from running cells that start with a formula character.
    if (/^[=+\-@]/.test(text) && !/^-?[\d.,]+$/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function download(blob, filename) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function stamp() {
    var d = new Date(), p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function safeName(name) {
    return String(name || 'export').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'export';
  }

  function exportCsv(name, rows) {
    var text = '\uFEFF' + rows.map(function (r) { return r.map(csvCell).join(','); }).join('\r\n');
    download(new Blob([text], { type: 'text/csv;charset=utf-8' }), 'nards-' + safeName(name) + '-' + stamp() + '.csv');
  }

  function exportXlsx(name, sheets) {
    download(buildXlsx(sheets), 'nards-' + safeName(name) + '-' + stamp() + '.xlsx');
  }

  window.NardsExport = { csv: exportCsv, xlsx: exportXlsx, stamp: stamp };

  function toast(message, icon) {
    if (window.Swal) {
      Swal.fire({ toast: true, position: 'top-end', icon: icon || 'info', title: message, showConfirmButton: false, timer: 3500, timerProgressBar: true });
    }
  }

  /* ----------------------------------------------------------- Table tools */
  var SKIP_HEADERS = /^(actions?|)$/i;

  function cellText(cell) {
    return (cell.innerText || cell.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function dataColumns(table) {
    var headRow = table.tHead && table.tHead.rows[0];
    if (!headRow) return [];
    return Array.prototype.map.call(headRow.cells, function (th, i) {
      return { index: i, title: cellText(th), skip: SKIP_HEADERS.test(cellText(th)) };
    });
  }

  function applyFilters(table) {
    var inputs = table.querySelectorAll('.col-filter');
    var active = [];
    inputs.forEach(function (input) {
      var value = input.value.trim().toLowerCase();
      if (value) active.push({ index: Number(input.dataset.col), value: value });
    });
    Array.prototype.forEach.call(table.tBodies, function (tbody) {
      Array.prototype.forEach.call(tbody.rows, function (row) {
        // Message rows ("No records") span the table and are never filtered.
        if (row.cells.length === 1 && row.cells[0].colSpan > 1) { row.hidden = false; return; }
        var show = active.every(function (f) {
          var cell = row.cells[f.index];
          return cell && cellText(cell).toLowerCase().indexOf(f.value) !== -1;
        });
        row.hidden = !show;
      });
    });
  }

  function visibleRows(table, columns) {
    var rows = [columns.map(function (c) { return c.title; })];
    Array.prototype.forEach.call(table.tBodies, function (tbody) {
      Array.prototype.forEach.call(tbody.rows, function (row) {
        if (row.hidden || (row.cells.length === 1 && row.cells[0].colSpan > 1)) return;
        rows.push(columns.map(function (c) { return row.cells[c.index] ? cellText(row.cells[c.index]) : ''; }));
      });
    });
    return rows;
  }

  function tableTitle(table) {
    var view = table.closest('.view');
    var card = table.closest('.card');
    var heading = card && card.querySelector('.card-title, h2');
    var viewTitle = document.getElementById('pageTitle');
    return (heading && heading.textContent.replace(/[^\w\s&-]/g, '').trim()) || (view && viewTitle && viewTitle.textContent) || 'table';
  }

  function enhanceTable(table) {
    if (table.dataset.tools || table.classList.contains('report-print-table') || table.closest('.report-print-sheet') || table.hasAttribute('data-no-tools')) return;
    var columns = dataColumns(table);
    if (!columns.length || !table.tBodies.length) return;
    table.dataset.tools = '1';

    // Check if this table's view has a global search bar; if so, skip individual column filters
    var view = table.closest('.view');
    var hasGlobalSearch = view && (
      view.querySelector('#booking-search') ||
      view.querySelector('#inv-search') ||
      view.querySelector('#dish-search') ||
      view.querySelector('#client-search') ||
      view.querySelector('#asset-search')
    );

    if (!hasGlobalSearch) {
      var filterRow = document.createElement('tr');
      filterRow.className = 'filter-row';
      columns.forEach(function (col) {
        var th = document.createElement('th');
        if (!col.skip) {
          var input = document.createElement('input');
          input.type = 'search';
          input.className = 'col-filter';
          input.dataset.col = col.index;
          input.placeholder = 'Filter';
          input.setAttribute('aria-label', 'Filter ' + col.title);
          input.addEventListener('input', function () { applyFilters(table); });
          th.appendChild(input);
        }
        filterRow.appendChild(th);
      });
      table.tHead.appendChild(filterRow);
    }

    var exportCols = columns.filter(function (c) { return !c.skip; });
    var tools = document.createElement('div');
    tools.className = 'table-tools';
    tools.innerHTML = '<button type="button" class="btn btn-outline btn-sm" data-act="clear">Clear filters</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-act="csv">Export CSV</button>' +
      '<button type="button" class="btn btn-outline btn-sm" data-act="xlsx">Export Excel</button>';
    tools.addEventListener('click', function (event) {
      var act = event.target.getAttribute('data-act');
      if (!act) return;
      if (act === 'clear') {
        table.querySelectorAll('.col-filter').forEach(function (i) { i.value = ''; });
        applyFilters(table);
        return;
      }
      var rows = visibleRows(table, exportCols), title = tableTitle(table);
      if (rows.length < 2) { toast('There are no rows to export.', 'info'); return; }
      if (act === 'csv') exportCsv(title, rows);
      else exportXlsx(title, [{ name: title, rows: rows }]);
    });
    var wrap = table.closest('.table-wrap') || table;
    wrap.parentNode.insertBefore(tools, wrap);

    // Rows are re-rendered by the pages; keep the filters applied.
    var observer = new MutationObserver(function () { applyFilters(table); });
    Array.prototype.forEach.call(table.tBodies, function (tbody) { observer.observe(tbody, { childList: true }); });
  }

  var enhanceQueued = false;
  function enhanceAllTables() {
    enhanceQueued = false;
    document.querySelectorAll('table').forEach(enhanceTable);
  }
  function queueEnhance() {
    if (enhanceQueued) return;
    enhanceQueued = true;
    setTimeout(enhanceAllTables, 50);
  }

  /* ------------------------------------------------------ Report workbook */
  // Exports every table of the printable business report as one sheet each.
  window.exportReportExcel = function () {
    var sheet = document.getElementById('reports-print-sheet');
    if (!sheet) return;
    var sheets = [];
    sheet.querySelectorAll('table').forEach(function (table, i) {
      var heading = table.previousElementSibling;
      var name = heading && heading.tagName === 'H2' ? heading.textContent : (i === 0 ? 'Summary' : 'Report ' + (i + 1));
      var rows = [];
      Array.prototype.forEach.call(table.rows, function (row) {
        if (row.cells.length === 1 && row.cells[0].colSpan > 1 && rows.length) return;
        rows.push(Array.prototype.map.call(row.cells, cellText));
      });
      if (rows.length > 1) sheets.push({ name: name, rows: rows });
    });
    if (!sheets.length) { toast('The report has no data to export.', 'info'); return; }
    exportXlsx('business-report', sheets);
  };

  /* ---------------------------------------------------------------- Sidebar */
  var ICONS = { dashboard: '\uD83C\uDFE0', bookings: '\uD83D\uDCCB', calendar: '\uD83D\uDCC5', clients: '\uD83D\uDC65', inventory: '\uD83D\uDCE6', menu: '\uD83C\uDF7D\uFE0F', assets: '\uD83E\uDE91', dishes: '\uD83E\uDD58', reports: '\uD83D\uDCCA', sales: '\uD83D\uDCB0', audit: '\uD83E\uDDFE', logins: '\uD83D\uDD11', staff: '\u2699\uFE0F', profile: '\uD83D\uDC64', roles: '\uD83D\uDEE1\uFE0F', dropdowns: '\uD83D\uDCDA' };
  var VIEW_PERMISSION = { bookings: 'bookings.view', calendar: 'calendar.view', clients: 'clients.view', inventory: 'inventory.manage', menu: 'packages.manage', assets: 'assets.manage', dishes: 'dishes.manage', reports: 'reports.view', sales: 'sales.view', audit: 'audit.view', logins: 'audit.view', staff: 'users.manage', roles: 'roles.manage', dropdowns: 'dropdowns.manage' };

  function viewOf(button) {
    var m = /navigate\('([\w-]+)'/.exec(button.getAttribute('onclick') || '');
    return m ? m[1] : '';
  }

  function buildSidebar() {
    var topnav = document.querySelector('.topnav');
    var tabs = topnav && topnav.querySelector('.tabs');
    if (!topnav || !tabs || document.getElementById('sidebar')) return;

    var brandBtn = topnav.querySelector('.brand');
    var roleSmall = brandBtn && brandBtn.querySelector('small');
    var aside = document.createElement('aside');
    aside.className = 'sidebar';
    aside.id = 'sidebar';
    aside.setAttribute('aria-label', 'Main navigation');
    aside.innerHTML = '<div class="sidebar-brand"><span class="sidebar-logo">N<span>.</span></span><span class="sidebar-brand-text"><span class="brand-name">Nards<span>.</span></span><small>' + esc(roleSmall ? roleSmall.textContent : ROLE_LABEL[user.role] || '') + '</small></span></div><nav class="sidebar-nav"></nav>';
    var nav = aside.querySelector('.sidebar-nav');

    // The original buttons are moved (not copied) so the pages' navigate() highlighting keeps working.
    Array.prototype.slice.call(tabs.querySelectorAll('.nav-item')).forEach(function (btn) {
      var label = btn.textContent.trim(), view = viewOf(btn);
      btn.innerHTML = '<span class="nav-icon" aria-hidden="true">' + (ICONS[view] || '\u2022') + '</span><span class="nav-label">' + esc(label) + '</span>';
      btn.title = label;
      btn.dataset.view = view;
      nav.appendChild(btn);
    });
    tabs.remove();
    if (brandBtn) brandBtn.remove();
    var back = topnav.querySelector('.btn-back');
    if (back && user.role === 'staff') back.remove();

    var backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    document.body.appendChild(aside);
    document.body.appendChild(backdrop);
    document.body.classList.add('has-sidebar');
    if (localStorage.getItem('nards_sidebar') === 'collapsed') document.body.classList.add('sidebar-collapsed');

    var toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'sidebar-toggle';
    toggle.setAttribute('aria-label', 'Collapse or expand the sidebar');
    toggle.setAttribute('aria-controls', 'sidebar');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16"/></svg>';
    topnav.insertBefore(toggle, topnav.firstChild);

    var mobile = function () { return window.matchMedia('(max-width: 900px)').matches; };
    toggle.addEventListener('click', function () {
      if (mobile()) { document.body.classList.toggle('sidebar-open'); return; }
      var collapsed = document.body.classList.toggle('sidebar-collapsed');
      localStorage.setItem('nards_sidebar', collapsed ? 'collapsed' : 'expanded');
    });
    backdrop.addEventListener('click', function () { document.body.classList.remove('sidebar-open'); });
    nav.addEventListener('click', function () { document.body.classList.remove('sidebar-open'); });
  }

  function applyPermissions() {
    if (!user.role || user.role === 'admin') return;
    fetch('/roles/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (res) {
      if (!res) return;
      var allowed = new Set(res.permissions);
      document.querySelectorAll('.sidebar-nav .nav-item').forEach(function (btn) {
        var perm = VIEW_PERMISSION[btn.dataset.view];
        if (perm && !allowed.has(perm)) btn.style.display = 'none';
      });
      window.NARDS_PERMISSIONS = allowed;
      document.dispatchEvent(new CustomEvent('nards:permissions', { detail: allowed }));
    }).catch(function () {});
  }

  /* -------------------------------------------------------- Profile popover */
  function initials(name) {
    return String(name || '?').trim().split(/\s+/).slice(0, 2).map(function (p) { return p[0]; }).join('').toUpperCase() || '?';
  }

  function buildProfileMenu() {
    var actions = document.querySelector('.topnav-actions');
    if (!actions || document.getElementById('profile-menu')) return;
    var logout = actions.querySelector('.btn-logout');
    var hasProfile = Boolean(document.getElementById('view-profile'));

    var wrap = document.createElement('div');
    wrap.className = 'profile-menu';
    wrap.id = 'profile-menu';
    wrap.innerHTML = '<button type="button" class="profile-btn" aria-haspopup="true" aria-expanded="false"><span class="profile-avatar"></span><span class="profile-name"></span><span class="profile-caret" aria-hidden="true">\u25BE</span></button>' +
      '<div class="profile-popover" role="menu" hidden><div class="profile-popover-head"><strong></strong><span></span></div>' +
      (hasProfile ? '<button type="button" role="menuitem" data-go="profile">\uD83D\uDC64 My Profile</button><button type="button" role="menuitem" data-go="password">\uD83D\uDD12 Change Password</button>' : '') +
      '<button type="button" role="menuitem" data-go="logout" class="danger">\u21AA Logout</button></div>';
    actions.appendChild(wrap);
    if (logout) logout.remove();

    var btn = wrap.querySelector('.profile-btn'), pop = wrap.querySelector('.profile-popover');
    function refresh() {
      try { user = JSON.parse(sessionStorage.getItem('nards_internal_user') || 'null') || user; } catch (e) {}
      var avatar = wrap.querySelector('.profile-avatar');
      if (user.profileImage) avatar.innerHTML = '<img alt="" src="' + esc(user.profileImage) + '">';
      else avatar.textContent = initials(user.name || user.username);
      wrap.querySelector('.profile-name').textContent = user.name || user.username || 'Account';
      pop.querySelector('.profile-popover-head strong').textContent = user.name || user.username || '';
      pop.querySelector('.profile-popover-head span').textContent = ROLE_LABEL[user.role] || '';
    }
    function close() { pop.hidden = true; btn.setAttribute('aria-expanded', 'false'); }
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      refresh();
      pop.hidden = !pop.hidden;
      btn.setAttribute('aria-expanded', String(!pop.hidden));
    });
    pop.addEventListener('click', function (e) {
      var target = e.target.closest('[data-go]');
      if (!target) return;
      close();
      var go = target.dataset.go;
      if (go === 'logout') return window.logout && window.logout();
      window.navigate('profile');
      if (go === 'password') setTimeout(function () {
        var field = document.getElementById('current-password');
        if (field) { field.scrollIntoView({ behavior: 'smooth', block: 'center' }); field.focus(); }
      }, 120);
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });
    refresh();
  }

  /* ----------------------------------------------------------- Live alerts */
  var alertState = { lastId: null };

  function buildAlerts() {
    var actions = document.querySelector('.topnav-actions');
    if (!actions || document.getElementById('alerts-menu') || !user.role) return;
    var wrap = document.createElement('div');
    wrap.className = 'alerts-menu';
    wrap.id = 'alerts-menu';
    wrap.innerHTML = '<button type="button" class="btn-notif-bell alerts-btn" title="Alerts and activity" aria-label="Alerts and activity" aria-expanded="false">\u26A1<span class="alerts-badge" hidden>0</span></button>' +
      '<div class="alerts-panel" hidden><div class="alerts-head"><strong>Alerts</strong><button type="button" class="btn btn-outline btn-sm" data-act="read">Mark all read</button></div><div class="alerts-list"><div class="notif-empty">No alerts yet.</div></div></div>';
    actions.insertBefore(wrap, actions.firstChild);
    var btn = wrap.querySelector('.alerts-btn'), panel = wrap.querySelector('.alerts-panel');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      panel.hidden = !panel.hidden;
      btn.setAttribute('aria-expanded', String(!panel.hidden));
    });
    document.addEventListener('click', function (e) { if (!wrap.contains(e.target)) { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); } });
    wrap.querySelector('[data-act="read"]').addEventListener('click', function () {
      fetch('/notifications/read', { method: 'POST' }).then(poll);
    });
    wrap.querySelector('.alerts-list').addEventListener('click', function (e) {
      var item = e.target.closest('[data-view]');
      if (item && item.dataset.view && window.navigate) { panel.hidden = true; try { window.navigate(item.dataset.view); } catch (err) {} }
    });
    poll();
    setInterval(poll, 8000);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  }

  function timeAgo(value) {
    var diff = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
    if (isNaN(diff)) return '';
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' h ago';
    return Math.floor(diff / 86400) + ' d ago';
  }

  function poll() {
    if (document.hidden) return;
    fetch('/notifications').then(function (r) { return r.ok ? r.json() : null; }).then(function (res) {
      var wrap = document.getElementById('alerts-menu');
      if (!res || !wrap) return;
      var badge = wrap.querySelector('.alerts-badge');
      badge.hidden = !res.unread;
      badge.textContent = res.unread > 9 ? '9+' : res.unread;
      var list = wrap.querySelector('.alerts-list');
      list.innerHTML = res.notifications.length ? res.notifications.map(function (n) {
        var unread = Number(n.id) > Number(res.lastRead);
        return '<div class="alert-item' + (unread ? ' unread' : '') + '" data-view="' + esc(n.link_view || '') + '"><strong>' + esc(n.title) + '</strong><span>' + esc(n.message) + '</span><small>' + timeAgo(n.created_at) + '</small></div>';
      }).join('') : '<div class="notif-empty">No alerts yet.</div>';
      var newest = res.notifications.length ? Number(res.notifications[0].id) : 0;
      if (alertState.lastId !== null && newest > alertState.lastId) {
        res.notifications.filter(function (n) { return Number(n.id) > alertState.lastId; }).slice(0, 3).reverse().forEach(function (n) { toast(n.title + ': ' + n.message, 'info'); });
        // Keep booking lists fresh when something changed elsewhere.
        if (window.syncFromAPI) window.syncFromAPI().then(function () {
          var active = document.querySelector('.view.active');
          if (active && active.id === 'view-bookings' && window.renderBookings) window.renderBookings();
          if (active && active.id === 'view-dashboard' && window.renderDashboard) window.renderDashboard();
        }).catch(function () {});
      }
      alertState.lastId = Math.max(alertState.lastId || 0, newest);
    }).catch(function () {});
  }

  /* ------------------------------------------------------ Dropdown library */
  function fillLibrarySelects() {
    document.querySelectorAll('select[data-dropdown]').forEach(function (select) {
      fetch('/dropdowns/' + encodeURIComponent(select.dataset.dropdown)).then(function (r) { return r.ok ? r.json() : []; }).then(function (labels) {
        if (!labels.length) return;
        var current = select.value;
        var first = select.querySelector('option[value=""]');
        select.innerHTML = (first ? first.outerHTML : '') + labels.map(function (l) { return '<option>' + esc(l) + '</option>'; }).join('');
        if (current && labels.indexOf(current) === -1) select.insertAdjacentHTML('beforeend', '<option>' + esc(current) + '</option>');
        select.value = current || (first ? '' : labels[0]);
      }).catch(function () {});
    });
  }

  window.NardsUI = { esc: esc, toast: toast, fillLibrarySelects: fillLibrarySelects };

  buildSidebar();
  buildProfileMenu();
  buildAlerts();
  applyPermissions();
  fillLibrarySelects();
  enhanceAllTables();
  new MutationObserver(queueEnhance).observe(document.body, { childList: true, subtree: true });
})();
