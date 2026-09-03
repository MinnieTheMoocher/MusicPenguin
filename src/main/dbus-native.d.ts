declare module "dbus-native" {
  export class Variant {
    constructor(type: string, value: unknown);
    readonly type: string;
    readonly value: unknown;
  }

  export interface DbusMessage {
    interface?: string;
    member?: string;
    body?: unknown[];
  }

  export interface DbusConnection {
    on(event: "message", listener: (msg: DbusMessage) => void): void;
    removeListener(event: "message", listener: (msg: DbusMessage) => void): void;
  }

  export interface DbusBus {
    connection: DbusConnection;
    requestName(name: string, flags: number, callback: (err: unknown) => void): void;
    addMatch(rule: string): void;
    export(path: string, iface: unknown): void;
    emitPropertiesChanged(path: string, iface: string, changed: Record<string, unknown>): void;
  }

  type PropertyAccess = "read" | "write" | "readwrite";

  export interface InterfaceProperty {
    type: string;
    access: PropertyAccess;
    value?: unknown;
  }

  export interface InterfaceMethod {
    in?: Record<string, string>;
    out?: string;
    handler?: (...args: unknown[]) => void;
  }

  export interface InterfaceDefinition {
    impl: Record<string, unknown>;
    emit: (name: string, ...args: unknown[]) => void;
  }

  export function defineInterface(config: {
    name: string;
    properties?: Record<string, InterfaceProperty>;
    methods?: Record<string, InterfaceMethod>;
  }): InterfaceDefinition;

  export function sessionBus(): DbusBus;
}
