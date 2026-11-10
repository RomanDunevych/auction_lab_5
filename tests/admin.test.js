// Тести адмін-панелі: параметри списків, захист маршрутів і універсальний контролер.
// Контролер виконується з вигаданим ресурсом і заглушками моделей, без бази даних.

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { stub, installStubs, fakeRes, fakeReq } = require('./helpers/stubs');

const Op = { or: Symbol('or'), like: Symbol('like') };
const calls = {};
const rows = [{ id: 1, name: 'Перша', price: 10 }, { id: 2, name: 'Друга', price: 20 }];
const record = { id: 1, name: 'Перша', price: 10 };

// Вигаданий ресурс «things»
const fake = {
  key: 'things',
  label: 'Речі',
  newLabel: 'Нова річ',
  searchFields: ['name'],
  searchHint: 'Пошук',
  defaultSort: { field: 'id', dir: 'DESC' },
  columns: [
    { label: 'ID', sort: 'id', value: (r) => r.id },
    { label: 'Назва', sort: 'name', value: (r) => r.name },
    { label: 'Ціна', type: 'money', value: (r) => r.price },
  ],
  model: {
    count: async (opts) => { calls.countOpts = opts; return calls.total; },
    findAll: async (opts) => { calls.findOpts = opts; return rows; },
  },
  find: async (id) => (String(id) === '1' ? record : null),
  title: (r) => r.name,
  defaults: () => ({ name: '' }),
  recordValues: (r) => ({ name: r.name }),
  fields: async () => [{ name: 'name', label: 'Назва', type: 'text' }],
  validate: async (body, ctx) => {
    calls.validateCtx = ctx;
    return { values: { name: body.name }, errors: body.name ? {} : { name: 'Вкажіть назву' } };
  },
  create: async (values) => { if (calls.throws) throw calls.throws; calls.created = values; },
  update: async (rec, values) => { if (calls.throws) throw calls.throws; calls.updated = values; },
  remove: async () => { if (calls.throws) throw calls.throws; calls.removed = true; },
};

stub('sequelize', { Op });
stub('admin/resources', { list: [fake], byKey: { things: fake } });
stub('models', {
  Lot: { findAll: async () => [{ id: 3, title: 'Лот', seller: { username: 's' }, currentPrice: 5 }] },
  Bid: { findAll: async () => [] },
  User: {},
});
installStubs();

const query = require('../admin/query');
const admin = require('../controllers/adminController');
const { ValidationError } = require('../validators/common');

const adminUser = { id: 1, username: 'admin', role: 'admin' };
const ivan = { id: 2, username: 'ivan', role: 'user' };

beforeEach(() => {
  for (const k of Object.keys(calls)) delete calls[k];
  calls.total = 25;
});

// ---------- Параметри списків ----------
describe('admin/query: parseListQuery', () => {
  const resource = {
    columns: [{ label: 'ID', sort: 'id' }, { label: 'Назва', sort: 'title' }, { label: 'Опис' }],
    defaultSort: { field: 'id', dir: 'DESC' },
  };

  it('значення за замовчуванням', () => {
    assert.deepEqual(query.parseListQuery({}, resource), {
      q: '', sort: 'id', dir: 'DESC', page: 1, pageSize: 10,
    });
  });

  it('приймає дозволене сортування, напрямок, пошук і сторінку', () => {
    const p = query.parseListQuery({ q: '  годинник ', sort: 'title', dir: 'asc', page: '3' }, resource);
    assert.equal(p.q, 'годинник');
    assert.equal(p.sort, 'title');
    assert.equal(p.dir, 'ASC');
    assert.equal(p.page, 3);
  });

  it('сортування лише за дозволеними полями (захист від підстановки в ORDER BY)', () => {
    for (const bad of ['passwordHash', 'id; DROP TABLE users', 'Опис', '', undefined, ['id']]) {
      assert.equal(query.parseListQuery({ sort: bad }, resource).sort, 'id', String(bad));
    }
  });

  it('некоректні напрямок і сторінка відкидаються', () => {
    assert.equal(query.parseListQuery({ dir: 'sideways' }, resource).dir, 'DESC');
    for (const bad of ['0', '-4', 'abc', '', '1e9']) {
      const page = query.parseListQuery({ page: bad }, resource).page;
      assert.ok(page >= 1 && page <= 100000, `page=${bad} → ${page}`);
    }
    assert.equal(query.parseListQuery({ page: 'abc' }, resource).page, 1);
  });

  it('пошуковий запит обмежується за довжиною', () => {
    assert.equal(query.parseListQuery({ q: 'а'.repeat(500) }, resource).q.length, 100);
  });
});

