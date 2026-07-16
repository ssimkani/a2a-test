declare module '@orbitdb/core' {
  export interface OrbitDbIdentity {
    id: string;
  }

  export interface OrbitDbDocumentEntry<TDocument> {
    hash: string;
    key: string;
    value: TDocument;
  }

  export interface OrbitDbEventEmitter {
    on(event: 'update', listener: (entry: unknown) => void | Promise<void>): void;
    on(event: 'join', listener: (peerId: unknown) => void | Promise<void>): void;
    on(event: 'leave', listener: (peerId: unknown) => void | Promise<void>): void;
  }

  export interface OrbitDbDocuments<TDocument> {
    address: string;
    name: string;
    type: 'documents';
    events: OrbitDbEventEmitter;
    peers: Set<unknown>;
    put(document: TDocument): Promise<string>;
    get(key: string): Promise<OrbitDbDocumentEntry<TDocument> | undefined>;
    all(): Promise<Array<OrbitDbDocumentEntry<TDocument>>>;
    query(predicate: (document: TDocument) => boolean): Promise<TDocument[]>;
    close(): Promise<void>;
  }

  export interface OrbitDbInstance {
    identity: OrbitDbIdentity;
    open<TDocument>(
      address: string,
      options?: {
        type?: 'documents';
        Database?: unknown;
        AccessController?: unknown;
        sync?: boolean;
      },
    ): Promise<OrbitDbDocuments<TDocument>>;
    stop(): Promise<void>;
  }

  export function createOrbitDB(options: {
    ipfs: unknown;
    id?: string;
    directory?: string;
  }): Promise<OrbitDbInstance>;

  export function Documents(options: { indexBy: string }): unknown;
  export function IPFSAccessController(options: { write: string[] }): unknown;
}
