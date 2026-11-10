const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const session = require('express-session');
const SequelizeStore = require('connect-session-sequelize')(session.Store);
const passport = require('passport');

const { sequelize, LotStatus } = require('./models');
const seed = require('./seed');
const registerFilters = require('./helpers/filters');
const routes = require('./routes');
const { configure: configurePassport } = require('./auth/passport');
const { authLocals } = require('./auth/middleware');

const app = express();

// --- Шаблонізатор Nunjucks ---
const env = nunjucks.configure(path.join(__dirname, 'views'), {
  autoescape: true, // екранування HTML (захист від XSS)
  express: app,
  noCache: true,    // шаблони перечитуються при кожному запиті (зручно під час розробки)
});
registerFilters(env);
app.set('view engine', 'njk');

// --- Проміжні обробники (middleware) ---
app.use(express.urlencoded({ extended: false })); // розбір даних HTML-форм у req.body (прості пари «поле = значення»)
app.use(express.static(path.join(__dirname, 'public'))); // CSS та інші статичні файли

// --- Сесії та Passport.js ---
// Сесії зберігаються в базі даних (таблиця sessions), тому після перезапуску сервера
// (nodemon перезапускає його при кожному збереженні файлу) користувачів не «розлогінює».
const sessionStore = new SequelizeStore({ db: sequelize });
if (!process.env.SESSION_SECRET) {
  console.warn('SESSION_SECRET не задано: використовується ключ для розробки. Для реального сайту задайте власний.');
}
app.use(session({
  name: 'auction.sid',
  secret: process.env.SESSION_SECRET || 'dev-only-secret-change-me',
  store: sessionStore,
  resave: false,
  saveUninitialized: false, // сесія створюється лише після входу
  cookie: {
    httpOnly: true,                                  // cookie недоступна для JavaScript (захист від викрадення через XSS)
    sameSite: 'lax',                                 // cookie не надсилається з POST-запитів інших сайтів (захист від CSRF)
    secure: process.env.NODE_ENV === 'production',   // у production — лише через HTTPS
    maxAge: 24 * 60 * 60 * 1000,                     // 1 доба
  },
}));
configurePassport(passport);
app.use(passport.initialize());
app.use(passport.session()); // відновлює req.user із сесії
app.use(authLocals);         // currentUser, role, can() — для шаблонів

// Повідомлення про успіх/помилку, що передаються через адресу (?ok=... / ?error=...)
const NOTICES = {
  created: 'Запис створено',
  updated: 'Зміни збережено',
  deleted: 'Запис видалено',
  bid: 'Ставку прийнято',
  login: 'Ви увійшли в систему',
  logout: 'Ви вийшли з системи',
  registered: 'Реєстрацію завершено, ласкаво просимо!',
};
app.use((req, res, next) => {
  res.locals.currentPath = req.path;
  res.locals.notice = Object.hasOwn(NOTICES, req.query.ok) ? NOTICES[req.query.ok] : null;
  res.locals.error = typeof req.query.error === 'string' ? req.query.error : null;
  next();
});

// --- Маршрути ---
app.use('/', routes);

// 404
app.use((req, res) => {
  res.status(404).render('error', { title: 'Не знайдено', code: 404, message: 'Сторінку не знайдено' });
});

// Обробник помилок (4 аргументи)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  // Помилка могла виникнути до підключення authLocals: шаблонам усе одно потрібна функція can()
  if (!res.locals.can) res.locals.can = () => false;
  res.status(500).render('error', { title: 'Помилка', code: 500, message: 'Внутрішня помилка сервера' });
});

// --- Запуск ---
(async () => {
  await sequelize.sync(); // створює таблиці (у т. ч. sessions), якщо їх ще немає (дані НЕ видаляються)
  await sessionStore.sync();
  if ((await LotStatus.count()) === 0) {
    await seed(); // тестові дані лише для порожньої бази
  }
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server: http://localhost:${port}`));
})();
