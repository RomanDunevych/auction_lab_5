const {
  addError, str, isEmail,
} = require('./common');
const { ROLES } = require('../config/constants');

// Перевірка форми користувача.
// При створенні пароль обов’язковий; при редагуванні (isEdit) порожній пароль означає «не змінювати».
async function validateUser(body, { id = null, isEdit = false, db = null } = {}) {
  const lookups = db || require('./lookups');
  const errors = {};

  const username = str(body.username);
  const email = str(body.email).toLowerCase();
  const password = body.password === undefined || body.password === null ? '' : String(body.password);
  const passwordConfirm = body.passwordConfirm === undefined || body.passwordConfirm === null ? '' : String(body.passwordConfirm);
  const role = str(body.role);

  // Ім’я користувача
  if (!username) {
    addError(errors, 'username', 'Вкажіть ім’я користувача');
  } else if (username.length < 3) {
    addError(errors, 'username', 'Ім’я має містити щонайменше 3 символи');
  } else if (username.length > 50) {
    addError(errors, 'username', 'Ім’я не може бути довшим за 50 символів');
  } else if (!/^[A-Za-z0-9_.-]+$/.test(username)) {
    addError(errors, 'username', 'Ім’я може містити лише латинські літери, цифри та символи . _ -');
  } else if (!(await lookups.isUnique('User', 'username', username, id))) {
    addError(errors, 'username', 'Користувач з таким ім’ям уже існує');
  }

  // Email
  if (!email) {
    addError(errors, 'email', 'Вкажіть email');
  } else if (email.length > 100) {
    addError(errors, 'email', 'Email не може бути довшим за 100 символів');
  } else if (!isEmail(email)) {
    addError(errors, 'email', 'Вкажіть коректну адресу електронної пошти, наприклад name@example.com');
  } else if (!(await lookups.isUnique('User', 'email', email, id))) {
    addError(errors, 'email', 'Користувач з таким email уже існує');
  }

  // Пароль
  const passwordGiven = password !== '';
  if (!passwordGiven) {
    if (!isEdit) addError(errors, 'password', 'Вкажіть пароль');
  } else if (password.length < 6) {
    addError(errors, 'password', 'Пароль має містити щонайменше 6 символів');
  } else if (password.length > 100) {
    addError(errors, 'password', 'Пароль не може бути довшим за 100 символів');
  } else if (!/\p{L}/u.test(password) || !/\d/.test(password)) {
    addError(errors, 'password', 'Пароль має містити хоча б одну літеру й одну цифру');
  }

  if (passwordGiven || passwordConfirm !== '') {
    if (passwordConfirm === '') {
      addError(errors, 'passwordConfirm', 'Повторіть пароль');
    } else if (password !== passwordConfirm) {
      addError(errors, 'passwordConfirm', 'Паролі не збігаються');
    }
  }

  // Роль
  if (!role) {
    addError(errors, 'role', 'Оберіть роль');
  } else if (!ROLES.includes(role)) {
    addError(errors, 'role', 'Оберіть роль зі списку');
  }

  return {
    values: {
      username, email, role, password: passwordGiven ? password : null,
    },
    errors,
  };
}

module.exports = { validateUser };
