import * as stream from 'stream';
import * as mysql from 'mysql';
import * as SyncPipes from "../../app/index";
import * as path from 'path';
import { readFileSync } from 'fs';
// config
import { Configuration } from './Configuration'


/**
 * Load GitHub issues into mysql
 */
export class PureIssueLoaderService implements SyncPipes.ILoaderService {

    /**
     * Extension config
     */
    private config: Configuration;

    /**
     * Workflow context
     */
    private context: SyncPipes.IPipelineContext;

    /**
     * MySQL connection
     */
    private connection: mysql.IConnection;

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
        return 'PureIssueLoader';
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
    getConfigSchema(config ): Promise<SyncPipes.ISchema> {
        return new Promise<SyncPipes.ISchema>((resolve, reject) => {
            resolve(this.schema);
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
        this.connection = mysql.createConnection(this.config.store());
        this.connection.connect();
        return this.setupDatabase();
    }


    load(): stream.Writable {
        this.stream = new stream.Writable({objectMode: true});
        this.stream._write = (chunk, encoding, callback) => {
            //console.log(`Chunk: ${JSON.stringify(chunk, null, "  ")}`);

            this.insertProjects(chunk.projects)
                .then(() => this.insertIssues(chunk.issues))
                .then(() => this.insertComments(chunk.comments))
                .then(() => callback())
                .catch((err) => callback(err));

        };

        return this.stream;
    }

    private insertProjects(projects: Array<any>): Promise<any> {
        // ignore if projects is no array
        if (projects.length < 1) {
            return Promise.resolve()
        }
        // requirements query
        let query = "INSERT INTO `projects` (`github_id`, `name`, `full_name`, `description`, `language`, `git_url`, `watcher_count`, `stars_count`, `created_at`, `updated_at`) VALUES ";
        let bindings = [];
        let placeholder = [];
        for (let project of projects) {
            placeholder.push("(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
            bindings = bindings.concat([
                project.github_id,
                project.name,
                project.full_name,
                project.description || null,
                project.language || null,
                project.git_url,
                project.watcher_count || 0,
                project.stars_count || 0,
                project.created_at,
                project.updated_at
            ]);
        }
        query += placeholder.join(',');
        return this.execQuery(query, bindings);
    }

    private insertIssues(issues: Array<any>): Promise<any> {
        // ignore empty
        if (issues.length < 1) {
            return Promise.resolve();
        }

        // helper for inserting one issue preserving fk relation
        let insertIssue = (issue) => {
            // we are done
            if (!issue) {
                return Promise.resolve();
            }
            return this.execQuery('SELECT id FROM projects WHERE github_id = ? LIMIT 1', [issue.project_id]).then((results) => {
                let sql = "INSERT INTO `issues` (`github_id`, `project_id`, `number`, `title`, `body`, `user`, `state`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
                // insert issue
                return this.execQuery(sql, [
                    issue.github_id,
                    results[0].id,
                    issue.number,
                    issue.title,
                    issue.body,
                    issue.user,
                    issue.state,
                    issue.created_at,
                    issue.updated_at || null
                ]).then(() => {
                    return insertIssue(issues.pop());
                });
            });
        };

        return insertIssue(issues.pop());
    }

    private insertComments(comments: Array<any>): Promise<any> {
        // ignore empty
        if (comments.length < 1) {
            return Promise.resolve();
        }

        // helper for inserting one issue preserving fk relation
        let insertComment = (comment) => {
            // we are done
            if (!comment) {
                return Promise.resolve();
            }
            return this.execQuery('SELECT id FROM issues WHERE github_id = ? LIMIT 1', [comment.issue_id]).then((results) => {
                if (results.length > 0) {
                    let sql = "INSERT INTO `comments` (`github_id`, `issue_id`, `body`, `user`, `created_at`, `updated_at`) VALUES (?, ?, ?, ?, ?, ?)";
                    // insert issue
                    return this.execQuery(sql, [
                        comment.github_id,
                        results[0].id,
                        comment.body,
                        comment.user,
                        comment.created_at,
                        comment.updated_at || null
                    ]).then(() => {
                        return insertComment(comments.pop());
                    })
                } else {
                    this.logger.warn(`Issue with id ${comment.issue_id} does not exist. Skipping insert.`, {
                        comment: comment
                    });
                }
            });
        };
        return insertComment(comments.pop());
    }

    private setupDatabase(): Promise<any> {
        let sql = readFileSync(path.join(__dirname, 'schema.sql'), {encoding: "utf8"});
        return this.execQuery(sql);
    }

    private execQuery(sql: string, bindings: Array<any> = []): Promise<any> {
        //this.logger.debug(`Executing SQL-Query ${sql}`, bindings);
        return new Promise<any>((resolve, reject) => {
            this.connection.query(sql, bindings, function (err, result) {
                if (err) {
                    reject(err);
                } else {
                    resolve(result);
                }
            });
        });
    }
}