describe('admin/query: пошук', () => {
  it('likeVariants дає варіанти регістру для кирилиці', () => {
    const variants = query.likeVariants('аНтиК');
    assert.ok(variants.includes('аНтиК'));
    assert.ok(variants.includes('антик'));
    assert.ok(variants.includes('АНТИК'));
    assert.ok(variants.includes('Антик'));
    assert.equal(new Set(variants).size, variants.length);
  });

  it('порожній запит — без умов', () => {
    assert.deepEqual(query.buildWhere({ searchFields: ['name'] }, ''), {});
  });

  it('текстовий запит шукає за полями ресурсу з усіма варіантами регістру', () => {
    const where = query.buildWhere({ searchFields: ['name', 'description'] }, 'Час');
    const conditions = where[Op.or];
    assert.ok(conditions.some((c) => c.name && c.name[Op.like] === '%Час%'));
    assert.ok(conditions.some((c) => c.name && c.name[Op.like] === '%час%'));
    assert.ok(conditions.some((c) => c.description && c.description[Op.like] === '%ЧАС%'));
    assert.ok(!conditions.some((c) => c.id !== undefined), 'не число — без пошуку за id');
  });

  it('число шукається ще й за id', () => {
    const where = query.buildWhere({ searchFields: ['name'] }, '15');
    assert.ok(where[Op.or].some((c) => c.id === 15));
  });

  it('ресурс без текстових полів: число шукає за id, текст дає порожній результат', () => {
    assert.deepEqual(query.buildWhere({ searchFields: [] }, '7')[Op.or], [{ id: 7 }]);
    assert.deepEqual(query.buildWhere({ searchFields: [] }, 'abc'), { id: 0 });
  });
});

describe('admin/query: сторінки й адреси', () => {
  it('pageInfo: межі, наявність сусідніх сторінок', () => {
    assert.deepEqual(query.pageInfo(25, 2, 10), {
      total: 25, totalPages: 3, page: 2, offset: 10, from: 11, to: 20, hasPrev: true, hasNext: true,
    });
    const last = query.pageInfo(25, 3, 10);
    assert.equal(last.to, 25);
    assert.equal(last.hasNext, false);
  });

  it('pageInfo: сторінка поза межами повертається в межі; порожній список', () => {
    assert.equal(query.pageInfo(25, 99, 10).page, 3);
    const empty = query.pageInfo(0, 5, 10);
    assert.equal(empty.page, 1);
    assert.equal(empty.from, 0);
    assert.equal(empty.to, 0);
    assert.equal(empty.totalPages, 1);
  });

  it('pageWindow: усі сторінки або вікно навколо поточної з пропусками', () => {
    assert.deepEqual(query.pageWindow(1, 3), [1, 2, 3]);
    assert.deepEqual(query.pageWindow(5, 10), [1, null, 4, 5, 6, null, 10]);
    assert.deepEqual(query.pageWindow(2, 10), [1, 2, 3, null, 10]);
  });

  it('listUrl складає адресу лише з потрібних параметрів і кодує пошук', () => {
    assert.equal(query.listUrl('/admin/lots', {}), '/admin/lots');
    assert.equal(query.listUrl('/admin/lots', { q: 'а б', sort: 'title', dir: 'ASC', page: 3 }),
      '/admin/lots?q=%D0%B0+%D0%B1&sort=title&dir=asc&page=3');
    assert.equal(query.listUrl('/admin/lots', { page: 1 }), '/admin/lots');
  });
});

