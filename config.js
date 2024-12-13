require("dotenv").config();

module.exports = {
  AWS_REGION: process.env.AWS_REGION,
  REDIS_HOST: process.env.REDIS_HOST,
  REDIS_PORT: parseInt(process.env.REDIS_PORT, 10),
};
