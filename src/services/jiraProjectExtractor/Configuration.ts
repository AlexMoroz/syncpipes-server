import { IServiceConfiguration, ISchema, Schema } from "../../app/index";
/**
 * MySQL Configuration for this extension
 */
export class Configuration implements IServiceConfiguration {

    private _url: string;

    private _username: string;

    private _token: string;

    get url(): string {
        return this._url;
    }

    get username(): string {
        return this._username;
    }

    get token(): string {
        return this._token;
    }

    getSchema(): ISchema {
        return Schema.createFromObject({
            "$schema": "http://json-schema.org/draft-054/schema#",
            "type": "object",
            "properties": {
                "url": {
                    "type": "string",
                    "description": "Url"
                },
                "username": {
                    "type": "string",
                    "description": "Jira username",
                },
                "token": {
                    "type": "string",
                    "description": "Jira personal access token",
                }
            },
            "additionalProperties": false,
            "required": [
                "url",
                "username",
                "token"
            ]
        });
    }

    store(): Object {
        return {
            "url": this._url,
            "username": this._username,
            "token": this._token
        };
    }

    load({url, username, token, project}): void {
        this._url = url;
        this._username = username;
        this._token = token;
    }
}
