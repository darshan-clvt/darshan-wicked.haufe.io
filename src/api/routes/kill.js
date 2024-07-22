'use strict';

/* global __dirname */

const path = require('path');
const fs = require('fs');

const utils = require('./utils');
const users = require('./users');

const { debug, info, warn, error } = require('portal-env').Logger('portal-api:kill');
const kill = require('express').Router();

const KILL_SEMAPHORE = path.join(__dirname, '..', 'RELOAD_REQUESTED');
// Sanity check at startup:
if (fs.existsSync(KILL_SEMAPHORE)) {
    fs.unlinkSync(KILL_SEMAPHORE);
}

const verifyKillScope = utils.verifyScope('restart_api');
const isRestartAllowed = utils.checkRestartKey()

// ===== ENDPOINTS =====

 kill.post('/', isRestartAllowed, function (req, res, next) {
     debug('POST /kill');
     kill.killApi(req.app, res, req.apiUserId);
    });

// ===== IMPLEMENTATION =====

kill.killApi = function (app, res, loggedInUserId) {
        debug('killApi()');
        warn('RESTARTING API DUE TO USER REQUEST');
        fs.writeFileSync(KILL_SEMAPHORE, 'reload requested by API interaction.', 'utf8');
        res.status(204).json({});
        setTimeout(function () {
            process.exit(0);
        }, 1000);
};

module.exports = kill;
