// Описи ресурсів адмін-панелі: для кожної таблиці — стовпці списку, поля форми,
// валідація, створення, оновлення та видалення.
//
// Панель керується даними: універсальний контролер (controllers/adminController.js) не знає
// нічого про конкретні таблиці й працює з цим описом. Валідатори та бізнес-правила використовуються
// ті самі, що й на сайті (validators/*, services/bidService), тому правила не розходяться.
//
// Операції create / update / remove можуть кинути ValidationError — контролер покаже
// повідомлення користувачеві (у формі або після перенаправлення на список).

const {
  sequelize, User, Category, LotStatus, Lot, Bid, BidHistory,
} = require('../models');
const { validateLot } = require('../validators/lot');
const { validateCategory } = require('../validators/category');
const { validateStatus } = require('../validators/status');
const { validateUser } = require('../validators/user');
const { validateNewBid, validateBidAmount } = require('../validators/bid');
const { validateHistory } = require('../validators/history');
const { ValidationError } = require('../validators/common');
const { placeBid, updateBidAmount, deleteBid } = require('../services/bidService');
const { hashPassword } = require('../helpers/password');
const { statusLabel, eventLabel } = require('../helpers/labels');
const { SYSTEM_STATUSES, EVENT_TYPES, ROLES } = require('../config/constants');
const { ROLE_LABELS } = require('../auth/permissions');

const DAY = 24 * 60 * 60 * 1000;

// Помилка, що відображається над формою або в повідомленні після перенаправлення
function fail(message) {
  throw new ValidationError({ _form: message });
}

const truncate = (text, length = 60) => {
  const s = String(text || '');
  return s.length > length ? `${s.slice(0, length)}…` : s;
};

// Кількість пов’язаних записів для кожного id: { id: count }
async function countBy(Model, field, ids) {
  if (!ids.length) return {};
  const rows = await Model.count({ where: { [field]: ids }, group: [field] });
  return Object.fromEntries(rows.map((r) => [r[field], r.count]));
}

// ---------- Варіанти для випадаючих списків ----------
const userOptions = async () => (await User.findAll({ order: [['username', 'ASC']] }))
  .map((u) => ({ value: u.id, label: u.username }));

const categoryOptions = async () => (await Category.findAll({ order: [['name', 'ASC']] }))
  .map((c) => ({ value: c.id, label: c.name }));

const statusOptions = async () => (await LotStatus.findAll({ order: [['id', 'ASC']] }))
  .map((s) => ({ value: s.id, label: statusLabel(s.name) }));

const lotOptions = async () => (await Lot.findAll({
  include: [{ model: LotStatus, as: 'status' }], order: [['title', 'ASC']],
})).map((l) => ({ value: l.id, label: `${l.title} (${statusLabel(l.status.name)})` }));

const bidOptions = async () => (await Bid.findAll({
  include: [
    { model: Lot, as: 'lot', attributes: ['id', 'title'] },
    { model: User, as: 'bidder', attributes: ['id', 'username'] },
  ],
  order: [['id', 'ASC']],
})).map((b) => ({
  value: b.id,
  label: `№${b.id} · ${b.lot.title} · ${b.bidder.username} · ${Number(b.amount).toFixed(2)} грн`,
}));

const eventOptions = () => EVENT_TYPES.map((e) => ({ value: e, label: `${eventLabel(e)} (${e})` }));
const roleOptions = () => ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }));

