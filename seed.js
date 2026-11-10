const { User, Category, LotStatus, Lot, Bid, BidHistory } = require('./models');
const { hashPassword } = require('./helpers/password');

const DAY = 24 * 3600 * 1000;

async function seed() {
  // Довідник статусів
  const statuses = {};
  for (const name of ['draft', 'active', 'sold', 'expired', 'cancelled']) {
    statuses[name] = await LotStatus.create({ name });
  }

  // Категорії
  const antiques = await Category.create({ name: 'Антикваріат', description: 'Старовинні речі' });
  const tech = await Category.create({ name: 'Техніка', description: 'Електроніка та гаджети' });
  const coins = await Category.create({ name: 'Колекціонування', description: 'Монети, марки, листівки' });

  // Користувачі (демо-облікові записи; паролі зберігаються у вигляді хешів)
  //   admin  / Admin123 — адміністратор
  //   seller1, ivan, olena / User1234 — звичайні користувачі
  await User.create({
    username: 'admin', email: 'admin@mail.com', role: 'admin', passwordHash: hashPassword('Admin123'),
  });
  const userPasswordHash = hashPassword('User1234');
  const seller = await User.create({ username: 'seller1', email: 'seller@mail.com', passwordHash: userPasswordHash });
  const ivan = await User.create({ username: 'ivan', email: 'ivan@mail.com', passwordHash: userPasswordHash });
  const olena = await User.create({ username: 'olena', email: 'olena@mail.com', passwordHash: userPasswordHash });

  // Лот 1: активний, дві ставки
  const clock = await Lot.create({
    title: 'Старовинний годинник',
    description: 'Настінний годинник, 1930-ті роки',
    startPrice: 100, currentPrice: 150, minStep: 10,
    startTime: new Date(Date.now() - DAY), endTime: new Date(Date.now() + 7 * DAY),
    sellerId: seller.id, categoryId: antiques.id, statusId: statuses.active.id,
  });
  const b1 = await Bid.create({ amount: 120, lotId: clock.id, userId: ivan.id });
  await BidHistory.create({ eventType: 'PLACED', amount: 120, bidId: b1.id, lotId: clock.id, userId: ivan.id });
  const b2 = await Bid.create({ amount: 150, lotId: clock.id, userId: olena.id });
  await BidHistory.create({ eventType: 'PLACED', amount: 150, bidId: b2.id, lotId: clock.id, userId: olena.id });
  await BidHistory.create({ eventType: 'OUTBID', amount: 120, bidId: b1.id, lotId: clock.id, userId: ivan.id });

  // Лот 2: чернетка
  await Lot.create({
    title: 'MacBook Pro 2019',
    description: 'Робочий стан, оригінальна зарядка',
    startPrice: 500, currentPrice: 500, minStep: 20,
    startTime: new Date(), endTime: new Date(Date.now() + 3 * DAY),
    sellerId: seller.id, categoryId: tech.id, statusId: statuses.draft.id,
  });

  // Лот 3: активний, ще без ставок
  await Lot.create({
    title: 'Срібна монета 1921 року',
    description: 'Колекційний стан',
    startPrice: 80, currentPrice: 80, minStep: 5,
    startTime: new Date(Date.now() - DAY), endTime: new Date(Date.now() + 5 * DAY),
    sellerId: seller.id, categoryId: coins.id, statusId: statuses.active.id,
  });

  // Лот 4: проданий, є переможець
  const camera = await Lot.create({
    title: 'Вінтажний фотоапарат',
    description: 'Плівковий фотоапарат, 1970-ті',
    startPrice: 200, currentPrice: 300, minStep: 25,
    startTime: new Date(Date.now() - 10 * DAY), endTime: new Date(Date.now() - 3 * DAY),
    sellerId: seller.id, winnerId: olena.id, categoryId: antiques.id, statusId: statuses.sold.id,
  });
  const c1 = await Bid.create({ amount: 250, lotId: camera.id, userId: ivan.id });
  await BidHistory.create({ eventType: 'PLACED', amount: 250, bidId: c1.id, lotId: camera.id, userId: ivan.id });
  const c2 = await Bid.create({ amount: 300, lotId: camera.id, userId: olena.id });
  await BidHistory.create({ eventType: 'PLACED', amount: 300, bidId: c2.id, lotId: camera.id, userId: olena.id });
  await BidHistory.create({ eventType: 'OUTBID', amount: 250, bidId: c1.id, lotId: camera.id, userId: ivan.id });
  await BidHistory.create({ eventType: 'WON', amount: 300, bidId: c2.id, lotId: camera.id, userId: olena.id });
}

module.exports = seed;
