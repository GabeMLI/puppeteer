'use strict';

const sleep = (ms = 300) => new Promise((resolve) => setTimeout(resolve, ms));

const randomBetween = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Small human-like jitter between actions.
const humanPause = (min = 120, max = 380) => sleep(randomBetween(min, max));

module.exports = {
    sleep,
    randomBetween,
    humanPause,
};
