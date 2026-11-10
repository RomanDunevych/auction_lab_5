// Middleware авторизації: вхід, перевірка прав, дані користувача для шаблонів.

const { mayAttempt, can, roleOf, ROLE_LABELS } = require('./permissions');
const { forbidden } = require('../helpers/respond');

// Безпечна адреса для повернення після входу: лише відносний шлях усередині сайту.
// Інакше був би «відкритий редирект» (наприклад, ?next=//evil.example).
function safeNext(value) {
  if (typeof value !== 'string' || value.length > 300) return null;
  if (value === '/') return value;
  // Не допускаємо «//», зворотних скісних рисок і керувальних символів (переноси рядків тощо)
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;
  return /^\/[^/]/.test(value) ? value : null;
}

// Додає параметр до адреси: /lots?x=1 + ok=login → /lots?x=1&ok=login
function withQuery(path, key, value) {
  return `${path}${path.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}

// Перенаправлення неавторизованого відвідувача на сторінку входу.
// Для GET-запиту запам’ятовуємо адресу, щоб повернути користувача після входу.
function redirectToLogin(req, res, message = 'Для цієї дії потрібно увійти в систему') {
  const params = new URLSearchParams();
  if (req.method === 'GET' && safeNext(req.originalUrl)) params.set('next', req.originalUrl);
  params.set('error', message);
  return res.redirect(`/login?${params.toString()}`);
}

// Лише для авторизованих
function requireLogin(req, res, next) {
  if (req.user) return next();
  return redirectToLogin(req, res);
}

// Лише для відвідувачів (сторінки входу й реєстрації)
function guestOnly(req, res, next) {
  if (req.user) return res.redirect('/');
  return next();
}

// Захист маршруту за таблицею прав: requirePermission('category:manage')
// Відвідувачу — перенаправлення на вхід; авторизованому без прав — 403.
function requirePermission(action) {
  return (req, res, next) => {
    if (mayAttempt(req.user, action)) return next();
    if (!req.user) return redirectToLogin(req, res);
    return forbidden(res);
  };
}

// Дані для шаблонів: поточний користувач, його роль і функція can(дія, ресурс)
function authLocals(req, res, next) {
  const role = roleOf(req.user);
  res.locals.currentUser = req.user || null;
  res.locals.role = role;
  res.locals.roleLabel = ROLE_LABELS[role];
  res.locals.can = (action, resource) => can(req.user, action, resource);
  next();
}

module.exports = {
  safeNext, withQuery, redirectToLogin, requireLogin, guestOnly, requirePermission, authLocals,
};
