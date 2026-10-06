async function api(path, options = {}) {
  const res = await fetch('/api' + path, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    ...options, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(data.message || 'Request failed'); e.errors = data.errors; throw e; }
  return data;
}
function bindForm(id, path, onSuccess) {
  const form = document.getElementById(id), msg = document.getElementById('msg'), btn = form.querySelector('button');
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); msg.textContent = ''; btn.disabled = true;
    try {
      const res = await api(path, { method: 'POST', body: Object.fromEntries(new FormData(form)) });
      msg.className = 'msg success'; msg.textContent = res.message || 'Success'; onSuccess(res);
    } catch (e) {
      msg.className = 'msg error';
      msg.textContent = e.errors ? e.errors.map(x => x.message).join('. ') : e.message;
    } finally { btn.disabled = false; }
  });
}
