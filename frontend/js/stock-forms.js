/* Shared by the Inventory and Expiry pages: add-stock, edit-batch and adjust-stock dialogs. */
async function fetchAll(path) { // walks every page (API caps page size at 100)
  const out = []; for (let page = 1; page <= 20; page++) {
    const r = await api(`${path}${path.includes('?') ? '&' : '?'}page=${page}&limit=100`); out.push(...r.data); if (page >= r.pagination.pages) break;
  } return out;
}
const medOptions = async () => (await fetchAll('/medicines?status=active&sort=name')).map(m => [m.medicine_id, `${m.name}${m.strength ? ' ' + m.strength : ''}${m.dosage_form ? ' (' + m.dosage_form + ')' : ''}`]);
const supOptions = async () => (await fetchAll('/suppliers?status=active')).map(s => [s.supplier_id, s.supplier_name]);
const expiryClass = { EXPIRED: 'bad', 'EXPIRING SOON': 'warn', VALID: 'ok' };
const stockClass = { OUT_OF_STOCK: 'bad', LOW_STOCK: 'warn', IN_STOCK: 'ok' };
const stockLabel = { OUT_OF_STOCK: 'Out of stock', LOW_STOCK: 'Low stock', IN_STOCK: 'In stock' };
const daysText = (d) => d < 0 ? `${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`;

async function openAddStock(done, presetMedicineId) {
  let meds, sups; try { [meds, sups] = await Promise.all([medOptions(), supOptions()]); } catch (e) { return toast(errMsg(e), 'error'); }
  openForm({ title: 'Add stock (new batch)', submitLabel: 'Add stock', values: { medicine_id: presetMedicineId || '', reorder_level: 10 },
    intro: '<p class="muted">Creates a new batch with opening stock. To change an existing batch use Adjust.</p>',
    fields: [{ name: 'medicine_id', label: 'Medicine', type: 'select', required: true, full: true, options: [['', '— select medicine —'], ...meds] },
      { name: 'batch_number', label: 'Batch number', required: true, maxlength: 50 }, { name: 'quantity', label: 'Quantity', type: 'number', min: 1, step: 1, required: true },
      { name: 'manufacturing_date', label: 'Manufacturing date', type: 'date' }, { name: 'expiry_date', label: 'Expiry date', type: 'date', required: true },
      { name: 'purchase_price', label: 'Purchase price (₹)', type: 'number', min: 0, step: '0.01', required: true }, { name: 'selling_price', label: 'Selling price (₹)', type: 'number', min: 0, step: '0.01', required: true },
      { name: 'reorder_level', label: 'Reorder level', type: 'number', min: 0, step: 1 }, { name: 'supplier_id', label: 'Supplier', type: 'select', options: [['', '— none —'], ...sups] }],
    onSubmit: async (v) => { await api('/inventory/batches', { method: 'POST', body: v }); toast('Stock added'); done(); } });
}
async function openEditBatch(b, done) {
  let sups; try { sups = await supOptions(); } catch (e) { return toast(errMsg(e), 'error'); }
  if (b.supplier_id && !sups.some(s => s[0] == b.supplier_id)) sups.push([b.supplier_id, b.supplier_name + ' (inactive)']);
  openForm({ title: `Edit batch ${b.batch_number}`, values: b, intro: `<p class="muted">${esc(b.medicine_name)} — quantity is changed with Adjust, not here.</p>`,
    fields: [{ name: 'manufacturing_date', label: 'Manufacturing date', type: 'date' }, { name: 'expiry_date', label: 'Expiry date', type: 'date', required: true },
      { name: 'purchase_price', label: 'Purchase price (₹)', type: 'number', min: 0, step: '0.01', required: true }, { name: 'selling_price', label: 'Selling price (₹)', type: 'number', min: 0, step: '0.01', required: true },
      { name: 'reorder_level', label: 'Reorder level', type: 'number', min: 0, step: 1 }, { name: 'supplier_id', label: 'Supplier', type: 'select', options: [['', '— none —'], ...sups] }],
    onSubmit: async (v) => { await api('/inventory/batches/' + b.batch_id, { method: 'PUT', body: v }); toast('Batch updated'); done(); } });
}
function openAdjust(b, done, presetType) {
  const expired = b.expiry_status === 'EXPIRED';
  const options = [...(expired ? [] : [['inc', 'Increase (count correction)']]), ['dec', 'Decrease (count correction)'], ['DAMAGED', 'Damaged / lost'], ['EXPIRED', 'Expired — write off'], ...(expired ? [] : [['RETURN', 'Customer return (adds stock)']])];
  openForm({ title: 'Adjust stock', submitLabel: 'Apply', values: { type: presetType || options[0][0], quantity: presetType === 'EXPIRED' ? b.quantity : '' },
    intro: `<div class="note"><strong>${esc(b.medicine_name)}</strong> ${esc(b.strength || '')}<br>Batch ${esc(b.batch_number)} · expires ${fdate(b.expiry_date)} · <strong>${b.quantity}</strong> in stock</div>`,
    fields: [{ name: 'type', label: 'Type', type: 'select', options, full: true }, { name: 'quantity', label: 'Quantity', type: 'number', min: 1, step: 1, required: true },
      { name: 'remarks', label: 'Reason', required: true, maxlength: 150, full: true }],
    onSubmit: async (v) => {
      const qty = Number(v.quantity); if (!Number.isInteger(qty) || qty < 1) throw new Error('Quantity must be a whole number of at least 1');
      const type = v.type === 'inc' || v.type === 'dec' ? 'ADJUSTMENT' : v.type;
      await api('/inventory/adjust', { method: 'POST', body: { batch_id: b.batch_id, type, quantity: v.type === 'dec' ? -qty : qty, remarks: v.remarks } });
      toast('Stock updated'); done();
    } });
}
