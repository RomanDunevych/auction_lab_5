// Тести перевірок доступу в контролерах (власник ресурсу, підробка полів форми).
// Контролери виконуються із заглушками моделей, валідаторів і Passport, без бази даних.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { stub, installStubs, fakeRes, fakeReq } = require('./helpers/stubs');

// ---------- Заглушки ----------
const calls = {};            // що саме викликали контролери
const models = {
  sequelize: { transaction: async (fn) => fn({}) },
  Lot: {}, Category: {}, LotStatus: {}, User: {}, Bid: {}, BidHistory: {},
};
const passportState = { user: false, error: null };

stub('sequelize', { Op: { or: Symbol('or'), like: Symbol('like') } });
stub('models', models);
stub('passport', {
  authenticate: (strategy, callback) => () => callback(passportState.error, passportState.user),
});
stub('validators/lot', {
  validateLot: async (body) => { calls.lotBody = body; return { values: {}, errors: { title: 'stop' } }; },
});
stub('validators/bid', {
  validateNewBid: async (body) => { calls.bidBody = body; return { values: { lotId: 1, userId: Number(body.userId), amount: 10 }, errors: {} }; },
  validateBidAmount: () => ({ values: { amount: 10 }, errors: {} }),
});
stub('services/bidService', {
  placeBid: async (v) => { calls.placeBid = v; },
  updateBidAmount: async (v) => { calls.updateBid = v; },
  deleteBid: async (v) => { calls.deleteBid = v; },
});
stub('validators/user', {
  validateUser: async (body) => {
    calls.userBody = body;
    return { values: { username: 'x', email: 'x@x.com', role: body.role, password: 'Abc12345' }, errors: calls.userErrors || {} };
  },
});
installStubs();

const lots = require('../controllers/lotController');
const bids = require('../controllers/bidController');
const users = require('../controllers/userController');
const auth = require('../controllers/authController');

const guest = null;
const ivan = { id: 2, username: 'ivan', role: 'user' };
const olena = { id: 3, username: 'olena', role: 'user' };
const admin = { id: 1, username: 'admin', role: 'admin' };

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  passportState.user = false;
  passportState.error = null;
  models.Category.findAll = async () => [];
  models.LotStatus.findAll = async () => [];
  models.User.findAll = async () => [];
  models.Lot.findAll = async () => [];
  models.Bid.count = async () => 0;
  models.Lot.count = async () => 0;
  models.BidHistory.count = async () => 0;
  models.BidHistory.destroy = async () => {};
  models.Bid.destroy = async () => {};
});

const status = (res) => res.out.code ?? res.code;

