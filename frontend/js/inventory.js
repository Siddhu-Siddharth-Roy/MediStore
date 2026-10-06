(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'inventory');
  let cache = [];
  const batchView = listView({ tbody: $('#rows'), pager: $('#pager'), colspan: 8, empty: 'No batches match. Use “Add stock” to record your first batch.',
    fetcher: async (page) => { const [sort, dir] = $('#sort').value.split('|');
      const r = await api('/inventory?' + new URLSearchParams({ page, limit: 10, q: $('#q').value, status: $('#status').value, sort, dir })); cache = r.data; return r; },
    row: (b) => `<tr><td>${esc(b.medicine_name)}<small>${esc([b.strength, b.dosage_form].filter(Boolean).join(' · '))}</small></td><td>${esc(b.batch_number)}</td>
      <td>${fdate(b.expiry_date)}<small>${badge(b.expiry_status, expiryClass[b.expiry_status])} ${esc(daysText(b.days_to_expiry))}</small></td>
      <td><strong>${b.quantity}</strong><small>${b.expiry_status === 'EXPIRED' && b.quantity > 0 ? badge('Not sellable', 'bad') : badge(stockLabel[b.stock_status], stockClass[b.stock_status])}</small></td><td>${b.reorder_level}</td>
      <td>${money(b.purchase_price)}<small>${money(b.selling_price)}</small></td><td>${esc(b.supplier_name || '—')}</td>
      <td class="actions"><button class="btn-sm btn-ghost" data-act="adjust" data-id="${b.batch_id}">Adjust</button><button class="btn-sm btn-ghost" data-act="edit" data-id="${b.batch_id}">Edit</button>
      <a class="btn btn-sm btn-ghost" href="admin-transactions.html?batch_id=${b.batch_id}">History</a></td></tr>` });
  let lowCache = [];
  const lowView = listView({ tbody: $('#lowRows'), colspan: 5, empty: 'Nothing is running low. 🎉',
    fetcher: async () => { const r = await api('/inventory/low-stock'); lowCache = r.data; return r; },
    row: (m) => `<tr><td>${esc(m.name)}<small>${esc([m.strength, m.dosage_form, m.manufacturer].filter(Boolean).join(' · '))}</small></td><td><strong>${m.sellable}</strong></td><td>${m.reorder_level}</td>
      <td>${badge(stockLabel[m.stock_status], stockClass[m.stock_status])}</td><td class="actions"><button class="btn-sm" data-act="restock" data-id="${m.medicine_id}">Add stock</button></td></tr>` });

  async function loadTiles() {
    try {
      const s = (await api('/inventory/summary')).data;
      const t = (label, num, cls, view, status) => `<button class="card tile ${cls}" data-view="${view}" data-status="${status || ''}"><div class="num">${num}</div><div class="lbl">${label}</div></button>`;
      $('#tiles').innerHTML = t('Expired batches (with stock)', s.expired_batches, s.expired_batches ? 'bad' : '', 'batches', 'expired') + t('Expiring ≤ 30 days', s.expiring_30, s.expiring_30 ? 'warn' : '', 'batches', 'expiring')
        + t('Low-stock medicines', s.low_stock_medicines, s.low_stock_medicines ? 'warn' : '', 'low') + t('Out-of-stock medicines', s.out_of_stock_medicines, s.out_of_stock_medicines ? 'bad' : '', 'low')
        + `<div class="card tile"><div class="num">${money(s.stock_value)}</div><div class="lbl">Sellable stock at cost · ${s.sellable_units} units</div></div>`;
    } catch (e) { $('#tiles').innerHTML = `<p class="error-text">${esc(errMsg(e))}</p>`; }
  }
  const refresh = () => { batchView.reload(); lowView.load(); loadTiles(); };

  function show(view) {
    document.querySelectorAll('.seg button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.view === view)));
    $('#batchesView').hidden = view !== 'batches'; $('#lowView').hidden = view !== 'low';
  }
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => show(b.dataset.view)));
  $('#tiles').addEventListener('click', (ev) => { const t = ev.target.closest('button.tile'); if (!t) return; show(t.dataset.view); if (t.dataset.view === 'batches') { $('#status').value = t.dataset.status; batchView.load(1); } });

  $('#addBtn').addEventListener('click', () => openAddStock(refresh));
  onAction($('#rows'), {
    adjust: (id) => openAdjust(cache.find(b => b.batch_id == id), refresh),
    edit: (id) => openEditBatch(cache.find(b => b.batch_id == id), refresh)
  });
  onAction($('#lowRows'), { restock: (id) => openAddStock(refresh, id) });
  ['status', 'sort'].forEach(i => $('#' + i).addEventListener('change', () => batchView.load(1)));
  $('#q').addEventListener('input', debounce(() => batchView.load(1)));
  batchView.load(1); lowView.load(); loadTiles();
})();
