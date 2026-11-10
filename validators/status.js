const { addError, str } = require('./common');
const { SYSTEM_STATUSES } = require('../config/constants');

// Перевірка форми статусу лоту.
// current — поточна назва статусу при редагуванні (для захисту системних статусів).
async function validateStatus(body, { id = null, current = null, db = null } = {}) {
  const lookups = db || require('./lookups');
  const errors = {};

  const name = str(body.name);

  if (!name) {
    addError(errors, 'name', 'Вкажіть код статусу');
  } else if (name.length < 2) {
    addError(errors, 'name', 'Код статусу має містити щонайменше 2 символи');
  } else if (name.length > 30) {
    addError(errors, 'name', 'Код статусу не може бути довшим за 30 символів');
  } else if (!/^[a-z][a-z0-9_]*$/.test(name)) {
    addError(errors, 'name', 'Код має починатися з малої латинської літери й містити лише малі латинські літери, цифри та _');
  } else if (current && SYSTEM_STATUSES.includes(current) && name !== current) {
    addError(errors, 'name', `Системний статус «${current}» не можна перейменувати: від нього залежить робота аукціону`);
  } else if (!(await lookups.isUnique('LotStatus', 'name', name, id))) {
    addError(errors, 'name', 'Статус з таким кодом уже існує');
  }

  return { values: { name }, errors };
}

module.exports = { validateStatus };
