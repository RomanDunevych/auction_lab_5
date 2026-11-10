// Обгортка для асинхронних контролерів: будь-яка помилка (відхилений проміс)
// передається в обробник помилок Express через next(err).
module.exports = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