// ---------- Захист маршрутів ----------
describe('routes/admin.js: захист області', () => {
  const recorded = [];

  it('перший обробник маршрутизатора — перевірка права admin:access, далі всі маршрути', () => {
    const router = {};
    router.use = (...handlers) => recorded.push({ method: 'USE', handlers });
    for (const m of ['get', 'post']) {
      router[m] = (path, ...handlers) => recorded.push({ method: m.toUpperCase(), path, handlers });
    }
    stub('express', { Router: () => router });
    require('../routes/admin.js');

    assert.equal(recorded[0].method, 'USE', 'захист має бути зареєстрований першим');
    const routes = recorded.filter((r) => r.method !== 'USE').map((r) => `${r.method} ${r.path}`);
    assert.deepEqual(routes, [
      'GET /', 'GET /:resource', 'GET /:resource/new', 'POST /:resource',
      'GET /:resource/:id/edit', 'POST /:resource/:id/edit', 'POST /:resource/:id/delete',
    ]);
  });

  const run = (user, method = 'GET', originalUrl = '/admin/lots') => {
    const res = fakeRes();
    let passed = false;
    recorded[0].handlers[0](fakeReq({ user, method, originalUrl }), res, () => { passed = true; });
    return { passed, out: res.out };
  };

  it('відвідувач → перенаправлення на вхід із поверненням на запитану сторінку', () => {
    const r = run(null);
    assert.equal(r.passed, false);
    assert.equal(r.out.type, 'redirect');
    assert.match(r.out.url, /^\/login\?next=%2Fadmin%2Flots&error=/);
  });

  it('відвідувач, POST → вхід без next', () => {
    const r = run(null, 'POST', '/admin/lots/5/delete');
    assert.equal(r.passed, false);
    assert.ok(!r.out.url.includes('next='));
  });

  it('звичайний користувач → 403', () => {
    const r = run(ivan);
    assert.equal(r.passed, false);
    assert.equal(r.out.code, 403);
    assert.equal(r.out.view, 'error');
  });

  it('адміністратор → доступ', () => {
    assert.equal(run(adminUser).passed, true);
  });
});

// ---------- Контролер ----------
describe('adminController: розділи', () => {
  const get = (extra = {}) => fakeReq({ user: adminUser, params: { resource: 'things' }, ...extra });

  it('невідомий розділ — 404', async () => {
    for (const action of ['list', 'newForm', 'create', 'editForm', 'update', 'destroy']) {
      const res = fakeRes();
      await admin[action](fakeReq({ user: adminUser, params: { resource: 'secrets', id: 1 }, body: {} }), res);
      assert.equal(res.code, 404, action);
    }
  });

  it('locals додає розділи в бічне меню', () => {
    const res = fakeRes();
    admin.locals(fakeReq(), res, () => {});
    assert.deepEqual(res.locals.adminSections, [{ key: 'things', label: 'Речі' }]);
  });

  it('dashboard: картки з кількістю записів, останні лоти й ставки', async () => {
    fake.model.count = async () => 7;
    const res = fakeRes();
    await admin.dashboard(get(), res);
    assert.equal(res.out.view, 'admin/dashboard');
    assert.deepEqual(res.out.data.cards, [{ key: 'things', label: 'Речі', newLabel: 'Нова річ', count: 7 }]);
    assert.equal(res.out.data.latestLots.length, 1);
    fake.model.count = async (opts) => { calls.countOpts = opts; return calls.total; };
  });
});