// ---------- Ресурси ----------
const categories = {
  key: 'categories',
  label: 'Категорії',
  newLabel: 'Нова категорія',
  singular: 'категорію',
  model: Category,
  searchFields: ['name', 'description'],
  searchHint: 'Пошук за назвою або описом',
  defaultSort: { field: 'name', dir: 'ASC' },
  columns: [
    { label: 'ID', sort: 'id', value: (r) => r.id },
    { label: 'Назва', sort: 'name', value: (r) => r.name },
    { label: 'Опис', value: (r) => truncate(r.description) },
    { label: 'Лотів', value: (r, extra) => extra.lots[r.id] || 0 },
  ],
  async loadListExtra(rows) {
    return { lots: await countBy(Lot, 'categoryId', rows.map((r) => r.id)) };
  },
  find: (id) => Category.findByPk(id),
  title: (record) => record.name,
  recordValues: (record) => record.toJSON(),
  fields: () => [
    { name: 'name', label: 'Назва категорії', type: 'text' },
    { name: 'description', label: 'Опис', type: 'area' },
  ],
  validate: (body, { record }) => validateCategory(body, { id: record && record.id }),
  async create(values) { return Category.create(values); },
  async update(record, values) { return record.update(values); },
  async remove(record) {
    const lots = await Lot.count({ where: { categoryId: record.id } });
    if (lots > 0) fail(`Не можна видалити категорію «${record.name}»: у ній є лоти (${lots})`);
    return record.destroy();
  },
};

const statuses = {
  key: 'statuses',
  label: 'Статуси лотів',
  newLabel: 'Новий статус',
  singular: 'статус',
  model: LotStatus,
  searchFields: ['name'],
  searchHint: 'Пошук за кодом статусу',
  defaultSort: { field: 'id', dir: 'ASC' },
  columns: [
    { label: 'ID', sort: 'id', value: (r) => r.id },
    { label: 'Код', sort: 'name', value: (r) => r.name },
    { label: 'Підпис', value: (r) => statusLabel(r.name) },
    { label: 'Тип', value: (r) => (SYSTEM_STATUSES.includes(r.name) ? 'системний' : 'власний') },
    { label: 'Лотів', value: (r, extra) => extra.lots[r.id] || 0 },
  ],
  async loadListExtra(rows) {
    return { lots: await countBy(Lot, 'statusId', rows.map((r) => r.id)) };
  },
  find: (id) => LotStatus.findByPk(id),
  title: (record) => record.name,
  recordValues: (record) => record.toJSON(),
  fields: () => [
    { name: 'name', label: 'Код статусу', type: 'text', hint: 'Малі латинські літери, цифри та підкреслення, наприклад: on_hold' },
  ],
  validate: (body, { record }) => validateStatus(body, { id: record && record.id, current: record && record.name }),
  async create(values) { return LotStatus.create(values); },
  async update(record, values) { return record.update(values); },
  async remove(record) {
    if (SYSTEM_STATUSES.includes(record.name)) fail(`Системний статус «${record.name}» видалити не можна`);
    const lots = await Lot.count({ where: { statusId: record.id } });
    if (lots > 0) fail(`Не можна видалити статус «${record.name}»: його мають лоти (${lots})`);
    return record.destroy();
  },
};

