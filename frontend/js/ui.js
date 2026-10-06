/* Shared UI helpers. All dynamic text MUST go through esc() before being placed in innerHTML. */
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fdate = (d) => d ? String(d).slice(0, 10) : '—';
const debounce = (fn, ms = 300) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const badge = (text, cls = '') => `<span class="badge ${cls}">${esc(text)}</span>`;
const errMsg = (e) => e.errors ? e.errors.map(x => x.message).join('. ') : e.message;

function toast(msg, type = 'success') {
  let box = $('#toasts'); if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('aria-live', 'polite'); document.body.append(box); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; box.append(t);
  setTimeout(() => t.remove(), 4000);
}

/* ---------- session ---------- */
async function currentUser() { try { return (await api('/auth/me')).data; } catch { return null; } }
const homeFor = (u) => u.role === 'customer' ? 'customer-dashboard.html' : 'admin-dashboard.html';
// Redirects to login (or the user's own dashboard) unless the visitor has one of the allowed roles.
async function requireUser(roles) {
  const u = await currentUser();
  if (!u) { location.href = 'login.html'; return new Promise(() => {}); }
  if (roles && !roles.includes(u.role)) { location.href = homeFor(u); return new Promise(() => {}); }
  return u;
}
async function logout() { try { await api('/auth/logout', { method: 'POST' }); } finally { location.href = 'login.html'; } }

/* ---------- notification bell + dropdown panel ---------- */
const BELL_HTML = `<div class="bellwrap"><button type="button" class="bell" id="bellBtn" aria-haspopup="true" aria-expanded="false" aria-controls="notifPanel" aria-label="Notifications"><span aria-hidden="true">🔔</span><span class="count" id="bellCount" hidden></span></button>
  <div class="notif-panel" id="notifPanel" hidden role="region" aria-label="Recent notifications"></div></div>`;
const NOTIF_ICON = { low_stock: '📉', out_of_stock: '🚫', expired: '⛔', expiring_soon: '⏳', stock_adjustment: '🔁', new_order: '🧾', new_purchase: '📥', purchase_cancelled: '📥' };
// Where a notification should take the user (null = nowhere in particular).
function notifLink(n) {
  const id = (/#(\d+)/.exec(n.title) || [])[1];
  if (/^order_|^new_order$/.test(n.type)) return id ? 'order-details.html?id=' + id : null;
  if (/purchase/.test(n.type)) return id ? 'purchase-details.html?id=' + id : null;
  return { low_stock: 'admin-inventory.html', out_of_stock: 'admin-inventory.html', expired: 'admin-expiry.html', expiring_soon: 'admin-expiry.html', stock_adjustment: 'admin-transactions.html' }[n.type] || null;
}
function setBellCount(n) { const c = $('#bellCount'); if (!c) return; c.textContent = n > 99 ? '99+' : n; c.hidden = !n; const b = $('#bellBtn'); if (b) b.setAttribute('aria-label', n ? `Notifications, ${n} unread` : 'Notifications'); }
async function refreshBell() { try { setBellCount((await api('/notifications?limit=1')).unread_count); } catch { /* offline or logged out: ignore */ } }
function initBell() {
  const btn = $('#bellBtn'), panel = $('#notifPanel'); if (!btn) return;
  const close = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); };
  async function open() {
    panel.hidden = false; btn.setAttribute('aria-expanded', 'true'); panel.innerHTML = '<p class="muted" style="padding:1rem">Loading…</p>';
    try {
      const r = await api('/notifications?limit=6'); setBellCount(r.unread_count);
      panel.innerHTML = `<div class="np-head"><strong>Notifications</strong><button type="button" class="btn-sm btn-ghost" id="npReadAll" ${r.unread_count ? '' : 'disabled'}>Mark all read</button></div>
        <ul class="np-list">${r.data.length ? r.data.map(n => { const l = notifLink(n); return `<li class="${n.is_read ? '' : 'unread'}"><${l ? 'a href="' + esc(l) + '"' : 'div'} data-nid="${n.notification_id}" data-read="${n.is_read}">
          <span aria-hidden="true">${NOTIF_ICON[n.type] || '🔔'}</span><span><strong>${esc(n.title)}</strong><br><span class="muted">${esc(String(n.created_at).slice(0, 16))}</span></span></${l ? 'a' : 'div'}></li>`; }).join('') : '<li class="state" style="padding:1.2rem;text-align:center">No notifications yet.</li>'}</ul>
        <div class="np-foot"><a href="notifications.html">View all notifications</a></div>`;
      $('#npReadAll', panel).addEventListener('click', async () => { try { await api('/notifications/read-all', { method: 'PUT' }); setBellCount(0); open(); } catch (e) { toast(errMsg(e), 'error'); } });
      panel.querySelectorAll('[data-nid]').forEach(el => el.addEventListener('click', async (ev) => { // mark read first, THEN navigate, so the request is not cancelled by the page change
        if (el.dataset.read === 'false') { if (el.tagName === 'A') ev.preventDefault(); try { await api(`/notifications/${el.dataset.nid}/read`, { method: 'PUT' }); } catch { /* still navigate */ } if (el.tagName === 'A') location.href = el.getAttribute('href'); } }));
    } catch (e) { panel.innerHTML = `<p class="error-text" style="padding:1rem">${esc(errMsg(e))}</p>`; }
  }
  btn.addEventListener('click', (ev) => { ev.stopPropagation(); panel.hidden ? open() : close(); });
  document.addEventListener('click', (ev) => { if (!panel.hidden && !ev.target.closest('.bellwrap')) close(); });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && !panel.hidden) { close(); btn.focus(); } });
  setInterval(() => { if (document.visibilityState === 'visible') { refreshBell(); if (!panel.hidden) open(); } }, 60000); // keep the badge fresh without a page reload
}

