const { addError, str } = require('./common');

// Літери (будь-якої мови), цифри, пробіли та кілька розділових знаків
const NAME_PATTERN = /^[\p{L}\p{N}\s.,'’"«»&()/+-]+$/u;

// Перевірка форми категорії.
// Повертає { values, errors }: values — очищені дані для збереження, errors — помилки по полях.
async function validateCategory(body, { id = null, db = null } = {}) {
  const lookups = db || require('./lookups');
  const errors = {};

  const name = str(body.name);
  const description = str(body.description);

  if (!name) {
    addError(errors, 'name', 'Вкажіть назву категорії');
  } else if (name.length < 2) {
    addError(errors, 'name', 'Назва має містити щонайменше 2 символи');
  } else if (name.length > 100) {
    addError(errors, 'name', 'Назва не може бути довшою за 100 символів');
  } else if (!NAME_PATTERN.test(name)) {
    addError(errors, 'name', 'Назва містить недопустимі символи (дозволені літери, цифри та . , \' " « » & ( ) / + -)');
  } else if (!(await lookups.isUnique('Category', 'name', name, id))) {
    addError(errors, 'name', 'Категорія з такою назвою вже існує');
  }

  if (description.length > 500) {
    addError(errors, 'description', 'Опис не може бути довшим за 500 символів');
  }

  return { values: { name, description: description || null }, errors };
}

module.exports = { validateCategory };
