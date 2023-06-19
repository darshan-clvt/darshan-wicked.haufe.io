
'use strict';


const express = require('express');
const router = express.Router();
const { debug, info, warn, error } = require('portal-env').Logger('kickstarter:apiBundle');


const utils = require('./utils');

router.get('/', function (req, res, next) {
    const bundles = utils.loadApiBundles(req.app);
    let apis = utils.loadApis(req.app)
    apis = apis.apis.filter(apiElem=>apiElem.tags.includes("bundle")).map(apiElem=>apiElem.id)
    let apiPathsMap = utils.getApiRoutes(req.app,apis)
    res.render('bundlePage', {
        apiBundles: bundles,
        apisMap : apiPathsMap
    });
});

router.post('/save', function (req, res, next) {
    const body = utils.getJson(req.body);
    let updatedBundle = body.bundles.updatedBundle
    let deleteBundles = body.bundles.deletedBundles
    let routesMap = updatedBundle && updatedBundle.routes ? updatedBundle.routes : {};
   
    const apiLookupcache = {};
    for(let api in routesMap) {
        let apiId  = api
        let apiRoutes = routesMap[api]
        let apiConfig = loadApiConfig(req.app, apiId);
        apiRoutes.forEach(routeName => {
            let pluginsAndIndexdata = getRoutePluginsAndAclIndex(apiConfig,routeName)
            let apiRoutePlugins = pluginsAndIndexdata[1]
            let aclPluginIndex = pluginsAndIndexdata[0]
            let apiRouteIndex = pluginsAndIndexdata[2]
            if(aclPluginIndex >= 0) {
                let aclPluginConfig = apiRoutePlugins[aclPluginIndex]
                let existingGroups = aclPluginConfig.config.allow
                if(!existingGroups.includes(updatedBundle.id)) {
                     aclPluginConfig.config.allow.push(updatedBundle.id)
                }
                apiConfig.api.routes[apiRouteIndex].plugins[aclPluginIndex] = aclPluginConfig
            } else {
                apiConfig.api.routes[apiRouteIndex].plugins.push({
                    name : 'acl',
                    config : {
                        allow : [updatedBundle.id,apiId]
                    }
                })
            }
        })
        updateApiConfig(apiId, apiConfig);
    }
    
   
    for( let bundleId in deleteBundles) {
        let bundledata = deleteBundles[bundleId]
        let bundleServiceMap = bundledata.routes
        for(let apiId in bundleServiceMap) {
            let apiRoutes = bundleServiceMap[apiId]
            let apiConfig = loadApiConfig(req.app, apiId);
            apiRoutes.forEach(routeName => {
                let pluginsAndIndexdata = getRoutePluginsAndAclIndex(apiConfig,routeName)
                let apiRoutePlugins = pluginsAndIndexdata[1]
                let aclPluginIndex = pluginsAndIndexdata[0]
                if(aclPluginIndex >= 0) {
                    let aclPluginConfig = apiRoutePlugins[aclPluginIndex]
                    let existingGroups = aclPluginConfig.config.allow
                    const bIdindex = existingGroups.indexOf(bundleId);
                    if (bIdindex > -1) { 
                        aclPluginConfig.config.allow.splice(bIdindex, 1); 
                        let apiRouteIndex = pluginsAndIndexdata[2]
                        apiConfig.api.routes[apiRouteIndex].plugins[aclPluginIndex] = aclPluginConfig
                    }
                } 
            })
            updateApiConfig(apiId, apiConfig);
        }
    }
   
     
    if(updatedBundle) {
        let bundleId;
        let existingBundlesData = utils.loadApiBundles(req.app).api_bundles;
        let bundleOldData = null
        for(let i=0;i<existingBundlesData.length;i++) {
            let bundle = existingBundlesData[i]
            let id = bundle.id
            if(id == updatedBundle.id) {
                bundleId = id
                bundleOldData = bundle;
                break;
            }
        }
        if(bundleOldData) {
            let toBeremoved = {}
            let existingRouteMap = bundleOldData.routes ? bundleOldData.routes : {}
            for (const key in existingRouteMap) {
                if (!routesMap.hasOwnProperty(key)) {
                toBeremoved[key] = existingRouteMap[key];
                } else {
                const newArray = routesMap[key];
                const oldArray = existingRouteMap[key];
                const elementsToRemove = oldArray.filter(element => !newArray.includes(element));
                if (elementsToRemove.length > 0) {
                    toBeremoved[key] = elementsToRemove;
                }
                }
            }
            for(let apiId in toBeremoved) {
                let apiRoutes = toBeremoved[apiId]
                let apiConfig = loadApiConfig(req.app, apiId);
                apiRoutes.forEach(routeName => {
                    let pluginsAndIndexdata = getRoutePluginsAndAclIndex(apiConfig,routeName)
                    let apiRoutePlugins = pluginsAndIndexdata[1]
                    let aclPluginIndex = pluginsAndIndexdata[0]
                    if(aclPluginIndex >= 0) {
                        let aclPluginConfig = apiRoutePlugins[aclPluginIndex]
                        let existingGroups = aclPluginConfig.config.allow
                        const bIdindex = existingGroups.indexOf(bundleId);
                        if (bIdindex > -1) { 
                            aclPluginConfig.config.allow.splice(bIdindex, 1); 
                            let apiRouteIndex = pluginsAndIndexdata[2]
                            apiConfig.api.routes[apiRouteIndex].plugins[aclPluginIndex] = aclPluginConfig
                        }
                    } 
                })
                updateApiConfig(apiId, apiConfig);
            }
        }
    }

    function loadApiConfig(app, apiId) {
        if (apiLookupcache[apiId]) {
          return apiLookupcache[apiId];
        }
        const apiConfig = utils.loadApiConfig(app, apiId);
        apiLookupcache[apiId] = apiConfig;
        return apiConfig;
    } 
    
    function updateApiConfig(apiId, apiConfig) {
        apiLookupcache[apiId] = apiConfig;
    }

    function flushApiConfigs(app) {
        for(let apiId in apiLookupcache) {
            let apiData = apiLookupcache[apiId]
            utils.saveApiConfig(app,apiId,apiData)
        }
    }

    
    let bundleData = body.bundles
    delete bundleData.updatedBundle 
    delete bundleData.deletedBundles
    flushApiConfigs(req.app)
    utils.saveApiBundles(req.app,bundleData) 

    res.json({ message: "OK" });
});

let getAclPluginIndex = (pluginArray) => {
    let idx = -1;
    for(let i=0;i<pluginArray.length;i++) {
        let pluginElem = pluginArray[i]
        if(pluginElem.name == 'acl') {
            idx = i
            break;
        }
    }
    return idx
}


const getRoutePluginsAndAclIndex = (apiConfig,routeName) => {
    let apiRouteIndex = apiConfig.api.routes.findIndex(routeElem => routeElem.displayName == routeName)
    let apiRoute = apiConfig.api.routes[apiRouteIndex]
    let apiRoutePlugins = apiRoute.plugins
    let aclPluginIndex = getAclPluginIndex(apiRoutePlugins)
    return [aclPluginIndex,apiRoutePlugins,apiRouteIndex]
}

module.exports = router;