/* ---------- page shell: wraps <main id="content"> in a sidebar (staff) or top bar (customer/public) ---------- */
function layout(user, active) {
  const content = $('#content'), staff = user && user.role !== 'customer';
  const wrap = document.createElement('div');
  const cur = (k) => k === active ? ' aria-current="page"' : '';
  if (staff) {
    const items = [['dashboard', 'admin-dashboard.html', '📊 Dashboard'], ['orders', 'admin-orders.html', '🧾 Orders'], ['medicines', 'admin-medicines.html', '💊 Medicines'], ['inventory', 'admin-inventory.html', '📦 Inventory'], ['purchases', 'admin-purchases.html', '📥 Purchases'],
      ['expiry', 'admin-expiry.html', '⏳ Expiry'], ['transactions', 'admin-transactions.html', '🔁 Stock movements'], ['reports', 'admin-reports.html', '📈 Reports'], ['categories', 'admin-categories.html', '🏷️ Categories'],
      ['suppliers', 'admin-suppliers.html', '🚚 Suppliers'], ...(user.role === 'admin' ? [['users', 'admin-users.html', '👥 Users']] : []),
      ['catalog', 'medicines.html', '🛍️ Customer catalog'], ['profile', 'profile.html', '🙍 My profile']];
    wrap.className = 'app';
    wrap.innerHTML = `<aside class="sidebar" id="sidebar" aria-label="Main navigation"><div class="brand">💊 MediStore</div><nav>${items.map(i => `<a href="${i[1]}"${cur(i[0])}>${i[2]}</a>`).join('')}</nav></aside>
      <div class="main"><header class="topbar"><button class="menu-toggle" id="menuBtn" aria-label="Toggle menu" aria-controls="sidebar">☰</button><span class="spacer"></span>
      ${BELL_HTML}<span class="who">${esc(user.name)} · ${esc(user.role)}</span><button class="btn-sm btn-ghost" id="logoutBtn">Logout</button></header></div>`;
    wrap.querySelector('.main').append(content);
    wrap.querySelector('#menuBtn').addEventListener('click', () => wrap.querySelector('#sidebar').classList.toggle('open'));
  } else {
    const links = user ? [['home', homeFor(user), 'Home'], ['catalog', 'medicines.html', 'Medicines'], ['cart', 'cart.html', '🛒 Cart<span class="nav-count" id="cartCount" hidden></span>'], ['orders', 'my-orders.html', 'My orders'], ['profile', 'profile.html', 'My profile']]
                       : [['home', 'index.html', 'Home'], ['catalog', 'medicines.html', 'Medicines'], ['login', 'login.html', 'Login'], ['register', 'register.html', 'Register']];
    wrap.className = 'site';
    wrap.innerHTML = `<header class="sitebar"><a class="brand" href="index.html">💊 MediStore</a><nav style="display:contents">${links.map(i => `<a href="${i[1]}"${cur(i[0])}>${i[2]}</a>`).join('')}</nav>
      ${user ? `${BELL_HTML}<button class="btn-sm btn-ghost" id="logoutBtn">Logout</button>` : ''}</header>`;
    wrap.append(content);
  }
  document.body.prepend(wrap);
  const lb = $('#logoutBtn'); if (lb) lb.addEventListener('click', logout);
  if (user && user.role === 'customer') api('/cart').then(r => setCartCount(r.data.item_count)).catch(() => {});
  if (user) { initBell(); refreshBell(); }
}

