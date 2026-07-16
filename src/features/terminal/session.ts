import type { ITheme, Terminal as XTerm } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import type { SearchAddon } from "@xterm/addon-search";

import { errorCode, errorMessage } from "@/lib/toast";
import type { TerminalStatus } from "@/workbench/tabs";
import { CommandTracker } from "./commands";
import { hasHostKeyPrompt, useHostKeyStore } from "./host-key";
import { attachImagePaste } from "./paste";
import { hasPasswordPrompt, usePasswordPromptStore } from "./password-prompt";
import type { TerminalStatusUpdate, TerminalTransport } from "./transport";
import { attachWebglRenderer, createTerminal } from "./xterm";

const CONNECT_TIMEOUT_MS = 45_000;
const COLUMN_RESIZE_DEBOUNCE_MS = 100;

export interface SessionStatusEvent {
  status: TerminalStatus;
  code?: string | null;
  message?: string;
}

export interface TerminalSessionOptions {
  id: string;
  connectionKey: string;
  transport: TerminalTransport;
  fontFamily: string;
  fontSize: number;
  theme: ITheme;
  watchHostKey: boolean;
  imagePaste: boolean;
  onStatus: (event: SessionStatusEvent) => void;
  onUserInput?: (data: string) => void;
  onDispose?: () => void;
}

export class TerminalSession {
  readonly term: XTerm;
  readonly search: SearchAddon;
  readonly commands: CommandTracker;
  readonly connectionKey: string;

  private readonly fit: FitAddon;
  private readonly transport: TerminalTransport;
  private readonly opts: TerminalSessionOptions;
  private readonly disposables: Array<() => void> = [];

  private container: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;

  private disposed = false;
  private ended = false;
  private connectSettled = false;
  private inputReady = false;
  private pendingInput = "";
  private sendingInput = false;

  private watchdog: ReturnType<typeof setTimeout> | undefined;
  private colsTimer: ReturnType<typeof setTimeout> | undefined;
  private fitQueued = false;
  private opened = false;
  private opening = false;
  private pendingFocus = false;

  constructor(opts: TerminalSessionOptions) {
    this.opts = opts;
    this.connectionKey = opts.connectionKey;
    this.transport = opts.transport;

    const { term, fit, search } = createTerminal({
      fontFamily: opts.fontFamily,
      fontSize: opts.fontSize,
      theme: opts.theme,
    });
    this.term = term;
    this.fit = fit;
    this.search = search;
    this.commands = new CommandTracker(term);

    const dataSub = term.onData((data) => {
      this.send(data);
      opts.onUserInput?.(data);
    });
    const resizeSub = term.onResize(({ cols, rows }) => {
      if (this.inputReady && !this.ended) {
        void this.transport.resize(cols, rows).catch(() => {});
      }
    });
    this.disposables.push(
      () => dataSub.dispose(),
      () => resizeSub.dispose(),
    );
  }

  attach(container: HTMLElement) {
    if (this.disposed || this.container === container) return;
    if (this.container) this.detach();
    this.container = container;
    if (this.opened) {
      const element = this.term.element;
      if (element) container.appendChild(element);
      this.observe(container);
      this.refit();
      return;
    }
    if (!this.opening) {
      this.opening = true;
      void this.open();
    }
  }

  detach() {
    if (!this.container) return;
    this.observer?.disconnect();
    this.observer = null;
    this.container = null;
  }

  private async open() {
    try {
      try {
        await document.fonts.load(
          `${this.term.options.fontSize ?? 13}px ${this.term.options.fontFamily}`,
        );
      } catch {}
      if (this.disposed || this.opened || !this.container) return;

      const container = this.container;
      this.term.open(container);
      attachWebglRenderer(this.term);
      if (this.opts.imagePaste) {
        this.disposables.push(attachImagePaste(this.term));
      }
      try {
        this.fit.fit();
      } catch {}
      this.opened = true;
      if (this.pendingFocus) {
        this.pendingFocus = false;
        this.term.focus();
      }
      this.observe(container);
      void this.start();
    } catch (err) {
      if (!this.disposed) {
        this.ended = true;
        this.emitStatus({
          status: "error",
          code: errorCode(err),
          message: errorMessage(err),
        });
      }
    } finally {
      this.opening = false;
    }
  }

  refit() {
    if (this.disposed || !this.container) return;
    try {
      this.fit.fit();
    } catch {}
    this.term.refresh(0, this.term.rows - 1);
  }

  send(data: string) {
    this.commands.noteInput(data);
    this.pendingInput += data;
    this.flushInput();
  }

  sendCommand(command: string) {
    this.commands.noteCommand(command);
    this.send(command.endsWith("\n") ? command : `${command}\n`);
  }

  focus() {
    if (!this.opened) {
      this.pendingFocus = true;
      return;
    }
    this.term.focus();
  }

  setFontSize(size: number) {
    this.term.options.fontSize = size;
    if (!this.container) return;
    try {
      this.fit.fit();
    } catch {}
  }

  setFontFamily(family: string) {
    if (family === this.term.options.fontFamily) return;
    this.term.options.fontFamily = family;
    if (!this.container) return;
    try {
      this.fit.fit();
    } catch {}
    this.term.refresh(0, this.term.rows - 1);
  }

  setTheme(theme: ITheme) {
    this.term.options.theme = theme;
  }

