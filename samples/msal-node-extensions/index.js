/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

const express = require("express");
const msal = require('@azure/msal-node');
const extensions = require("@azure/msal-node-extensions");
const { promises: fs } = require("fs");
const process = require("process");
const path = require("path");

const SERVER_PORT = process.env.PORT || 3000;
const cachePath = path.join(__dirname, "./cache.json");

createPersistence().then((filePersistence) => {

            const publicClientConfig = {
                auth: {
                    clientId: "99cab759-2aab-420b-91d8-5e3d8d4f063b",
                    authority: "https://login.microsoftonline.com/90b8faa8-cc95-460e-a618-ee770bee1759",
                    redirectUri: "http://localhost:3000/redirect",
                },
                cache: {
                    cachePlugin: new extensions.PersistenceCachePlugin(filePersistence)
                },
            };
            const pca = new msal.PublicClientApplication(publicClientConfig);
            const msalCacheManager = pca.getTokenCache();

            // Create Express App and Routes
            const app = express();

            app.get('/', (req, res) => {
                const authCodeUrlParameters = {
                    scopes: ["openid"],
                    redirectUri: "http://localhost:3000/redirect",
                };

                // get url to sign user in and consent to scopes needed for application
                pca.getAuthCodeUrl(authCodeUrlParameters).then((response) => {
                    res.redirect(response);
                }).catch((error) => console.log(JSON.stringify(error)));
            });

            app.get('/redirect', (req, res) => {
                const tokenRequest = {
                    code: req.query.code,
                    redirectUri: "http://localhost:3000/redirect",
                    scopes: ["openid"],
                };

                pca.acquireTokenByCode(tokenRequest).then((response) => {
                    console.log("\nResponse: \n", response);
                    res.sendStatus(200);
                    return msalCacheManager.writeToPersistence();
                }).catch((error) => {
                    console.log(error);
                    res.status(500).send(error);
                });
            });

            msalCacheManager.readFromPersistence().then(() => {
                app.listen(SERVER_PORT, () => console.log(`Msal Extensions Sample app listening on port ${SERVER_PORT}!`))
            });
        }
    );

/**
 * Builds persistence based on operating system. Falls back to storing in plain text.
 */
async function createPersistence(){
    // On Windows, uses a DPAPI encrypted file
    if(process.platform === "win32"){
        return extensions.FilePersistenceWithDataProtection.create(cachePath, extensions.DataProtectionScope.LocalMachine);
    }

    // On Mac, uses keychain.
    if(process.platform === "darwin"){
        return extensions.KeychainPersistence.create(cachePath, "serviceName", "accountName");
    }

    // On Linux, uses  libsecret to store to secret service. Libsecret has to be installed.
    if(process.platform === "linux"){
        return extensions.LibSecretPersistence.create(cachePath, "serviceName", "accountName");
    }

    // fall back to using plain text file. Not recommended for storing secrets.
    return extensions.FilePersistence.create(cachePath);
}
