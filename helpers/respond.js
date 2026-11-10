// Допоміжні функції для відповідей контролерів

// Сторінка «Не знайдено» (404)
function notFound(res, message) {
  return res.status(404).render('error', { title: 'Не знайдено', code: 404, message });
}

// Сторінка «Доступ заборонено» (403): користувач увійшов, але прав для дії немає
function forbidden(res, message = 'У вас немає прав для виконання цієї дії') {
  return res.status(403).render('error', { title: 'Доступ заборонено', code: 403, message });
}

// Перенаправлення на сторінку з повідомленням про помилку (?error=...)
function redirectWithError(res, path, message) {
  const separator = path.includes('?') ? '&' : '?';
  return res.redirect(`${path}${separator}error=${encodeURIComponent(message)}`);
}

// Перше повідомлення з помилок валідації (для повідомлень після перенаправлення)
function firstError(errors) {
  return Object.values(errors)[0];
}

module.exports = { notFound, forbidden, redirectWithError, firstError };
