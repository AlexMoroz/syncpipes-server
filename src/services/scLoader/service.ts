import * as stream from 'stream';
import * as SyncPipes from "../../app/index";
import * as path from 'path';
import { readFileSync } from 'fs';
// config
import { Configuration } from './Configuration'
import 'node-rest-client';

/**
 * Load Contacts to Exchange
 */
export class SocioCortexLoaderService implements SyncPipes.ILoaderService {

    /**
     * Extension config
     */
    private config: Configuration;

    /**
     * Node Rest Client
     */
    private client: any;

    /**
     * Workflow context
     */
    private context: SyncPipes.IPipelineContext;

    /**
     * Stream provided to the framework
     */
    private stream: stream.Writable;

    /**
     * SyncPipes logger instance
     */
    private logger: SyncPipes.ILogger;

    /**
     * Extension schema
     */
    private schema: SyncPipes.ISchema;

    constructor() {
        this.schema = SyncPipes.Schema.createFromFile(__dirname + '/schema.json');
    }

    /**
     * Returns the name of the extension
     *
     * @return {string}
     */
    getName(): string {
        return 'SocioCortexLoader';
    }

    /**
     * Returns the schema of the configuration
     *
     * @return {SyncPipes.ISchema}
     */
    getSchema(): SyncPipes.ISchema {
        return this.schema;
    }

    /**
     * Returns the configured schema
     *
     * @param config
     * @returns {Promise<SyncPipes.ISchema>}
     */
    getConfigSchema(config): Promise<SyncPipes.ISchema> {
        this.setConfiguration(config.config);
        var Client = require('node-rest-client').Client;
        this.client = new Client({ user: this.config.username, password: this.config.password });
        return this.updateSchema();
    }

    updateSchema(): Promise<SyncPipes.ISchema> {
        return new Promise<SyncPipes.ISchema>((resolve, reject) => {
            this.fetchTypes().then((types) => {
                for(var i = 0; i < types.length; i++) {
                    var properties = {};
                    properties["id"] = {"type": "string", "default": types[i].id};
                    properties["name"] = {"type": "string"};
                    properties["href"] = {"type": "string"};
                    for(var j=0; j<types[i].attributeDefinitions.length; j++) {
                        //TODO: JSON Schema generation has to be improved according to standard
                        switch (types[i].attributeDefinitions[j].attributeType) {
                            case "Number":
                                properties[types[i].attributeDefinitions[j].name] = {"type": "number"};
                                break;
                            case "Link":
                                // attribute definitions can contain references to system types like Pages
                                // (then entityType is undefined)
                                // or to the custom types (then entityType is an object, that contains: id, name, href )
                                if (types[i].attributeDefinitions[j].options["entityType"] == undefined) {
                                    properties[types[i].attributeDefinitions[j].name] = {"type": "string"};
                                }
                                else {
                                    properties[types[i].attributeDefinitions[j].name] = {"type": "string", "href": types[i].attributeDefinitions[j].options.entityType.name };
                                }
                                break;
                            case "Text":
                                properties[types[i].attributeDefinitions[j].name] = {"type": "string"};
                                break;
                            case "Date":
                                properties[types[i].attributeDefinitions[j].name] = {"type": "string"};
                                break;
                            default:
                                properties[types[i].attributeDefinitions[j].name] = {"type": "string"};
                        }
                    }
                    var required = ["id", "name"];
                    this.schema.toObject().properties[types[i].name.toString()] = {"type": "array", "items":{"type": "object", "properties":properties, "required": required}};
                }
                resolve(this.schema);
            });
        });
    }

