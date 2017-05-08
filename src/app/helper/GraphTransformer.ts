import * as lodash from 'lodash'
// helper for object access
import * as ObjectAccess from './ObjectAccess';
import { ObjectGraphNode } from './ObjectGraph';
import { MappingTree } from './MappingTree';

import { ISchema } from "../service/Schema";
import { IMapping, Mapping } from "../model/Mapping";
import { writeFile } from 'fs';

interface IDestinationValue {
    to: string;
    value: any;
    unique: boolean;
    primary: boolean;
    foreignKey: string;
}

interface IGroupMappingTransformer {
    prefix: string;
    mapping: MappingTree;
}

export class GraphTransformer {

    /**
     * JSON-Schema of the source
     */
    private sourceSchema: ISchema;

    /**
     * JSON-Schema of the target
     */
    private targetSchema: ISchema;

    /**
     * Mapping of source to target
     */
    private mapping: IMapping;

    private mappingGroups: Array<IGroupMappingTransformer>;

    constructor(sourceSchema: ISchema, targetSchema: ISchema, mapping: IMapping) {
        this.sourceSchema = sourceSchema;
        this.targetSchema = targetSchema;
        this.mapping = mapping;
        // group mapping
        this.mappingGroups = this.groupMapping();
    }

    transform(data: Object): Object {
        // validate against schema
        // if (!this.sourceSchema.validateObject(data)) {
           // throw new Error('Schema validation error: ' + JSON.stringify(this.sourceSchema.getErrors(), null, '  '));
        // }
        // create graph from input data
        let graph = new ObjectGraphNode("_root");
        graph.insert(data);
        // target object
        let destObj = GraphTransformer.instantiateStructure(this.targetSchema.toObject(true));
        // iterate over mapping
        for (let group of this.mappingGroups) {
            let toMerge = this.extract(graph.getNodeByPrefix(group.mapping.getName()), group.mapping);
            //if (group.prefix === "issues") {
            //    writeFile('./toMerge.json', JSON.stringify(toMerge));
            //}
            //console.log(toMerge);
            // merge sub destination object into root destination
            for (let objs of toMerge) {
                // search for foreign key
                let fk: IDestinationValue = null;
                for (let obj of objs) {
                    if (obj.to === '$foreignKey' && obj.foreignKey !== null) {
                        fk = obj;
                        break;
                    }
                }

                // fk insert
                if (fk !== null) {
                    this.insertForeignKey(destObj, objs, group.prefix, fk);
                } else {
                    this.insert(destObj, objs, group.prefix);
                }
            }
        }
        //writeFile('./dest.json', JSON.stringify(destObj));
        return destObj;
    }

    insert(dest: any, objects: Array<IDestinationValue>, path: string) {
        // paths does not
        let currentNode = dest;
        let pathElements = path.split('/');
        for (let i = 0; i < pathElements.length; i++) {
            // lookup schema and create node if not exists
            if (pathElements[i] != "") {
                if (!currentNode.hasOwnProperty(pathElements[i])) {
                    // make path for schema
                    let schemaPath = pathElements.splice(0, i).join('/');
                    // get partial schema
                    let schema = this.targetSchema.partial(schemaPath);
                    // determine type
                    if (schema.type === 'array') {
                        currentNode[pathElements[i]] = [];
                    } else if (schema.type === 'object') {
                        currentNode[pathElements[i]] = {};
                    }
                }
                currentNode = currentNode[pathElements[i]];
            }
            // leaf element
            if (i === pathElements.length-1) {
                // search unique and primary flag and prepare object
                let unique: IDestinationValue = null;
                let primary: IDestinationValue = null;
                let tmp = {};
                for (let obj of objects) {
                    if (obj.unique) {
                        unique = obj;
                    }
                    if (obj.primary) {
                        primary = obj;
                    }
                    tmp[obj.to] = obj.value;
                }
                if (lodash.isPlainObject(currentNode)) {
                    let insert = true;
                    if (primary !== null) {
                        if (currentNode.hasOwnProperty(primary.to) && currentNode[primary.to] === primary.value) {
                            for (let key of Reflect.ownKeys(tmp))  {
                                if (!currentNode.hasOwnProperty(key)) {
                                    currentNode[key] = tmp[key];
                                }
                            }
                            // set non existing
                            insert = false;
                        }
                    }
                    if (insert) {
                        // insert data
                        currentNode = tmp;
                    }

                } else if (lodash.isArray(currentNode)) {
                    let insert = true;
                    // unique check
                    if (unique !== null) {
                        // check if element exists
                        for (let item of currentNode) {
                            if (item[unique.to] === unique.value) {
                                // update
                                for (let field of Reflect.ownKeys(tmp)) {
                                    if (!item.hasOwnProperty(field)) {
                                        item[field] = tmp[field];
                                    }
                                }
                                insert = false;
                                break;
                            }
                        }
                    }
                    if (insert) {
                        currentNode.push(tmp);
                    }
                }
            }
        }
    }