describe('adminController: список', () => {
  const list = async (q = {}) => {
    const res = fakeRes();
    await admin.list(fakeReq({ user: adminUser, params: { resource: 'things' }, query: q }), res);
    return res;
  };

  it('запитує сторінку з пошуком, сортуванням і зсувом', async () => {
    const res = await list({ q: 'пер', sort: 'name', dir: 'asc', page: '2' });
    assert.equal(res.out.view, 'admin/list');
    assert.equal(calls.findOpts.limit, 10);
    assert.equal(calls.findOpts.offset, 10);
    assert.deepEqual(calls.findOpts.order, [['name', 'ASC'], ['id', 'ASC']]);
    assert.ok(calls.findOpts.where[Op.or].length > 0);
    assert.equal(res.out.data.pager.page, 2);
    assert.equal(res.out.data.pager.total, 25);
  });

  it('сортування за id без додаткового ключа, за замовчуванням — від нових до старих', async () => {
    await list({});
    assert.deepEqual(calls.findOpts.order, [['id', 'DESC']]);
  });

  it('недозволене поле сортування ігнорується', async () => {
    await list({ sort: 'passwordHash; DROP TABLE users' });
    assert.deepEqual(calls.findOpts.order, [['id', 'DESC']]);
  });

  it('заголовки: посилання сортування, позначка активного стовпця й перемикання напрямку', async () => {
    const res = await list({ sort: 'name', dir: 'asc', q: 'а' });
    const [id, name, price] = res.out.data.columns;
    assert.equal(name.mark, '▲');
    assert.match(name.sortUrl, /sort=name&dir=desc/);
    assert.match(name.sortUrl, /q=%D0%B0/);
    assert.equal(id.mark, '');
    assert.match(id.sortUrl, /sort=id&dir=asc/);
    assert.equal(price.sortUrl, undefined);
  });

  it('рядки таблиці містять типізовані комірки й id', async () => {
    const res = await list();
    assert.deepEqual(res.out.data.rows[0], {
      id: 1,
      cells: [{ type: 'text', value: 1 }, { type: 'text', value: 'Перша' }, { type: 'money', value: 10 }],
    });
  });

  it('навігація сторінками', async () => {
    const res = await list({ page: '2' });
    const { pager } = res.out.data;
    assert.equal(pager.hasPrev, true);
    assert.match(pager.prevUrl, /^\/admin\/things\?sort=id&dir=desc$/);
    assert.match(pager.nextUrl, /page=3/);
    assert.deepEqual(pager.links.map((l) => l.number), [1, 2, 3]);
    assert.equal(pager.links.find((l) => l.current).number, 2);
  });

  it('порожній результат: запит рядків не виконується', async () => {
    calls.total = 0;
    const res = await list({ q: 'нічого' });
    assert.equal(calls.findOpts, undefined);
    assert.deepEqual(res.out.data.rows, []);
    assert.equal(res.out.data.pager.total, 0);
  });
});