const users = {
  key: 'users',
  label: 'Користувачі',
  newLabel: 'Новий користувач',
  singular: 'користувача',
  model: User,
  searchFields: ['username', 'email'],
  searchHint: 'Пошук за іменем або email',
  defaultSort: { field: 'username', dir: 'ASC' },
  columns: [
    { label: 'ID', sort: 'id', value: (r) => r.id },
    { label: 'Ім’я', sort: 'username', value: (r) => r.username },
    { label: 'Email', sort: 'email', value: (r) => r.email },
    { label: 'Роль', sort: 'role', value: (r) => ROLE_LABELS[r.role] || r.role },
    { label: 'Зареєстровано', sort: 'createdAt', type: 'date', value: (r) => r.createdAt },
  ],
  find: (id) => User.findByPk(id),
  title: (record) => record.username,
  defaults: () => ({ role: 'user' }),
  // Пароль у форму не підставляється
  recordValues: (record) => ({ username: record.username, email: record.email, role: record.role }),
  fields: ({ record }) => [
    { name: 'username', label: 'Ім’я користувача', type: 'text', hint: 'Латинські літери, цифри та символи . _ -' },
    { name: 'email', label: 'Email', type: 'text', inputmode: 'email' },
    {
      name: 'password',
      label: record ? 'Новий пароль' : 'Пароль',
      type: 'password',
      hint: record ? 'Залиште порожнім, щоб не змінювати пароль' : 'Щонайменше 6 символів, літери та цифри',
    },
    { name: 'passwordConfirm', label: 'Повторіть пароль', type: 'password' },
    { name: 'role', label: 'Роль', type: 'select', options: roleOptions() },
  ],
  validate: (body, { record }) => validateUser(body, { id: record && record.id, isEdit: Boolean(record) }),
  async create(values) {
    return User.create({
      username: values.username,
      email: values.email,
      role: values.role,
      passwordHash: hashPassword(values.password),
    });
  },
  async update(record, values, { req }) {
    if (record.role === 'admin' && values.role !== 'admin') {
      // Не можна залишити систему без адміністратора
      if (req && req.user && req.user.id === record.id) {
        throw new ValidationError({ role: 'Не можна забрати роль адміністратора у самого себе' });
      }
      if ((await User.count({ where: { role: 'admin' } })) <= 1) {
        throw new ValidationError({ role: 'Не можна змінити роль єдиного адміністратора' });
      }
    }
    const changes = { username: values.username, email: values.email, role: values.role };
    if (values.password) changes.passwordHash = hashPassword(values.password);
    return record.update(changes);
  },
  async remove(record, { req }) {
    if (req && req.user && req.user.id === record.id) fail('Не можна видалити власний обліковий запис');
    const [selling, won, bids, events] = await Promise.all([
      Lot.count({ where: { sellerId: record.id } }),
      Lot.count({ where: { winnerId: record.id } }),
      Bid.count({ where: { userId: record.id } }),
      BidHistory.count({ where: { userId: record.id } }),
    ]);
    if (selling + won + bids + events > 0) {
      fail(`Не можна видалити користувача «${record.username}»: з ним пов’язані лоти (${selling + won}), ставки (${bids}) та записи історії (${events})`);
    }
    return record.destroy();
  },
};

