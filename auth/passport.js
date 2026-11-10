// Налаштування Passport.js: локальна стратегія (логін + пароль) і зберігання користувача в сесії.
//
// Як це працює:
//  1. Користувач надсилає форму входу → passport.authenticate('local') викликає функцію verify.
//  2. verify шукає користувача й перевіряє пароль. Успіх → serializeUser кладе в сесію лише id.
//  3. На кожному наступному запиті deserializeUser за id з сесії завантажує користувача з бази
//     й записує його в req.user.

const { Op } = require('sequelize');
const { verifyPassword, hashPassword } = require('../helpers/password');

const INVALID_CREDENTIALS = 'Невірне ім’я користувача, email або пароль';

// Для користувача, якого не існує, все одно виконується перевірка пароля (за фіктивним хешем),
// щоб за часом відповіді не можна було дізнатися, чи існує такий логін.
const DUMMY_HASH = hashPassword('dummy-password-1');

// Пошук користувача за ім’ям або email (email порівнюється в нижньому регістрі)
function findByLogin(login) {
  const { User } = require('../models');
  return User.findOne({
    where: { [Op.or]: [{ username: login }, { email: String(login).toLowerCase() }] },
  });
}

// Повертає користувача, якщо логін і пароль правильні, інакше null.
// findUser передається ззовні, щоб функцію можна було перевірити тестами без бази даних.
async function authenticate(login, password, findUser = findByLogin) {
  const user = await findUser(String(login));
  const ok = verifyPassword(password, user ? user.passwordHash : DUMMY_HASH);
  return user && ok ? user : null;
}

// Функція verify для LocalStrategy: (login, password, done)
function makeVerify(findUser = findByLogin) {
  return (login, password, done) => {
    authenticate(login, password, findUser)
      .then((user) => (user ? done(null, user) : done(null, false, { message: INVALID_CREDENTIALS })))
      .catch(done);
  };
}

function configure(passport) {
  const { Strategy: LocalStrategy } = require('passport-local');
  const { User } = require('../models');

  // Поле форми називається «login» (ім’я або email), а не «username»
  passport.use(new LocalStrategy({ usernameField: 'login', passwordField: 'password' }, makeVerify()));

  // У сесію потрапляє тільки id користувача
  passport.serializeUser((user, done) => done(null, user.id));

  // Користувач, якого видалили, автоматично стає відвідувачем (done(null, false))
  passport.deserializeUser((id, done) => {
    User.findByPk(id, { attributes: ['id', 'username', 'email', 'role'] })
      .then((user) => done(null, user || false))
      .catch(done);
  });
}

module.exports = { configure, authenticate, makeVerify, INVALID_CREDENTIALS };
