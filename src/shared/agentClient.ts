import { AGENT_BRIDGE_PORT, AGENT_PROTOCOL_VERSION } from './agentProtocol';
import type {
  AgentEventName,
  AgentRole,
  BridgeToExtension,
  ExtensionToBridge,
  HelloMessage,
} from './agentProtocol';

export type AgentHandler = (params: any) => Promise<unknown> | unknown;

export interface AgentClientOptions {
  role: AgentRole;
  handlers: Record<string, AgentHandler>;
  /** Defaults to `ws://127.0.0.1:${AGENT_BRIDGE_PORT}`. */
  url?: string;
  onStateChange?: (connected: boolean) => void;
}

const RECONNECT_MIN_MS = 1000;
const RECONNECT_MAX_MS = 10000;
/** Under 30 s: a Chrome MV3 service worker stays alive while its socket has traffic. */
const PING_INTERVAL_MS = 20000;

/**
 * Outbound WebSocket client shared by the service worker and the Studio tab.
 * The bridge is a plain local process that may start before or after the
 * extension, so the client reconnects forever with a capped backoff and
 * re-announces its method table on every (re)connection.
 */
export class AgentClient {
  private socket: WebSocket | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private stopped = false;
  private readonly url: string;

  constructor(private readonly options: AgentClientOptions) {
    this.url = options.url ?? `ws://127.0.0.1:${AGENT_BRIDGE_PORT}`;
  }

  get connected(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  start(): void {
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearPing();
    this.socket?.close();
    this.socket = null;
  }

  /** Fire-and-forget notification; silently dropped while disconnected. */
  emit(name: AgentEventName, data: unknown): void {
    this.send({ type: 'event', name, data });
  }

  private send(message: ExtensionToBridge): void {
    if (!this.connected) return;
    try {
      this.socket!.send(JSON.stringify(message));
    } catch (err) {
      console.warn('[diorama agent] send failed', err);
    }
  }

  private connect(): void {
    if (this.stopped || this.socket) return;
    let socket: WebSocket;
    try {
      socket = new WebSocket(this.url);
    } catch (err) {
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;

    socket.addEventListener('open', () => {
      this.reconnectDelay = RECONNECT_MIN_MS;
      const hello: HelloMessage = {
        type: 'hello',
        role: this.options.role,
        protocol: AGENT_PROTOCOL_VERSION,
        extensionVersion: chrome.runtime.getManifest().version,
        methods: Object.keys(this.options.handlers),
      };
      socket.send(JSON.stringify(hello));
      this.pingTimer = setInterval(() => {
        if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"ping"}');
      }, PING_INTERVAL_MS);
      this.options.onStateChange?.(true);
    });

    socket.addEventListener('message', (ev) => {
      void this.handleMessage(typeof ev.data === 'string' ? ev.data : '');
    });

    const onClose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      this.clearPing();
      this.options.onStateChange?.(false);
      this.scheduleReconnect();
    };
    socket.addEventListener('close', onClose);
    socket.addEventListener('error', () => {
      // 'close' follows; nothing to do here, the bridge is simply not running.
    });
  }

  private clearPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectDelay);
    this.reconnectDelay = Math.min(RECONNECT_MAX_MS, this.reconnectDelay * 2);
  }

  private async handleMessage(raw: string): Promise<void> {
    let message: BridgeToExtension | { type: 'pong' };
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (message.type !== 'call') return;
    const handler = this.options.handlers[message.method];
    if (!handler) {
      this.send({ type: 'result', id: message.id, ok: false, error: `unknown method: ${message.method}` });
      return;
    }
    try {
      const result = await handler(message.params ?? {});
      this.send({ type: 'result', id: message.id, ok: true, result: result ?? null });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.send({ type: 'result', id: message.id, ok: false, error });
    }
  }
}