const lots = {
  key: 'lots',
  label: 'Лоти',
  newLabel: 'Новий лот',
  singular: 'лот',
  model: Lot,
  include: () => [
    { model: Category, as: 'category', attributes: ['id', 'name'] },
    { model: User, as: 'seller', attributes: ['id', 'username'] },
    { model: LotStatus, as: 'status', attributes: ['id', 'name'] },
  ],
  searchFields: ['title', 'description'],
  searchHint: 'Пошук за назвою або описом',
  defaultSort: { field: 'id', dir: 'DESC' },
  columns: [
    { label: 'ID', sort: 'id', value: (r) => r.id },
    { label: 'Назва', sort: 'title', value: (r) => r.title },
    { label: 'Категорія', value: (r) => r.category.name },
    { label: 'Продавець', value: (r) => r.seller.username },
    { label: 'Статус', value: (r) => statusLabel(r.status.name) },
    { label: 'Поточна ціна', sort: 'currentPrice', type: 'money', value: (r) => r.currentPrice },
    { label: 'Завершення', sort: 'endTime', type: 'date', value: (r) => r.endTime },
  ],
  find: (id) => Lot.findByPk(id, { include: [{ model: LotStatus, as: 'status' }] }),
  title: (record) => record.title,
  defaults: () => {
    const now = new Date();
    return { minStep: '1.00', startTime: now, endTime: new Date(now.getTime() + 7 * DAY) };
  },
  recordValues: (record) => record.toJSON(),
  // Додаткові відомості для форми: чи є ставки (тоді початкову ціну змінити не можна)
  async formExtra(record) {
    return { hasBids: record ? (await Bid.count({ where: { lotId: record.id } })) > 0 : false };
  },
  // Заблоковане поле не надсилається браузером — при помилці беремо його значення із запису
  redisplayValues: (body, record, extra) => (extra.hasBids ? { ...body, startPrice: record.startPrice } : body),
  fields: async ({ extra }) => {
    const [sellers, cats, stats] = await Promise.all([userOptions(), categoryOptions(), statusOptions()]);
    return [
      { name: 'title', label: 'Назва лоту', type: 'text' },
      { name: 'description', label: 'Опис', type: 'area' },
      {
        name: 'startPrice',
        label: 'Початкова ціна, грн',
        type: 'text',
        inputmode: 'decimal',
        disabled: Boolean(extra.hasBids),
        hint: extra.hasBids ? 'Не можна змінити: на лот уже є ставки' : 'Наприклад: 100 або 100.50',
      },
      { name: 'minStep', label: 'Мінімальний крок ставки, грн', type: 'text', inputmode: 'decimal' },
      { name: 'startTime', label: 'Початок торгів', type: 'datetime' },
      { name: 'endTime', label: 'Завершення торгів', type: 'datetime' },
      { name: 'sellerId', label: 'Продавець', type: 'select', options: sellers },
      { name: 'categoryId', label: 'Категорія', type: 'select', options: cats },
      { name: 'statusId', label: 'Статус', type: 'select', options: stats },
    ];
  },
  validate: (body, { record, extra }) => validateLot(body, { id: record && record.id, hasBids: extra.hasBids }),
  async create(values) {
    return Lot.create({
      title: values.title,
      description: values.description,
      startPrice: values.startPrice,
      currentPrice: values.startPrice, // на початку поточна ціна = початкова
      minStep: values.minStep,
      startTime: values.startTime,
      endTime: values.endTime,
      sellerId: values.sellerId,
      categoryId: values.categoryId,
      statusId: values.statusId,
    });
  },
  async update(lot, values, { extra }) {
    const newStatus = await LotStatus.findByPk(values.statusId);
    const becomesSold = newStatus.name === 'sold' && lot.status.name !== 'sold';

    // Переможець визначається автоматично: автор найвищої ставки, якщо лот проданий
    let winnerId = null;
    let topBid = null;
    if (newStatus.name === 'sold') {
      topBid = await Bid.findOne({ where: { lotId: lot.id }, order: [['amount', 'DESC'], ['id', 'DESC']] });
      winnerId = topBid ? topBid.userId : null;
    }

    const changes = {
      title: values.title,
      description: values.description,
      minStep: values.minStep,
      startTime: values.startTime,
      endTime: values.endTime,
      sellerId: values.sellerId,
      categoryId: values.categoryId,
      statusId: values.statusId,
      winnerId,
    };
    if (!extra.hasBids) {
      changes.startPrice = values.startPrice;
      changes.currentPrice = values.startPrice;
    }

    await sequelize.transaction(async (t) => {
      await lot.update(changes, { transaction: t });
      if (becomesSold && topBid) {
        await BidHistory.create({
          eventType: 'WON', amount: topBid.amount, bidId: topBid.id, lotId: lot.id, userId: topBid.userId,
        }, { transaction: t });
      }
    });
    return lot;
  },
  async remove(lot) {
    // Спочатку залежні записи, потім сам лот (через зовнішні ключі)
    await sequelize.transaction(async (t) => {
      await BidHistory.destroy({ where: { lotId: lot.id }, transaction: t });
      await Bid.destroy({ where: { lotId: lot.id }, transaction: t });
      await lot.destroy({ transaction: t });
    });
  },
};

