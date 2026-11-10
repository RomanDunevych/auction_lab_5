// Тести описів ресурсів адмін-панелі (admin/resources.js): бізнес-правила створення,
// зміни та видалення записів. Моделі та сервіси замінені заглушками, база даних не потрібна.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { stub, installStubs } = require('./helpers/stubs');

// ---------- Заглушки ----------
const log = [];          // журнал викликів: [назва, аргументи]
const state = {};        // налаштування сценарію
const rec = (name, ...args) => log.push([name, ...args]);
const called = (name) => log.filter((l) => l[0] === name);

const model = (name) => ({
  findAll: async (o) => { rec(`${name}.findAll`, o); return (state[`${name}.all`] || []); },
  findByPk: async (id, o) => { rec(`${name}.findByPk`, id, o); return state[`${name}.byPk`] || null; },
  findOne: async (o) => { rec(`${name}.findOne`, o); return state[`${name}.one`] || null; },
  count: async (o) => { rec(`${name}.count`, o); const v = state[`${name}.count`]; return typeof v === 'function' ? v(o) : (v || 0); },
  create: async (v, o) => { rec(`${name}.create`, v, o); return { id: 100, ...v }; },
  destroy: async (o) => { rec(`${name}.destroy`, o); },
});

const models = {
  sequelize: { transaction: async (fn) => { rec('transaction'); return fn({ tx: true }); } },
  User: model('User'),
  Category: model('Category'),
  LotStatus: model('LotStatus'),
  Lot: model('Lot'),
  Bid: model('Bid'),
  BidHistory: model('BidHistory'),
};

const services = {
  placeBid: async (v) => { rec('placeBid', v); if (state.placeBidError) throw state.placeBidError; return { id: 1 }; },
  updateBidAmount: async (v) => { rec('updateBidAmount', v); },
  deleteBid: async (v) => { rec('deleteBid', v); },
};
const validators = {
  'validators/lot': { validateLot: (b, c) => { rec('validateLot', b, c); return { values: b, errors: {} }; } },
  'validators/category': { validateCategory: (b, c) => { rec('validateCategory', b, c); return { values: b, errors: {} }; } },
  'validators/status': { validateStatus: (b, c) => { rec('validateStatus', b, c); return { values: b, errors: {} }; } },
  'validators/user': { validateUser: (b, c) => { rec('validateUser', b, c); return { values: b, errors: {} }; } },
  'validators/bid': {
    validateNewBid: (b) => { rec('validateNewBid', b); return { values: b, errors: {} }; },
    validateBidAmount: (b) => { rec('validateBidAmount', b); return { values: b, errors: {} }; },
  },
  'validators/history': { validateHistory: (b, c) => { rec('validateHistory', b, c); return { values: b, errors: {} }; } },
};

stub('models', models);
for (const [k, v] of Object.entries(validators)) stub(k, v);
stub('services/bidService', services);
// validators/common (ValidationError), helpers/*, config/constants, auth/permissions — справжні
installStubs();

const { ValidationError } = require('../validators/common');
const { verifyPassword } = require('../helpers/password');
const resources = require('../admin/resources');

const { byKey, list } = resources;
const admin = { id: 1, username: 'admin', role: 'admin' };

// Запис із методами update/destroy, що фіксують виклики
const makeRecord = (data) => ({
  ...data,
  toJSON() { return { ...data }; },
  update: async (changes, o) => { rec('record.update', changes, o); Object.assign(this, changes); return changes; },
  destroy: async (o) => { rec('record.destroy', o); },
});

const rejectsWith = async (promise, check) => {
  await assert.rejects(promise, (err) => {
    assert.ok(err instanceof ValidationError, `очікували ValidationError, отримали ${err}`);
    check(err.errors);
    return true;
  });
};

beforeEach(() => {
  log.length = 0;
  for (const k of Object.keys(state)) delete state[k];
});

