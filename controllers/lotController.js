const { Op } = require('sequelize');
const {
  sequelize, Lot, Category, LotStatus, User, Bid, BidHistory,
} = require('../models');
const { validateLot } = require('../validators/lot');
const { hasErrors } = require('../validators/common');
const { notFound, forbidden } = require('../helpers/respond');
const { can } = require('../auth/permissions');
const { statusLabel } = require('../helpers/labels');

const DAY = 24 * 3600 * 1000;
const NOT_FOUND = 'Лот не знайдено';

// Дані для випадаючих списків у формі лоту
async function loadOptions() {
  const [categories, statuses, users] = await Promise.all([
    Category.findAll({ order: [['name', 'ASC']] }),
    LotStatus.findAll({ order: [['id', 'ASC']] }),
    User.findAll({ order: [['username', 'ASC']] }),
  ]);
  return {
    categoryOptions: categories.map((c) => ({ value: c.id, label: c.name })),
    statusOptions: statuses.map((s) => ({ value: s.id, label: statusLabel(s.name) })),
    userOptions: users.map((u) => ({ value: u.id, label: u.username })),
  };
}

async function renderForm(res, {
  status = 200, title, action, values, errors = {}, hasBids = false, lot = null,
}) {
  res.status(status).render('lots/form', {
    title, action, values, errors, hasBids, lot, ...(await loadOptions()),
  });
}

