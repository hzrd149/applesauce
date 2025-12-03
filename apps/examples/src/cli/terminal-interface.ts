/** Terminal interface abstraction for both Node.js and browser environments */
import { type Terminal } from "@xterm/xterm";

// Check if we're in a browser environment
const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

export interface TerminalInterface {
  write(data: string): void;
  clear(): void;
  prompt(question: string): Promise<string>;
  onData(callback: (data: string) => void): void;
  exit(code?: number): void;
  dispose(): void;
}

export class NodeTerminalInterface implements TerminalInterface {
  private readline: any;
  private rl: any;

  constructor() {
    this.readline = require("readline");
    this.rl = this.readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }

  write(data: string, nl = true): void {
    process.stdout.write(data);
    if (nl) process.stdout.write("\n");
  }

  clear(): void {
    console.clear();
  }

  prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.rl.question(question + " ", resolve);
    });
  }

  onData(callback: (data: string) => void): void {
    process.stdin.on("data", (data: Buffer) => {
      callback(data.toString());
    });
  }

  exit(code: number = 0): void {
    process.exit(code);
  }

  dispose(): void {
    this.rl.close();
  }
}

export class BrowserTerminalInterface implements TerminalInterface {
  private terminal: Terminal | null = null;
  private currentPromptResolve: ((value: string) => void) | null = null;
  private inputBuffer = "";
  private isPrompting = false;

  constructor(container: HTMLElement) {
    // Dynamically import xterm only in browser
    this.initializeXterm(container);
  }

  private async initializeXterm(container: HTMLElement) {
    const { Terminal } = await import("@xterm/xterm");

    this.terminal = new Terminal({
      theme: {
        background: "#1e1e1e",
        foreground: "#ffffff",
        cursor: "#ffffff",
      },
      fontSize: 14,
      fontFamily: "Monaco, Menlo, 'Ubuntu Mono', monospace",
      cursorBlink: true,
      rows: 60,
      cols: 120,
    });

    this.terminal.open(container);

    // Handle input
    this.terminal.onData((data: string) => {
      if (this.isPrompting) {
        if (data === "\r" || data === "\n") {
          // Enter pressed
          this.terminal!.writeln("");
          const result = this.inputBuffer;
          this.inputBuffer = "";
          this.isPrompting = false;
          if (this.currentPromptResolve) {
            this.currentPromptResolve(result);
            this.currentPromptResolve = null;
          }
        } else if (data === "\u007F" || data === "\b") {
          // Backspace
          if (this.inputBuffer.length > 0) {
            this.inputBuffer = this.inputBuffer.slice(0, -1);
            this.terminal!.write("\b \b");
          }
        } else if (data >= " " || data === "\t") {
          // Printable characters
          this.inputBuffer += data;
          this.terminal!.write(data);
        }
      }
    });

    // Make terminal focusable
    this.terminal.focus();
  }

  write(data: string): void {
    if (this.terminal) {
      for (const line of data.split("\n")) this.terminal.writeln(line);
    }
  }

  clear(): void {
    if (this.terminal) this.terminal.clear();
  }

  prompt(question: string): Promise<string> {
    return new Promise((resolve) => {
      this.write(question + " ");
      this.currentPromptResolve = resolve;
      this.isPrompting = true;
      this.inputBuffer = "";
    });
  }

  onData(callback: (data: string) => void): void {
    if (this.terminal) this.terminal.onData(callback);
  }

  exit(code: number = 0): void {
    if (this.terminal) this.terminal.write("Exit: " + code);
  }

  dispose(): void {
    if (this.terminal) this.terminal.dispose();
  }
}

let terminal: TerminalInterface | null = null;

// Sets the global terminal interface
export function setTerminalInterface(term: TerminalInterface) {
  terminal = term;
}

// If we started in node, set the global terminal interface
if (!isBrowser) setTerminalInterface(new NodeTerminalInterface());

// Method for examples to get the interface
export function getTerminalInterface(): TerminalInterface {
  if (!terminal) throw new Error("Terminal interface not set");
  return terminal;
}
