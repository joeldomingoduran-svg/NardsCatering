// Shared by the Admin and Manager pages. Relies on the page globals: data, fmtMoney, auditEscape.
const SALES_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SALES_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const salesIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');

// Monday of the week containing the given date.
function salesWeekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

// Builds the chart buckets and the bookings that fall inside the selected period.
function salesBuckets(period) {
  const all = data.bookings;
  if (period === 'weekly') {
    const weekInput = document.getElementById('sales-week');
    if (!weekInput.value) weekInput.value = salesIso(new Date());
    const [y, m, d] = weekInput.value.split('-').map(Number);
    const start = salesWeekStart(new Date(y, m - 1, d));
    const buckets = SALES_DAYS.map((label, i) => {
      const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      return { label, key: salesIso(day), title: label + ' ' + salesIso(day) };
    });
    const keyOf = (b) => String(b.date || '').slice(0, 10);
    const end = salesIso(new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6));
    return { buckets, keyOf, inRange: all.filter(b => keyOf(b) >= salesIso(start) && keyOf(b) <= end), range: salesIso(start) + ' to ' + end, unit: 'Day' };
  }
  if (period === 'yearly') {
    const keyOf = (b) => String(b.date || '').slice(0, 4);
    const years = [...new Set(all.map(keyOf).filter(k => /^\d{4}$/.test(k)))];
    const current = String(new Date().getFullYear());
    if (!years.includes(current)) years.push(current);
    const buckets = years.sort().map(y => ({ label: y, key: y, title: y }));
    return { buckets, keyOf, inRange: all.filter(b => /^\d{4}$/.test(keyOf(b))), range: 'All years', unit: 'Year' };
  }
  const yearSelect = document.getElementById('sales-year');
  const years = [...new Set(all.map(b => Number(String(b.date || '').slice(0, 4))).filter(Boolean))].sort((a, b) => b - a);
  const currentYear = new Date().getFullYear();
  if (!years.includes(currentYear)) years.unshift(currentYear);
  const previous = Number(yearSelect.value);
  yearSelect.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');
  yearSelect.value = years.includes(previous) ? previous : currentYear;
  const year = Number(yearSelect.value);
  const keyOf = (b) => String(b.date || '').slice(0, 7);
  const buckets = SALES_MONTHS.map((label, i) => ({ label, key: year + '-' + String(i + 1).padStart(2, '0'), title: label + ' ' + year }));
  return { buckets, keyOf, inRange: all.filter(b => String(b.date || '').slice(0, 4) === String(year)), range: String(year), unit: 'Month' };
}

function salesBarChart(buckets, values, formatter, extraClass) {
  const max = Math.max(...values, 1);
  return buckets.map((b, i) => `
    <div class="sales-bar-col" title="${b.title}: ${formatter(values[i])}">
      <div class="sales-bar-value">${values[i] ? formatter(values[i]) : ''}</div>
      <div class="sales-bar-track"><div class="sales-bar-fill ${extraClass}" style="height:${Math.round(values[i] / max * 100)}%"></div></div>
      <div class="sales-bar-label">${b.label}</div>
    </div>`).join('');
}

function renderSalesAnalytics() {
  const period = document.getElementById('sales-period').value;
  document.getElementById('sales-year').style.display = period === 'monthly' ? '' : 'none';
  document.getElementById('sales-week').style.display = period === 'weekly' ? '' : 'none';

  const { buckets, keyOf, inRange, range, unit } = salesBuckets(period);
  // Only confirmed and completed bookings count as sales.
  const sold = inRange.filter(b => b.status === 'Confirmed' || b.status === 'Completed');
  const indexByKey = new Map(buckets.map((b, i) => [b.key, i]));
  const revenue = new Array(buckets.length).fill(0);
  const counts = new Array(buckets.length).fill(0);
  inRange.forEach(b => { const i = indexByKey.get(keyOf(b)); if (i !== undefined) counts[i]++; });
  sold.forEach(b => { const i = indexByKey.get(keyOf(b)); if (i !== undefined) revenue[i] += Number(b.amount) || 0; });

  const totalRevenue = revenue.reduce((s, n) => s + n, 0);
  const best = revenue.indexOf(Math.max(...revenue));
  document.getElementById('sales-range').textContent = range;
  document.getElementById('sales-total').textContent = fmtMoney(totalRevenue);
  document.getElementById('sales-bookings').textContent = inRange.length;
  document.getElementById('sales-avg').textContent = fmtMoney(sold.length ? Math.round(totalRevenue / sold.length) : 0);
  document.getElementById('sales-best-label').textContent = 'Best ' + unit;
  document.getElementById('sales-best').textContent = totalRevenue > 0 ? buckets[best].label : '-';
  document.getElementById('sales-title-rev').textContent = '📈 Sales per ' + unit;
  document.getElementById('sales-title-count').textContent = '🗓️ Bookings per ' + unit;

  document.getElementById('sales-month-chart').innerHTML = salesBarChart(buckets, revenue, fmtMoney, '');
  document.getElementById('sales-count-chart').innerHTML = salesBarChart(buckets, counts, (n) => String(n), 'sales-bar-alt');

  const statuses = ['Pending', 'Confirmed', 'Completed', 'Cancelled'];
  const statusCls = { Pending: 'fill-warning', Confirmed: 'fill-success', Completed: 'fill-success', Cancelled: 'fill-danger' };
  const totalBookings = inRange.length || 1;
  document.getElementById('sales-by-status').innerHTML = statuses.map(s => {
    const n = inRange.filter(b => b.status === s).length;
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:14px;margin-bottom:4px"><span>${s}</span><strong>${n}</strong></div>
      <div class="progress-bar"><div class="progress-fill ${statusCls[s]}" style="width:${Math.round(n / totalBookings * 100)}%"></div></div>
    </div>`;
  }).join('');

  const byType = {};
  sold.forEach(b => {
    const key = b.event || 'Other';
    byType[key] = byType[key] || { count: 0, amount: 0 };
    byType[key].count++;
    byType[key].amount += Number(b.amount) || 0;
  });
  const rows = Object.entries(byType).sort((a, b) => b[1].amount - a[1].amount);
  document.getElementById('sales-by-type').innerHTML = rows.length
    ? rows.map(([type, v]) => `<tr><td>${auditEscape(type)}</td><td>${v.count}</td><td><strong>${fmtMoney(v.amount)}</strong></td></tr>`).join('')
    : '<tr><td colspan="3">No sales recorded for this period.</td></tr>';
}