// ---------- Лоти ----------
describe('lotController: власник лоту', () => {
  const lotOf = (sellerId) => ({
    id: 5, sellerId, title: 'Годинник', startPrice: 100, status: { name: 'draft' },
    toJSON() { return { id: 5, sellerId }; },
    destroy: async () => { calls.lotDestroyed = true; },
  });

  it('видалити чужий лот не можна (403), лот не видаляється', async () => {
    models.Lot.findByPk = async () => lotOf(1);
    const res = fakeRes();
    await lots.destroy(fakeReq({ user: ivan, params: { id: 5 } }), res);
    assert.equal(res.out.view, 'error');
    assert.equal(res.code, 403);
    assert.equal(calls.lotDestroyed, undefined);
  });

  it('власник видаляє свій лот', async () => {
    models.Lot.findByPk = async () => lotOf(2);
    const res = fakeRes();
    await lots.destroy(fakeReq({ user: ivan, params: { id: 5 } }), res);
    assert.equal(calls.lotDestroyed, true);
    assert.deepEqual(res.out, { type: 'redirect', url: '/lots?ok=deleted' });
  });

  it('адміністратор видаляє чужий лот', async () => {
    models.Lot.findByPk = async () => lotOf(2);
    const res = fakeRes();
    await lots.destroy(fakeReq({ user: admin, params: { id: 5 } }), res);
    assert.equal(calls.lotDestroyed, true);
  });

  it('форма редагування чужого лоту закрита', async () => {
    models.Lot.findByPk = async () => lotOf(1);
    const res = fakeRes();
    await lots.editForm(fakeReq({ user: olena, params: { id: 5 } }), res);
    assert.equal(res.code, 403);
  });

  it('форма редагування власного лоту відкривається', async () => {
    models.Lot.findByPk = async () => lotOf(3);
    const res = fakeRes();
    await lots.editForm(fakeReq({ user: olena, params: { id: 5 } }), res);
    assert.equal(res.out.view, 'lots/form');
    assert.equal(res.code, 200);
  });

  it('збереження змін чужого лоту закрите', async () => {
    models.Lot.findByPk = async () => lotOf(1);
    const res = fakeRes();
    await lots.update(fakeReq({ user: ivan, params: { id: 5 }, body: { title: 'Хакнуто' } }), res);
    assert.equal(res.code, 403);
    assert.equal(calls.lotBody, undefined, 'валідатор не мав навіть викликатися');
  });

  it('користувач не може підмінити продавця при редагуванні свого лоту', async () => {
    models.Lot.findByPk = async () => lotOf(2);
    await lots.update(fakeReq({ user: ivan, params: { id: 5 }, body: { sellerId: '3', title: 'x' } }), fakeRes());
    assert.equal(calls.lotBody.sellerId, '2');
  });

  it('адміністратор може змінити продавця', async () => {
    models.Lot.findByPk = async () => lotOf(2);
    await lots.update(fakeReq({ user: admin, params: { id: 5 }, body: { sellerId: '3', title: 'x' } }), fakeRes());
    assert.equal(calls.lotBody.sellerId, '3');
  });

  it('при створенні користувач завжди стає продавцем (поле sellerId з форми ігнорується)', async () => {
    await lots.create(fakeReq({ user: ivan, method: 'POST', body: { sellerId: '1', title: 'x' } }), fakeRes());
    assert.equal(calls.lotBody.sellerId, '2');
  });

  it('адміністратор при створенні обирає продавця', async () => {
    await lots.create(fakeReq({ user: admin, method: 'POST', body: { sellerId: '3', title: 'x' } }), fakeRes());
    assert.equal(calls.lotBody.sellerId, '3');
  });
});

// ---------- Ставки ----------
describe('bidController: автор ставки', () => {
  const bidOf = (userId) => ({ id: 7, userId, lot: { id: 1, title: 'L' }, bidder: { id: userId, username: 'u' }, amount: 120 });

  it('користувач робить ставку лише від свого імені', async () => {
    const res = fakeRes();
    await bids.create(fakeReq({ user: ivan, method: 'POST', body: { lotId: '1', userId: '3', amount: '200' } }), res);
    assert.equal(calls.bidBody.userId, '2');
    assert.equal(calls.placeBid.userId, 2);
    assert.deepEqual(res.out, { type: 'redirect', url: '/lots/1?ok=bid' });
  });

  it('адміністратор може зробити ставку від імені іншого користувача', async () => {
    await bids.create(fakeReq({ user: admin, method: 'POST', body: { lotId: '1', userId: '3', amount: '200' } }), fakeRes());
    assert.equal(calls.bidBody.userId, '3');
    assert.equal(calls.placeBid.userId, 3);
  });

  it('редагувати й видаляти чужу ставку не можна', async () => {
    models.Bid.findByPk = async () => bidOf(3);
    for (const action of ['editForm', 'update', 'destroy']) {
      const res = fakeRes();
      await bids[action](fakeReq({ user: ivan, params: { id: 7 }, method: 'POST', body: { amount: '300' } }), res);
      assert.equal(res.code, 403, action);
    }
    assert.equal(calls.updateBid, undefined);
    assert.equal(calls.deleteBid, undefined);
  });

  it('автор редагує й видаляє власну ставку', async () => {
    models.Bid.findByPk = async () => bidOf(2);
    const up = fakeRes();
    await bids.update(fakeReq({ user: ivan, params: { id: 7 }, method: 'POST', body: { amount: '300' } }), up);
    assert.equal(calls.updateBid.bidId, 7);
    const del = fakeRes();
    await bids.destroy(fakeReq({ user: ivan, params: { id: 7 }, method: 'POST' }), del);
    assert.equal(calls.deleteBid.bidId, 7);
    assert.deepEqual(del.out, { type: 'redirect', url: '/bids?ok=deleted' });
  });

  it('адміністратор видаляє чужу ставку', async () => {
    models.Bid.findByPk = async () => bidOf(3);
    await bids.destroy(fakeReq({ user: admin, params: { id: 7 }, method: 'POST' }), fakeRes());
    assert.equal(calls.deleteBid.bidId, 7);
  });
});

