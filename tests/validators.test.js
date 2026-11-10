// Тести серверної валідації. Запуск: npm test
// Використовується вбудований у Node.js тестовий рушій (node:test), додаткові бібліотеки не потрібні.
// Замість справжньої бази даних валідаторам передається заглушка `db`.

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const common = require('../validators/common');
const { validateCategory } = require('../validators/category');
const { validateStatus } = require('../validators/status');
const { validateUser } = require('../validators/user');
const { validateLot } = require('../validators/lot');
const {
  validateNewBid, validateBidAmount, bidPlacementRules, bidEditRules, bidDeleteRules,
} = require('../validators/bid');
const { validateHistory } = require('../validators/history');

// ---------- Заглушка бази даних ----------
function makeDb(extra = {}) {
  const data = {
    User: [
      { id: 1, username: 'seller1', email: 'seller@mail.com' },
      { id: 2, username: 'ivan', email: 'ivan@mail.com' },
    ],
    Category: [{ id: 1, name: 'Антикваріат' }, { id: 2, name: 'Техніка' }],
    LotStatus: [{ id: 1, name: 'draft' }, { id: 2, name: 'active' }, { id: 3, name: 'sold' }],
    Lot: [{ id: 1 }],
  };
  return {
    exists: async (model, id) => data[model].some((row) => row.id === id),
    isUnique: async (model, field, value, excludeId = null) => !data[model].some(
      (row) => row.id !== Number(excludeId) && String(row[field]).toLowerCase() === String(value).toLowerCase(),
    ),
    statusName: async (id) => (data.LotStatus.find((s) => s.id === id) || {}).name || null,
    userHasBidOnLot: async () => false,
    bidContext: async (id) => (id === 10
      ? { id: 10, lotId: 1, userId: 2, amount: 120, lotStatusName: 'active' }
      : id === 11 ? { id: 11, lotId: 1, userId: 2, amount: 300, lotStatusName: 'sold' } : null),
    countHistory: async () => 0,
    ...extra,
  };
}

const NOW = new Date(2026, 9, 31, 12, 0);

// ---------- Спільні функції ----------
describe('common: розбір значень', () => {
  it('parseMoney приймає суми з крапкою або комою та до двох знаків', () => {
    assert.equal(common.parseMoney('150'), 150);
    assert.equal(common.parseMoney('150,5'), 150.5);
    assert.equal(common.parseMoney(' 1 250.00 '), 1250);
  });

  it('parseMoney відхиляє некоректні рядки', () => {
    for (const bad of ['', 'abc', '-5', '12.345', '1,000,5', '1e5', '10 грн']) {
      assert.equal(common.parseMoney(bad), null, `«${bad}» має бути відхилено`);
    }
  });

  it('parseId приймає лише додатні цілі', () => {
    assert.equal(common.parseId('5'), 5);
    for (const bad of ['0', '-1', '1.5', 'x', '', '12345678901']) assert.equal(common.parseId(bad), null);
  });

  it('parseDateTime перевіряє формат і існування дати', () => {
    assert.ok(common.parseDateTime('2026-10-31T19:30') instanceof Date);
    assert.ok(common.parseDateTime('2026-10-31 19:30') instanceof Date);
    for (const bad of ['', 'abc', '2026-02-31T10:00', '2026-13-01T10:00', '2026-10-31T25:00', '31.10.2026']) {
      assert.equal(common.parseDateTime(bad), null, `«${bad}» має бути відхилено`);
    }
  });

  it('isEmail', () => {
    assert.ok(common.isEmail('name@example.com'));
    for (const bad of ['name', 'name@', '@example.com', 'name@example', 'na me@example.com']) {
      assert.ok(!common.isEmail(bad), bad);
    }
  });

  it('toCents не помиляється на дробових сумах', () => {
    assert.equal(common.toCents(0.1) + common.toCents(0.2), 30);
  });
});

