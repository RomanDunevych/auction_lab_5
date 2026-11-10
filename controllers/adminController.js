// Універсальний контролер адмін-панелі.
// Працює з будь-яким ресурсом із admin/resources.js: дашборд, список (пошук, сортування,
// сторінки), форми створення й редагування, видалення.
// Доступ до всіх маршрутів /admin обмежено в routes/admin.js (право admin:access).

const { Lot, Bid, User } = require('../models');
const resources = require('../admin/resources');
const {
  parseListQuery, buildWhere, pageInfo, pageWindow, listUrl,
} = require('../admin/query');
const { ValidationError, hasErrors } = require('../validators/common');
const { notFound, redirectWithError, firstError } = require('../helpers/respond');

// Дані для бічного меню на кожній сторінці панелі
exports.locals = (req, res, next) => {
  res.locals.adminSections = resources.list.map((r) => ({ key: r.key, label: r.label }));
  next();
};

// Ресурс за адресою (/admin/lots → lots); невідомий розділ — 404
function resolve(req, res) {
  const resource = resources.byKey[req.params.resource];
  if (!resource) {
    notFound(res, 'Розділ адмін-панелі не знайдено');
    return null;
  }
  return resource;
}

const base = (resource) => `/admin/${resource.key}`;

async function renderForm(res, {
  resource, status = 200, title, action, values, errors = {}, record = null, extra = {}, submitLabel = 'Зберегти',
}) {
  const fields = await resource.fields({ record, extra });
  res.status(status).render('admin/form', {
    title, resource, action, values, errors, fields, record, submitLabel, backUrl: base(resource),
  });
}

// GET /admin — огляд: кількість записів у таблицях і останні події
exports.dashboard = async (req, res) => {
  const [counts, latestLots, latestBids] = await Promise.all([
    Promise.all(resources.list.map((r) => r.model.count())),
    Lot.findAll({
      include: [{ model: User, as: 'seller', attributes: ['id', 'username'] }],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: 5,
    }),
    Bid.findAll({
      include: [
        { model: Lot, as: 'lot', attributes: ['id', 'title'] },
        { model: User, as: 'bidder', attributes: ['id', 'username'] },
      ],
      order: [['createdAt', 'DESC'], ['id', 'DESC']],
      limit: 5,
    }),
  ]);

  res.render('admin/dashboard', {
    title: 'Панель керування',
    cards: resources.list.map((r, i) => ({ key: r.key, label: r.label, newLabel: r.newLabel, count: counts[i] })),
    latestLots,
    latestBids,
  });
};

// GET /admin/:resource — список із пошуком, сортуванням і сторінками
exports.list = async (req, res) => {
  const resource = resolve(req, res);
  if (!resource) return;

  const params = parseListQuery(req.query, resource);
  const where = buildWhere(resource, params.q);
  const total = await resource.model.count({ where });
  const pager = pageInfo(total, params.page, params.pageSize);

  const order = [[params.sort, params.dir]];
  if (params.sort !== 'id') order.push(['id', 'ASC']);

  const rows = total
    ? await resource.model.findAll({
      where,
      include: resource.include ? resource.include() : [],
      order,
      limit: params.pageSize,
      offset: pager.offset,
    })
    : [];
  const extra = resource.loadListExtra ? await resource.loadListExtra(rows) : {};

  // Заголовки стовпців: за клацанням змінюється сортування
  const columns = resource.columns.map((c) => {
    if (!c.sort) return { label: c.label };
    const active = params.sort === c.sort;
    const nextDir = active && params.dir === 'ASC' ? 'DESC' : 'ASC';
    return {
      label: c.label,
      sortUrl: listUrl(base(resource), { q: params.q, sort: c.sort, dir: nextDir }),
      mark: active ? (params.dir === 'ASC' ? '▲' : '▼') : '',
    };
  });

  const tableRows = rows.map((row) => ({
    id: row.id,
    cells: resource.columns.map((c) => ({ type: c.type || 'text', value: c.value(row, extra) })),
  }));

  const linkParams = { q: params.q, sort: params.sort, dir: params.dir };
  const pageLinks = pageWindow(pager.page, pager.totalPages).map((n) => (n === null
    ? { gap: true }
    : { number: n, current: n === pager.page, url: listUrl(base(resource), { ...linkParams, page: n }) }));

  res.render('admin/list', {
    title: resource.label,
    resource,
    params,
    columns,
    rows: tableRows,
    pager: {
      ...pager,
      links: pageLinks,
      prevUrl: listUrl(base(resource), { ...linkParams, page: pager.page - 1 }),
      nextUrl: listUrl(base(resource), { ...linkParams, page: pager.page + 1 }),
    },
  });
};

