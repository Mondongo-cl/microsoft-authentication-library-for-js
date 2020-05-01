/*
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */

import { DeviceCodeResponse, ServerDeviceCodeResponse } from "../response/DeviceCodeResponse";
import { BaseClient } from "./BaseClient";
import { DeviceCodeRequest } from "../request/DeviceCodeRequest";
import { Authority } from "../authority/Authority";
import { ClientAuthError } from "../error/ClientAuthError";
import { RequestParameterBuilder } from "../server/RequestParameterBuilder";
import { Constants, GrantType } from "../utils/Constants";
import { Configuration } from "../config/Configuration";
import { TimeUtils } from "../utils/TimeUtils";
import { ServerAuthorizationTokenResponse } from "../server/ServerAuthorizationTokenResponse";
import { ScopeSet } from "../request/ScopeSet";

/**
 * OAuth2.0 Device code client
 */
export class DeviceCodeClient extends BaseClient {

    private authority: Authority;

    constructor(configuration: Configuration) {
        super(configuration);
    }

    /**
     * Gets device code from device code endpoint, calls back to with device code response, and
     * polls token endpoint to exchange device code for tokens
     * @param request
     */
    public async acquireToken(request: DeviceCodeRequest): Promise<string> {
        this.authority = await this.createAuthority(request.authority);
        const deviceCodeResponse: DeviceCodeResponse = await this.getDeviceCode(request);
        request.deviceCodeCallback(deviceCodeResponse);
        const response: ServerAuthorizationTokenResponse = await this.acquireTokenWithDeviceCode(
            request,
            deviceCodeResponse);

        // TODO handle response
        return JSON.stringify(response);
    }

    /**
     * Creates device code request and executes http GET
     * @param request
     */
    private async getDeviceCode(request: DeviceCodeRequest): Promise<DeviceCodeResponse> {

        const deviceCodeUrl = this.createDeviceCodeUrl(request);
        const headers = this.createDefaultLibraryHeaders();

        return this.executeGetRequestToDeviceCodeEndpoint(deviceCodeUrl, headers);
    }

    /**
     * Executes GET request to device code endpoint
     * @param deviceCodeUrl
     * @param headers
     */
    private async executeGetRequestToDeviceCodeEndpoint(deviceCodeUrl: string, headers: Map<string, string>): Promise<DeviceCodeResponse> {

        const {
            body: {
                user_code: userCode,
                device_code: deviceCode,
                verification_uri: verificationUri,
                expires_in: expiresIn,
                interval,
                message
            }
        } = await this.networkClient.sendGetRequestAsync<ServerDeviceCodeResponse>(deviceCodeUrl, {headers});

        return {
            userCode,
            deviceCode,
            verificationUri,
            expiresIn,
            interval,
            message
        };
    }

    /**
     * Create device code endpoint url
     * @param request
     */
    private createDeviceCodeUrl(request: DeviceCodeRequest): string {
        const queryString: string = this.createQueryString(request);

        // TODO add device code endpoint to authority class
        return `${this.authority.canonicalAuthority}${Constants.DEVICE_CODE_ENDPOINT_PATH}?${queryString}`;
    }

    /**
     * Create device code endpoint query parameters and returns string
     */
    private createQueryString(request: DeviceCodeRequest): string {

        const parameterBuilder: RequestParameterBuilder = new RequestParameterBuilder();

        const scopeSet = new ScopeSet(request.scopes || [],
            this.config.authOptions.clientId,
            false);
        parameterBuilder.addScopes(scopeSet);
        parameterBuilder.addClientId(this.config.authOptions.clientId);

        return parameterBuilder.createQueryString();
    }

    /**
     * Creates token request with device code response and polls token endpoint at interval set by the device code
     * response
     * @param request
     * @param deviceCodeResponse
     */
    private async acquireTokenWithDeviceCode(
        request: DeviceCodeRequest,
        deviceCodeResponse: DeviceCodeResponse): Promise<ServerAuthorizationTokenResponse> {

        const requestBody = this.createTokenRequestBody(request, deviceCodeResponse);
        const headers: Map<string, string> = this.createDefaultTokenRequestHeaders();

        const deviceCodeExpirationTime = TimeUtils.nowSeconds() + deviceCodeResponse.expiresIn;
        const pollingIntervalMilli = deviceCodeResponse.interval * 1000;

        // Poll token endpoint while (device code is not expired AND operation has not been cancelled by
        // setting CancellationToken.cancel = true). POST request is sent at interval set by pollingIntervalMilli
        return new Promise<ServerAuthorizationTokenResponse>((resolve, reject) => {

            const intervalId: ReturnType<typeof setTimeout> = setInterval(async () => {
                try {
                    if (request.cancel) {

                        this.logger.error("Token request cancelled by setting DeviceCodeRequest.cancel = true");
                        clearInterval(intervalId);
                        reject(ClientAuthError.createDeviceCodeCancelledError());

                    } else if (TimeUtils.nowSeconds() > deviceCodeExpirationTime) {
                        this.logger.error(`Device code expired. Expiration time of device code was ${deviceCodeExpirationTime}`);
                        clearInterval(intervalId);
                        reject(ClientAuthError.createDeviceCodeExpiredError());

                    } else {
                        const response = await this.executePostToTokenEndpoint(
                            this.authority.tokenEndpoint,
                            requestBody,
                            headers);

                        if (response.body && response.body.error == Constants.AUTHORIZATION_PENDING) {
                            // user authorization is pending. Sleep for polling interval and try again
                            this.logger.info(response.body.error_description);
                        } else {
                            clearInterval(intervalId);
                            resolve(response.body);
                        }
                    }
                } catch (error) {
                    clearInterval(intervalId);
                    reject(error);
                }
            }, pollingIntervalMilli);
        });
    }

    /**
     * Creates query parameters and converts to string.
     * @param request
     * @param deviceCodeResponse
     */
    private createTokenRequestBody(request: DeviceCodeRequest, deviceCodeResponse: DeviceCodeResponse): string {

        const requestParameters: RequestParameterBuilder = new RequestParameterBuilder();

        const scopeSet = new ScopeSet(request.scopes || [],
            this.config.authOptions.clientId,
            true);
        requestParameters.addScopes(scopeSet);
        requestParameters.addClientId(this.config.authOptions.clientId);
        requestParameters.addGrantType(GrantType.DEVICE_CODE_GRANT);
        requestParameters.addDeviceCode(deviceCodeResponse.deviceCode);
        return requestParameters.createQueryString();
    }
}