// ---------- Користувачі ----------
describe('userController: профіль і ролі', () => {
  const userRow = (id, role = 'user') => ({
    id, role, username: `u${id}`, email: `u${id}@mail.com`, bids: [], lotsForSale: [], wonLots: [],
    update: async (changes) => { calls.userUpdate = changes; },
    destroy: async () => { calls.userDestroyed = id; },
  });

  it('чужий профіль закритий для користувача, відкритий для адміністратора', async () => {
    models.User.findByPk = async (id) => userRow(Number(id));
    const denied = fakeRes();
    await users.show(fakeReq({ user: ivan, params: { id: 3 } }), denied);
    assert.equal(denied.code, 403);

    const own = fakeRes();
    await users.show(fakeReq({ user: ivan, params: { id: 2 } }), own);
    assert.equal(own.out.view, 'users/show');

    const byAdmin = fakeRes();
    await users.show(fakeReq({ user: admin, params: { id: 3 } }), byAdmin);
    assert.equal(byAdmin.out.view, 'users/show');
  });

  it('редагувати чужий профіль не можна', async () => {
    models.User.findByPk = async (id) => userRow(Number(id));
    for (const action of ['editForm', 'update']) {
      const res = fakeRes();
      await users[action](fakeReq({ user: ivan, params: { id: 3 }, method: 'POST', body: {} }), res);
      assert.equal(res.code, 403, action);
    }
    assert.equal(calls.userUpdate, undefined);
  });

  it('користувач не може підвищити собі роль до адміністратора', async () => {
    models.User.findByPk = async (id) => userRow(Number(id), 'user');
    const res = fakeRes();
    await users.update(fakeReq({ user: ivan, params: { id: 2 }, method: 'POST', body: { role: 'admin', username: 'ivan' } }), res);
    assert.equal(calls.userBody.role, 'user');
    assert.equal(calls.userUpdate.role, 'user');
    assert.deepEqual(res.out, { type: 'redirect', url: '/users/2?ok=updated' });
  });

  it('адміністратор змінює роль іншому користувачеві', async () => {
    models.User.findByPk = async (id) => userRow(Number(id), 'user');
    await users.update(fakeReq({ user: admin, params: { id: 2 }, method: 'POST', body: { role: 'admin' } }), fakeRes());
    assert.equal(calls.userUpdate.role, 'admin');
  });

  it('не можна позбавити прав єдиного адміністратора', async () => {
    models.User.findByPk = async (id) => userRow(Number(id), 'admin');
    models.User.count = async () => 1;
    const res = fakeRes();
    await users.update(fakeReq({ user: admin, params: { id: 1 }, method: 'POST', body: { role: 'user' } }), res);
    assert.equal(res.code, 400);
    assert.match(res.out.data.errors.role, /єдиного адміністратора/);
    assert.equal(calls.userUpdate, undefined);
  });

  it('якщо адміністраторів кілька, роль змінити можна', async () => {
    models.User.findByPk = async (id) => userRow(Number(id), 'admin');
    models.User.count = async () => 2;
    await users.update(fakeReq({ user: admin, params: { id: 1 }, method: 'POST', body: { role: 'user' } }), fakeRes());
    assert.equal(calls.userUpdate.role, 'user');
  });

  it('адміністратор не може видалити власний обліковий запис', async () => {
    models.User.findByPk = async (id) => userRow(Number(id), 'admin');
    const res = fakeRes();
    await users.destroy(fakeReq({ user: admin, params: { id: 1 }, method: 'POST' }), res);
    assert.equal(res.out.type, 'redirect');
    assert.match(decodeURIComponent(res.out.url), /error=Не можна видалити власний/);
    assert.equal(calls.userDestroyed, undefined);
  });

  it('адміністратор видаляє іншого користувача без пов’язаних даних', async () => {
    models.User.findByPk = async (id) => userRow(Number(id));
    const res = fakeRes();
    await users.destroy(fakeReq({ user: admin, params: { id: 3 }, method: 'POST' }), res);
    assert.equal(calls.userDestroyed, 3);
    assert.deepEqual(res.out, { type: 'redirect', url: '/users?ok=deleted' });
  });
});