// GET /admin/:resource/new
exports.newForm = async (req, res) => {
  const resource = resolve(req, res);
  if (!resource) return;
  const extra = resource.formExtra ? await resource.formExtra(null) : {};

  await renderForm(res, {
    resource,
    title: resource.newLabel,
    action: base(resource),
    values: resource.defaults ? resource.defaults() : {},
    extra,
  });
};

// POST /admin/:resource
exports.create = async (req, res) => {
  const resource = resolve(req, res);
  if (!resource) return;
  const extra = resource.formExtra ? await resource.formExtra(null) : {};

  const { values, errors } = await resource.validate(req.body, { record: null, extra, req });
  if (!hasErrors(errors)) {
    try {
      await resource.create(values, { req, extra });
      return res.redirect(`${base(resource)}?ok=created`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      Object.assign(errors, err.errors);
    }
  }

  return renderForm(res, {
    resource, status: 400, title: resource.newLabel, action: base(resource), values: req.body, errors, extra,
  });
};

// GET /admin/:resource/:id/edit
exports.editForm = async (req, res) => {
  const resource = resolve(req, res);
  if (!resource) return;
  const record = await resource.find(req.params.id);
  if (!record) return notFound(res, 'Запис не знайдено');
  const extra = resource.formExtra ? await resource.formExtra(record) : {};

  return renderForm(res, {
    resource,
    title: `Редагування: ${resource.title(record)}`,
    action: `${base(resource)}/${record.id}/edit`,
    values: resource.recordValues(record),
    record,
    extra,
  });
};

// POST /admin/:resource/:id/edit
exports.update = async (req, res) => {
  const resource = resolve(req, res);
  if (!resource) return;
  const record = await resource.find(req.params.id);
  if (!record) return notFound(res, 'Запис не знайдено');
  const extra = resource.formExtra ? await resource.formExtra(record) : {};

  const { values, errors } = await resource.validate(req.body, { record, extra, req });
  if (!hasErrors(errors)) {
    try {
      await resource.update(record, values, { req, extra });
      return res.redirect(`${base(resource)}?ok=updated`);
    } catch (err) {
      if (!(err instanceof ValidationError)) throw err;
      Object.assign(errors, err.errors);
    }
  }

  return renderForm(res, {
    resource,
    status: 400,
    title: `Редагування: ${resource.title(record)}`,
    action: `${base(resource)}/${record.id}/edit`,
    values: resource.redisplayValues ? resource.redisplayValues(req.body, record, extra) : req.body,
    errors,
    record,
    extra,
  });
};

// POST /admin/:resource/:id/delete
exports.destroy = async (req, res) => {
  const resource = resolve(req, res);
  if (!resource) return;
  const record = await resource.find(req.params.id);
  if (!record) return notFound(res, 'Запис не знайдено');

  try {
    await resource.remove(record, { req });
  } catch (err) {
    if (!(err instanceof ValidationError)) throw err;
    return redirectWithError(res, base(resource), firstError(err.errors));
  }
  return res.redirect(`${base(resource)}?ok=deleted`);
};
