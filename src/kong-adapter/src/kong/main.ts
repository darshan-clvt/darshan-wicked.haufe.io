'use strict';

const async = require('async');
const { debug, info, warn, error } = require('portal-env').Logger('kong-adapter:main');

import * as wicked from 'wicked-sdk';
import * as utils from './utils';
import { sync } from './sync';
import { WickedEvent, WickedWebhookListener, WickedGlobals, Callback } from 'wicked-sdk';
const axios = require('axios')

const MAX_ASYNC_CALLS = 10;

const APPLICATION = 'application'
const SUBSCRIPTION = 'subscription'
const ACTION_ADD ='add'
const ACTION_DELETE = 'delete'
const ACTION_UPDATE = 'update'
const KEY_ROTATION='key_rotation';
const REVOKE_OLD_KEY='revoke_old_key';
// ====== PUBLIC INTERFACE ======

export const kongMain = {

    init: function (options, done) {
        debug('init()');
        async.series({
            initGlobals: function (callback) {
                if (options.initGlobals) {
                    debug('Calling initGlobals()');
                    registerWebhookListener(callback);
                } else {
                    callback(null);
                }
            },
            flushEvents: function (callback) {
                wicked.flushWebhookEvents('kong-adapter', callback);
            },
            syncApis: function (callback) {
                if (options.syncApis) {
                    debug('Calling sync.syncApis()');
                    sync.syncApis(options.apisList,callback);
                } else {
                    callback(null);
                }
            },
            syncConsumers: function (callback) {
                if (options.syncConsumers) {
                    debug('Calling sync.syncAllConsumers()');
                    sync.syncAllConsumers(callback);
                } else {
                    callback(null);
                }
            },
            addPrometheusPlugin: function (callback) {
                sync.addPrometheusPlugin(callback);
            },
            processPendingEvents: function (callback) {
                if (options.syncConsumers) {
                    processPendingWebhooks(callback);
                } else {
                    callback(null);
                }
            },
        }, function (err) {
            if (err) {
                return done(err);
            }
            info('INITIALIZATION DONE');
            done(null);
        });
    },

    resync: function (options={syncApis:false,syncConsumers:false,apisList:[]},done) {
        const initOptions = {
            syncApis: options.syncApis,
            syncConsumers: options.syncConsumers,
            apisList:options.apisList
        };
        kongMain.init(initOptions, done);
    },

    resyncApis: function (changedApis=[]) {
        info('Resyncing all APIs (to check for updated scopes)');
        const initOptions = {
            syncApis: true,
            syncConsumers: false,
            apisList: changedApis
        };
        kongMain.init(initOptions, function (err) {
            if (err) {
                error('Resyncing all APIs: An error occurred!');
                error(err);
            }
        });
    },

    processWebhooks: function (callback) {
        debug('processWebhooks()');
        info(`Processing events.`);
        const onlyDelete = false;

        //async.eachSeries(webhookList, (webhookData, callback) => dispatchWebhookAction(webhookData, onlyDelete, callback), done);
        info('Starting processing pending webhooks.');
        processPendingWebhooks(function (err, foundEvents) {
            if (err) {
                error('ERROR - Could not process all webhooks! This is bad!');
                error(err);
                return callback(err);
            }
            if (foundEvents) {
                info('Finished processing events, checking for more events.');
                return kongMain.processWebhooks(callback);
            }

            info('Finished processing events, currently there are no more events.');
            return callback(null, false);
        });
    },

    deinit: function (done) {
        // Don't do this; this can result in glitches in the database; let
        // the wicked API store our events until we return.
        //utils.apiDelete('webhooks/listeners/kong-adapter', done);
        setTimeout(done, 0);
    }
};

function processPendingWebhooks(callback: Callback<boolean>) {
    debug('processPendingWebhooks()');
    const now = new Date().getTime();
    wicked.getWebhookEvents('kong-adapter', function (err, pendingEvents) {
        if (err) {
            error('COULD NOT RETRIEVE WEBHOOKS')
            return callback(err);
        }
        const duration = (new Date().getTime() - now);
        debug(`processPendingWebhooks: Retrieved ${pendingEvents.length} events in ${duration}ms`);
        const onlyDelete = false;
        if (pendingEvents.length === 0)
            return callback(null, false);

        async.eachSeries(pendingEvents, (webhookData: WickedEvent, callback) => {
            const now = new Date().getTime();
            dispatchWebhookAction(webhookData, onlyDelete, function (err) {
                const duration = (new Date().getTime() - now);
                debug(`processPendingWebhooks: Processed ${webhookData.action} ${webhookData.entity} event in ${duration}ms`);
                if (err)
                    return callback(err);
                return callback(null);
            });
        }, function (err) {
            if (err) {
                error('An error occurred during dispatching events.');
                error(err);
                return callback(err);
            }
            return callback(null, true);
        });
    });
}

function containsImportEvent(eventList) {
    if (!eventList)
        return false;
    const importEvent = eventList.find(e => e.entity === 'import');
    return !!importEvent;
}

