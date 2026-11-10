const {
  BidHistory, Bid, Lot, User,
} = require('../models');
const { validateHistory } = require('../validators/history');
const { hasErrors } = require('../validators/common');
const { EVENT_TYPES } = require('../config/constants');
const { notFound } = require('../helpers/respond');
const { eventLabel } = require('../helpers/labels');

const NOT_FOUND = 'Запис історії не знайдено';

// Варіанти для списків у формі: ставки та типи подій
async function loadOptions() {
  const bids = await Bid.findAll({
    include: [
      { model: Lot, as: 'lot', attributes: ['id', 'title'] },
      { model: User, as: 'bidder', attributes: ['id', 'username'] },
    ],
    order: [['id', 'ASC']],
  });
  return {
    bidOptions: bids.map((b) => ({
      value: b.id,
      label: `№${b.id} · ${b.lot.title} · ${b.bidder.username} · ${Number(b.amount).toFixed(2)} грн`,
    })),
    eventOptions: EVENT_TYPES.map((e) => ({ value: e, label: `${eventLabel(e)} (${e})` })),
  };
}

async function renderForm(res, {
  status = 200, title, action, values, errors = {}, entry = null,
}) {
  res.status(status).render('history/form', {
    title, action, values, errors, entry, ...(await loadOptions()),
  });
}

// GET /history — журнал подій зі ставками з фільтрами
exports.index = async (req, res) => {
  const lot = req.query.lot || '';
  const event = req.query.event || '';

  const where = {};
  if (lot) where.lotId = lot;
  if (EVENT_TYPES.includes(event)) where.eventType = event;

  const [history, lots] = await Promise.all([
    BidHistory.findAll({
      where,
      include: [
        { model: User, as: 'user', attributes: ['id', 'username'] },
        { model: Lot, as: 'lot', attributes: ['id', 'title'] },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
    }),
    Lot.findAll({ attributes: ['id', 'title'], order: [['title', 'ASC']] }),
  ]);

  res.render('history/index', {
    title: 'Історія ставок', history, lots, eventTypes: EVENT_TYPES, filters: { lot, event },
  });
};

// GET /history/new
exports.newForm = async (req, res) => {
  await renderForm(res, { title: 'Нова подія', action: '/history', values: {} });
};

// POST /history
exports.create = async (req, res) => {
  const { values, errors } = await validateHistory(req.body);

  if (hasErrors(errors)) {
    return renderForm(res, {
      status: 400, title: 'Нова подія', action: '/history', values: req.body, errors,
    });
  }

  await BidHistory.create(values);
  res.redirect('/history?ok=created');
};

// GET /history/:id/edit
exports.editForm = async (req, res) => {
  const entry = await BidHistory.findByPk(req.params.id);
  if (!entry) return notFound(res, NOT_FOUND);

  await renderForm(res, {
    title: `Редагування події №${entry.id}`,
    action: `/history/${entry.id}/edit`,
    values: { bidId: entry.bidId, eventType: entry.eventType, amount: Number(entry.amount).toFixed(2) },
    entry,
  });
};

// POST /history/:id/edit
exports.update = async (req, res) => {
  const entry = await BidHistory.findByPk(req.params.id);
  if (!entry) return notFound(res, NOT_FOUND);

  const { values, errors } = await validateHistory(req.body, { id: entry.id });

  if (hasErrors(errors)) {
    return renderForm(res, {
      status: 400,
      title: `Редагування події №${entry.id}`,
      action: `/history/${entry.id}/edit`,
      values: req.body,
      errors,
      entry,
    });
  }

  await entry.update(values);
  res.redirect('/history?ok=updated');
};

// POST /history/:id/delete
exports.destroy = async (req, res) => {
  const entry = await BidHistory.findByPk(req.params.id);
  if (!entry) return notFound(res, NOT_FOUND);

  await entry.destroy();
  res.redirect('/history?ok=deleted');
};