// GET /lots — список лотів з фільтрами
exports.index = async (req, res) => {
  const q = String(req.query.q || '').trim();
  const category = req.query.category || '';
  const status = req.query.status || '';

  const where = {};
  if (q) where.title = { [Op.like]: `%${q}%` };
  if (category) where.categoryId = category;
  if (status) where.statusId = status;

  const [lots, categories, statuses] = await Promise.all([
    Lot.findAll({
      where,
      include: [
        { model: Category, as: 'category' },
        { model: LotStatus, as: 'status' },
        { model: User, as: 'seller', attributes: ['id', 'username'] },
        { model: Bid, as: 'bids', attributes: ['id'] },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
    }),
    Category.findAll({ order: [['name', 'ASC']] }),
    LotStatus.findAll({ order: [['id', 'ASC']] }),
  ]);

  res.render('lots/index', {
    title: 'Лоти', lots, categories, statuses, filters: { q, category, status },
  });
};

// GET /lots/:id — сторінка лоту зі ставками та історією
exports.show = async (req, res) => {
  const lot = await Lot.findByPk(req.params.id, {
    include: [
      { model: Category, as: 'category' },
      { model: LotStatus, as: 'status' },
      { model: User, as: 'seller', attributes: ['id', 'username'] },
      { model: User, as: 'winner', attributes: ['id', 'username'] },
      { model: Bid, as: 'bids', include: [{ model: User, as: 'bidder', attributes: ['id', 'username'] }] },
    ],
  });
  if (!lot) return notFound(res, NOT_FOUND);

  // Ставки: від найвищої до найнижчої
  lot.bids.sort((a, b) => Number(b.amount) - Number(a.amount) || b.id - a.id);

  const [history, users] = await Promise.all([
    BidHistory.findAll({
      where: { lotId: lot.id },
      include: [{ model: User, as: 'user', attributes: ['id', 'username'] }],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
    }),
    // Список користувачів потрібен лише адміністратору (ставка від імені іншого користувача)
    can(req.user, 'bid:createFor') ? User.findAll({ order: [['username', 'ASC']] }) : [],
  ]);

  const hasBids = lot.bids.length > 0;
  const minBid = hasBids ? Number(lot.currentPrice) + Number(lot.minStep) : Number(lot.startPrice);
  const now = new Date();
  const canBid = lot.status.name === 'active' && now >= lot.startTime && now <= lot.endTime;

  res.render('lots/show', {
    title: lot.title,
    lot,
    history,
    userOptions: users.map((u) => ({ value: u.id, label: u.username })),
    hasBids,
    minBid: minBid.toFixed(2),
    canBid,
  });
};

// GET /lots/new — форма створення
exports.newForm = async (req, res) => {
  const now = new Date();
  await renderForm(res, {
    title: 'Новий лот',
    action: '/lots',
    values: { minStep: '1.00', startTime: now, endTime: new Date(now.getTime() + 7 * DAY) },
  });
};

// POST /lots — створення лоту
exports.create = async (req, res) => {
  // Звичайний користувач завжди є продавцем власного лоту; обрати іншого продавця може лише адміністратор.
  // Значення з форми для нього ігнорується (інакше можна було б підробити запит).
  const body = can(req.user, 'lot:setSeller') ? req.body : { ...req.body, sellerId: String(req.user.id) };
  const { values, errors } = await validateLot(body);

  if (hasErrors(errors)) {
    return renderForm(res, {
      status: 400, title: 'Новий лот', action: '/lots', values: body, errors,
    });
  }

  const lot = await Lot.create({
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

  res.redirect(`/lots/${lot.id}?ok=created`);
};

// GET /lots/:id/edit — форма редагування
exports.editForm = async (req, res) => {
  const lot = await Lot.findByPk(req.params.id);
  if (!lot) return notFound(res, NOT_FOUND);
  if (!can(req.user, 'lot:edit', lot)) return forbidden(res, 'Редагувати лот може лише його продавець або адміністратор');
  const hasBids = (await Bid.count({ where: { lotId: lot.id } })) > 0;

  await renderForm(res, {
    title: `Редагування: ${lot.title}`,
    action: `/lots/${lot.id}/edit`,
    values: lot.toJSON(),
    hasBids,
    lot,
  });
};

// POST /lots/:id/edit — збереження змін
exports.update = async (req, res) => {
  const lot = await Lot.findByPk(req.params.id, { include: [{ model: LotStatus, as: 'status' }] });
  if (!lot) return notFound(res, NOT_FOUND);
  if (!can(req.user, 'lot:edit', lot)) return forbidden(res, 'Редагувати лот може лише його продавець або адміністратор');

  const hasBids = (await Bid.count({ where: { lotId: lot.id } })) > 0;
  // Продавця змінює лише адміністратор; для власника лот залишається за ним
  const body = can(req.user, 'lot:setSeller') ? req.body : { ...req.body, sellerId: String(lot.sellerId) };
  const { values, errors } = await validateLot(body, { id: lot.id, hasBids });

  if (hasErrors(errors)) {
    // Заблокована початкова ціна в тілі запиту не приходить — беремо її з лоту
    const formValues = hasBids ? { ...body, startPrice: lot.startPrice } : body;
    return renderForm(res, {
      status: 400,
      title: `Редагування: ${lot.title}`,
      action: `/lots/${lot.id}/edit`,
      values: formValues,
      errors,
      hasBids,
      lot,
    });
  }

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
  // Початкову ціну можна змінити, лише поки немає жодної ставки
  if (!hasBids) {
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

  res.redirect(`/lots/${lot.id}?ok=updated`);
};

// POST /lots/:id/delete — видалення лоту разом зі ставками та історією
exports.destroy = async (req, res) => {
  const lot = await Lot.findByPk(req.params.id);
  if (!lot) return notFound(res, NOT_FOUND);
  if (!can(req.user, 'lot:delete', lot)) return forbidden(res, 'Видалити лот може лише його продавець або адміністратор');

  await sequelize.transaction(async (t) => {
    // Спочатку залежні записи, потім сам лот (через зовнішні ключі)
    await BidHistory.destroy({ where: { lotId: lot.id }, transaction: t });
    await Bid.destroy({ where: { lotId: lot.id }, transaction: t });
    await lot.destroy({ transaction: t });
  });

  res.redirect('/lots?ok=deleted');
};
