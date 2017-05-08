import * as stream from 'stream';
import jiraClient = require("jira-connector");
import * as SyncPipes from "../../app/index";
// config
import { Configuration } from './Configuration'

/**
 * Extracts Issues from a jira org
 */
export class JiraIssueExtractorService implements SyncPipes.IExtractorService {

    /**
     * Extractor configuration
     */
    private config: Configuration;

    /**
     * Execution context
     */
    private context: SyncPipes.PipelineContext;

    /**
     * jira client
     */
    private jira: any;

    /**
     * Output stream
     */
    private stream: stream.Readable;

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
     * Data is fetched actively
     *
     * @return {ExtractorServiceType}
     */
    getType(): SyncPipes.ExtractorServiceType {
        return SyncPipes.ExtractorServiceType.Active;
    }

    prepare(context: SyncPipes.PipelineContext, logger: SyncPipes.ILogger): Promise<any> {
        this.context = context;
        this.config = new Configuration();
        this.logger = logger;
        this.config.load(context.pipeline.extractorConfig.config);
        this.jira = new jiraClient( {
            host: this.config.url
            // TODO: handel different types of authorisation
            //    type: "oauth",
            //    username: this.config.username,
            //    token: this.config.token
        });
        //this.github.authenticate({
        //    type: "oauth",
        //    token: this.config.token
        //});
        return Promise.resolve();
    }

    extract(): stream.Readable {
        // create output stream
        this.stream = new stream.Readable({objectMode: true});
        this.stream._read = () => {};

        this.fetchIssuesOfProject();

        return this.stream;
    }

    getName(): string {
        return 'jiraIssueExtractor';
    }

    getConfiguration(): SyncPipes.IServiceConfiguration {
        return new Configuration();
    }

    setConfiguration(config: SyncPipes.IServiceConfiguration): void {
        this.config = <Configuration>config;
    }

    /**
     * Return the schema which can be extracted
     *
     * @return {Schema}
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
     * Fetch issues from specified project
     *
     *
     */
    private fetchIssuesOfProject(next: Object = null) {
        if (this.stream === null) {
            throw new Error('No output stream available');
        } else {
            Promise.all([this.fetchIssuesForPage(null, [])]).then((issues) => {
                console.log("resolved");
                this.stream.push({"issues": issues[0]});
                this.stream.push(null);
            }).catch((err) => {
                console.error(err);
            });
        }

    }

    private fetchIssuesForPage(next: Object = null, issues: Array<any> = []): Promise<any> {
        return new Promise<any>((resolve, reject) => {
            let fnHandle = (err, _issues) => {
                if (err) {
                    reject(err);
                } else {
                    // manipulate issues an push to stream
                    for (let issue of _issues.issues) {
                        issues.push(issue);
                    }
                    var nextPage = _issues.startAt+_issues.maxResults;
                    //TODO: handle the left issues
                     if (nextPage<(_issues.total)){
                         console.log(nextPage);
                    //if (nextPage<2){
                        this.fetchIssuesForPage(nextPage, issues);
                    } else {
                         console.log("resolve");
                        resolve(issues);
                         return;
                    }
                }
            };
            this.jira.search.search({
                jql: 'project=' + this.config.project,
                startAt: next
            }, fnHandle);

        });
    }

    updateConfigSchema(inputData:Array<Buffer>) {
        return null;
    }
}
