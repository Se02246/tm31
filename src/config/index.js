require('dotenv').config();

const config = {
    hardwareMode: process.env.HARDWARE_MODE || 'mock',
    isMock: (process.env.HARDWARE_MODE || 'mock') === 'mock',
};

module.exports = config;
