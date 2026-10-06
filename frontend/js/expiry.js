(async () => {
  const user = await requireUser(['admin', 'pharmacist']); layout(user, 'expiry');
  let win = 'expired', cache = [];
  const colspan = 7;
  const view = listView({ tbody: $('#rows'), pager: $('#pager'), colspan, empty: 'No batches in this window. 👍',
    fetcher: async (page) => {
      const path = win === 'expired' ? '/inventory/expired' : `/inventory/expiring?days=${win}`;
      const r = await api(`${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=10`); cache = r.data;
      const t = r.totals; $('#totals').innerHTML = `<strong>${t.batches}</strong> batch(es) · <strong>${t.units}</strong> unit(s) · <strong>${money(t.value_at_risk)}</strong> value at cost`;
      $('#writeOffBtn').hidden = !(win === 'expired' && t.batches > 0); return r;
    },
    row: (b) => `<tr><td>${esc(b.medicine_name)}<small>${esc([b.strength, b.dosage_form].filter(Boolean).join(' · '))}</small></td><td>${esc(b.batch_number)}</td>
      <td>${fdate(b.expiry_date)}<small>${esc(daysText(b.days_to_expiry))}</small></td><td>${badge(b.expiry_status, expiryClass[b.expiry_status])}</td><td><strong>${b.quantity}</strong></td>
      <td>${money(b.quantity * b.purchase_price)}</td><td class="actions">${b.expiry_status === 'EXPIRED'
        ? `<button class="btn-sm btn-danger" data-act="writeoff" data-id="${b.batch_id}">Write off</button>` : `<button class="btn-sm btn-ghost" data-act="adjust" data-id="${b.batch_id}">Adjust</button>`}</td></tr>` });
  onAction($('#rows'), {
    writeoff: (id) => { const b = cache.find(x => x.batch_id == id); openAdjust(b, view.reload, 'EXPIRED'); },
    adjust: (id) => openAdjust(cache.find(x => x.batch_id == id), view.reload)
  });
  document.querySelectorAll('.seg button').forEach(b => b.addEventListener('click', () => {
    win = b.dataset.w; document.querySelectorAll('.seg button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); view.load(1); }));
  $('#writeOffBtn').addEventListener('click', async () => {
    if (!await confirmBox('Write off ALL expired stock? Every expired batch will be set to zero and recorded as an EXPIRED movement. Only do this after the stock has been physically removed.', 'Write off all')) return;
    try { const r = await api('/inventory/write-off-expired', { method: 'POST' }); toast(r.message); view.load(1); } catch (e) { toast(e.message, 'error'); }
  });
  $('#syncBtn').addEventListener('click', async () => { try { await api('/inventory/sync-alerts', { method: 'POST' }); toast('Alerts refreshed – check the 🔔'); } catch (e) { toast(e.message, 'error'); } });
  view.load(1);
})();
