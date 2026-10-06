bindForm('f', '/auth/login', r => { location.href = r.data.role === 'customer' ? 'customer-dashboard.html' : 'admin-dashboard.html'; });