// ---------- Структура ----------
describe('реєстр ресурсів', () => {
  it('усі шість таблиць у відповідному порядку', () => {
    assert.deepEqual(list.map((r) => r.key), ['lots', 'categories', 'statuses', 'users', 'bids', 'history']);
    assert.deepEqual(Object.keys(byKey).sort(), list.map((r) => r.key).sort());
  });

  it('кожен ресурс має все потрібне універсальному контролеру', () => {
    for (const r of list) {
      for (const prop of ['label', 'newLabel', 'singular', 'model', 'defaultSort', 'columns', 'find', 'title', 'recordValues', 'fields', 'validate', 'create', 'update', 'remove']) {
        assert.ok(r[prop] !== undefined, `${r.key}: немає «${prop}»`);
      }
      assert.ok(r.searchFields instanceof Array, `${r.key}: searchFields`);
      assert.ok(r.columns.every((c) => typeof c.value === 'function' && c.label), `${r.key}: стовпці`);
    }
  });

  it('сортування лише за стовпцями зі списку, початкове сортування — теж з нього', () => {
    for (const r of list) {
      const sortable = r.columns.filter((c) => c.sort).map((c) => c.sort);
      assert.ok(sortable.includes(r.defaultSort.field), `${r.key}: ${r.defaultSort.field} не в ${sortable}`);
    }
  });

  it('хеш пароля не виводиться у списку користувачів і формі', async () => {
    const labels = byKey.users.columns.map((c) => c.label.toLowerCase());
    assert.ok(!labels.some((l) => l.includes('парол') || l.includes('hash')));
    const values = byKey.users.recordValues({ username: 'u', email: 'e', role: 'user', passwordHash: 'secret' });
    assert.deepEqual(values, { username: 'u', email: 'e', role: 'user' });
  });
});

// ---------- Категорії ----------
describe('категорії', () => {
  it('валідація отримує id редагованого запису (унікальність назви)', () => {
    byKey.categories.validate({ name: 'x' }, { record: { id: 4 } });
    assert.deepEqual(called('validateCategory')[0][2], { id: 4 });
    byKey.categories.validate({ name: 'x' }, { record: null });
    assert.deepEqual(called('validateCategory')[1][2], { id: null });
  });

  it('видалення заборонено, якщо в категорії є лоти', async () => {
    state['Lot.count'] = 3;
    const record = makeRecord({ id: 1, name: 'Антикваріат' });
    await rejectsWith(byKey.categories.remove(record, { req: {} }), (e) => assert.match(e._form, /Антикваріат.*лоти \(3\)/));
    assert.equal(called('record.destroy').length, 0);
  });

  it('порожня категорія видаляється', async () => {
    await byKey.categories.remove(makeRecord({ id: 1, name: 'Порожня' }), { req: {} });
    assert.equal(called('record.destroy').length, 1);
  });

  it('кількість лотів у списку рахується одним запитом із групуванням', async () => {
    state['Lot.count'] = () => [{ categoryId: 1, count: 5 }, { categoryId: 2, count: 1 }];
    const extra = await byKey.categories.loadListExtra([{ id: 1 }, { id: 2 }, { id: 3 }]);
    assert.deepEqual(extra, { lots: { 1: 5, 2: 1 } });
    assert.equal(called('Lot.count').length, 1);
    assert.deepEqual(byKey.categories.columns[3].value({ id: 3 }, extra), 0);
  });

  it('порожній список не робить запиту', async () => {
    assert.deepEqual(await byKey.categories.loadListExtra([]), { lots: {} });
    assert.equal(called('Lot.count').length, 0);
  });
});

