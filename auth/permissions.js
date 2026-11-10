// Ролі та права доступу.
//
// Ролі:
//   guest — відвідувач: неавторизований користувач (у базі не зберігається);
//   user  — зареєстрований користувач: бере участь в аукціоні, керує власними лотами й ставками;
//   admin — адміністратор: повний доступ, керує довідниками й користувачами.
//
// Усі правила зібрано в одній таблиці RULES: «дія → хто може її виконати».
// Для дій над чужими даними додатково вказується правило власника (own): звичайний користувач
// може змінювати лише свої ресурси, адміністратор — будь-які.
// Усе, чого в таблиці немає, заборонено (принцип «заборонено, доки не дозволено»).

const GUEST = 'guest';
const USER = 'user';
const ADMIN = 'admin';

const ROLE_LABELS = {
  [GUEST]: 'Відвідувач',
  [USER]: 'Користувач',
  [ADMIN]: 'Адміністратор',
};

const ANY = [GUEST, USER, ADMIN];
const LOGGED_IN = [USER, ADMIN];
const ADMIN_ONLY = [ADMIN];

// Власник ресурсу: поле ресурсу (sellerId, userId, id) збігається з id поточного користувача
const ownedBy = (field) => (user, resource) => (
  Boolean(resource) && resource[field] !== undefined && Number(resource[field]) === Number(user.id)
);

const RULES = {
  // Лоти
  'lot:view': { roles: ANY },
  'lot:create': { roles: LOGGED_IN },
  'lot:edit': { roles: LOGGED_IN, own: ownedBy('sellerId') },
  'lot:delete': { roles: LOGGED_IN, own: ownedBy('sellerId') },
  'lot:setSeller': { roles: ADMIN_ONLY }, // обрати іншого продавця

  // Категорії та статуси лотів
  'category:view': { roles: ANY },
  'category:manage': { roles: ADMIN_ONLY },
  'status:manage': { roles: ADMIN_ONLY },

  // Адмін-панель (захищена область керування даними всіх таблиць)
  'admin:access': { roles: ADMIN_ONLY },

  // Користувачі
  'user:list': { roles: ADMIN_ONLY },
  'user:create': { roles: ADMIN_ONLY },
  'user:view': { roles: LOGGED_IN, own: ownedBy('id') },
  'user:edit': { roles: LOGGED_IN, own: ownedBy('id') },
  'user:delete': { roles: ADMIN_ONLY },
  'user:setRole': { roles: ADMIN_ONLY },

  // Ставки
  'bid:view': { roles: LOGGED_IN },
  'bid:create': { roles: LOGGED_IN },
  'bid:createFor': { roles: ADMIN_ONLY }, // зробити ставку від імені іншого користувача
  'bid:edit': { roles: LOGGED_IN, own: ownedBy('userId') },
  'bid:delete': { roles: LOGGED_IN, own: ownedBy('userId') },

  // Історія ставок
  'history:view': { roles: LOGGED_IN },
  'history:manage': { roles: ADMIN_ONLY },
};

// Роль користувача; усе невідоме трактується як відвідувач
function roleOf(user) {
  if (user && (user.role === USER || user.role === ADMIN)) return user.role;
  return GUEST;
}

// Чи може роль користувача взагалі виконувати дію (без перевірки власника).
// Використовується для захисту маршрутів: чи має сенс пускати далі.
function mayAttempt(user, action) {
  const rule = RULES[action];
  return Boolean(rule) && rule.roles.includes(roleOf(user));
}

// Чи може користувач виконати дію над конкретним ресурсом.
// Для дій із правилом власника ресурс обов’язковий (без нього звичайному користувачеві відмовляють).
function can(user, action, resource) {
  const rule = RULES[action];
  if (!rule) return false;
  const role = roleOf(user);
  if (!rule.roles.includes(role)) return false;
  if (rule.own && role !== ADMIN) return rule.own(user, resource);
  return true;
}

module.exports = {
  GUEST, USER, ADMIN, ROLE_LABELS, RULES, roleOf, mayAttempt, can,
};