// ---------- Категорія ----------
describe('validateCategory', () => {
  it('порожня форма: помилка назви', async () => {
    const { errors } = await validateCategory({}, { db: makeDb() });
    assert.equal(errors.name, 'Вкажіть назву категорії');
  });

  it('занадто коротка, задовга та з недопустимими символами', async () => {
    const db = makeDb();
    assert.match((await validateCategory({ name: 'А' }, { db })).errors.name, /щонайменше 2/);
    assert.match((await validateCategory({ name: 'а'.repeat(101) }, { db })).errors.name, /довшою за 100/);
    assert.match((await validateCategory({ name: '<script>' }, { db })).errors.name, /недопустимі символи/);
  });

  it('унікальність без урахування регістру (кирилиця)', async () => {
    const { errors } = await validateCategory({ name: 'антикваріат' }, { db: makeDb() });
    assert.match(errors.name, /[ву]же існує/);
  });

  it('при редагуванні власна назва не вважається дублем', async () => {
    const { errors } = await validateCategory({ name: 'Антикваріат' }, { id: 1, db: makeDb() });
    assert.deepEqual(errors, {});
  });

  it('довгий опис відхиляється', async () => {
    const { errors } = await validateCategory({ name: 'Монети', description: 'x'.repeat(501) }, { db: makeDb() });
    assert.match(errors.description, /500/);
  });

  it('коректні дані проходять; пробіли обрізаються', async () => {
    const { errors, values } = await validateCategory({ name: '  Монети  ', description: '' }, { db: makeDb() });
    assert.deepEqual(errors, {});
    assert.deepEqual(values, { name: 'Монети', description: null });
  });
});

// ---------- Статус ----------
describe('validateStatus', () => {
  it('порожній, коротий, з великими літерами/кирилицею', async () => {
    const db = makeDb();
    assert.match((await validateStatus({}, { db })).errors.name, /Вкажіть код/);
    assert.match((await validateStatus({ name: 'a' }, { db })).errors.name, /щонайменше 2/);
    assert.match((await validateStatus({ name: 'Active2' }, { db })).errors.name, /малої латинської/);
    assert.match((await validateStatus({ name: 'статус' }, { db })).errors.name, /малої латинської/);
  });

  it('системний статус не можна перейменувати', async () => {
    const { errors } = await validateStatus({ name: 'foo' }, { id: 2, current: 'active', db: makeDb() });
    assert.match(errors.name, /Системний статус/);
  });

  it('системний статус із незміненою назвою дозволений', async () => {
    const { errors } = await validateStatus({ name: 'active' }, { id: 2, current: 'active', db: makeDb() });
    assert.deepEqual(errors, {});
  });

  it('дубль відхиляється, новий код проходить', async () => {
    const db = makeDb();
    assert.match((await validateStatus({ name: 'sold' }, { db })).errors.name, /[ву]же існує/);
    assert.deepEqual((await validateStatus({ name: 'on_hold' }, { db })).errors, {});
  });
});

// ---------- Користувач ----------
describe('validateUser', () => {
  it('порожня форма створення: помилки всіх полів', async () => {
    const { errors } = await validateUser({}, { db: makeDb() });
    assert.deepEqual(Object.keys(errors).sort(), ['email', 'password', 'role', 'username']);
  });

  it('некоректні ім’я та email', async () => {
    const db = makeDb();
    assert.match((await validateUser({ username: 'ab' }, { db })).errors.username, /щонайменше 3/);
    assert.match((await validateUser({ username: 'ivan petrenko' }, { db })).errors.username, /лише латинські/);
    assert.match((await validateUser({ username: 'ivan' }, { db })).errors.username, /[ву]же існує/);
    assert.match((await validateUser({ email: 'not-an-email' }, { db })).errors.email, /коректну адресу/);
    assert.match((await validateUser({ email: 'IVAN@mail.com' }, { db })).errors.email, /[ву]же існує/);
  });

  it('правила пароля', async () => {
    const db = makeDb();
    const ok = { username: 'newuser', email: 'new@mail.com', role: 'user' };
    assert.match((await validateUser({ ...ok, password: '12345' }, { db })).errors.password, /щонайменше 6/);
    assert.match((await validateUser({ ...ok, password: 'abcdefgh' }, { db })).errors.password, /літеру й одну цифру/);
    assert.match((await validateUser({ ...ok, password: 'abc12345', passwordConfirm: 'abc12346' }, { db })).errors.passwordConfirm, /не збігаються/);
    assert.match((await validateUser({ ...ok, password: 'abc12345' }, { db })).errors.passwordConfirm, /Повторіть/);
  });

  it('невідома роль', async () => {
    const { errors } = await validateUser({ role: 'superuser' }, { db: makeDb() });
    assert.match(errors.role, /зі списку/);
  });

  it('коректні дані: email у нижньому регістрі', async () => {
    const { errors, values } = await validateUser({
      username: 'newuser', email: 'New@Mail.com', password: 'abc12345', passwordConfirm: 'abc12345', role: 'admin',
    }, { db: makeDb() });
    assert.deepEqual(errors, {});
    assert.equal(values.email, 'new@mail.com');
    assert.equal(values.password, 'abc12345');
  });

  it('редагування: порожній пароль означає «не змінювати»', async () => {
    const { errors, values } = await validateUser({
      username: 'ivan', email: 'ivan@mail.com', role: 'user', password: '', passwordConfirm: '',
    }, { id: 2, isEdit: true, db: makeDb() });
    assert.deepEqual(errors, {});
    assert.equal(values.password, null);
  });
});

