const express = require('express');
const wrap = require('../helpers/asyncHandler');
const { requirePermission } = require('../auth/middleware');
const admin = require('../controllers/adminController');

const router = express.Router();

// Захищена область: усі маршрути нижче доступні лише користувачам із правом admin:access (адміністратор).
// Відвідувача перенаправляють на вхід, авторизованого без прав зупиняє сторінка 403.
// Перевірка стоїть ПЕРШОЮ, тому жоден маршрут цього файлу не можна «забути» захистити.
router.use(requirePermission('admin:access'));
router.use(admin.locals);

router.get('/', wrap(admin.dashboard));

// Керування даними таблиць: :resource — lots, categories, statuses, users, bids, history
router.get('/:resource', wrap(admin.list));
router.get('/:resource/new', wrap(admin.newForm));
router.post('/:resource', wrap(admin.create));
router.get('/:resource/:id/edit', wrap(admin.editForm));
router.post('/:resource/:id/edit', wrap(admin.update));
router.post('/:resource/:id/delete', wrap(admin.destroy));

module.exports = router;
