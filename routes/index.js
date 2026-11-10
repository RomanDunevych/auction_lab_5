const express = require('express');
const wrap = require('../helpers/asyncHandler');
const { requireLogin, guestOnly, requirePermission: need } = require('../auth/middleware');

const home = require('../controllers/homeController');
const auth = require('../controllers/authController');
const lots = require('../controllers/lotController');
const categories = require('../controllers/categoryController');
const statuses = require('../controllers/statusController');
const users = require('../controllers/userController');
const bids = require('../controllers/bidController');
const history = require('../controllers/historyController');

const adminRoutes = require('./admin');

const router = express.Router();

// Права доступу описано в auth/permissions.js. Тут кожен маршрут захищається middleware need('дія'):
//   • відвідувача без права на дію перенаправляють на сторінку входу;
//   • авторизованого без права на дію зупиняє сторінка 403.
// Додаткові перевірки «лише власник» виконуються в контролерах (там відомий конкретний запис).

// Головна — доступна всім
router.get('/', wrap(home.index));

// Автентифікація
router.get('/login', guestOnly, auth.loginForm);
router.post('/login', guestOnly, auth.login);
router.get('/register', guestOnly, auth.registerForm);
router.post('/register', guestOnly, wrap(auth.register));
router.post('/logout', requireLogin, auth.logout);

// Лоти: перегляд — усім; створення — користувачам; зміна й видалення — власнику лоту або адміністратору
// (маршрут /lots/new має стояти ПЕРЕД /lots/:id)
router.get('/lots', wrap(lots.index));
router.get('/lots/new', need('lot:create'), wrap(lots.newForm));
router.post('/lots', need('lot:create'), wrap(lots.create));
router.get('/lots/:id', wrap(lots.show));
router.get('/lots/:id/edit', need('lot:edit'), wrap(lots.editForm));
router.post('/lots/:id/edit', need('lot:edit'), wrap(lots.update));
router.post('/lots/:id/delete', need('lot:delete'), wrap(lots.destroy));

// Категорії: перегляд — усім; керування — адміністратору
router.get('/categories', wrap(categories.index));
router.get('/categories/new', need('category:manage'), wrap(categories.newForm));
router.post('/categories', need('category:manage'), wrap(categories.create));
router.get('/categories/:id/edit', need('category:manage'), wrap(categories.editForm));
router.post('/categories/:id/edit', need('category:manage'), wrap(categories.update));
router.post('/categories/:id/delete', need('category:manage'), wrap(categories.destroy));

// Статуси лотів: лише адміністратор
router.get('/statuses', need('status:manage'), wrap(statuses.index));
router.get('/statuses/new', need('status:manage'), wrap(statuses.newForm));
router.post('/statuses', need('status:manage'), wrap(statuses.create));
router.get('/statuses/:id/edit', need('status:manage'), wrap(statuses.editForm));
router.post('/statuses/:id/edit', need('status:manage'), wrap(statuses.update));
router.post('/statuses/:id/delete', need('status:manage'), wrap(statuses.destroy));

// Користувачі: список і створення — адміністратор; профіль і редагування — власник профілю або адміністратор
// (маршрут /users/new має стояти ПЕРЕД /users/:id)
router.get('/users', need('user:list'), wrap(users.index));
router.get('/users/new', need('user:create'), wrap(users.newForm));
router.post('/users', need('user:create'), wrap(users.create));
router.get('/users/:id', need('user:view'), wrap(users.show));
router.get('/users/:id/edit', need('user:edit'), wrap(users.editForm));
router.post('/users/:id/edit', need('user:edit'), wrap(users.update));
router.post('/users/:id/delete', need('user:delete'), wrap(users.destroy));

// Ставки: для авторизованих; змінювати й видаляти можна лише свої (адміністратор — будь-які)
router.get('/bids', need('bid:view'), wrap(bids.index));
router.get('/bids/new', need('bid:create'), wrap(bids.newForm));
router.post('/bids', need('bid:create'), wrap(bids.create));
router.get('/bids/:id/edit', need('bid:edit'), wrap(bids.editForm));
router.post('/bids/:id/edit', need('bid:edit'), wrap(bids.update));
router.post('/bids/:id/delete', need('bid:delete'), wrap(bids.destroy));

// Історія ставок: перегляд — авторизованим; керування — адміністратору
router.get('/history', need('history:view'), wrap(history.index));
router.get('/history/new', need('history:manage'), wrap(history.newForm));
router.post('/history', need('history:manage'), wrap(history.create));
router.get('/history/:id/edit', need('history:manage'), wrap(history.editForm));
router.post('/history/:id/edit', need('history:manage'), wrap(history.update));
router.post('/history/:id/delete', need('history:manage'), wrap(history.destroy));

// Адмін-панель: захищена область керування даними всіх таблиць (див. routes/admin.js)
router.use('/admin', adminRoutes);

module.exports = router;
