const { LotStatus, Lot } = require('../models');
const { validateStatus } = require('../validators/status');
const { hasErrors } = require('../validators/common');
const { SYSTEM_STATUSES } = require('../config/constants');
const { notFound, redirectWithError } = require('../helpers/respond');

const NOT_FOUND = 'Статус не знайдено';

function renderForm(res, {
  status = 200, title, action, values, errors = {}, lotStatus = null,
}) {
  res.status(status).render('statuses/form', {
    title, action, values, errors, lotStatus,
  });
}

// GET /statuses
exports.index = async (req, res) => {
  const rows = await LotStatus.findAll({
    include: [{ model: Lot, as: 'lots', attributes: ['id'] }],
    order: [['id', 'ASC']],
  });
  const statuses = rows.map((s) => ({
    id: s.id,
    name: s.name,
    lotsCount: s.lots.length,
    isSystem: SYSTEM_STATUSES.includes(s.name),
  }));
  res.render('statuses/index', { title: 'Статуси лотів', statuses });
};

// GET /statuses/new
exports.newForm = (req, res) => {
  renderForm(res, { title: 'Новий статус', action: '/statuses', values: {} });
};

// POST /statuses
exports.create = async (req, res) => {
  const { values, errors } = await validateStatus(req.body);

  if (hasErrors(errors)) {
    return renderForm(res, {
      status: 400, title: 'Новий статус', action: '/statuses', values: req.body, errors,
    });
  }

  await LotStatus.create(values);
  res.redirect('/statuses?ok=created');
};

// GET /statuses/:id/edit
exports.editForm = async (req, res) => {
  const lotStatus = await LotStatus.findByPk(req.params.id);
  if (!lotStatus) return notFound(res, NOT_FOUND);

  renderForm(res, {
    title: `Редагування статусу: ${lotStatus.name}`,
    action: `/statuses/${lotStatus.id}/edit`,
    values: lotStatus.toJSON(),
    lotStatus,
  });
};

// POST /statuses/:id/edit
exports.update = async (req, res) => {
  const lotStatus = await LotStatus.findByPk(req.params.id);
  if (!lotStatus) return notFound(res, NOT_FOUND);

  const { values, errors } = await validateStatus(req.body, { id: lotStatus.id, current: lotStatus.name });

  if (hasErrors(errors)) {
    return renderForm(res, {
      status: 400,
      title: `Редагування статусу: ${lotStatus.name}`,
      action: `/statuses/${lotStatus.id}/edit`,
      values: req.body,
      errors,
      lotStatus,
    });
  }

  await lotStatus.update(values);
  res.redirect('/statuses?ok=updated');
};

// POST /statuses/:id/delete
exports.destroy = async (req, res) => {
  const lotStatus = await LotStatus.findByPk(req.params.id);
  if (!lotStatus) return notFound(res, NOT_FOUND);

  if (SYSTEM_STATUSES.includes(lotStatus.name)) {
    return redirectWithError(res, '/statuses', `Системний статус «${lotStatus.name}» видалити не можна`);
  }

  const lotsCount = await Lot.count({ where: { statusId: lotStatus.id } });
  if (lotsCount > 0) {
    return redirectWithError(res, '/statuses', `Не можна видалити статус «${lotStatus.name}»: його мають лоти (${lotsCount})`);
  }

  await lotStatus.destroy();
  res.redirect('/statuses?ok=deleted');
};
