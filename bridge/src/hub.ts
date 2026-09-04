import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';

export type AgentRole = 'background' | 'studio';

export interface HelloMessage {
  type: 'hello';
  role: AgentRole;
  protocol: number;
  extensionVersion: string;
  methods: string[];
}

export interface CallMessage {
  type: 'call';
  id: string;
  method: string;
  params: unknown;
}

export interface ResultMessage {
  type: 'result';
  id: string;
  ok: true;
  result: unknown;
}

export interface ErrorMessage {
  type: 'result';
  id: string;
  ok: false;
  error: string;
}

export interface EventMessage {
  type: 'event';
  name: string;
  data: unknown;
}

export interface PingMessage {
  type: 'ping';
}

export interface PongMessage {
  type: 'pong';
}

export type ExtensionMessage =
  | HelloMessage
  | ResultMessage
  | ErrorMessage
  | EventMessage
  | PingMessage
  | PongMessage;

interface ClientConnection {
  socket: WebSocket;
  role: AgentRole;
  protocol: number;
  extensionVersion: string;
  methods: Set<string>;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

const DEFAULT_TIMEOUT_MS = 60_000;

export const BACKGROUND_METHODS = new Set([
  'list_tabs',
  'inspect_page',
  'capture',
  'wait_for_capture',
  'open_studio',
]);

export const STUDIO_METHODS = new Set([
  'get_scene',
  'set_frame',
  'set_duration',
  'set_camera',
  'set_layer',
  'set_scene',
  'fit',
  'set_keyframes',
  'clear_timeline',
  'apply_preset',
  'seek',
  'screenshot',
  'contact_sheet',
  'export',
]);

export class ExtensionHub extends EventEmitter {
  public readonly port: number;
  private wss: WebSocketServer | null = null;
  private clients = new Map<AgentRole, ClientConnection>();
  private methodRouting = new Map<string, ClientConnection>();
  private pendingCalls = new Map<string, PendingCall>();

