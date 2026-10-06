/* Thin wrapper around the locally-served Chart.js (loaded before this file). Gives consistent styling, accessible labels and an empty state. */
const CHART_COLORS = ['#0d9488', '#2563eb', '#d97706', '#9333ea', '#dc2626', '#0891b2', '#65a30d', '#db2777', '#475569', '#ca8a04'];
const STATUS_COLORS = { Healthy: '#16a34a', 'Expiring soon': '#d97706', 'Low stock': '#ea580c', Expired: '#dc2626', 'Out of stock': '#64748b' };
if (window.Chart) {
  Chart.defaults.font.family = 'system-ui, -apple-system, "Segoe UI", sans-serif';
  Chart.defaults.color = '#134e4a';
  Chart.defaults.maintainAspectRatio = false;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
}
const _charts = new Map();
// box: element containing (or to contain) the canvas. empty: when truthy, shows `emptyText` instead of an empty chart.
function drawChart(box, config, ariaLabel, empty, emptyText = 'No data yet.') {
  if (_charts.has(box)) { _charts.get(box).destroy(); _charts.delete(box); }
  if (empty || !window.Chart) { box.innerHTML = `<div class="chart-empty">${esc(window.Chart ? emptyText : 'Charts could not be loaded.')}</div>`; return null; }
  box.innerHTML = `<canvas role="img" aria-label="${esc(ariaLabel)}"></canvas>`;
  const chart = new Chart(box.firstElementChild, config); _charts.set(box, chart); return chart;
}
const shortDate = (iso) => { const [, m, d] = iso.split('-'); return `${d}/${m}`; };
const monthName = (ym) => new Date(ym + '-01T00:00:00').toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
