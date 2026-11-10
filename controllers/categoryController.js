const { Category, Lot } = require('../models');
const { validateCategory } = require('../validators/category');
const { hasErrors } = require('../validators/common');
const { notFound, redirectWithError } = require('../helpers/respond');

const NOT_FOUND = 'Категорію не знайдено';

// Показує форму: нову (порожню), редагування або форму з помилками
function renderForm(res, {
  status = 200, title, action, values, errors = {}, category = null,
}) {
  res.status(status).render('categories/form', {
    title, action, values, errors, category,
  });
}

// GET /categories
exports.index = async (req, res) => {
  const categories = await Category.findAll({
    include: [{ model: Lot, as: 'lots', attributes: ['id'] }],
    order: [['name', 'ASC']],
  });
  res.render('categories/index', { title: 'Категорії', categories });
};

// GET /categories/new
exports.newForm = (req, res) => {
  renderForm(res, { title: 'Нова категорія', action: '/categories', values: {} });
};

// POST /categories
exports.create = async (req, res) => {
  const { values, errors } = await validateCategory(req.body);

  if (hasErrors(errors)) {
    return renderForm(res, {
      status: 400, title: 'Нова категорія', action: '/categories', values: req.body, errors,
    });
  }

  await Category.create(values);
  res.redirect('/categories?ok=created');
};

// GET /categories/:id/edit
exports.editForm = async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) return notFound(res, NOT_FOUND);

  renderForm(res, {
    title: `Редагування: ${category.name}`,
    action: `/categories/${category.id}/edit`,
    values: category.toJSON(),
    category,
  });
};

// POST /categories/:id/edit
exports.update = async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) return notFound(res, NOT_FOUND);

  const { values, errors } = await validateCategory(req.body, { id: category.id });

  if (hasErrors(errors)) {
    return renderForm(res, {
      status: 400,
      title: `Редагування: ${category.name}`,
      action: `/categories/${category.id}/edit`,
      values: req.body,
      errors,
      category,
    });
  }

  await category.update(values);
  res.redirect('/categories?ok=updated');
};

// POST /categories/:id/delete
exports.destroy = async (req, res) => {
  const category = await Category.findByPk(req.params.id);
  if (!category) return notFound(res, NOT_FOUND);

  const lotsCount = await Lot.count({ where: { categoryId: category.id } });
  if (lotsCount > 0) {
    return redirectWithError(res, '/categories', `Не можна видалити категорію «${category.name}»: у ній є лоти (${lotsCount})`);
  }

  await category.destroy();
  res.redirect('/categories?ok=deleted');
};
