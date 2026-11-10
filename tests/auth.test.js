// Тести авторизації та ролей. Запуск: npm test
// Перевіряються: таблиця прав, middleware, хешування паролів, логіка Passport (verify),
// валідація форми входу та захист кожного маршруту для відвідувача, користувача й адміністратора.

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');

const {
  stub, installStubs, anyFunctions, fakeRes, fakeReq,
} = require('./helpers/stubs');

// Пакет sequelize не потрібен для цих тестів: підставляємо заглушку до завантаження модулів
stub('sequelize', { Op: { or: Symbol('or'), like: Symbol('like') } });
installStubs();

const {
  RULES, roleOf, mayAttempt, can, GUEST, USER, ADMIN,
} = require('../auth/permissions');
const mw = require('../auth/middleware');
const { hashPassword, verifyPassword } = require('../helpers/password');
const { authenticate, makeVerify, INVALID_CREDENTIALS } = require('../auth/passport');
const { validateLogin } = require('../validators/auth');

const guest = null;
const ivan = { id: 2, username: 'ivan', role: 'user' };
const olena = { id: 3, username: 'olena', role: 'user' };
const admin = { id: 1, username: 'admin', role: 'admin' };

// ---------- Ролі та права ----------
describe('permissions: ролі', () => {
  it('роль визначається за користувачем; невідоме — відвідувач', () => {
    assert.equal(roleOf(null), GUEST);
    assert.equal(roleOf(undefined), GUEST);
    assert.equal(roleOf(ivan), USER);
    assert.equal(roleOf(admin), ADMIN);
    assert.equal(roleOf({ id: 9, role: 'superuser' }), GUEST);
    assert.equal(roleOf({ id: 9 }), GUEST);
  });

  it('невідома дія заборонена всім, навіть адміністратору', () => {
    assert.equal(can(admin, 'something:unknown'), false);
    assert.equal(mayAttempt(admin, 'something:unknown'), false);
  });
});

describe('permissions: відвідувач (guest)', () => {
  it('може лише переглядати лоти та категорії', () => {
    assert.ok(can(guest, 'lot:view'));
    assert.ok(can(guest, 'category:view'));
  });

  it('не може нічого змінювати й бачити службові розділи', () => {
    for (const action of [
      'lot:create', 'lot:edit', 'lot:delete', 'category:manage', 'status:manage', 'user:list', 'user:view',
      'user:edit', 'user:delete', 'admin:access', 'bid:view', 'bid:create', 'bid:edit', 'bid:delete', 'history:view', 'history:manage',
    ]) {
      assert.equal(can(guest, action, { id: 1, sellerId: 1, userId: 1 }), false, action);
      assert.equal(mayAttempt(guest, action), false, action);
    }
  });
});

describe('permissions: користувач (user)', () => {
  it('може створювати лоти, робити ставки та переглядати ставки й історію', () => {
    for (const action of ['lot:create', 'bid:create', 'bid:view', 'history:view', 'lot:view']) {
      assert.ok(can(ivan, action), action);
    }
  });

  it('змінює й видаляє лише власні лоти', () => {
    assert.ok(can(ivan, 'lot:edit', { sellerId: 2 }));
    assert.ok(can(ivan, 'lot:delete', { sellerId: 2 }));
    assert.equal(can(ivan, 'lot:edit', { sellerId: 3 }), false);
    assert.equal(can(ivan, 'lot:delete', { sellerId: 3 }), false);
  });

  it('змінює й видаляє лише власні ставки', () => {
    assert.ok(can(ivan, 'bid:edit', { userId: 2 }));
    assert.equal(can(ivan, 'bid:edit', { userId: 3 }), false);
    assert.equal(can(ivan, 'bid:delete', { userId: 3 }), false);
  });

  it('бачить і редагує лише власний профіль', () => {
    assert.ok(can(ivan, 'user:view', { id: 2 }));
    assert.ok(can(ivan, 'user:edit', { id: 2 }));
    assert.equal(can(ivan, 'user:view', { id: 3 }), false);
    assert.equal(can(ivan, 'user:edit', { id: 3 }), false);
  });

  it('для дій із правилом власника без ресурсу відмовляють (контролер не може «забути» перевірку)', () => {
    assert.equal(can(ivan, 'lot:edit'), false);
    assert.equal(can(ivan, 'bid:delete', undefined), false);
    assert.equal(can(ivan, 'lot:edit', {}), false);
  });

  it('id порівнюються як числа (рядок "2" з адреси дорівнює 2)', () => {
    assert.ok(can(ivan, 'lot:edit', { sellerId: '2' }));
  });

  it('не має адміністративних прав', () => {
    for (const action of [
      'category:manage', 'status:manage', 'user:list', 'user:create', 'user:delete', 'user:setRole',
      'history:manage', 'lot:setSeller', 'bid:createFor', 'admin:access',
    ]) {
      assert.equal(can(ivan, action, { id: 2, sellerId: 2, userId: 2 }), false, action);
    }
  });
});