/* ---------- list views: loading / empty / error states + pagination ---------- */
function listView({ tbody, pager, colspan, fetcher, row, empty = 'Nothing to show yet.' }) {
  let page = 1;
  async function load(p = page) {
    page = p; tbody.innerHTML = `<tr><td class="state" colspan="${colspan}">Loading…</td></tr>`;
    try {
      const res = await fetcher(page);
      tbody.innerHTML = res.data.length ? res.data.map(row).join('') : `<tr><td class="state" colspan="${colspan}">${esc(empty)}</td></tr>`;
      renderPager(pager, res.pagination, load);
      return res;
    } catch (e) { tbody.innerHTML = `<tr><td class="state error-text" colspan="${colspan}">${esc(errMsg(e))}</td></tr>`; }
  }
  return { load, reload: () => load(page) };
}
function renderPager(el, p, go) {
  if (!el) return;
  if (!p || p.pages <= 1) { el.innerHTML = p ? `<span class="muted">${p.total} result${p.total === 1 ? '' : 's'}</span>` : ''; return; }
  el.innerHTML = `<button class="btn-sm btn-ghost" data-p="${p.page - 1}" ${p.page <= 1 ? 'disabled' : ''}>← Prev</button>
    <span>Page ${p.page} of ${p.pages} · ${p.total} results</span><button class="btn-sm btn-ghost" data-p="${p.page + 1}" ${p.page >= p.pages ? 'disabled' : ''}>Next →</button>`;
  el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => go(+b.dataset.p)));
}
// Delegated click handling for row buttons: <button data-act="edit" data-id="5">
function onAction(container, handlers) {
  container.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b || !handlers[b.dataset.act]) return;
    handlers[b.dataset.act](b.dataset.id, b);
  });
}

/* ---------- dialogs ---------- */
function makeDialog(title, wide) {
  const d = document.createElement('dialog'); if (wide) d.className = 'wide';
  d.setAttribute('aria-labelledby', 'dlgTitle');
  d.innerHTML = `<div class="dlg-head"><h2 id="dlgTitle">${esc(title)}</h2><button type="button" class="btn-sm btn-ghost" data-close aria-label="Close">✕</button></div><div class="dlg-body"></div><div class="dlg-foot"></div>`;
  d.querySelector('[data-close]').addEventListener('click', () => d.close());
  d.addEventListener('close', () => d.remove());
  document.body.append(d); return d;
}
function openInfo(title, html, wide = true) { const d = makeDialog(title, wide); d.querySelector('.dlg-body').innerHTML = html; d.querySelector('.dlg-foot').innerHTML = '<button type="button" class="btn-ghost" data-close>Close</button>'; d.querySelector('.dlg-foot [data-close]').addEventListener('click', () => d.close()); d.showModal(); return d; }
function confirmBox(message, okLabel = 'Confirm', danger = true) {
  return new Promise(res => {
    const d = makeDialog('Please confirm'); let result = false;
    d.querySelector('.dlg-body').innerHTML = `<p>${esc(message)}</p>`;
    d.querySelector('.dlg-foot').innerHTML = `<button type="button" class="btn-ghost" data-no>Cancel</button><button type="button" class="${danger ? 'btn-danger' : ''}" data-yes>${esc(okLabel)}</button>`;
    d.querySelector('[data-no]').addEventListener('click', () => d.close());
    d.querySelector('[data-yes]').addEventListener('click', () => { result = true; d.close(); });
    d.addEventListener('close', () => res(result)); d.showModal();
  });
}
/* fields: [{name,label,type:'text|email|tel|number|password|textarea|select|checkbox', required, options:[[value,label]], full, step, min, max, maxlength, autocomplete}]
   onSubmit(values) may throw; the message (and per-field server errors) is shown inside the dialog. */
