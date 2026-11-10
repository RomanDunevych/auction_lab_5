// Спільні константи застосунку (використовуються валідаторами, контролерами та шаблонами)

// Статуси, від яких залежить логіка аукціону: їх не можна перейменувати чи видалити
const SYSTEM_STATUSES = ['draft', 'active', 'sold', 'expired', 'cancelled'];

// Типи подій в історії ставок
const EVENT_TYPES = ['PLACED', 'OUTBID', 'WON', 'CANCELLED'];

// Ролі користувачів
const ROLES = ['user', 'admin'];

// Найбільше значення для DECIMAL(10, 2)
const MAX_MONEY = 99999999.99;

// Найдовша дозволена тривалість торгів (днів)
const MAX_AUCTION_DAYS = 365;

module.exports = { SYSTEM_STATUSES, EVENT_TYPES, ROLES, MAX_MONEY, MAX_AUCTION_DAYS };