// ---------- Статуси ----------
describe('статуси лотів', () => {
  it('системні статуси не видаляються', async () => {
    for (const name of ['active', 'sold']) {
      await rejectsWith(byKey.statuses.remove(makeRecord({ id: 1, name })), (e) => assert.match(e._form, /Системний статус/));
    }
    assert.equal(called('record.destroy').length, 0);
  });

  it('власний статус, що використовується лотами, не видаляється', async () => {
    state['Lot.count'] = 2;
    await rejectsWith(byKey.statuses.remove(makeRecord({ id: 9, name: 'on_hold' })), (e) => assert.match(e._form, /on_hold.*лоти \(2\)/));
  });

  it('власний статус без лотів видаляється', async () => {
    await byKey.statuses.remove(makeRecord({ id: 9, name: 'on_hold' }));
    assert.equal(called('record.destroy').length, 1);
  });

  it('валідація знає поточну назву статусу', () => {
    byKey.statuses.validate({ name: 'a' }, { record: { id: 3, name: 'on_hold' } });
    assert.deepEqual(called('validateStatus')[0][2], { id: 3, current: 'on_hold' });
  });
});

// ---------- Користувачі ----------
describe('користувачі', () => {
  it('створення хешує пароль і не зберігає його відкритим', async () => {
    await byKey.users.create({ username: 'new', email: 'n@x.ua', role: 'user', password: 'Secret123' });
    const created = called('User.create')[0][1];
    assert.notEqual(created.passwordHash, 'Secret123');
    assert.equal(created.password, undefined);
    assert.equal(verifyPassword('Secret123', created.passwordHash), true);
    assert.equal(created.role, 'user');
  });

  it('форма: у створенні пароль обов’язковий за підписом, у редагуванні — необов’язковий', () => {
    const create = byKey.users.fields({ record: null }).find((f) => f.name === 'password');
    const edit = byKey.users.fields({ record: { id: 1 } }).find((f) => f.name === 'password');
    assert.equal(create.label, 'Пароль');
    assert.match(edit.hint, /порожнім/);
  });

  it('редагування без нового пароля не змінює хеш', async () => {
    const record = makeRecord({ id: 2, role: 'user' });
    await byKey.users.update(record, { username: 'a', email: 'a@x.ua', role: 'user', password: '' }, { req: { user: admin } });
    const changes = called('record.update')[0][1];
    assert.deepEqual(Object.keys(changes).sort(), ['email', 'role', 'username']);
  });

  it('редагування з новим паролем оновлює хеш', async () => {
    const record = makeRecord({ id: 2, role: 'user' });
    await byKey.users.update(record, { username: 'a', email: 'a@x.ua', role: 'user', password: 'NewPass123' }, { req: { user: admin } });
    const changes = called('record.update')[0][1];
    assert.equal(verifyPassword('NewPass123', changes.passwordHash), true);
  });

  it('адміністратор не може знизити роль самому собі', async () => {
    const record = makeRecord({ id: 1, role: 'admin' });
    state['User.count'] = 3;
    await rejectsWith(
      byKey.users.update(record, { username: 'admin', email: 'a@x.ua', role: 'user' }, { req: { user: admin } }),
      (e) => assert.match(e.role, /у самого себе/),
    );
    assert.equal(called('record.update').length, 0);
  });

  it('не можна забрати роль у єдиного адміністратора', async () => {
    const record = makeRecord({ id: 5, role: 'admin' });
    state['User.count'] = 1;
    await rejectsWith(
      byKey.users.update(record, { username: 'a', email: 'a@x.ua', role: 'user' }, { req: { user: admin } }),
      (e) => assert.match(e.role, /єдиного адміністратора/),
    );
  });

  it('роль іншого адміністратора знизити можна, якщо адміністраторів кілька', async () => {
    const record = makeRecord({ id: 5, role: 'admin' });
    state['User.count'] = 2;
    await byKey.users.update(record, { username: 'a', email: 'a@x.ua', role: 'user' }, { req: { user: admin } });
    assert.equal(called('record.update').length, 1);
  });

  it('не можна видалити самого себе', async () => {
    await rejectsWith(byKey.users.remove(makeRecord({ id: 1, username: 'admin' }), { req: { user: admin } }),
      (e) => assert.match(e._form, /власний обліковий запис/));
    assert.equal(called('User.count').length + called('Lot.count').length, 0, 'перевірка відбувається до запитів');
  });

  it('не можна видалити користувача зі зв’язаними записами', async () => {
    state['Lot.count'] = (o) => (o.where.sellerId ? 2 : 1);
    state['Bid.count'] = 4;
    state['BidHistory.count'] = 6;
    await rejectsWith(byKey.users.remove(makeRecord({ id: 7, username: 'ivan' }), { req: { user: admin } }),
      (e) => assert.match(e._form, /«ivan».*лоти \(3\).*ставки \(4\).*історії \(6\)/));
    assert.equal(called('record.destroy').length, 0);
  });

  it('користувач без зв’язків видаляється', async () => {
    await byKey.users.remove(makeRecord({ id: 7, username: 'free' }), { req: { user: admin } });
    assert.equal(called('record.destroy').length, 1);
  });
});