const bids = {
  key: 'bids',
  label: 'Ставки',
  newLabel: 'Нова ставка',
  singular: 'ставку',
  model: Bid,
  include: () => [
    { model: Lot, as: 'lot', attributes: ['id', 'title'] },
    { model: User, as: 'bidder', attributes: ['id', 'username'] },
  ],
  searchFields: [],
  searchHint: 'Пошук за номером ставки (ID)',
  defaultSort: { field: 'id', dir: 'DESC' },
  columns: [
    { label: 'ID', sort: 'id', value: (r) => r.id },
    { label: 'Лот', value: (r) => r.lot.title },
    { label: 'Користувач', value: (r) => r.bidder.username },
    { label: 'Сума', sort: 'amount', type: 'money', value: (r) => r.amount },
    { label: 'Час', sort: 'createdAt', type: 'date', value: (r) => r.createdAt },
  ],
  find: (id) => Bid.findByPk(id, {
    include: [
      { model: Lot, as: 'lot', attributes: ['id', 'title'] },
      { model: User, as: 'bidder', attributes: ['id', 'username'] },
    ],
  }),
  title: (record) => `№${record.id}`,
  defaults: () => ({}),
  recordValues: (record) => ({ amount: Number(record.amount).toFixed(2) }),
  fields: async ({ record }) => {
    if (record) {
      // Редагування: лот і автор не змінюються, редагується лише сума
      return [
        { name: 'lot', label: 'Лот', type: 'info', value: record.lot.title },
        { name: 'bidder', label: 'Користувач', type: 'info', value: record.bidder.username },
        {
          name: 'amount',
          label: 'Сума ставки, грн',
          type: 'text',
          inputmode: 'decimal',
          hint: 'Редагувати можна лише найвищу ставку непроданого лоту',
        },
      ];
    }
    const [lotList, userList] = await Promise.all([lotOptions(), userOptions()]);
    return [
      { name: 'lotId', label: 'Лот', type: 'select', options: lotList },
      { name: 'userId', label: 'Користувач', type: 'select', options: userList },
      {
        name: 'amount',
        label: 'Сума ставки, грн',
        type: 'text',
        inputmode: 'decimal',
        hint: 'Не менша за початкову ціну (перша ставка) або поточну ціну + крок',
      },
    ];
  },
  // Створення, зміна й видалення ставок виконуються сервісом у транзакції (оновлюються ціна лоту та історія)
  validate: async (body, { record }) => (record ? validateBidAmount(body) : validateNewBid(body)),
  async create(values) { return placeBid(values); },
  async update(record, values) { return updateBidAmount({ bidId: record.id, amount: values.amount }); },
  async remove(record) { return deleteBid({ bidId: record.id }); },
};

const history = {
  key: 'history',
  label: 'Історія ставок',
  newLabel: 'Нова подія',
  singular: 'подію',
  model: BidHistory,
  include: () => [
    { model: Lot, as: 'lot', attributes: ['id', 'title'] },
    { model: User, as: 'user', attributes: ['id', 'username'] },
  ],
  searchFields: [],
  searchHint: 'Пошук за номером події (ID)',
  defaultSort: { field: 'id', dir: 'DESC' },
  columns: [
    { label: 'ID', sort: 'id', value: (r) => r.id },
    { label: 'Подія', value: (r) => eventLabel(r.eventType) },
    { label: 'Лот', value: (r) => r.lot.title },
    { label: 'Користувач', value: (r) => r.user.username },
    { label: 'Сума', sort: 'amount', type: 'money', value: (r) => r.amount },
    { label: 'Час', sort: 'createdAt', type: 'date', value: (r) => r.createdAt },
  ],
  find: (id) => BidHistory.findByPk(id),
  title: (record) => `№${record.id}`,
  defaults: () => ({}),
  recordValues: (record) => ({
    bidId: record.bidId, eventType: record.eventType, amount: Number(record.amount).toFixed(2),
  }),
  fields: async () => [
    {
      name: 'bidId',
      label: 'Ставка',
      type: 'select',
      options: await bidOptions(),
      hint: 'Лот і користувач визначаються автоматично за обраною ставкою',
    },
    { name: 'eventType', label: 'Тип події', type: 'select', options: eventOptions() },
    { name: 'amount', label: 'Сума, грн', type: 'text', inputmode: 'decimal', hint: 'Наприклад: 150 або 150.50' },
  ],
  validate: (body, { record }) => validateHistory(body, { id: record && record.id }),
  async create(values) { return BidHistory.create(values); },
  async update(record, values) { return record.update(values); },
  async remove(record) { return record.destroy(); },
};

// Порядок = порядок розділів у бічному меню
const list = [lots, categories, statuses, users, bids, history];
const byKey = Object.fromEntries(list.map((r) => [r.key, r]));

module.exports = { list, byKey };
