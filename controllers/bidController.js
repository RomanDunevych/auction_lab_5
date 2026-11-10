const {
  Lot, User, Bid, LotStatus,
} = require('../models');
const { validateNewBid, validateBidAmount } = require('../validators/bid');
const { ValidationError, hasErrors } = require('../validators/common');
const { placeBid, updateBidAmount, deleteBid } = require('../services/bidService');
const { notFound, forbidden, redirectWithError, firstError } = require('../helpers/respond');
const { can } = require('../auth/permissions');
const { statusLabel } = require('../helpers/labels');

const NOT_FOUND = 'Ставку не знайдено';

// Дані для випадаючих списків у формі нової ставки
async function loadOptions() {
  const [lots, users] = await Promise.all([
    Lot.findAll({ include: [{ model: LotStatus, as: 'status' }], order: [['title', 'ASC']] }),
    User.findAll({ order: [['username', 'ASC']] }),
  ]);
  return {
    lotOptions: lots.map((l) => ({ value: l.id, label: `${l.title} (${statusLabel(l.status.name)})` })),
    userOptions: users.map((u) => ({ value: u.id, label: u.username })),
  };
}

async function renderForm(res, {
  status = 200, title, action, values, errors = {}, bid = null,
}) {
  res.status(status).render('bids/form', {
    title, action, values, errors, bid, ...(await loadOptions()),
  });
}

// GET /bids — список усіх ставок (за потреби — лише одного лоту)
exports.index = async (req, res) => {
  const lot = req.query.lot || '';
  const where = lot ? { lotId: lot } : {};

  const [bids, lots] = await Promise.all([
    Bid.findAll({
      where,
      include: [
        { model: Lot, as: 'lot', attributes: ['id', 'title'] },
        { model: User, as: 'bidder', attributes: ['id', 'username'] },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
    }),
    Lot.findAll({ attributes: ['id', 'title'], order: [['title', 'ASC']] }),
  ]);

  res.render('bids/index', { title: 'Ставки', bids, lots, filters: { lot } });
};

// GET /bids/new — форма нової ставки (?lotId=... підставляє лот)
exports.newForm = async (req, res) => {
  await renderForm(res, {
    title: 'Нова ставка', action: '/bids', values: { lotId: req.query.lotId || '' },
  });
};

// POST /bids — розміщення ставки (також використовується швидкою формою на сторінці лоту)
exports.create = async (req, res) => {
  // Звичайний користувач робить ставку лише від свого імені (userId з форми ігнорується);
  // від імені іншого користувача може діяти тільки адміністратор.
  const body = can(req.user, 'bid:createFor') ? req.body : { ...req.body, userId: String(req.user.id) };
  const { values, errors } = await validateNewBid(body);

  if (!hasErrors(errors)) {
    try {
      await placeBid(values);
      return res.redirect(`/lots/${values.lotId}?ok=bid`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      Object.assign(errors, err.errors);
    }
  }

  return renderForm(res, {
    status: 400, title: 'Нова ставка', action: '/bids', values: body, errors,
  });
};

// Завантажує ставку разом із лотом і автором (для форми редагування)
const loadBid = (id) => Bid.findByPk(id, {
  include: [
    { model: Lot, as: 'lot', attributes: ['id', 'title'] },
    { model: User, as: 'bidder', attributes: ['id', 'username'] },
  ],
});

// GET /bids/:id/edit
exports.editForm = async (req, res) => {
  const bid = await loadBid(req.params.id);
  if (!bid) return notFound(res, NOT_FOUND);
  if (!can(req.user, 'bid:edit', bid)) return forbidden(res, 'Редагувати ставку може лише її автор або адміністратор');

  await renderForm(res, {
    title: `Редагування ставки №${bid.id}`,
    action: `/bids/${bid.id}/edit`,
    values: { amount: Number(bid.amount).toFixed(2) },
    bid,
  });
};

// POST /bids/:id/edit
exports.update = async (req, res) => {
  const bid = await loadBid(req.params.id);
  if (!bid) return notFound(res, NOT_FOUND);
  if (!can(req.user, 'bid:edit', bid)) return forbidden(res, 'Редагувати ставку може лише її автор або адміністратор');

  const { values, errors } = validateBidAmount(req.body);

  if (!hasErrors(errors)) {
    try {
      await updateBidAmount({ bidId: bid.id, amount: values.amount });
      return res.redirect('/bids?ok=updated');
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      Object.assign(errors, err.errors);
    }
  }

  return renderForm(res, {
    status: 400,
    title: `Редагування ставки №${bid.id}`,
    action: `/bids/${bid.id}/edit`,
    values: req.body,
    errors,
    bid,
  });
};

// POST /bids/:id/delete
exports.destroy = async (req, res) => {
  const bid = await Bid.findByPk(req.params.id);
  if (!bid) return notFound(res, NOT_FOUND);
  if (!can(req.user, 'bid:delete', bid)) return forbidden(res, 'Видалити ставку може лише її автор або адміністратор');

  try {
    await deleteBid({ bidId: bid.id });
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return redirectWithError(res, '/bids', firstError(err.errors));
  }

  res.redirect('/bids?ok=deleted');
};
