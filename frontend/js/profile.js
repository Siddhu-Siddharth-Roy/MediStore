(async () => {
  const user = await requireUser(); layout(user, 'profile');
  const setErr = (form, errs) => { form.querySelectorAll('.field-error').forEach(x => x.textContent = ''); (errs || []).forEach(e => { const t = form.querySelector(`[data-err="${e.field}"]`); if (t) t.textContent = e.message; }); };
  function fill(u) { $('#name').value = u.name; $('#email').value = u.email; $('#phone').value = u.phone || ''; $('#meta').textContent = `Role: ${u.role} · Member since ${fdate(u.created_at)}`; }
  try { fill((await api('/users/me')).data); } catch (e) { toast(errMsg(e), 'error'); }
  const submit = (form, path, done) => form.addEventListener('submit', async (ev) => {
    ev.preventDefault(); setErr(form); const btn = form.querySelector('button'); btn.disabled = true;
    try { const res = await api(path, { method: 'PUT', body: Object.fromEntries(new FormData(form)) }); toast(res.message); done(res); }
    catch (e) { if (e.errors) setErr(form, e.errors); else toast(e.message, 'error'); } finally { btn.disabled = false; }
  });
  submit($('#pf'), '/users/me', r => fill(r.data));
  submit($('#pw'), '/users/me/password', () => $('#pw').reset());
})();