// ---------- Лоти ----------
describe('лоти', () => {
  const values = {
    title: 'Годинник', description: 'Опис', startPrice: 100, minStep: 5,
    startTime: new Date(), endTime: new Date(), sellerId: 2, categoryId: 3, statusId: 1,
  };

  it('створення: поточна ціна дорівнює початковій', async () => {
    await byKey.lots.create(values);
    const created = called('Lot.create')[0][1];
    assert.equal(created.currentPrice, 100);
    assert.equal(created.startPrice, 100);
    assert.equal(created.sellerId, 2);
  });

  it('formExtra: hasBids залежить від наявності ставок і від того, редагується запис чи ні', async () => {
    assert.deepEqual(await byKey.lots.formExtra(null), { hasBids: false });
    state['Bid.count'] = 2;
    assert.deepEqual(await byKey.lots.formExtra({ id: 1 }), { hasBids: true });
    state['Bid.count'] = 0;
    assert.deepEqual(await byKey.lots.formExtra({ id: 1 }), { hasBids: false });
  });

  it('поле початкової ціни блокується, якщо є ставки', async () => {
    const find = (fields) => fields.find((f) => f.name === 'startPrice');
    assert.equal(find(await byKey.lots.fields({ extra: { hasBids: true } })).disabled, true);
    assert.equal(find(await byKey.lots.fields({ extra: { hasBids: false } })).disabled, false);
  });

  it('випадаючі списки містять продавців, категорії та статуси', async () => {
    state['User.all'] = [{ id: 2, username: 'seller1' }];
    state['Category.all'] = [{ id: 3, name: 'Книги' }];
    state['LotStatus.all'] = [{ id: 1, name: 'active' }];
    const fields = await byKey.lots.fields({ extra: { hasBids: false } });
    const options = (name) => fields.find((f) => f.name === name).options;
    assert.deepEqual(options('sellerId'), [{ value: 2, label: 'seller1' }]);
    assert.deepEqual(options('categoryId'), [{ value: 3, label: 'Книги' }]);
    assert.equal(options('statusId')[0].value, 1);
  });

  it('заблокована початкова ціна повертається у форму із запису після помилки', () => {
    const body = { title: '' };
    assert.deepEqual(byKey.lots.redisplayValues(body, { startPrice: 50 }, { hasBids: true }), { title: '', startPrice: 50 });
    assert.equal(byKey.lots.redisplayValues(body, { startPrice: 50 }, { hasBids: false }), body);
  });

  describe('зміна статусу', () => {
    const lot = (status) => makeRecord({ id: 10, status: { name: status } });

    it('продаж: переможець — автор найвищої ставки, подія WON записується в транзакції', async () => {
      state['LotStatus.byPk'] = { id: 2, name: 'sold' };
      state['Bid.one'] = { id: 77, userId: 5, amount: 250 };
      await byKey.lots.update(lot('active'), { ...values, statusId: 2 }, { extra: { hasBids: true } });

      assert.equal(called('transaction').length, 1);
      const changes = called('record.update')[0][1];
      assert.equal(changes.winnerId, 5);
      assert.equal(changes.startPrice, undefined, 'початкова ціна не змінюється, якщо є ставки');
      assert.equal(changes.currentPrice, undefined);
      const won = called('BidHistory.create')[0][1];
      assert.deepEqual(won, { eventType: 'WON', amount: 250, bidId: 77, lotId: 10, userId: 5 });
      assert.deepEqual(called('Bid.findOne')[0][1].order, [['amount', 'DESC'], ['id', 'DESC']]);
    });

    it('повторне збереження вже проданого лоту не дублює подію WON', async () => {
      state['LotStatus.byPk'] = { id: 2, name: 'sold' };
      state['Bid.one'] = { id: 77, userId: 5, amount: 250 };
      await byKey.lots.update(lot('sold'), { ...values, statusId: 2 }, { extra: { hasBids: true } });
      assert.equal(called('BidHistory.create').length, 0);
      assert.equal(called('record.update')[0][1].winnerId, 5);
    });

    it('продаж без ставок: переможця немає, історія не пишеться', async () => {
      state['LotStatus.byPk'] = { id: 2, name: 'sold' };
      await byKey.lots.update(lot('active'), { ...values, statusId: 2 }, { extra: { hasBids: false } });
      assert.equal(called('record.update')[0][1].winnerId, null);
      assert.equal(called('BidHistory.create').length, 0);
    });

    it('не проданий статус скидає переможця й не шукає ставки', async () => {
      state['LotStatus.byPk'] = { id: 1, name: 'active' };
      await byKey.lots.update(lot('sold'), { ...values, statusId: 1 }, { extra: { hasBids: false } });
      assert.equal(called('record.update')[0][1].winnerId, null);
      assert.equal(called('Bid.findOne').length, 0);
    });

    it('без ставок початкова ціна змінюється разом із поточною', async () => {
      state['LotStatus.byPk'] = { id: 1, name: 'active' };
      await byKey.lots.update(lot('active'), { ...values, startPrice: 120 }, { extra: { hasBids: false } });
      const changes = called('record.update')[0][1];
      assert.equal(changes.startPrice, 120);
      assert.equal(changes.currentPrice, 120);
    });
  });

  it('видалення каскадне: історія → ставки → лот, усе в одній транзакції', async () => {
    const record = makeRecord({ id: 10 });
    await byKey.lots.remove(record);
    assert.equal(called('transaction').length, 1);
    const order = log.map((l) => l[0]).filter((n) => ['BidHistory.destroy', 'Bid.destroy', 'record.destroy'].includes(n));
    assert.deepEqual(order, ['BidHistory.destroy', 'Bid.destroy', 'record.destroy']);
    assert.deepEqual(called('BidHistory.destroy')[0][1].where, { lotId: 10 });
    assert.deepEqual(called('Bid.destroy')[0][1].where, { lotId: 10 });
    assert.deepEqual(called('record.destroy')[0][1], { transaction: { tx: true } });
  });
});