// ---------- Лот ----------
const goodLot = {
  title: 'Старовинний годинник',
  description: 'Настінний, 1930-ті',
  startPrice: '100',
  minStep: '10',
  startTime: '2026-10-31T12:00',
  endTime: '2026-11-07T12:00',
  sellerId: '1',
  categoryId: '1',
  statusId: '2',
};

describe('validateLot', () => {
  it('порожня форма: помилки всіх обов’язкових полів', async () => {
    const { errors } = await validateLot({}, { db: makeDb(), now: NOW });
    assert.deepEqual(
      Object.keys(errors).sort(),
      ['categoryId', 'endTime', 'minStep', 'sellerId', 'startPrice', 'startTime', 'statusId', 'title'],
    );
  });

  it('коректні дані проходять і перетворюються на типізовані значення', async () => {
    const { errors, values } = await validateLot(goodLot, { db: makeDb(), now: NOW });
    assert.deepEqual(errors, {});
    assert.equal(values.startPrice, 100);
    assert.equal(values.minStep, 10);
    assert.equal(values.sellerId, 1);
    assert.ok(values.endTime instanceof Date);
  });

  it('некоректні числа', async () => {
    const { errors } = await validateLot({ ...goodLot, startPrice: 'abc', minStep: '0' }, { db: makeDb(), now: NOW });
    assert.match(errors.startPrice, /додатним числом/);
    assert.match(errors.minStep, /більшим за 0/);
    const zero = await validateLot({ ...goodLot, startPrice: '0' }, { db: makeDb(), now: NOW });
    assert.match(zero.errors.startPrice, /більшою за 0/);
  });

  it('назва: коротка та з тегами', async () => {
    const db = makeDb();
    assert.match((await validateLot({ ...goodLot, title: 'ab' }, { db, now: NOW })).errors.title, /щонайменше 3/);
    assert.match((await validateLot({ ...goodLot, title: '<b>x</b>' }, { db, now: NOW })).errors.title, /< та >/);
  });

  it('час завершення має бути пізніше за початок і не довше року', async () => {
    const db = makeDb();
    const before = await validateLot({ ...goodLot, endTime: '2026-10-30T12:00' }, { db, now: NOW });
    assert.match(before.errors.endTime, /пізніше за час початку/);
    const tooLong = await validateLot({ ...goodLot, endTime: '2027-12-31T12:00' }, { db, now: NOW });
    assert.match(tooLong.errors.endTime, /365/);
    const badDate = await validateLot({ ...goodLot, startTime: '2026-02-31T10:00' }, { db, now: NOW });
    assert.match(badDate.errors.startTime, /коректні дату/);
  });

  it('активний лот не може завершуватися в минулому', async () => {
    const { errors } = await validateLot({
      ...goodLot, startTime: '2026-10-01T12:00', endTime: '2026-10-10T12:00',
    }, { db: makeDb(), now: NOW });
    assert.match(errors.endTime, /майбутньому/);
  });

  it('неіснуючі продавець, категорія й статус', async () => {
    const { errors } = await validateLot({
      ...goodLot, sellerId: '99', categoryId: '99', statusId: '99',
    }, { db: makeDb(), now: NOW });
    assert.match(errors.sellerId, /не існує/);
    assert.match(errors.categoryId, /не існує/);
    assert.match(errors.statusId, /не існує/);
  });

  it('значення id не з числа відхиляється', async () => {
    const { errors } = await validateLot({ ...goodLot, sellerId: 'abc' }, { db: makeDb(), now: NOW });
    assert.match(errors.sellerId, /не існує/);
  });

  it('статус «sold» потребує ставок', async () => {
    const db = makeDb();
    const without = await validateLot({ ...goodLot, statusId: '3' }, { db, now: NOW });
    assert.match(without.errors.statusId, /немає жодної ставки/);
    const withBids = await validateLot({ ...goodLot, statusId: '3' }, { db, now: NOW, hasBids: true, id: 1 });
    assert.equal(withBids.errors.statusId, undefined);
  });

  it('якщо є ставки, початкова ціна не перевіряється', async () => {
    const { errors } = await validateLot({ ...goodLot, startPrice: '' }, { db: makeDb(), now: NOW, hasBids: true, id: 1 });
    assert.equal(errors.startPrice, undefined);
  });

  it('автор ставок не може стати продавцем цього лоту', async () => {
    const db = makeDb({ userHasBidOnLot: async () => true });
    const { errors } = await validateLot(goodLot, { db, now: NOW, id: 1 });
    assert.match(errors.sellerId, /робив ставки/);
  });
});

