// Українські підписи для статусів лотів і типів подій

const STATUS_LABELS = {
  draft: 'Чернетка',
  active: 'Активний',
  sold: 'Продано',
  expired: 'Завершено без продажу',
  cancelled: 'Скасовано',
};

const EVENT_LABELS = {
  PLACED: 'Ставку зроблено',
  OUTBID: 'Ставку перебито',
  WON: 'Виграш',
  CANCELLED: 'Ставку скасовано',
};

// Для нових (власних) статусів показуємо їх код
const statusLabel = (name) => STATUS_LABELS[name] || name;
const eventLabel = (name) => EVENT_LABELS[name] || name;

module.exports = { STATUS_LABELS, EVENT_LABELS, statusLabel, eventLabel };