describe('permissions: адміністратор (admin)', () => {
  it('має право на всі дії з таблиці, у тому числі над чужими ресурсами', () => {
    for (const action of Object.keys(RULES)) {
      assert.ok(can(admin, action, { id: 99, sellerId: 99, userId: 99 }), action);
    }
  });

  it('ролі не «успадковуються»: у таблиці немає дії, доступної user, але не доступної admin', () => {
    for (const [action, rule] of Object.entries(RULES)) {
      if (rule.roles.includes(USER)) assert.ok(rule.roles.includes(ADMIN), action);
    }
  });
});

// ---------- Middleware ----------
describe('safeNext', () => {
  it('приймає лише відносні шляхи всередині сайту', () => {
    assert.equal(mw.safeNext('/'), '/');
    assert.equal(mw.safeNext('/lots/5'), '/lots/5');
    assert.equal(mw.safeNext('/lots?category=2'), '/lots?category=2');
  });

  it('відхиляє зовнішні й небезпечні адреси (відкритий редирект)', () => {
    for (const bad of ['//evil.example', 'https://evil.example', '/\\evil.example', 'evil', '', null, undefined, 5, '/a\nb', `/${'a'.repeat(400)}`]) {
      assert.equal(mw.safeNext(bad), null, String(bad));
    }
  });
});

describe('withQuery', () => {
  it('додає параметр з ? або &', () => {
    assert.equal(mw.withQuery('/lots', 'ok', 'login'), '/lots?ok=login');
    assert.equal(mw.withQuery('/lots?x=1', 'ok', 'login'), '/lots?x=1&ok=login');
  });
});

describe('requireLogin / guestOnly', () => {
  it('відвідувача перенаправляє на вхід із поверненням на GET-сторінку', () => {
    const res = fakeRes();
    let called = false;
    mw.requireLogin(fakeReq({ originalUrl: '/lots/new' }), res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.out.type, 'redirect');
    assert.match(res.out.url, /^\/login\?next=%2Flots%2Fnew&error=/);
  });

  it('для POST адреса повернення не запам’ятовується', () => {
    const res = fakeRes();
    mw.requireLogin(fakeReq({ method: 'POST', originalUrl: '/bids' }), res, () => {});
    assert.ok(!res.out.url.includes('next='));
    assert.match(res.out.url, /^\/login\?error=/);
  });

  it('авторизованого пропускає', () => {
    let called = false;
    mw.requireLogin(fakeReq({ user: ivan }), fakeRes(), () => { called = true; });
    assert.ok(called);
  });

  it('guestOnly: авторизованого відправляє на головну', () => {
    const res = fakeRes();
    mw.guestOnly(fakeReq({ user: ivan }), res, () => assert.fail('не мав пропустити'));
    assert.deepEqual(res.out, { type: 'redirect', url: '/' });
    let called = false;
    mw.guestOnly(fakeReq(), fakeRes(), () => { called = true; });
    assert.ok(called);
  });
});