// ---------- Ставки ----------
describe('ставки', () => {
  it('створення, зміна й видалення виконує сервіс ставок', async () => {
    await byKey.bids.create({ lotId: 1, userId: 2, amount: 300 });
    await byKey.bids.update({ id: 8 }, { amount: 350 });
    await byKey.bids.remove({ id: 8 });
    assert.deepEqual(called('placeBid')[0][1], { lotId: 1, userId: 2, amount: 300 });
    assert.deepEqual(called('updateBidAmount')[0][1], { bidId: 8, amount: 350 });
    assert.deepEqual(called('deleteBid')[0][1], { bidId: 8 });
  });

  it('помилки сервісу (ValidationError) доходять до контролера', async () => {
    state.placeBidError = new ValidationError({ amount: 'Занадто мала ставка' });
    await rejectsWith(byKey.bids.create({}), (e) => assert.equal(e.amount, 'Занадто мала ставка'));
  });

  it('валідація: для нової ставки й для редагування — різні правила', async () => {
    await byKey.bids.validate({ lotId: 1 }, { record: null });
    await byKey.bids.validate({ amount: 1 }, { record: { id: 3 } });
    assert.equal(called('validateNewBid').length, 1);
    assert.equal(called('validateBidAmount').length, 1);
  });

  it('форма редагування: лот і автор лише для читання, редагується сума', async () => {
    const fields = await byKey.bids.fields({ record: { lot: { title: 'Годинник' }, bidder: { username: 'ivan' } } });
    assert.deepEqual(fields.map((f) => [f.name, f.type]), [['lot', 'info'], ['bidder', 'info'], ['amount', 'text']]);
    assert.equal(fields[0].value, 'Годинник');
    assert.equal(fields[1].value, 'ivan');
    assert.deepEqual(byKey.bids.recordValues({ amount: 12.5 }), { amount: '12.50' });
  });

  it('форма створення: вибір лота й користувача', async () => {
    state['Lot.all'] = [{ id: 1, title: 'Годинник', status: { name: 'active' } }];
    state['User.all'] = [{ id: 2, username: 'ivan' }];
    const fields = await byKey.bids.fields({ record: null });
    assert.deepEqual(fields.map((f) => f.name), ['lotId', 'userId', 'amount']);
    assert.equal(fields[0].options[0].value, 1);
    assert.deepEqual(fields[1].options, [{ value: 2, label: 'ivan' }]);
  });
});