// ---------- Ставки ----------
describe('validateNewBid / validateBidAmount', () => {
  it('порожня форма', async () => {
    const { errors } = await validateNewBid({}, { db: makeDb() });
    assert.deepEqual(Object.keys(errors).sort(), ['amount', 'lotId', 'userId']);
  });

  it('неіснуючі лот і користувач, некоректна сума', async () => {
    const { errors } = await validateNewBid({ lotId: '99', userId: '99', amount: '1,234' }, { db: makeDb() });
    assert.match(errors.lotId, /не існує/);
    assert.match(errors.userId, /не існує/);
    assert.match(errors.amount, /додатним числом/);
  });

  it('коректні дані', async () => {
    const { errors, values } = await validateNewBid({ lotId: '1', userId: '2', amount: '150,50' }, { db: makeDb() });
    assert.deepEqual(errors, {});
    assert.deepEqual(values, { lotId: 1, userId: 2, amount: 150.5 });
  });

  it('форма редагування: лише сума', () => {
    assert.match(validateBidAmount({}).errors.amount, /Вкажіть суму/);
    assert.match(validateBidAmount({ amount: '-3' }).errors.amount, /додатним числом/);
    assert.deepEqual(validateBidAmount({ amount: '200' }).errors, {});
  });
});

describe('bidPlacementRules', () => {
  const lot = {
    statusName: 'active',
    startTime: new Date(2026, 9, 1),
    endTime: new Date(2026, 10, 30),
    sellerId: 1,
    startPrice: 100,
    currentPrice: 100,
    minStep: 10,
  };

  it('перша ставка не менша за початкову ціну', () => {
    assert.match(bidPlacementRules({ lot, userId: 2, amount: 99.99, topBid: null, now: NOW }).amount, /не меншою за 100.00/);
    assert.deepEqual(bidPlacementRules({ lot, userId: 2, amount: 100, topBid: null, now: NOW }), {});
  });

  it('наступна ставка — не менше поточної ціни плюс крок', () => {
    const next = { ...lot, currentPrice: 150 };
    const top = { userId: 3 };
    assert.match(bidPlacementRules({ lot: next, userId: 2, amount: 159, topBid: top, now: NOW }).amount, /160.00/);
    assert.deepEqual(bidPlacementRules({ lot: next, userId: 2, amount: 160, topBid: top, now: NOW }), {});
  });

  it('дробові суми порівнюються точно (0.1 + 0.2 = 0.30)', () => {
    const tiny = { ...lot, startPrice: 0.1, currentPrice: 0.1, minStep: 0.2 };
    assert.deepEqual(bidPlacementRules({ lot: tiny, userId: 2, amount: 0.3, topBid: { userId: 3 }, now: NOW }), {});
  });

  it('торги неактивні, ще не почалися, вже завершені', () => {
    assert.match(bidPlacementRules({ lot: { ...lot, statusName: 'draft' }, userId: 2, amount: 100, topBid: null, now: NOW }).lotId, /не активні/);
    assert.match(bidPlacementRules({ lot: { ...lot, startTime: new Date(2026, 10, 5) }, userId: 2, amount: 100, topBid: null, now: NOW }).lotId, /не розпочалися/);
    assert.match(bidPlacementRules({ lot: { ...lot, endTime: new Date(2026, 9, 20) }, userId: 2, amount: 100, topBid: null, now: NOW }).lotId, /завершено/);
  });

  it('продавець не ставить на власний лот; найвищий не перебиває себе', () => {
    assert.match(bidPlacementRules({ lot, userId: 1, amount: 100, topBid: null, now: NOW }).userId, /Продавець/);
    assert.match(bidPlacementRules({ lot: { ...lot, currentPrice: 150 }, userId: 2, amount: 200, topBid: { userId: 2 }, now: NOW }).userId, /вже є найвищою/);
  });
});

