const crypto = require('crypto');

const KEY_LENGTH = 64;

// Хешування пароля вбудованим модулем crypto (scrypt + випадкова «сіль»).
// У базі зберігається рядок «сіль:хеш».
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, KEY_LENGTH).toString('hex');
  return `${salt}:${hash}`;
}

// Перевірка пароля за збереженим рядком «сіль:хеш». Порівняння виконується за постійний час
// (timingSafeEqual), щоб за часом відповіді не можна було підібрати хеш.
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash || !/^[0-9a-f]+$/i.test(hash) || hash.length !== KEY_LENGTH * 2) return false;
  const expected = Buffer.from(hash, 'hex');
  const actual = crypto.scryptSync(String(password), salt, KEY_LENGTH);
  return crypto.timingSafeEqual(actual, expected);
}

module.exports = { hashPassword, verifyPassword };