describe('requirePermission', () => {
  const run = (user, action, req = {}) => {
    const res = fakeRes();
    let passed = false;
    mw.requirePermission(action)(fakeReq({ user, ...req }), res, () => { passed = true; });
    return { passed, out: res.out };
  };

  it('відвідувач без права → перенаправлення на вхід', () => {
    const r = run(guest, 'category:manage', { originalUrl: '/categories/new' });
    assert.equal(r.passed, false);
    assert.equal(r.out.type, 'redirect');
    assert.match(r.out.url, /^\/login/);
  });

  it('авторизований без права → 403', () => {
    const r = run(ivan, 'category:manage');
    assert.equal(r.passed, false);
    assert.equal(r.out.type, 'render');
    assert.equal(r.out.code, 403);
    assert.equal(r.out.data.code, 403);
  });

  it('з правом → далі', () => {
    assert.ok(run(admin, 'category:manage').passed);
    assert.ok(run(ivan, 'lot:create').passed);
    assert.ok(run(guest, 'lot:view').passed);
  });

  it('для дій «лише власник» маршрут пропускає користувача (власника перевіряє контролер)', () => {
    assert.ok(run(ivan, 'lot:edit').passed);
  });
});

describe('authLocals', () => {
  it('дає шаблонам користувача, роль і функцію can()', () => {
    const res = fakeRes();
    mw.authLocals(fakeReq({ user: ivan }), res, () => {});
    assert.equal(res.locals.currentUser, ivan);
    assert.equal(res.locals.role, 'user');
    assert.equal(res.locals.roleLabel, 'Користувач');
    assert.equal(res.locals.can('lot:edit', { sellerId: 2 }), true);
    assert.equal(res.locals.can('lot:edit', { sellerId: 3 }), false);
  });

  it('для відвідувача: роль «Відвідувач», can() відмовляє', () => {
    const res = fakeRes();
    mw.authLocals(fakeReq(), res, () => {});
    assert.equal(res.locals.currentUser, null);
    assert.equal(res.locals.roleLabel, 'Відвідувач');
    assert.equal(res.locals.can('lot:create'), false);
    assert.equal(res.locals.can('lot:view'), true);
  });
});

