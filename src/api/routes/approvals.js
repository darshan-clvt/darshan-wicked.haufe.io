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
/**
 * GET route for retrieving approvals by date range.
 * @param {string} '/byDates/:startDate/:endDate' - The route URL with parameters.
 * @param {function} verifyReadScope - Middleware to verify read scope.
 * @param {function} validateDateParams - Middleware to validate date parameters and order.
 * @param {function} next - The next middleware/route handler.
 *
 * @example
 * // GET /api/approvals/byDates/2023-08-01T00:00:00Z/2023-08-14T23:59:59Z
 * // Returns:
 * // List of approvals within the specified date range.
 */
approvals.get('/byDates/:startDate/:endDate', verifyReadScope, validateDateParams, function (req, res, next) {
    const startDate = req.params.startDate;
    const endDate = req.params.endDate;
    approvals.getApprovalByDates(req, res, next, req.apiUserId, startDate, endDate);
});  
/**
 * DELETE route for deleting approvals by date range.
 * @param {string} '/byDates/:startDate/:endDate' - The route URL with parameters.
 * @param {function} verifyWriteScope - Middleware to verify write scope.
 * @param {function} validateDateParams - Middleware to validate date parameters and order.
 * @param {function} next - The next middleware/route handler.
 *
 * @example
 * // DELETE /api/approvals/byDates/2023-08-01T00:00:00Z/2023-09-14T23:59:59Z
 * // Returns:
 * // Deletion of approvals within the specified date range is successful.
 */
approvals.delete('/byDates/:startDate/:endDate',verifyWriteScope,  validateDateParams, function (req, res, next){
    const startDate = req.params.startDate;
    const endDate = req.params.endDate;
    approvals.deleteApprovalsByDates(req, res, req.app, next, req.apiUserId, startDate, endDate);
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
/**
 * Retrieve approvals within the specified date range.
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 * @param {Function} next - The next middleware/route handler.
 * @param {string} loggedInUserId - The ID of the logged-in user.
 * @param {string} startDate - The start date of the date range (ISO 8601 format).
 * @param {string} endDate - The end date of the date range (ISO 8601 format).
 */
approvals.getApprovalByDates = function (req, res, next, loggedInUserId, startDate, endDate) {
    getApprovalsDateRange(req.app, loggedInUserId, startDate, endDate, (err, approvalInfo) => {
        if (err) {
            return utils.failError(res, err);
        }
        return res.json(approvalInfo);
    });
};
/**
 * Function to delete approvals and subscriptions within a specified date range.
 *
 * @param {Request} req - The Express request object.
 * @param {Response} res - The Express response object.
 * @param {Application} app - The Express application context.
 * @param {Function} next - The next middleware/route handler.
 * @param {string} loggedInUserId - The ID of the logged-in user.
 * @param {string} startDate - The start date of the date range.
 * @param {string} endDate - The end date of the date range.
 */
approvals.deleteApprovalsByDates = function (req, res, app, next, loggedInUserId, startDate, endDate) {
    getApprovalsDateRange(app, loggedInUserId, startDate, endDate, (err, approvalInfo) => {
        if (err) {
            return utils.failError(res, err);
        }
        var approvalData = approvalInfo;
        for (let approval of approvalData) {
            const subscriptionId = approval.subscriptionId;
            const subscriptionData = approval;
            let appId = approval.application.id;
            let apiId = approval.api.id;
            debug(appId + " this is appID");
            debug(apiId + " this is apiID");

            dao.subscriptions.delete(appId, apiId, subscriptionId, (err) => {
                if (err) {
                    return utils.fail(res, 500, 'deleteSubscription: DAO delete subscription failed', err);
                }
                webhooks.logEvent(app, {
                    action: webhooks.ACTION_DELETE,
                    entity: webhooks.ENTITY_SUBSCRIPTION,
                    data: {
                        subscriptionId: subscriptionId,
                        applicationId: appId,
                        apiId: apiId,
                        userId: loggedInUserId,
                        auth: subscriptionData.auth
                    }
                });
            });
        }
        res.status(204).send('');
    });
};

const iso8601Regex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

/**
 * Middleware to validate date parameters and order.
 * @param {Object} req - The Express request object.
 * @param {Object} res - The Express response object.
 * @param {Function} next - The next middleware function.
 */
function validateDateParams(req, res, next) {
    const startDate = req.params.startDate;
    const endDate = req.params.endDate;
    
    if (!iso8601Regex.test(startDate) || !iso8601Regex.test(endDate)) {
        return res.status(400).json({ message: "Invalid date format. Please use ISO 8601 format." });
    }

    if (startDate > endDate) {
        return res.status(400).json({ message: "Start date cannot be greater than end date." });
    }

    // If validations pass, move to the next middleware/route handler
    next();
}
/**
 * Retrieves approvals within a specified date range.
 * 
 * @param {object} app - The Express app instance.
 * @param {string} loggedInUserId - The ID of the logged-in user.
 * @param {string} startDate - The start date of the date range.
 * @param {string} endDate - The end date of the date range.
 * @param {function} callback - A callback function to handle the results or errors.
 */
function getApprovalsDateRange(app, loggedInUserId, startDate, endDate, callback) {
    getAllApprovals(app, loggedInUserId, (err, approvalInfos) => {
        if (err) {
            return callback(err, null);
        }
        
        const decodedStartDate = decodeURIComponent(startDate);
        const decodedEndDate = decodeURIComponent(endDate);
        const approvalInfo = approvalInfos.filter(a => a.changedDate >= decodedStartDate && a.changedDate <= decodedEndDate);
        
        if (approvalInfo.length === 0) {
            return callback('Not found', null);
        }
        
        callback(null, approvalInfo);
    });
}

function getAllApprovals(app, loggedInUserId, callback) {
    debug(`getAllApprovals(${loggedInUserId})`);
    checkRights(app, loggedInUserId, (err, userInfo) => {
        if (err) {
            return callback(err);
        }
        loadAllApprovals(app, userInfo, callback);
    });
}

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
