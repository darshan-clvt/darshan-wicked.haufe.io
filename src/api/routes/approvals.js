'use strict';

const fs = require('fs');
const path = require('path');
const { debug, info, warn, error } = require('portal-env').Logger('portal-api:approvals');
const utils = require('./utils');
const users = require('./users');

const dao = require('../dao/dao');
const daoUtils = require('../dao/dao-utils');
const webhooks = require('./webhooks');
const subscription =require('./subscriptions');
const approvals = require('express').Router();

// ===== SCOPES =====

const READ_SCOPE = 'read_approvals';
const WRITE_SCOPE = 'write_subscriptions';
const verifyReadScope = utils.verifyScope(READ_SCOPE);
const verifyWriteScope =utils.verifyScope(WRITE_SCOPE);

// ===== ENDPOINTS =====

approvals.get('/', verifyReadScope, function (req, res, next) {
    approvals.getApprovals(req, res, next, req.apiUserId);
});

approvals.get('/:approvalId', verifyReadScope, function (req, res, next) {
    approvals.getApproval(req, res, next, req.apiUserId, req.params.approvalId);
});
//get By DateRange routes
approvals.get('/byDates/:startDate/:endDate', verifyReadScope, function (req, res, next) {
    const startDate = req.params.startDate;
    const endDate = req.params.endDate;
    approvals.getApprovalByDates(req, res, next, req.apiUserId, startDate, endDate);
});
//Delete By DateRange routes
approvals.delete('/byDates/:startDate/:endDate',verifyWriteScope, function (req, res, next){
    const startDate = req.params.startDate;
    const endDate = req.params.endDate;
    approvals.deleteApprovalsByDates(req, res, next, req.apiUserId, startDate, endDate);
});

// ===== IMPLEMENTATION =====

approvals.getApprovals = function (req, res, next, loggedInUserId) {
    debug('getApprovals()');
    getAllApprovals(req.app, loggedInUserId, (err, approvalInfos) => {
        if (err) {
            return utils.failError(res, err);
        }
        res.json(approvalInfos);
    });
};

approvals.getApproval = function (req, res, next, loggedInUserId, approvalId) {
    debug(`getApproval(${approvalId})`);
    getAllApprovals(req.app, loggedInUserId, (err, approvalInfos) => {
        if (err) {
            return utils.failError(res, err);
        }
        const approvalInfo = approvalInfos.find(a => a.id === approvalId);
        if (!approvalInfo) {
            return utils.fail(res, 404, 'Not found');
        }
        return res.json(approvalInfo);
    });
};

function getAllApprovals(app, loggedInUserId, callback) {
    debug(`getAllApprovals(${loggedInUserId})`);
    checkRights(app, loggedInUserId, (err, userInfo) => {
        if (err) {
            return callback(err);
        }
        loadAllApprovals(app, userInfo, callback);
    });
}
approvals.getApprovalByDates = function (req, res, next, loggedInUserId, startDate, endDate) {
    getAllApprovals(req.app, loggedInUserId, (err, approvalInfos) => {
        if (err) {
            return utils.failError(res, err);
        }
        const decodedStartDate = decodeURIComponent(startDate);
        const decodedEndDate = decodeURIComponent(endDate);
        const approvalInfo = approvalInfos.filter(a => a.changedDate >= decodedStartDate && a.changedDate <= decodedEndDate);
        if (!approvalInfo) {
            return utils.fail(res, 404, 'Not found');
        }
        return res.json(approvalInfo);
    });
};

approvals.deleteApprovalsByDates = function (req, res, next, loggedInUserId, startDate, endDate) {
    getAllApprovals(req.app, loggedInUserId, (err, approvalInfos) => {
        if (err) {
            return utils.failError(res, err);
        }
        const decodedStartDate = decodeURIComponent(startDate);
        const decodedEndDate = decodeURIComponent(endDate);

        const approvalInfo = approvalInfos.filter(a => a.changedDate >= decodedStartDate && a.changedDate <= decodedEndDate);
        if (approvalInfo.length === 0) {
            return utils.fail(res, 404, 'Not found');
        }
        for (let approval of approvalInfo){
            dao.subscriptions.delete(approval.application.id, approval.api.id, approval.subscriptionId, (err) => {
                      if (err) {
                          return utils.fail(res, 500, 'deleteSubscription: DAO delete subscription failed',err);
                      }
                       res.status(204).send('');
                  });
              };
    });
};

function checkRights(app, loggedInUserId, callback) {
    if (!loggedInUserId) {
        return callback(utils.makeError(403, 'Not allowed'));
    }
    users.loadUser(app, loggedInUserId, (err, userInfo) => {
        if (err) {
            return callback(utils.makeError(500, 'getApprovals: loadUser failed', err));
        }
        if (!userInfo) {
            return callback(utils.makeError(403, 'Not allowed'));
        }
        if (!userInfo.admin && !userInfo.approver) {
            return callback(utils.makeError(403, 'Not allowed'));
        }
        return callback(null, userInfo);
    });
}

function loadAllApprovals(app, userInfo, callback) {
    dao.approvals.getAll((err, approvalInfos) => {
        if (err) {
            return callback(utils.makeError(500, 'getApprovals: DAO load approvals failed', err));
        }

        const groupsJson = utils.loadGroups(app);
        const groups = groupsJson.groups;

        // Assemble a user's groups to check for approval roles
        // and correct groups. If the user is not admin but approver,
        // the requiredGroup needs to be present in this user's list
        // of groups.
        const userGroups = {};
        if (userInfo.groups) {
            for (let i = 0; i < userInfo.groups.length; i++) {
                userGroups[userInfo.groups[i]] = true;
            }
            // This is probably not strictly necessary, as the alt_ids
            // are mapped to wicked groups at login anyway, but it doesn't
            // hurt either.
            for (let i = 0; i < groups.length; i++) {
                if (userGroups.hasOwnProperty(groups[i].id)) {
                    const alt_ids = groups[i].alt_ids;
                    if (alt_ids) {
                        for (let j = 0; j < alt_ids.length; j++) {
                            userGroups[alt_ids[j]] = true;
                        }
                    }
                }
            }
        }

        approvalInfos = approvalInfos.filter(function (approval) {
            if (userInfo.admin) {
                return true; // Show all approvals for admin
            }
            if (!approval.api.requiredGroup) {
                return false; // API does not require a group; only admins can approve of public APIs.
            }
            // If group id or alt_id of approver's group matches with requiredGroup of an API, return happy
            return (!!userGroups[approval.api.requiredGroup]);
        });
        return callback(null, approvalInfos);
    });
}

module.exports = approvals;