    insertForeignKey(dest: any, objects: Array<IDestinationValue>, path: string, fk: IDestinationValue) {
        // check if the entry exists where the foreignKey points to
        //console.log(dest);
        //console.log(".....................");
        let extractPath = '';
        let partsFK = fk.foreignKey.split('/');
        let partsPath = path.split('/');
        for (let i = 0; i < partsFK.length; i++) {
            if (partsFK[i] !== partsPath[i]) {
                break;
            }
            extractPath += partsFK[i] + '/';
        }
        let wherePath = fk.foreignKey.replace(extractPath, '');
        if (extractPath.endsWith('/')) {
            extractPath = extractPath.substr(0, extractPath.length-1);
        }
        // try to find foreignKey objects
        let fkObjects = ObjectAccess.where(dest, extractPath, wherePath, fk.value);
        // no matching path with the foreign key found so we create one and call this function again
        if (fkObjects.length === 0) {
            // paths does not exist
            let currentNode = dest;
            let pathElements = fk.foreignKey.split('/');
            for (let i = 0; i < pathElements.length; i++) {
                if (i === pathElements.length-1) {
                    // create leaf
                    if (lodash.isArray(currentNode)) {
                        let tmp = {};
                        tmp[pathElements[i]] = fk.value;
                        currentNode.push(tmp);
                    } else if (lodash.isPlainObject(currentNode)) {
                        currentNode[pathElements[i]] = fk.value;
                    }
                } else {
                    if (!currentNode.hasOwnProperty(pathElements[i])) {
                        // make path for schema
                        let schemaPath = pathElements.splice(0, i).join('/');
                        // get partial schema
                        let schema = this.targetSchema.partial(schemaPath);
                        // determine type
                        if (schema.type === 'array') {
                            currentNode[pathElements[i]] = [];
                        } else if (schema.type === 'object') {
                            currentNode[pathElements[i]] = {};
                        }
                    }
                    currentNode = currentNode[pathElements[i]];
                }
            }
            // call this function
            this.insertForeignKey(dest, objects, path, fk);

        } else {
            // path exist
            for (let i = 0; i < fkObjects.length; i++) {
                let elementName: string = null;
                if (path !== extractPath) {
                    elementName = path.replace(extractPath + '/', '')
                }
                if (elementName !== null) {
                    // check if element exists
                    if (!fkObjects[i].hasOwnProperty(elementName)) {
                        // create element based on schema
                        let schema = this.targetSchema.partial(path);
                        if (schema.type === 'array') {
                            fkObjects[i][elementName] = [];
                            // insert element
                        } else if (schema.type === 'object') {
                            fkObjects[i][elementName] = {};
                        }
                    }
                    // insert or overwrite
                    if (lodash.isPlainObject(fkObjects[i][elementName])) {
                        // just put in the properties
                        for (let obj of objects) {
                            if (obj.foreignKey === null && obj.to !== '$foreignKey') {
                                // TODO: Typecast!
                                fkObjects[i][elementName][obj.to] = obj.value;
                            }
                        }
                    } else if (lodash.isArray(fkObjects[i][elementName])) {
                        let doInsert = true;
                        // search unique flag and preapre object
                        let unique: IDestinationValue = null;
                        let tmp = {};
                        for (let obj of objects) {
                            if (obj.foreignKey === null && obj.to !== '$foreignKey') {
                                if (obj.unique) {
                                    unique = obj;
                                }
                                tmp[obj.to] = obj.value;
                            }
                        }
                        // check unique if available
                        if (unique !== null) {
                            // check if element exists
                            for (let item of fkObjects[i][elementName]) {
                                if (item[unique.to] === unique.value) {
                                    doInsert = false;
                                    break;
                                }
                            }
                        }
                        // insert
                        if (doInsert) {
                            fkObjects[i][elementName].push(tmp);
                        }
                    }
                } else {
                    for (let obj of objects) {
                        if (obj.foreignKey === null && obj.to !== '$foreignKey') {
                            // TODO: Typecast!
                            fkObjects[i][obj.to] = obj.value;
                        }
                    }
                }
            }
        }
    }