  readContext(maxLines = 60): string | undefined {
    const buf = this.term.buffer.active;
    const start = Math.max(0, buf.length - maxLines);
    const lines: string[] = [];
    for (let i = start; i < buf.length; i++) {
      const line = buf.getLine(i);
      if (line) lines.push(line.translateToString(true));
    }
    const text = lines.join("\n").replace(/\s+$/, "");
    return text || undefined;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pendingInput = "";
    this.clearWatchdog();
    clearTimeout(this.colsTimer);
    this.observer?.disconnect();
    this.observer = null;
    for (const dispose of this.disposables.splice(0)) dispose();
    void this.transport.disconnect().catch(() => {});
    try {
      this.opts.onDispose?.();
    } finally {
      this.commands.dispose();
      this.term.dispose();
    }
  }

  private async start() {
    let unData: (() => void) | undefined;
    let unStatus: (() => void) | undefined;
    try {
      unData = await this.transport.onData((bytes) => {
        if (!this.disposed && !this.ended) this.term.write(bytes);
      });
      unStatus = await this.transport.onStatus((e) => this.handleStatus(e));
    } catch (err) {
      unData?.();
      unStatus?.();
      if (!this.disposed) {
        this.ended = true;
        this.pendingInput = "";
        this.emitStatus({
          status: "error",
          code: errorCode(err),
          message: errorMessage(err),
        });
      }
      return;
    }
    if (this.disposed) {
      unData();
      unStatus();
      return;
    }
    this.disposables.push(unData, unStatus);

    this.emitStatus({ status: "connecting" });
    if (this.opts.watchHostKey) this.watchConnectionPrompts();
    this.armWatchdog();

    try {
      await this.transport.connect({
        cols: this.term.cols,
        rows: this.term.rows,
      });
      if (this.disposed || this.ended) return;
    } catch (err) {
      this.settleConnect();
      this.ended = true;
      this.pendingInput = "";
      if (!this.disposed) {
        this.emitStatus({
          status: "error",
          code: errorCode(err),
          message: errorMessage(err),
        });
      }
    }
  }

  private handleStatus(e: TerminalStatusUpdate) {
    if (this.disposed || this.ended) return;
    if (e.status !== "connecting") this.settleConnect();
    if (e.status === "connected") {
      this.inputReady = true;
      void this.transport
        .resize(this.term.cols, this.term.rows)
        .catch(() => {});
      this.flushInput();
    } else if (e.status === "closed" || e.status === "error") {
      this.ended = true;
      this.inputReady = false;
      this.pendingInput = "";
    }
    this.emitStatus(e);
  }

  private emitStatus(event: SessionStatusEvent) {
    this.opts.onStatus(event);
  }

  private flushInput() {
    if (
      !this.inputReady ||
      this.sendingInput ||
      this.disposed ||
      this.ended ||
      this.pendingInput.length === 0
    ) {
      return;
    }
    const data = this.pendingInput;
    this.pendingInput = "";
    this.sendingInput = true;
    void this.transport
      .send(data)
      .catch(() => {})
      .finally(() => {
        this.sendingInput = false;
        this.flushInput();
      });
  }

  private armWatchdog() {
    this.clearWatchdog();
    if (this.opts.watchHostKey && this.hasConnectionPrompt()) return;
    this.watchdog = setTimeout(() => {
      if (this.disposed || this.connectSettled) return;
      this.ended = true;
      this.pendingInput = "";
      this.emitStatus({ status: "error", code: "timeout" });
      void this.transport.disconnect().catch(() => {});
    }, CONNECT_TIMEOUT_MS);
  }

  private clearWatchdog() {
    clearTimeout(this.watchdog);
    this.watchdog = undefined;
  }

  private settleConnect() {
    this.connectSettled = true;
    this.clearWatchdog();
  }

  private hasConnectionPrompt() {
    return hasHostKeyPrompt(this.opts.id) || hasPasswordPrompt(this.opts.id);
  }

  private watchConnectionPrompts() {
    let prompted = this.hasConnectionPrompt();
    const update = () => {
      const pending = this.hasConnectionPrompt();
      if (pending === prompted) return;
      prompted = pending;
      if (this.disposed || this.connectSettled || this.ended) return;
      if (pending) this.clearWatchdog();
      else this.armWatchdog();
    };
    this.disposables.push(
      useHostKeyStore.subscribe(update),
      usePasswordPromptStore.subscribe(update),
    );
  }

  private scheduleFit() {
    if (this.fitQueued) return;
    this.fitQueued = true;
    setTimeout(() => {
      this.fitQueued = false;
      if (!this.disposed) this.fitNow();
    }, 0);
  }

  private observe(container: HTMLElement) {
    this.observer?.disconnect();
    this.observer = new ResizeObserver(() => this.scheduleFit());
    this.observer.observe(container);
  }

  private fitNow() {
    const el = this.container;
    if (!el || el.clientWidth === 0 || el.clientHeight === 0) return;
    const dims = this.fit.proposeDimensions();
    if (!dims || !(dims.cols > 0) || !(dims.rows > 0)) return;
    if (dims.rows !== this.term.rows) {
      this.applyDims(this.term.cols, dims.rows);
    }
    if (dims.cols !== this.term.cols) {
      clearTimeout(this.colsTimer);
      const cols = dims.cols;
      this.colsTimer = setTimeout(() => {
        if (!this.disposed) this.applyDims(cols, this.term.rows);
      }, COLUMN_RESIZE_DEBOUNCE_MS);
    }
  }

  private applyDims(cols: number, rows: number) {
    if (cols === this.term.cols && rows === this.term.rows) return;
    this.term.resize(cols, rows);
    this.term.refresh(0, this.term.rows - 1);
  }
}