describe('adminController: форми', () => {
  it('newForm: порожня форма з назвою та адресою', async () => {
    const res = fakeRes();
    await admin.newForm(fakeReq({ user: adminUser, params: { resource: 'things' } }), res);
    assert.equal(res.out.view, 'admin/form');
    assert.equal(res.out.data.title, 'Нова річ');
    assert.equal(res.out.data.action, '/admin/things');
    assert.equal(res.out.data.backUrl, '/admin/things');
    assert.equal(res.out.data.fields[0].name, 'name');
  });

  it('create з помилками: 400, значення та помилки зберігаються, запис не створюється', async () => {
    const res = fakeRes();
    await admin.create(fakeReq({ user: adminUser, method: 'POST', params: { resource: 'things' }, body: { name: '' } }), res);
    assert.equal(res.code, 400);
    assert.equal(res.out.view, 'admin/form');
    assert.deepEqual(res.out.data.errors, { name: 'Вкажіть назву' });
    assert.equal(calls.created, undefined);
  });

  it('create успішно: redirect на список із повідомленням', async () => {
    const res = fakeRes();
    await admin.create(fakeReq({ user: adminUser, method: 'POST', params: { resource: 'things' }, body: { name: 'Нова' } }), res);
    assert.deepEqual(calls.created, { name: 'Нова' });
    assert.deepEqual(res.out, { type: 'redirect', url: '/admin/things?ok=created' });
  });

  it('create: помилка бізнес-правила (ValidationError) показується у формі', async () => {
    calls.throws = new ValidationError({ _form: 'Правило порушено' });
    const res = fakeRes();
    await admin.create(fakeReq({ user: adminUser, method: 'POST', params: { resource: 'things' }, body: { name: 'Нова' } }), res);
    assert.equal(res.code, 400);
    assert.equal(res.out.data.errors._form, 'Правило порушено');
  });

  it('create: невідома помилка не ковтається', async () => {
    calls.throws = new Error('db down');
    await assert.rejects(
      () => admin.create(fakeReq({ user: adminUser, method: 'POST', params: { resource: 'things' }, body: { name: 'x' } }), fakeRes()),
      /db down/,
    );
  });

  it('editForm: 404 для неіснуючого запису; для існуючого — значення запису', async () => {
    const missing = fakeRes();
    await admin.editForm(fakeReq({ user: adminUser, params: { resource: 'things', id: '99' } }), missing);
    assert.equal(missing.code, 404);

    const res = fakeRes();
    await admin.editForm(fakeReq({ user: adminUser, params: { resource: 'things', id: '1' } }), res);
    assert.equal(res.out.data.action, '/admin/things/1/edit');
    assert.equal(res.out.data.title, 'Редагування: Перша');
    assert.deepEqual(res.out.data.values, { name: 'Перша' });
  });

  it('update: валідатор отримує запис і користувача; успіх → redirect', async () => {
    const res = fakeRes();
    const req = fakeReq({ user: adminUser, method: 'POST', params: { resource: 'things', id: '1' }, body: { name: 'Змінена' } });
    await admin.update(req, res);
    assert.equal(calls.validateCtx.record, record);
    assert.equal(calls.validateCtx.req, req);
    assert.deepEqual(calls.updated, { name: 'Змінена' });
    assert.deepEqual(res.out, { type: 'redirect', url: '/admin/things?ok=updated' });
  });

  it('update з помилками: 400, форма редагування', async () => {
    const res = fakeRes();
    await admin.update(fakeReq({ user: adminUser, method: 'POST', params: { resource: 'things', id: '1' }, body: { name: '' } }), res);
    assert.equal(res.code, 400);
    assert.equal(res.out.data.action, '/admin/things/1/edit');
    assert.equal(calls.updated, undefined);
  });

  it('update: redisplayValues змінює значення, що повертаються у форму', async () => {
    fake.redisplayValues = (body) => ({ ...body, locked: 'з запису' });
    const res = fakeRes();
    await admin.update(fakeReq({ user: adminUser, method: 'POST', params: { resource: 'things', id: '1' }, body: { name: '' } }), res);
    assert.equal(res.out.data.values.locked, 'з запису');
    delete fake.redisplayValues;
  });

  it('update неіснуючого запису — 404', async () => {
    const res = fakeRes();
    await admin.update(fakeReq({ user: adminUser, method: 'POST', params: { resource: 'things', id: '5' }, body: { name: 'x' } }), res);
    assert.equal(res.code, 404);
  });
});

describe('adminController: видалення', () => {
  const del = async (id = '1') => {
    const res = fakeRes();
    await admin.destroy(fakeReq({ user: adminUser, method: 'POST', params: { resource: 'things', id } }), res);
    return res;
  };

  it('успіх → redirect із повідомленням', async () => {
    const res = await del();
    assert.equal(calls.removed, true);
    assert.deepEqual(res.out, { type: 'redirect', url: '/admin/things?ok=deleted' });
  });

  it('відмова за бізнес-правилом → redirect на список із повідомленням про помилку', async () => {
    calls.throws = new ValidationError({ _form: 'Не можна видалити: є пов’язані записи' });
    const res = await del();
    assert.equal(res.out.type, 'redirect');
    assert.match(decodeURIComponent(res.out.url), /^\/admin\/things\?error=Не можна видалити: є пов’язані записи$/);
  });

  it('неіснуючий запис — 404', async () => {
    assert.equal((await del('77')).code, 404);
  });

  it('невідома помилка не ковтається', async () => {
    calls.throws = new Error('boom');
    await assert.rejects(() => del(), /boom/);
  });
});