    extract(graph: Array<ObjectGraphNode>, mappingNode: MappingTree, depth: number = 0): Array<Array<IDestinationValue>> {
        let result = Array<Array<IDestinationValue>>();
        // get direct
        for (let node of graph) {
            let destObjects = this.extractSingle(node, mappingNode);
            // handle children
            if (mappingNode.getChildren() !== null) {
                for (let childMapping of mappingNode.getChildren()) {
                    let subGraph = node.getNodeByPrefix(childMapping.getName());
                    let tmp = this.extract(subGraph, childMapping, (depth+1));
                    for (let i = 0; i < tmp.length; i++) {
                        tmp[i] = tmp[i].concat(destObjects);
                        result.push(tmp[i]);
                    }
                    // clear object since it has been merged
                    destObjects = [];
                }
            }
            if (destObjects.length > 0) {
                result.push(destObjects);
            }
        }
        return result;
    }

    extractSingle(node: ObjectGraphNode, mappingNode: MappingTree): Array<IDestinationValue> {
        let destObjects = [];

        if (mappingNode.getValue() instanceof Array) {
            for (let mapping of mappingNode.getValue()) {
                // find leaf in node
                let leaf = node.getLeafByName(mapping.fromPath);
                // set value to destination object
                if (leaf !== null) {
                    destObjects.push({
                        "to": mapping.toPath,
                        "value": leaf.getValue(),
                        "unique": mapping.uniqueKey,
                        "primary": mapping.primaryKey,
                        "foreignKey": mapping.foreignKey
                    });
                } else {
                    //ignore if the source leaf node is unavailable
                    //throw new Error(`Unable to get find leaf by name '${mapping.fromPath}' at path '${mappingNode.getName()}'`);
                }
            }
        }
        return destObjects;
    }

    groupMapping(): Array<IGroupMappingTransformer> {
        // build inner map aka. toMap
        let groups = new Array<IGroupMappingTransformer>();
        for (let group of this.mapping.groups) {
            // determine if all fromPaths have the same prefix
            let hasSameFromPrefix = true;
            let prefix = '';
            for (let mapping of group.properties) {
                if (prefix === '') {
                    let idx = mapping.fromPath.indexOf('/');
                    prefix = idx !== -1 ? mapping.fromPath.substr(0, idx) : mapping.fromPath;
                } else if (!mapping.fromPath.startsWith(prefix)) {
                    hasSameFromPrefix = false;
                    break;
                }
            }
            // create mapping tree
            if (!hasSameFromPrefix) {
                prefix = '';
            }
            let node = new MappingTree(prefix);
            // insert mappings into tree
            for (let mapping of group.properties) {
                // determine from path
                let idx = mapping.fromPath.lastIndexOf('/');
                let fromPath = idx !== -1 ? mapping.fromPath.substr(0, idx) : mapping.fromPath;
                // strip prefix
                mapping.fromPath = mapping.fromPath.replace(fromPath + '/', '');
                mapping.toPath = mapping.toPath.replace(group.toPrefix + '/', '');
                // tree insert
                node.insert(fromPath, [mapping], idx === -1);
            }
            if (node !== null) {
                // make transformer group
                groups.push({
                    prefix: group.toPrefix,
                    mapping: node
                });
            }
        }

        return groups;
    }

    static instantiateStructure(schema: any): Object {

        if (!schema.hasOwnProperty("type")) {
            return null;
        }

        let obj = null;
        switch (schema.type) {
            case 'object':
                obj = {};
                // traverse children
                for (let prop of Reflect.ownKeys(schema.properties)) {
                    obj[prop] = GraphTransformer.instantiateStructure(schema.properties[prop]);
                }
                break;
            case 'array':
                obj = [];
                break;
        }

        return obj;
    }

}