    private fetchTypes() : Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this.handleRequests(this.config.url + "/workspaces").then((workspaces) => {
                for (var w = 0; w < workspaces.length; w++) {
                    if (workspaces[w].name.toLowerCase() === this.config.workspace.toLowerCase()) {
                        this.handleRequests(this.config.url + "/workspaces/" + workspaces[w].id + "/entityTypes").then((types) => {
                            var p = [];
                            var allTypes = [];
                            for (var i = 0; i < types.length; i++) {
                                p.push(this.handleRequests(types[i].href).then((type) => {
                                    allTypes.push(type);
                                }));
                            }

                            Promise.all(p).then(() => {
                                resolve(allTypes);
                            }).catch((err) => {
                                this.logger.error(err);
                            });
                        });
                    }
                }
            });
        });
    }

    handleRequests(url: string) : Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this.client.get(url, (data, response) => {
                resolve(data);
            });
        });
    }


    /**
     * TBD
     * @return {Configuration}
     */
    getConfiguration(): SyncPipes.IServiceConfiguration {
        return new Configuration();
    }

    setConfiguration(config: SyncPipes.IServiceConfiguration): void {
        this.config = <Configuration>config;
    }

    /**
     * Connect to mysql and setup database before loading
     *
     * @param context
     * @param logger
     * @return {Promise<any>}
     */
    prepare(context: SyncPipes.IPipelineContext, logger: SyncPipes.ILogger): Promise<any> {
        this.context = context;
        this.logger = logger;
        var Client = require('node-rest-client').Client;
        this.client = new Client({ user: this.config.username, password: this.config.password });
        return this.updateSchema().then( (schema) => {
            this.schema = schema;
        });
    }


    load(): stream.Writable {
        this.stream = new stream.Writable({objectMode: true});
        var workspaceId = "";
        this.getWorkspaceId().then((wId) => { workspaceId = wId; });
        this.stream._write = (entities, encoding, callback) => {
            var keys = [];
            var typeNames = [];
            Object.keys(entities).forEach(function(key) {
                keys.push(key.toString());
                typeNames.push(key.toString());
            });
            this.createEntitiesForType(keys, typeNames, entities, workspaceId).then(() => {
                callback();
            }).catch((err) => {
                this.logger.error(err);
                callback(err);
            });

        };
        setTimeout(function() {}, 60000);
        return this.stream;
    }

    wait(ms): any {
        var start = new Date().getTime();
        var end = start;
        while(end < start + ms) {
            end = new Date().getTime();
        }
    }

    createEntitiesForType(keys, typeNames, entities, workspaceId): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            let createEntity = (key, typeNames, entities, workspaceId) => {
                if (!key) { return Promise.resolve(); }

                this.getType(key, workspaceId).then((type) => {
                    let typeId = type.id;
                    let val = entities[key];

                    for(let j=0; j<val.length; j++) {
                        let jsonObject = val[j];
                        let entity = {};
                        entity["name"] = jsonObject.name;
                        this.eExists(typeId, entity["name"]).then((b) => {
                            if(!b) {
                                entity["entityType"] = { "id": typeId };
                                entity["workspace"] = { "id": workspaceId };
                                entity["attributes"] = [];
                                let attributeNames = this.getAttributeNames(type);
                                //let p = [];
                                for(var k=0; k<attributeNames.length; k++) {
                                    var attributeName = attributeNames[k];
                                    if(jsonObject.hasOwnProperty(attributeName) && attributeName!=="name") {
                                        let refTypeName = this.typeName(typeNames, attributeName);
                                        /*if(refTypeName != null) {
                                         var attributeValue = jsonObject[attributeName];
                                         this.getType(refTypeName, workspaceId).then((t) => {
                                         p.push(this.getEntityId(t.id, attributeValue).then((refId) => {
                                         entity["attributes"].push({"name": attributeName, "values": [refId]});
                                         }));
                                         });
                                         } else { */
                                        entity["attributes"].push({"name": attributeName, "values": [jsonObject[attributeName]]});
                                        //}
                                    }
                                }
                                var args = {
                                    data: entity,
                                    headers: { "Content-Type": "application/json" }
                                };

                                this.handlePostRequests(this.config.url + "/entities", args);
                            } else {
                                console.log("entity exists");
                            }
                        });
                        //break;
                    }
                });
                createEntity(keys.pop(), typeNames, entities, workspaceId);
            };
            createEntity(keys.pop(), typeNames, entities, workspaceId);
        });
    }

    typeName(typeNames,name): string {
        for(let i=0; i<typeNames.length; i++) {
            let typeName = typeNames[i];
            if(typeName.toLowerCase() === name.toLowerCase() || this.camelize(typeName) === name) {
                return typeName;
            }
        }
        return null;
    }

    camelize(str): string {
        return str.replace(/(?:^\w|[A-Z]|\b\w)/g, function(letter, index) {
            return index == 0 ? letter.toLowerCase() : letter.toUpperCase();
        }).replace(/\s+/g, '');
    }

    eExists(typeId, name): any {
        return new Promise<any>((resolve, reject) => {
            var exists = false;
            this.handleRequests(this.config.url + "/entityTypes/" + typeId +"/entities").then((entities) => {
                for (let w=0; w<entities.length; w++) {
                    if(entities[w].name.toLowerCase() === name.toLowerCase().trim()) {
                        exists = true;
                        resolve(exists);
                    }
                }
                resolve(exists);
            });
        });
    }

    getEntityId(typeId, name): any {
        return new Promise<any>((resolve, reject) => {
            this.handleRequests(this.config.url + "/entityTypes/" + typeId +"/entities").then((entities) => {
                console.log(typeId);
                console.log(name);
                for (let w=0; w<entities.length; w++) {
                    if(entities[w].name.toLowerCase() === name.toLowerCase().trim()) {
                        resolve(entities[w].id);
                    }
                }
            });
        });
    }

    getAttributeNames(type): any {
        let names = [];
        for(let j=0; j<type.attributeDefinitions.length; j++) {
            names.push(type.attributeDefinitions[j].name);
        }
        return names;
    }

    getWorkspaceId(): Promise {
        return new Promise<any>((resolve, reject) => {
            this.handleRequests(this.config.url + "/workspaces").then((workspaces) => {
                for (let w = 0; w < workspaces.length; w++) {
                    if (workspaces[w].name.toLowerCase() === this.config.workspace.toLowerCase()) {
                        resolve(workspaces[w].id);
                    }
                }
            });
        });
    }

    getType(typeName, wId): Promise {
        return new Promise<any>((resolve, reject) => {
            this.handleRequests(this.config.url + "/workspaces/" + wId + "/entityTypes").then((types) => {
                for (let i=0; i<types.length; i++) {
                    if(types[i].name.toLowerCase() === typeName.toLowerCase()) {
                        this.handleRequests(types[i].href).then((type) => {
                            resolve(type);
                        });
                    }
                }
            });
        });
    }

    getUniqueId(url): string {
        if(url != null) {
            let params = url.split("&");
            for (let i = 0; i < params.length; i++) {
                let keyValuePair = params[i].split("=");
                if (keyValuePair[0] === "contactId")
                    return keyValuePair[1];
            }
        }
        return null;
    }

    handleGetRequests(url: string): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this.client.get(url, (data, response) => {
                resolve(data);
            });
        });
    }

    handlePostRequests(url, args) : Promise<any> {
        return new Promise<any>((resolve, reject) => {
            this.client.post(url, args, (data, response) => {
                resolve(data);
            });
        });
    }
}