function dispatchWebhookAction(webhookData, onlyDelete, callback) {
    debug('dispatchWebhookAction()');
    const action = webhookData.action;
    const entity = webhookData.entity;
    info(`Process action ${action} for entity ${entity}`);
    let syncAction = null;
    if (entity === APPLICATION && (action === ACTION_ADD || action === ACTION_UPDATE) && !onlyDelete)
        syncAction = callback => syncAppConsumers(webhookData.data.applicationId, callback);
    else if (entity === APPLICATION && action === ACTION_DELETE)
        syncAction = callback => deleteAppConsumers(webhookData.data.applicationId, webhookData.data.subscriptions, callback);
    else if (entity === SUBSCRIPTION && (action === ACTION_ADD || action === ACTION_UPDATE) && !onlyDelete)
        syncAction = callback => syncAppConsumers(webhookData.data.applicationId, callback);
    else if (entity === SUBSCRIPTION && action === ACTION_DELETE)
        syncAction = callback => deleteAppSubscriptionConsumer(webhookData.data, callback);
    else if (entity === SUBSCRIPTION && action === KEY_ROTATION && !onlyDelete) {
        syncAction = callback => handleKeyRotation(webhookData.data.applicationId, webhookData.data.apiId, callback);
        debug('handle_key_rotation' + utils.getText(webhookData.data.applicationId));
    }else if (entity === SUBSCRIPTION && action === REVOKE_OLD_KEY && !onlyDelete) {
        syncAction = callback => handleKeyRevoke(webhookData.data.applicationId, webhookData.data.apiId,webhookData.data.apiKey, callback);
        debug('revoke_old_key' + utils.getText(webhookData.data.applicationId));
    }
    else
        debug(`Discarding event ${action} ${entity}.`)

    async.series([
        callback => {
            if (syncAction)
                return syncAction(callback);
            return callback(null);
        },
        callback => acknowledgeEvent(webhookData.id, callback)
    ], function (err) {
        if (err) {
            error('SYNC ACTION FAILED!');
            error(err);
            return callback(err);
        }
        let globals = utils.getGlobals()
        let apiId = webhookData.data.apiId
        let appId = webhookData.data.applicationId
        if (entity === SUBSCRIPTION && (action === ACTION_UPDATE || action === ACTION_ADD) && globals && globals.features.enableAPIKeyCustomHeaders && (apiId in globals.customHeaderApisList)) {
            debug('invoking ch script of api')
            let chAPiJs = utils.getCustomHeaderModules(apiId)
            if(chAPiJs) {
              chAPiJs.processData(appId,apiId,globals,wicked,axios)
            }
            debug('invoking ch script end')
        }
        debug(`dispatchWebhookAction successfully returned for action ${action} ${entity}`);
        callback(null);
    });
}

function syncAppConsumers(appId, callback) {
    info(`Syncing consumers for wicked application ${appId}`);
    // Relay to sync
    sync.syncAppConsumers(appId, callback);
}

function deleteAppConsumers(appId, subscriptionList, callback) {
    info(`Deleting all consumers associated with wicked application ${appId}`);
    // Just relay
    sync.deleteAppConsumers(appId, subscriptionList, callback);
}

function deleteAppSubscriptionConsumer(webhookSubsInfo, callback) {
    // The subsInfo in the webhook is a little different from the persisted ones.
    // We need to translate them.
    const subsInfo = {
        id: webhookSubsInfo.subscriptionId,
        application: webhookSubsInfo.applicationId,
        api: webhookSubsInfo.apiId,
        userId: webhookSubsInfo.userId,
        auth: webhookSubsInfo.auth
    };
    info(`Deleting cosumers associated with a subscription: ${subsInfo.application} subscribed to API ${subsInfo.api}`);

    sync.deleteAppSubscriptionConsumer(subsInfo, callback);
}

function acknowledgeEvent(eventId, callback) {
    debug(`acknowledgeEvent(${eventId})`);
    wicked.deleteWebhookEvent('kong-adapter', eventId, function (err) {
        debug('deleteWebhookEvent returned');
        callback(null);
    });
}
/**
 * Handles the key rotation for a given application and API.
 * 
 * @param {string} appId - The ID of the application.
 * @param {string} apiId - The ID of the API.
 * @param {Function} callback - The callback function to be called after handling the key rotation.
 */
function handleKeyRotation(appId, apiId, callback) {
    info(`Key rotation for app ${appId} and api ${apiId}`);
    // Relay to sync
    sync.handleKeyRotation(appId, apiId, callback);
}

function handleKeyRevoke(appId, apiId, apikey,callback) {
    info(`Key revoke for app ${appId} and api ${apiId}`);
    sync.handleKeyRevoke(appId, apiId, apikey,callback);
}

// ====== INTERNALS =======

function registerWebhookListener(done) {
    debug('registerWebhookListener()');
    const myUrl = utils.getMyUrl();

    const putPayload: WickedWebhookListener = {
        id: 'kong-adapter',
        url: myUrl
    };
    wicked.upsertWebhookListener('kong-adapter', putPayload, done);
}
