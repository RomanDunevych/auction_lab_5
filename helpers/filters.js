// Фільтри для шаблонів Nunjucks: форматування дат, грошей та підписи статусів.

const { statusLabel, eventLabel } = require('./labels');

function pad(n) {
  return String(n).padStart(2, '0');
}

module.exports = function registerFilters(env) {
  // 12.10.2026, 21:56
  env.addFilter('date', (value) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString('uk-UA', {
      day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
  });

  // Значення для <input type="datetime-local">: 2026-10-12T21:56
  env.addFilter('inputDate', (value) => {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  });

  // 1 250,00 грн
  env.addFilter('money', (value) => {
    const n = Number(value);
    if (Number.isNaN(n)) return '—';
    return `${n.toLocaleString('uk-UA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} грн`;
  });

  env.addFilter('statusLabel', statusLabel);
  env.addFilter('eventLabel', eventLabel);
};