// ---------- Вхід, реєстрація, вихід ----------
describe('authController', () => {
  const login = (body, query = {}) => new Promise((resolve, reject) => {
    const req = fakeReq({ method: 'POST', body, query });
    const res = fakeRes();
    const originalRedirect = res.redirect;
    res.redirect = (url) => { originalRedirect(url); resolve({ req, res }); };
    const originalRender = res.render;
    res.render = (...args) => { originalRender(...args); resolve({ req, res }); };
    auth.login(req, res, (err) => (err ? reject(err) : resolve({ req, res })));
  });

  it('порожня форма входу: 400 і помилки полів (Passport не викликається)', async () => {
    passportState.user = ivan;
    const { res, req } = await login({});
    assert.equal(res.code, 400);
    assert.equal(res.out.view, 'auth/login');
    assert.deepEqual(Object.keys(res.out.data.errors).sort(), ['login', 'password']);
    assert.equal(req.user, null);
  });

  it('невірні дані: 401, загальне повідомлення, пароль у форму не повертається', async () => {
    const { res, req } = await login({ login: 'ivan', password: 'wrong' });
    assert.equal(res.code, 401);
    assert.match(res.out.data.errors._form, /Невірне/);
    assert.equal(res.out.data.values.login, 'ivan');
    assert.equal(res.out.data.values.password, undefined);
    assert.equal(req.user, null);
  });

  it('успішний вхід: сесія створюється, перенаправлення на головну', async () => {
    passportState.user = ivan;
    const { res, req } = await login({ login: 'ivan', password: 'User1234' });
    assert.equal(req.user, ivan);
    assert.deepEqual(res.out, { type: 'redirect', url: '/?ok=login' });
  });

  it('після входу повертає на запитану сторінку', async () => {
    passportState.user = ivan;
    const { res } = await login({ login: 'ivan', password: 'User1234', next: '/lots/3' });
    assert.equal(res.out.url, '/lots/3?ok=login');
  });

  it('зовнішня адреса в next ігнорується', async () => {
    passportState.user = ivan;
    const { res } = await login({ login: 'ivan', password: 'User1234', next: '//evil.example' });
    assert.equal(res.out.url, '/?ok=login');
    const second = await login({ login: 'ivan', password: 'User1234', next: 'https://evil.example' });
    assert.equal(second.res.out.url, '/?ok=login');
  });

  it('помилка Passport передається далі в обробник помилок', async () => {
    passportState.error = new Error('boom');
    await assert.rejects(() => login({ login: 'ivan', password: 'x' }), /boom/);
  });

  it('реєстрація: роль завжди «user», навіть якщо в запиті role=admin', async () => {
    models.User.create = async (data) => { calls.created = data; return { id: 10, ...data }; };
    const req = fakeReq({ method: 'POST', body: { username: 'new', email: 'n@n.com', password: 'Abc12345', passwordConfirm: 'Abc12345', role: 'admin' } });
    const res = fakeRes();
    await auth.register(req, res, (e) => { throw e; });
    assert.equal(calls.userBody.role, 'user');
    assert.equal(calls.created.role, 'user');
    assert.notEqual(calls.created.passwordHash, 'Abc12345');
    assert.match(calls.created.passwordHash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
    assert.equal(req.user.id, 10, 'після реєстрації користувач входить автоматично');
    assert.deepEqual(res.out, { type: 'redirect', url: '/?ok=registered' });
  });

  it('реєстрація з помилками: 400, паролі й роль у форму не повертаються', async () => {
    calls.userErrors = { username: 'Вкажіть ім’я користувача' };
    const req = fakeReq({ method: 'POST', body: { username: '', password: 'Abc12345', passwordConfirm: 'Abc12345', role: 'admin' } });
    const res = fakeRes();
    await auth.register(req, res, (e) => { throw e; });
    assert.equal(res.code, 400);
    assert.equal(res.out.data.values.password, undefined);
    assert.equal(res.out.data.values.passwordConfirm, undefined);
    assert.equal(res.out.data.values.role, undefined);
  });

  it('вихід: сесія завершується, cookie очищується', () => {
    const req = fakeReq({ user: ivan, method: 'POST' });
    const res = fakeRes();
    auth.logout(req, res, (e) => { throw e; });
    assert.equal(req.user, null);
    assert.deepEqual(res.cleared, ['auction.sid']);
    assert.deepEqual(res.out, { type: 'redirect', url: '/login?ok=logout' });
  });
});
