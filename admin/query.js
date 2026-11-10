// Параметри списків адмін-панелі: пошук, сортування, сторінки.
// Усе тут — чисті функції без звернень до бази даних, тому їх легко перевірити тестами.

const { Op } = require('sequelize');

const PAGE_SIZE = 10;
const MAX_QUERY_LENGTH = 100;
const MAX_PAGE = 100000;

// Розбір параметрів ?q=&sort=&dir=&page=.
// Поле сортування береться ЛИШЕ зі списку дозволених у ресурсі: так користувач не може
// підставити в ORDER BY довільне ім’я стовпця.
function parseListQuery(query, resource) {
  const q = String(query.q || '').trim().slice(0, MAX_QUERY_LENGTH);

  const sortable = resource.columns.filter((c) => c.sort).map((c) => c.sort);
  const sort = sortable.includes(query.sort) ? query.sort : resource.defaultSort.field;

  let dir = resource.defaultSort.dir;
  if (query.dir === 'asc') dir = 'ASC';
  if (query.dir === 'desc') dir = 'DESC';

  let page = Number.parseInt(query.page, 10);
  if (!(page >= 1)) page = 1;
  if (page > MAX_PAGE) page = MAX_PAGE;

  return {
    q, sort, dir, page, pageSize: PAGE_SIZE,
  };
}

// SQLite порівнює кирилицю в LIKE з урахуванням регістру, тому шукаємо за кількома варіантами
// написання: як введено, малими, великими літерами та з великої літери.
function likeVariants(term) {
  const lower = term.toLowerCase();
  const capitalized = lower.charAt(0).toUpperCase() + lower.slice(1);
  return [...new Set([term, lower, term.toUpperCase(), capitalized])];
}

// Умова WHERE для пошуку: за текстовими полями ресурсу та (якщо введено число) за id
function buildWhere(resource, q) {
  if (!q) return {};
  const conditions = [];
  for (const field of resource.searchFields) {
    for (const variant of likeVariants(q)) {
      conditions.push({ [field]: { [Op.like]: `%${variant}%` } });
    }
  }
  if (/^\d{1,9}$/.test(q)) conditions.push({ id: Number(q) });
  // Нічого, за чим можна шукати, — порожній результат (id завжди більше нуля)
  if (!conditions.length) return { id: 0 };
  return { [Op.or]: conditions };
}

// Відомості про сторінку: межі, наявність попередньої/наступної
function pageInfo(total, page, pageSize) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), totalPages);
  const offset = (current - 1) * pageSize;
  return {
    total,
    totalPages,
    page: current,
    offset,
    from: total ? offset + 1 : 0,
    to: Math.min(total, offset + pageSize),
    hasPrev: current > 1,
    hasNext: current < totalPages,
  };
}

// Номери сторінок для навігації: перша, остання та сусідні з поточною; null — пропуск («…»)
function pageWindow(current, totalPages) {
  const wanted = new Set([1, totalPages, current - 1, current, current + 1]);
  const pages = [...wanted].filter((n) => n >= 1 && n <= totalPages).sort((a, b) => a - b);
  const result = [];
  pages.forEach((n, i) => {
    if (i > 0 && n - pages[i - 1] > 1) result.push(null);
    result.push(n);
  });
  return result;
}

// Адреса списку з параметрами: /admin/lots?q=...&sort=...&dir=...&page=...
function listUrl(base, { q, sort, dir, page }) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (sort) params.set('sort', sort);
  if (dir) params.set('dir', dir.toLowerCase());
  if (page && page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `${base}?${query}` : base;
}

module.exports = {
  PAGE_SIZE, parseListQuery, likeVariants, buildWhere, pageInfo, pageWindow, listUrl,
};
