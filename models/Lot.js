const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Lot = sequelize.define('Lot', {
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  title: { type: DataTypes.STRING(150), allowNull: false },
  description: { type: DataTypes.TEXT },
  startPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false, validate: { min: 0 } },
  currentPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  minStep: { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 1.0 },
  startTime: { type: DataTypes.DATE, allowNull: false },
  endTime: { type: DataTypes.DATE, allowNull: false },
}, { tableName: 'lots' });

module.exports = Lot;