function openForm({ title, fields, values = {}, submitLabel = 'Save', onSubmit, intro = '' }) {
  const d = makeDialog(title);
  const input = (f) => {
    const id = 'f_' + f.name, v = values[f.name] ?? '', req = f.required ? ' required' : '', common = `id="${id}" name="${f.name}"${req}`;
    if (f.type === 'textarea') return `<textarea ${common} maxlength="${f.maxlength || 5000}">${esc(v)}</textarea>`;
    if (f.type === 'select') return `<select ${common}>${(f.options || []).map(o => `<option value="${esc(o[0])}" ${String(o[0]) === String(v) ? 'selected' : ''}>${esc(o[1])}</option>`).join('')}</select>`;
    if (f.type === 'checkbox') return `<label style="display:flex;align-items:center;margin:.3rem 0"><input type="checkbox" id="${id}" name="${f.name}" ${v === true || v === 1 || v === '1' ? 'checked' : ''}> ${esc(f.label)}</label>`;
    return `<input ${common} type="${f.type || 'text'}" value="${f.type === 'password' ? '' : esc(v)}" ${f.step ? `step="${f.step}"` : ''} ${f.min !== undefined ? `min="${f.min}"` : ''} ${f.max !== undefined ? `max="${f.max}"` : ''} ${f.maxlength ? `maxlength="${f.maxlength}"` : ''} ${f.autocomplete ? `autocomplete="${f.autocomplete}"` : ''}>`;
  };
  const body = d.querySelector('.dlg-body');
  body.innerHTML = `${intro}<form id="dlgForm" novalidate><div class="grid2">${fields.map(f => `<div class="${f.full ? 'full' : ''}">${f.type === 'checkbox' ? '' : `<label for="f_${f.name}">${esc(f.label)}${f.required ? ' *' : ''}</label>`}${input(f)}<div class="field-error" data-err="${f.name}" role="alert"></div></div>`).join('')}</div><div class="msg error" id="dlgMsg" role="alert"></div></form>`;
  d.querySelector('.dlg-foot').innerHTML = `<button type="button" class="btn-ghost" data-close2>Cancel</button><button type="submit" form="dlgForm" id="dlgSubmit">${esc(submitLabel)}</button>`;
  d.querySelector('[data-close2]').addEventListener('click', () => d.close());
  const form = $('#dlgForm', d);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    d.querySelectorAll('.field-error').forEach(x => x.textContent = ''); $('#dlgMsg', d).textContent = '';
    const out = {}; let bad = false;
    for (const f of fields) {
      const el = form.elements[f.name];
      out[f.name] = f.type === 'checkbox' ? el.checked : el.value.trim();
      if (f.required && f.type !== 'checkbox' && !out[f.name]) { $(`[data-err="${f.name}"]`, d).textContent = f.label + ' is required'; bad = true; }
    }
    if (bad) return;
    const btn = $('#dlgSubmit', d); btn.disabled = true;
    try { await onSubmit(out); d.close(); }
    catch (e) {
      if (e.errors) e.errors.forEach(x => { const t = $(`[data-err="${x.field}"]`, d); if (t) t.textContent = x.message; else $('#dlgMsg', d).textContent += x.message + ' '; });
      else $('#dlgMsg', d).textContent = e.message;
    } finally { btn.disabled = false; }
  });
  d.showModal(); const first = form.querySelector('input,select,textarea'); if (first) first.focus();
  return d;
}

/* ---------- orders & cart helpers ---------- */
const STATUS_CLASS = { Pending: 'warn', Confirmed: 'info', Processing: 'info', Packed: 'info', Dispatched: 'info', 'Out for Delivery': 'info', Delivered: 'ok', Cancelled: 'bad' };
const statusBadge = (s) => badge(s, STATUS_CLASS[s] || '');
const fdatetime = (d) => d ? String(d).slice(0, 16) : '—';
function setCartCount(n) { const c = $('#cartCount'); if (!c) return; c.textContent = n; c.hidden = !n; }
async function addToCart(medicineId, qty = 1) {
  try { const r = await api('/cart/items', { method: 'POST', body: { medicine_id: Number(medicineId), quantity: qty } }); setCartCount(r.data.item_count); toast('Added to cart'); return true; }
  catch (e) { toast(errMsg(e), 'error'); return false; }
}
const PURCHASE_CLASS = { Draft: 'warn', Confirmed: 'ok', Cancelled: 'bad' };
const purchaseBadge = (s) => badge(s, PURCHASE_CLASS[s] || '');
