const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const { notFound, errorHandler } = require('./middleware/errorMiddleware');

const app = express();
app.use(helmet());
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));

app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/categories', require('./routes/categoryRoutes'));
app.use('/api/medicines', require('./routes/medicineRoutes'));
app.use('/api/suppliers', require('./routes/supplierRoutes'));
app.use('/api/inventory', require('./routes/inventoryRoutes'));
app.use('/api/notifications', require('./routes/notificationRoutes'));
app.use('/api/cart', require('./routes/cartRoutes'));
app.use('/api/orders', require('./routes/orderRoutes'));
app.use('/api/purchases', require('./routes/purchaseRoutes'));
app.use('/api/dashboard', require('./routes/dashboardRoutes'));
app.use('/api/reports', require('./routes/reportRoutes'));

// Chart.js is served from our own origin (the CSP only allows scripts from 'self'; no CDN needed).
app.use('/vendor/chart.js', express.static(path.join(__dirname, '../node_modules/chart.js/dist'), { maxAge: '7d' }));
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/api', notFound);
app.use(errorHandler);
module.exports = app;
