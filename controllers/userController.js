const {
  User, Lot, Bid, BidHistory, LotStatus,
} = require('../models');
const { validateUser } = require('../validators/user');
const { hasErrors } = require('../validators/common');
const { hashPassword } = require('../helpers/password');
const { notFound, forbidden, redirectWithError } = require('../helpers/respond');
const { can, ADMIN } = require('../auth/permissions');

const NOT_FOUND = 'Користувача не знайдено';

function renderForm(res, {
  status = 200, title, action, values, errors = {}, user = null,
}) {
  res.status(status).render('users/form', {
    title, action, values, errors, user,
  });
}

// GET /users
exports.index = async (req, res) => {
  const users = await User.findAll({
    include: [
      { model: Lot, as: 'lotsForSale', attributes: ['id'] },
      { model: Bid, as: 'bids', attributes: ['id'] },
    ],
    order: [['username', 'ASC']],
  });
  res.render('users/index', { title: 'Користувачі', users });
};

// GET /users/new
exports.newForm = (req, res) => {
  renderForm(res, { title: 'Новий користувач', action: '/users', values: { role: 'user' } });
};

// POST /users
exports.create = async (req, res) => {
  const { values, errors } = await validateUser(req.body);

  if (hasErrors(errors)) {
    // Паролі назад у форму не повертаємо
    const { password, passwordConfirm, ...safe } = req.body;
    return renderForm(res, {
      status: 400, title: 'Новий користувач', action: '/users', values: safe, errors,
    });
  }

  const user = await User.create({
    username: values.username,
    email: values.email,
    role: values.role,
    passwordHash: hashPassword(values.password),
  });
  res.redirect(`/users/${user.id}?ok=created`);
};

// GET /users/:id — профіль користувача
exports.show = async (req, res) => {
  const user = await User.findByPk(req.params.id, {
    attributes: ['id', 'username', 'email', 'role', 'createdAt'],
    include: [
      { model: Lot, as: 'lotsForSale', include: [{ model: LotStatus, as: 'status' }] },
      { model: Bid, as: 'bids', include: [{ model: Lot, as: 'lot', attributes: ['id', 'title'] }] },
      { model: Lot, as: 'wonLots', attributes: ['id', 'title', 'currentPrice'] },
    ],
  });
  if (!user) return notFound(res, NOT_FOUND);
  if (!can(req.user, 'user:view', user)) return forbidden(res, 'Профіль можна переглядати лише власний (адміністратор бачить усі)');

  // Ставки: від новіших до старіших
  user.bids.sort((a, b) => b.createdAt - a.createdAt || b.id - a.id);

  res.render('users/show', { title: user.username, profile: user });
};

// GET /users/:id/edit
exports.editForm = async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return notFound(res, NOT_FOUND);
  if (!can(req.user, 'user:edit', user)) return forbidden(res, 'Редагувати можна лише власний профіль');

  renderForm(res, {
    title: `Редагування: ${user.username}`,
    action: `/users/${user.id}/edit`,
    values: { username: user.username, email: user.email, role: user.role },
    user,
  });
};

// POST /users/:id/edit
exports.update = async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return notFound(res, NOT_FOUND);
  if (!can(req.user, 'user:edit', user)) return forbidden(res, 'Редагувати можна лише власний профіль');

  // Роль змінює лише адміністратор; для решти значення з форми ігнорується (захист від підвищення прав)
  const body = can(req.user, 'user:setRole') ? req.body : { ...req.body, role: user.role };
  const { values, errors } = await validateUser(body, { id: user.id, isEdit: true });

  // Не можна залишити систему без адміністратора
  if (user.role === ADMIN && values.role !== ADMIN && !errors.role) {
    const admins = await User.count({ where: { role: ADMIN } });
    if (admins <= 1) errors.role = 'Не можна змінити роль єдиного адміністратора';
  }

  if (hasErrors(errors)) {
    const { password, passwordConfirm, ...safe } = body;
    return renderForm(res, {
      status: 400,
      title: `Редагування: ${user.username}`,
      action: `/users/${user.id}/edit`,
      values: safe,
      errors,
      user,
    });
  }

  const changes = { username: values.username, email: values.email, role: values.role };
  if (values.password) changes.passwordHash = hashPassword(values.password); // порожній пароль = не змінювати
  await user.update(changes);

  res.redirect(`/users/${user.id}?ok=updated`);
};

// POST /users/:id/delete
exports.destroy = async (req, res) => {
  const user = await User.findByPk(req.params.id);
  if (!user) return notFound(res, NOT_FOUND);

  if (user.id === req.user.id) {
    return redirectWithError(res, `/users/${user.id}`, 'Не можна видалити власний обліковий запис');
  }

  const [selling, won, bids, events] = await Promise.all([
    Lot.count({ where: { sellerId: user.id } }),
    Lot.count({ where: { winnerId: user.id } }),
    Bid.count({ where: { userId: user.id } }),
    BidHistory.count({ where: { userId: user.id } }),
  ]);

  if (selling + won + bids + events > 0) {
    return redirectWithError(
      res,
      `/users/${user.id}`,
      `Не можна видалити користувача «${user.username}»: з ним пов’язані лоти (${selling + won}), ставки (${bids}) та записи історії (${events})`,
    );
  }

  await user.destroy();
  res.redirect('/users?ok=deleted');
};