// ---------- Паролі ----------
describe('паролі', () => {
  it('hashPassword дає різні хеші для однакових паролів (випадкова сіль)', () => {
    assert.notEqual(hashPassword('Secret123'), hashPassword('Secret123'));
    assert.match(hashPassword('Secret123'), /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });

  it('verifyPassword приймає правильний і відхиляє неправильний пароль', () => {
    const stored = hashPassword('Secret123');
    assert.equal(verifyPassword('Secret123', stored), true);
    assert.equal(verifyPassword('secret123', stored), false);
    assert.equal(verifyPassword('', stored), false);
  });

  it('verifyPassword не падає на некоректних збережених значеннях', () => {
    for (const bad of ['seed-hash-1', '', null, undefined, 'abc:zzz', 'a:b:c', ':']) {
      assert.equal(verifyPassword('Secret123', bad), false, String(bad));
    }
  });
});

// ---------- Passport: функція verify ----------
describe('passport: authenticate / verify', () => {
  const stored = { id: 2, username: 'ivan', passwordHash: hashPassword('User1234') };
  const findUser = async (login) => (['ivan', 'ivan@mail.com'].includes(login) ? stored : null);

  it('правильні дані → користувач', async () => {
    assert.equal(await authenticate('ivan', 'User1234', findUser), stored);
  });

  it('неправильний пароль або невідомий логін → null', async () => {
    assert.equal(await authenticate('ivan', 'wrong', findUser), null);
    assert.equal(await authenticate('nobody', 'User1234', findUser), null);
  });

  it('makeVerify викликає done за контрактом Passport', async () => {
    const verify = makeVerify(findUser);
    const call = (login, password) => new Promise((resolve) => {
      verify(login, password, (err, user, info) => resolve({ err, user, info }));
    });
    const ok = await call('ivan', 'User1234');
    assert.equal(ok.err, null);
    assert.equal(ok.user, stored);

    const bad = await call('ivan', 'nope');
    assert.equal(bad.user, false);
    assert.equal(bad.info.message, INVALID_CREDENTIALS);
  });

  it('повідомлення про помилку не розкриває, що саме невірне', () => {
    assert.doesNotMatch(INVALID_CREDENTIALS, /не існує|не знайден/i);
  });

  it('помилка бази даних передається в done як помилка', async () => {
    const verify = makeVerify(async () => { throw new Error('db down'); });
    const err = await new Promise((resolve) => verify('x', 'y', (e) => resolve(e)));
    assert.equal(err.message, 'db down');
  });
});

// ---------- Валідація форми входу ----------
describe('validateLogin', () => {
  it('порожня форма: помилки обох полів', () => {
    const { errors } = validateLogin({});
    assert.deepEqual(Object.keys(errors).sort(), ['login', 'password']);
  });

  it('занадто довгі значення відхиляються', () => {
    const { errors } = validateLogin({ login: 'a'.repeat(101), password: 'b'.repeat(101) });
    assert.match(errors.login, /довге/);
    assert.match(errors.password, /довгий/);
  });

  it('коректні дані проходять; логін обрізається', () => {
    const { errors, values } = validateLogin({ login: '  ivan ', password: 'User1234' });
    assert.deepEqual(errors, {});
    assert.equal(values.login, 'ivan');
  });
});

// ---------- Захист маршрутів ----------
describe('маршрути: доступ за ролями', () => {
  const routes = [];

  before(() => {
    // Підміняємо express і контролери: вони потрібні лише як імена обробників
    // Кожен express.Router() — окремий «записувач» маршрутів. Головний router — той, що має /login
    // (адмін-маршрути з routes/admin.js перевіряються окремо в tests/admin.test.js)
    const routers = [];
    stub('express', {
      Router: () => {
        const recorded = [];
        const router = { recorded };
        for (const method of ['get', 'post']) {
          router[method] = (path, ...handlers) => recorded.push({ method: method.toUpperCase(), path, handlers });
        }
        router.use = () => {};
        routers.push(router);
        return router;
      },
    });
    for (const name of ['home', 'auth', 'lot', 'category', 'status', 'user', 'bid', 'history', 'admin']) {
      stub(`controllers/${name}Controller`, anyFunctions());
    }
    require('../routes/index.js');
    const main = routers.find((r) => r.recorded.some((x) => x.path === '/login'));
    routes.push(...main.recorded);
  });

  // Виконує всі middleware маршруту (крім контролера в кінці) і повертає, що сталося
  function access(method, path, user) {
    const route = routes.find((r) => r.method === method && r.path === path);
    assert.ok(route, `маршрут ${method} ${path} не знайдено`);
    const res = fakeRes();
    const req = fakeReq({ user, method, originalUrl: path });
    const guards = route.handlers.slice(0, -1);
    for (const guard of guards) {
      let passed = false;
      guard(req, res, () => { passed = true; });
      if (!passed) {
        if (res.out.type === 'redirect') return res.out.url.startsWith('/login') ? 'login' : `redirect:${res.out.url}`;
        return res.out.code === 403 ? '403' : 'blocked';
      }
    }
    return 'allow';
  }

  // [метод, адреса, відвідувач, користувач, адміністратор]
  const MATRIX = [
    ['GET', '/', 'allow', 'allow', 'allow'],
    ['GET', '/lots', 'allow', 'allow', 'allow'],
    ['GET', '/lots/:id', 'allow', 'allow', 'allow'],
    ['GET', '/categories', 'allow', 'allow', 'allow'],

    ['GET', '/lots/new', 'login', 'allow', 'allow'],
    ['POST', '/lots', 'login', 'allow', 'allow'],
    ['GET', '/lots/:id/edit', 'login', 'allow', 'allow'], // власника перевіряє контролер
    ['POST', '/lots/:id/edit', 'login', 'allow', 'allow'],
    ['POST', '/lots/:id/delete', 'login', 'allow', 'allow'],

    ['GET', '/categories/new', 'login', '403', 'allow'],
    ['POST', '/categories', 'login', '403', 'allow'],
    ['GET', '/categories/:id/edit', 'login', '403', 'allow'],
    ['POST', '/categories/:id/edit', 'login', '403', 'allow'],
    ['POST', '/categories/:id/delete', 'login', '403', 'allow'],

    ['GET', '/statuses', 'login', '403', 'allow'],
    ['GET', '/statuses/new', 'login', '403', 'allow'],
    ['POST', '/statuses', 'login', '403', 'allow'],
    ['GET', '/statuses/:id/edit', 'login', '403', 'allow'],
    ['POST', '/statuses/:id/edit', 'login', '403', 'allow'],
    ['POST', '/statuses/:id/delete', 'login', '403', 'allow'],

    ['GET', '/users', 'login', '403', 'allow'],
    ['GET', '/users/new', 'login', '403', 'allow'],
    ['POST', '/users', 'login', '403', 'allow'],
    ['GET', '/users/:id', 'login', 'allow', 'allow'], // чужий профіль закриває контролер
    ['GET', '/users/:id/edit', 'login', 'allow', 'allow'],
    ['POST', '/users/:id/edit', 'login', 'allow', 'allow'],
    ['POST', '/users/:id/delete', 'login', '403', 'allow'],

    ['GET', '/bids', 'login', 'allow', 'allow'],
    ['GET', '/bids/new', 'login', 'allow', 'allow'],
    ['POST', '/bids', 'login', 'allow', 'allow'],
    ['GET', '/bids/:id/edit', 'login', 'allow', 'allow'],
    ['POST', '/bids/:id/edit', 'login', 'allow', 'allow'],
    ['POST', '/bids/:id/delete', 'login', 'allow', 'allow'],

    ['GET', '/history', 'login', 'allow', 'allow'],
    ['GET', '/history/new', 'login', '403', 'allow'],
    ['POST', '/history', 'login', '403', 'allow'],
    ['GET', '/history/:id/edit', 'login', '403', 'allow'],
    ['POST', '/history/:id/edit', 'login', '403', 'allow'],
    ['POST', '/history/:id/delete', 'login', '403', 'allow'],

    ['POST', '/logout', 'login', 'allow', 'allow'],
    ['GET', '/login', 'allow', 'redirect:/', 'redirect:/'],
    ['POST', '/login', 'allow', 'redirect:/', 'redirect:/'],
    ['GET', '/register', 'allow', 'redirect:/', 'redirect:/'],
    ['POST', '/register', 'allow', 'redirect:/', 'redirect:/'],
  ];

  for (const [method, path, forGuest, forUser, forAdmin] of MATRIX) {
    it(`${method} ${path}: відвідувач → ${forGuest}, користувач → ${forUser}, адміністратор → ${forAdmin}`, () => {
      assert.equal(access(method, path, guest), forGuest, 'відвідувач');
      assert.equal(access(method, path, ivan), forUser, 'користувач');
      assert.equal(access(method, path, admin), forAdmin, 'адміністратор');
    });
  }

  it('таблиця покриває всі маршрути (нових маршрутів без перевірки прав немає)', () => {
    const covered = new Set(MATRIX.map(([m, p]) => `${m} ${p}`));
    const missing = routes.map((r) => `${r.method} ${r.path}`).filter((k) => !covered.has(k));
    assert.deepEqual(missing, []);
  });

  it('усі маршрути, що змінюють дані (POST), крім входу й реєстрації, захищені middleware', () => {
    const open = ['/login', '/register'];
    for (const r of routes.filter((x) => x.method === 'POST' && !open.includes(x.path))) {
      assert.ok(r.handlers.length >= 2, `POST ${r.path} без захисту`);
      assert.equal(access('POST', r.path, guest), 'login', `POST ${r.path} доступний відвідувачу`);
    }
  });
});