  constructor(port = 47831) {
    super();
    this.port = port;
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.wss = new WebSocketServer({ host: '127.0.0.1', port: this.port });

        this.wss.on('listening', () => {
          resolve();
        });

        this.wss.on('error', (err) => {
          reject(err);
        });

        this.wss.on('connection', (socket: WebSocket) => {
          this.handleConnection(socket);
        });
      } catch (err) {
        reject(err);
      }
    });
  }

  public async stop(): Promise<void> {
    // Cancel any pending calls
    for (const [id, pending] of this.pendingCalls.entries()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('ExtensionHub stopping'));
      this.pendingCalls.delete(id);
    }

    return new Promise((resolve, reject) => {
      if (!this.wss) {
        resolve();
        return;
      }
      this.wss.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private handleConnection(socket: WebSocket): void {
    let clientConn: ClientConnection | null = null;

    socket.on('message', (raw: Buffer | string) => {
      try {
        const text = typeof raw === 'string' ? raw : raw.toString('utf-8');
        const msg = JSON.parse(text) as ExtensionMessage;

        if (msg.type === 'ping') {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'pong' }));
          }
          return;
        }

        if (msg.type === 'pong') {
          return;
        }

        if (msg.type === 'hello') {
          // If a client already exists for this role, close/replace it
          const existing = this.clients.get(msg.role);
          if (existing && existing.socket !== socket) {
            try {
              existing.socket.close();
            } catch {
              // Ignore close errors
            }
          }

          clientConn = {
            socket,
            role: msg.role,
            protocol: msg.protocol,
            extensionVersion: msg.extensionVersion,
            methods: new Set(msg.methods),
          };

          this.clients.set(msg.role, clientConn);
          this.rebuildMethodRouting();
          this.emit('role-connected', msg.role, clientConn);
          return;
        }

        if (msg.type === 'result') {
          const pending = this.pendingCalls.get(msg.id);
          if (pending) {
            clearTimeout(pending.timer);
            this.pendingCalls.delete(msg.id);
            if (msg.ok) {
              pending.resolve(msg.result);
            } else {
              pending.reject(new Error(msg.error || 'Unknown error from extension'));
            }
          }
          return;
        }

        if (msg.type === 'event') {
          this.emit('event', msg.name, msg.data);
          this.emit(msg.name, msg.data);
          return;
        }
      } catch (e) {
        console.error('[ExtensionHub] Error handling message:', e);
      }
    });

    const cleanup = () => {
      if (clientConn && this.clients.get(clientConn.role)?.socket === socket) {
        this.clients.delete(clientConn.role);
        this.rebuildMethodRouting();
        this.emit('role-disconnected', clientConn.role);
      }
    };

    socket.on('close', cleanup);
    socket.on('error', cleanup);
  }

  private rebuildMethodRouting(): void {
    this.methodRouting.clear();
    for (const client of this.clients.values()) {
      for (const method of client.methods) {
        this.methodRouting.set(method, client);
      }
    }
  }

  public getConnectedRoles(): AgentRole[] {
    return Array.from(this.clients.keys());
  }

  public getAvailableMethods(): string[] {
    return Array.from(this.methodRouting.keys());
  }

  public getClientInfo(role: AgentRole): { protocol: number; extensionVersion: string; methods: string[] } | null {
    const client = this.clients.get(role);
    if (!client) return null;
    return {
      protocol: client.protocol,
      extensionVersion: client.extensionVersion,
      methods: Array.from(client.methods),
    };
  }

  public async waitForRole(role: AgentRole, timeoutMs = 30_000): Promise<void> {
    if (this.clients.has(role)) {
      return;
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.off('role-connected', listener);
        reject(new Error(`Timeout waiting for role "${role}" to connect (${timeoutMs}ms)`));
      }, timeoutMs);

      const listener = (connectedRole: AgentRole) => {
        if (connectedRole === role) {
          clearTimeout(timer);
          this.off('role-connected', listener);
          resolve();
        }
      };

      this.on('role-connected', listener);
    });
  }

  public getCallTimeout(method: string, params?: unknown): number {
    if (method === 'capture') {
      return 180_000;
    }
    if (method === 'wait_for_capture') {
      const p = params as { timeoutMs?: number } | undefined;
      const paramTimeout = typeof p?.timeoutMs === 'number' ? p.timeoutMs : 120_000;
      return paramTimeout + 5_000;
    }
    if (method === 'export') {
      return 600_000;
    }
    if (method === 'contact_sheet' || method === 'screenshot') {
      return 60_000;
    }
    return DEFAULT_TIMEOUT_MS;
  }

  public async call(method: string, params: unknown = {}, customTimeoutMs?: number): Promise<unknown> {
    const client = this.methodRouting.get(method);
    if (!client || client.socket.readyState !== WebSocket.OPEN) {
      if (BACKGROUND_METHODS.has(method)) {
        throw new Error(
          "L'extension Diorama n'est pas connectée (rôle background). Ouvre Chrome avec l'extension chargée."
        );
      }
      if (STUDIO_METHODS.has(method)) {
        throw new Error(
          "L'onglet Studio n'est pas ouvert : appelle diorama_capture ou diorama_open_studio d'abord."
        );
      }
      throw new Error(`Aucun client connecté pour la méthode "${method}".`);
    }

    const id = crypto.randomUUID();
    const timeout = customTimeoutMs ?? this.getCallTimeout(method, params);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingCalls.delete(id);
        reject(new Error(`Call to "${method}" timed out after ${timeout}ms`));
      }, timeout);

      this.pendingCalls.set(id, { resolve, reject, timer });

      const callMsg: CallMessage = {
        type: 'call',
        id,
        method,
        params,
      };

      try {
        client.socket.send(JSON.stringify(callMsg), (err) => {
          if (err) {
            clearTimeout(timer);
            this.pendingCalls.delete(id);
            reject(err);
          }
        });
      } catch (err) {
        clearTimeout(timer);
        this.pendingCalls.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}
