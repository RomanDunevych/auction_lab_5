const { addError, str } = require('./common');

// Перевірка форми входу. Пароль у values не повертається.
function validateLogin(body) {
  const errors = {};
  const login = str(body.login);
  const password = body.password === undefined || body.password === null ? '' : String(body.password);

  if (!login) {
    addError(errors, 'login', 'Вкажіть ім’я користувача або email');
  } else if (login.length > 100) {
    addError(errors, 'login', 'Занадто довге значення (не більше 100 символів)');
  }

  if (!password) {
    addError(errors, 'password', 'Вкажіть пароль');
  } else if (password.length > 100) {
    addError(errors, 'password', 'Занадто довгий пароль (не більше 100 символів)');
  }

  return { values: { login, password }, errors };
}

module.exports = { validateLogin };
