import { describe, expect, it } from "vitest";
import type { Terminal as XTerm } from "@xterm/xterm";

import { CommandTracker, stickyMarkAt, type CommandMark } from "./commands";

function mark(line: number, isDisposed = false): CommandMark {
  return { marker: { line, isDisposed }, text: `cmd@${line}` };
}

describe("stickyMarkAt", () => {
  it("returns null when there are no marks", () => {
    expect(stickyMarkAt([], 10)).toBeNull();
  });

  it("returns null when no command line is above the viewport", () => {
    expect(stickyMarkAt([mark(5), mark(9)], 5)).toBeNull();
    expect(stickyMarkAt([mark(5)], 0)).toBeNull();
  });

  it("returns the last command whose line is scrolled above the viewport", () => {
    const marks = [mark(2), mark(8), mark(20)];
    expect(stickyMarkAt(marks, 10)?.text).toBe("cmd@8");
    expect(stickyMarkAt(marks, 21)?.text).toBe("cmd@20");
    expect(stickyMarkAt(marks, 3)?.text).toBe("cmd@2");
  });

  it("hides while the command line itself is still visible at the top", () => {
    expect(stickyMarkAt([mark(8)], 8)).toBeNull();
    expect(stickyMarkAt([mark(2), mark(8)], 8)).toBeNull();
  });

  it("skips disposed marks", () => {
    expect(stickyMarkAt([mark(2), mark(8, true)], 10)?.text).toBe("cmd@2");
  });
});

interface FakeLine {
  text: string;
  wrapped?: boolean;
}

function fakeTerm(
  lines: FakeLine[],
  cursorRow: number,
  type: "normal" | "alternate" = "normal",
): XTerm {
  return {
    buffer: {
      active: {
        type,
        baseY: 0,
        cursorY: cursorRow,
        getLine: (i: number) =>
          lines[i] && {
            isWrapped: Boolean(lines[i].wrapped),
            translateToString: () => lines[i].text,
          },
      },
    },
    registerMarker: (offset = 0) => {
      let onDispose = () => {};
      const marker = {
        line: cursorRow + offset,
        isDisposed: false,
        dispose() {
          this.isDisposed = true;
          onDispose();
        },
        onDispose(cb: () => void) {
          onDispose = cb;
        },
      };
      return marker;
    },
  } as unknown as XTerm;
}

describe("CommandTracker.noteInput", () => {
  it("marks the prompt line when Enter is pressed", () => {
    const tracker = new CommandTracker(
      fakeTerm([{ text: "user@host:~$ ls -la" }], 0),
    );
    tracker.noteInput("\r");
    expect(tracker.stickyAt(1)?.text).toBe("user@host:~$ ls -la");
  });

  it("ignores non-Enter input and empty commands", () => {
    const tracker = new CommandTracker(
      fakeTerm([{ text: "user@host:~$ " }], 0),
    );
    tracker.noteInput("a");
    tracker.noteInput("\r");
    expect(tracker.stickyAt(5)).toBeNull();
  });

  it("walks back to the start of a soft-wrapped command line", () => {
    const tracker = new CommandTracker(
      fakeTerm(
        [
          { text: "user@host:~$ echo aaaaaaaaaa" },
          { text: "bbbbbbbbbb", wrapped: true },
        ],
        1,
      ),
    );
    tracker.noteInput("\r");
    expect(tracker.stickyAt(1)?.marker.line).toBe(0);
    expect(tracker.stickyAt(1)?.text).toBe("user@host:~$ echo aaaaaaaaaa");
  });

  it("ignores input while in the alternate buffer", () => {
    const tracker = new CommandTracker(
      fakeTerm([{ text: "user@host:~$ ls" }], 0, "alternate"),
    );
    tracker.noteInput("\r");
    expect(tracker.stickyAt(5)).toBeNull();
  });
});

describe("CommandTracker.noteCommand", () => {
  it("marks a programmatic command at the cursor line", () => {
    const tracker = new CommandTracker(fakeTerm([{ text: "" }], 3));
    tracker.noteCommand("df -h\n");
    const sticky = tracker.stickyAt(4);
    expect(sticky?.text).toBe("df -h");
    expect(sticky?.marker.line).toBe(3);
  });

  it("ignores blank commands", () => {
    const tracker = new CommandTracker(fakeTerm([{ text: "" }], 0));
    tracker.noteCommand("  \n");
    expect(tracker.stickyAt(5)).toBeNull();
  });

  it("clears marks on dispose", () => {
    const tracker = new CommandTracker(fakeTerm([{ text: "" }], 3));
    tracker.noteCommand("df -h");
    tracker.dispose();
    expect(tracker.stickyAt(10)).toBeNull();
  });
});
