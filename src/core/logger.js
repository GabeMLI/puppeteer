'use strict';

const fs = require('node:fs');
const path = require('node:path');

const { LOG_FILE_NAME } = require('../config/constants');

/**
 * A single append-only stream is opened for the lifetime of the process.
 * Every log line is written asynchronously through the stream, avoiding the
 * per-message open/close cycle that the old `fs.writeFile` approach caused.
 */
class Logger {

    constructor({ filePath = LOG_FILE_NAME, truncate = false } = {}) {

        this.filePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(process.cwd(), filePath);

        if (truncate) {
            try { fs.writeFileSync(this.filePath, ''); } catch (_) { /* ignore */ }
        }

        this.stream = fs.createWriteStream(this.filePath, { flags: 'a' });
        this.stream.on('error', (err) => {
            // Don't crash the whole bot if the log file becomes unwritable.
            console.error('[logger] write stream error:', err.message);
        });
    }

    _write(level, message) {

        const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;

        // Mirror to the console for live feedback.
        if (level === 'ERROR') {
            console.error(line.trimEnd());
        } else {
            console.log(line.trimEnd());
        }

        // stream.write is non-blocking; back-pressure is fine here because the
        // log volume is low and message ordering is preserved by Node.
        try {
            this.stream.write(line);
        } catch (err) {
            console.error('[logger] failed to write:', err.message);
        }
    }

    info(message = '') { this._write('INFO', String(message)); }
    warn(message = '') { this._write('WARN', String(message)); }
    error(message = '') { this._write('ERROR', String(message)); }

    // Visual separator used throughout the bot.
    divider() { this._write('INFO', '------------------------------'); }

    timestamp() { this._write('INFO', new Date().toString()); }

    async close() {

        return new Promise((resolve) => {

            if (!this.stream || this.stream.destroyed) { return resolve(); }

            this.stream.end(() => resolve());
        });
    }
}

module.exports = {
    Logger,
};
