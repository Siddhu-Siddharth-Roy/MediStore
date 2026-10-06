(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'reports');
  let type = 'sales', sups = [];
  try { sups = await fetchAll('/suppliers'); } catch { /* purchases filter is optional */ }
  const today = new Date().toLocaleDateString('en-CA'), ago = new Date(Date.now() - 29 * 864e5).toLocaleDateString('en-CA');
  const sel = (id, label, opts, val) => `<div><label for="${id}">${label}</label><select id="${id}">${opts.map(o => `<option value="${esc(o[0])}" ${o[0] === val ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select></div>`;
  const dates = `<div><label for="from">From</label><input id="from" type="date" value="${ago}" max="${today}"></div><div><label for="to">To</label><input id="to" type="date" value="${today}" max="${today}"></div>`;
  const FILTERS = {
    sales: () => dates + sel('group', 'Group by', [['day', 'Day'], ['month', 'Month'], ['medicine', 'Medicine'], ['category', 'Category']], 'day'),
    purchases: () => dates + sel('supplier_id', 'Supplier', [['', 'All suppliers'], ...sups.map(s => [s.supplier_id, s.supplier_name])], ''),
    inventory: () => sel('stock', 'Show', [['', 'All medicines'], ['low', 'Low stock only'], ['out', 'Out of stock only']], ''),
    expiry: () => sel('window', 'Window', [['expired', 'Already expired'], ['30', 'Expiring within 30 days'], ['60', 'Within 60 days'], ['90', 'Within 90 days']], '30'),
    'low-stock': () => '<p class="muted" style="margin:0">Medicines at or below their reorder level.</p>'
  };
  const params = () => { const p = new URLSearchParams(); document.querySelectorAll('#filters select, #filters input').forEach(e => { if (e.value) p.set(e.id, e.value); }); return p; };
  const fmt = (v, c) => c.type === 'money' ? money(v) : c.type === 'date' ? fdate(v) : c.type === 'int' ? Number(v).toLocaleString('en-IN') : esc(v);
  const cls = (c) => (c.type === 'money' || c.type === 'int' ? ' class="num-cell"' : '');

  async function load() {
    const err = $('#error'); err.hidden = true;
    const qs = params().toString(); $('#csvBtn').href = `/api/reports/${type}?${qs}${qs ? '&' : ''}format=csv`;
    $('#body').innerHTML = '<tr><td class="state" colspan="9">Loading…</td></tr>';
    try {
      const r = (await api(`/reports/${type}?${qs}`)).data;
      $('#title').textContent = r.title + (r.params.from ? ` · ${r.params.from} to ${r.params.to}` : ''); $('#note').textContent = r.note || '';
      $('#head').innerHTML = `<tr>${r.columns.map(c => `<th${cls(c)}>${esc(c.label)}</th>`).join('')}</tr>`;
      $('#body').innerHTML = r.rows.length ? r.rows.map(row => `<tr>${r.columns.map(c => `<td${cls(c)}>${fmt(row[c.key], c)}</td>`).join('')}</tr>`).join('') : `<tr><td class="state" colspan="${r.columns.length}">No data for these filters.</td></tr>`;
      $('#foot').innerHTML = r.totals && r.rows.length ? `<tr>${r.columns.map(c => `<td${cls(c)}>${r.totals[c.key] === '' ? '' : fmt(r.totals[c.key], c)}</td>`).join('')}</tr>` : '';
    } catch (e) { err.hidden = false; err.textContent = errMsg(e); $('#body').innerHTML = ''; $('#head').innerHTML = ''; $('#foot').innerHTML = ''; $('#title').textContent = ''; }
  }
  function show(t) {
    type = t; document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.t === t)));
    $('#filters').innerHTML = FILTERS[t](); $('#filters').querySelectorAll('select,input').forEach(e => e.addEventListener('change', load)); load();
  }
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => show(b.dataset.t)));
  $('#printBtn').addEventListener('click', () => window.print());
  $('#filters').addEventListener('submit', (e) => e.preventDefault());
  show('sales');
})();
