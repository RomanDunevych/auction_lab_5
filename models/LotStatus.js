const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const LotStatus = sequelize.define('LotStatus', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  name: { type: DataTypes.STRING(30), allowNull: false, unique: true },
}, { tableName: 'lot_statuses', timestamps: false });

module.exports = LotStatus;