describe('bidEditRules / bidDeleteRules', () => {
  const lot = { statusName: 'active', startPrice: 100, minStep: 10 };

  it('проданий лот: редагування й видалення заборонені', () => {
    const sold = { ...lot, statusName: 'sold' };
    assert.match(bidEditRules({ lot: sold, bid: { id: 5 }, topBids: [{ id: 5, amount: 300 }], amount: 400 })._form, /продано/);
    assert.match(bidDeleteRules({ lot: sold })._form, /продано/);
    assert.deepEqual(bidDeleteRules({ lot }), {});
  });

  it('редагувати можна лише найвищу ставку', () => {
    const topBids = [{ id: 6, amount: 150 }, { id: 5, amount: 120 }];
    assert.match(bidEditRules({ lot, bid: { id: 5 }, topBids, amount: 130 })._form, /лише найвищу/);
  });

  it('сума нової ставки має перевищувати попередню на крок', () => {
    const topBids = [{ id: 6, amount: 150 }, { id: 5, amount: 120 }];
    assert.match(bidEditRules({ lot, bid: { id: 6 }, topBids, amount: 129 }).amount, /130.00/);
    assert.deepEqual(bidEditRules({ lot, bid: { id: 6 }, topBids, amount: 130 }), {});
  });

  it('єдина ставка не може бути нижчою за початкову ціну', () => {
    const topBids = [{ id: 5, amount: 120 }];
    assert.match(bidEditRules({ lot, bid: { id: 5 }, topBids, amount: 99 }).amount, /100.00/);
  });
});

// ---------- Історія ставок ----------
describe('validateHistory', () => {
  it('порожня форма', async () => {
    const { errors } = await validateHistory({}, { db: makeDb() });
    assert.deepEqual(Object.keys(errors).sort(), ['amount', 'bidId', 'eventType']);
  });

  it('неіснуюча ставка, невідомий тип, некоректна сума', async () => {
    const { errors } = await validateHistory({ bidId: '99', eventType: 'HACKED', amount: 'abc' }, { db: makeDb() });
    assert.match(errors.bidId, /не існує/);
    assert.match(errors.eventType, /зі списку/);
    assert.match(errors.amount, /додатним числом/);
  });

  it('лот і користувач визначаються за ставкою', async () => {
    const { errors, values } = await validateHistory({ bidId: '10', eventType: 'PLACED', amount: '120' }, { db: makeDb() });
    assert.deepEqual(errors, {});
    assert.deepEqual(values, {
      bidId: 10, lotId: 1, userId: 2, eventType: 'PLACED', amount: 120,
    });
  });

  it('подія «Виграш» лише для проданого лоту', async () => {
    const db = makeDb();
    assert.match((await validateHistory({ bidId: '10', eventType: 'WON', amount: '120' }, { db })).errors.eventType, /проданого лоту/);
    assert.deepEqual((await validateHistory({ bidId: '11', eventType: 'WON', amount: '300' }, { db })).errors, {});
  });

  it('подія того самого типу для ставки не дублюється', async () => {
    const db = makeDb({ countHistory: async (bidId, type, excludeId) => (excludeId === 7 ? 0 : 1) });
    assert.match((await validateHistory({ bidId: '10', eventType: 'PLACED', amount: '120' }, { db })).errors.eventType, /[ву]же існує/);
    // при редагуванні власний запис не рахується
    assert.deepEqual((await validateHistory({ bidId: '10', eventType: 'PLACED', amount: '120' }, { id: 7, db })).errors, {});
  });
});

describe('ValidationError', () => {
  it('зберігає помилки по полях', () => {
    const err = new common.ValidationError({ amount: 'x' });
    assert.ok(err instanceof Error);
    assert.deepEqual(err.errors, { amount: 'x' });
  });
});