// ---------- Історія ставок ----------
describe('історія ставок', () => {
  it('просте створення, оновлення й видалення запису', async () => {
    await byKey.history.create({ bidId: 1, eventType: 'BID_PLACED', amount: 10 });
    assert.equal(called('BidHistory.create').length, 1);
    const record = makeRecord({ id: 4 });
    await byKey.history.update(record, { amount: 20 });
    await byKey.history.remove(record);
    assert.deepEqual(called('record.update')[0][1], { amount: 20 });
    assert.equal(called('record.destroy').length, 1);
  });

  it('форма: ставка, тип події й сума', async () => {
    state['Bid.all'] = [{ id: 1, amount: 10, lot: { title: 'Лот' }, bidder: { username: 'ivan' } }];
    const fields = await byKey.history.fields({});
    assert.deepEqual(fields.map((f) => f.name), ['bidId', 'eventType', 'amount']);
    assert.match(fields[0].options[0].label, /№1 · Лот · ivan · 10\.00 грн/);
    assert.ok(fields[1].options.length >= 3);
  });

  it('значення запису для форми редагування', () => {
    assert.deepEqual(byKey.history.recordValues({ bidId: 1, eventType: 'WON', amount: 5 }),
      { bidId: 1, eventType: 'WON', amount: '5.00' });
  });
});

// ---------- Стовпці списків ----------
describe('стовпці списків', () => {
  it('значення комірок обчислюються для всіх ресурсів без винятків', () => {
    const date = new Date('2026-01-01T10:00:00Z');
    const samples = {
      lots: { id: 1, title: 'Л', category: { name: 'К' }, seller: { username: 'с' }, status: { name: 'active' }, currentPrice: 1, endTime: date },
      categories: { id: 1, name: 'К', description: 'а'.repeat(100) },
      statuses: { id: 1, name: 'active' },
      users: { id: 1, username: 'u', email: 'e', role: 'admin', createdAt: date },
      bids: { id: 1, lot: { title: 'Л' }, bidder: { username: 'с' }, amount: 5, createdAt: date },
      history: { id: 1, eventType: 'WON', lot: { title: 'Л' }, user: { username: 'с' }, amount: 5, createdAt: date },
    };
    for (const r of list) {
      const extra = { lots: {} };
      for (const c of r.columns) assert.doesNotThrow(() => c.value(samples[r.key], extra), `${r.key}: ${c.label}`);
    }
    // довгий опис категорії скорочується
    assert.ok(byKey.categories.columns[2].value(samples.categories).length <= 61);
  });
});
