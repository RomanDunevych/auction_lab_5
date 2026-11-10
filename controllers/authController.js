const passport = require('passport');
const { User } = require('../models');
const { validateLogin } = require('../validators/auth');
const { validateUser } = require('../validators/user');
const { hasErrors } = require('../validators/common');
const { hashPassword } = require('../helpers/password');
const { safeNext, withQuery } = require('../auth/middleware');
const { INVALID_CREDENTIALS } = require('../auth/passport');

function renderLogin(res, { status = 200, values = {}, errors = {}, next = null }) {
  res.status(status).render('auth/login', {
    title: 'Вхід', values: { login: values.login || '' }, errors, next,
  });
}

function renderRegister(res, { status = 200, values = {}, errors = {} }) {
  res.status(status).render('auth/register', { title: 'Реєстрація', values, errors });
}

// GET /login
exports.loginForm = (req, res) => {
  renderLogin(res, { next: safeNext(req.query.next) });
};

// POST /login
exports.login = (req, res, next) => {
  const target = safeNext(req.body.next);
  const { values, errors } = validateLogin(req.body);
  if (hasErrors(errors)) {
    return renderLogin(res, { status: 400, values, errors, next: target });
  }

  return passport.authenticate('local', (err, user) => {
    if (err) return next(err);
    if (!user) {
      return renderLogin(res, {
        status: 401, values, errors: { _form: INVALID_CREDENTIALS }, next: target,
      });
    }
    // req.logIn створює сесію (id сесії при цьому оновлюється — захист від session fixation)
    return req.logIn(user, (loginErr) => {
      if (loginErr) return next(loginErr);
      return res.redirect(withQuery(target || '/', 'ok', 'login'));
    });
  })(req, res, next);
};

// GET /register
exports.registerForm = (req, res) => {
  renderRegister(res, { values: {} });
};

// POST /register — самореєстрація. Роль завжди «user»: з форми вона не читається,
// тому відвідувач не може зареєструватися адміністратором.
exports.register = async (req, res, next) => {
  const { values, errors } = await validateUser({ ...req.body, role: 'user' });

  if (hasErrors(errors)) {
    const { password, passwordConfirm, role, ...safe } = req.body;
    return renderRegister(res, { status: 400, values: safe, errors });
  }

  const user = await User.create({
    username: values.username,
    email: values.email,
    role: 'user',
    passwordHash: hashPassword(values.password),
  });

  // Після реєстрації користувач одразу входить у систему
  return req.logIn(user, (err) => {
    if (err) return next(err);
    return res.redirect('/?ok=registered');
  });
};

// POST /logout — вихід лише методом POST (щоб сторонній сайт не міг «розлогінити» користувача посиланням)
exports.logout = (req, res, next) => {
  req.logout((err) => {
    if (err) return next(err);
    res.clearCookie('auction.sid');
    return res.redirect('/login?ok=logout');
  });
};
