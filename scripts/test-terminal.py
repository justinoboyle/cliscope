#!/usr/bin/env python3
"""Exercise a real terminal, including an installed npm launcher.

Usage:
    python3 scripts/test-terminal.py node /tmp/install/node_modules/cliscope/dist/launcher.js --demo -i
    python3 scripts/test-terminal.py ./artifacts/cliscope --demo -i

Only synthetic demo data is allowed. Uses the Python standard library on POSIX;
Windows prints a skip because its console is not a POSIX pseudo-terminal.
"""

from __future__ import annotations

import argparse
import codecs
import errno
import os
import re
import select
import signal
import subprocess
import sys
import time
import unicodedata
from collections.abc import Callable


class Screen:
    """Minimal VT screen for the cursor-addressed output produced by OpenTUI.

    Interpret cursor movement and erasure instead of searching concatenated
    terminal updates: stale content must not make a failed interaction pass.
    Color, capability queries, and terminal string commands have no text cells.
    """

    def __init__(self, columns: int, rows: int) -> None:
        self.pending = ""
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.cells: list[list[str]] = []
        self.x = self.y = 0
        self.saved = (0, 0)
        self.updating = False
        self.frames = 0
        self.resize(columns, rows)

    def resize(self, columns: int, rows: int) -> None:
        # Resizing a terminal does not erase cells the renderer may leave alone.
        cells = [row[:columns] + [" "] * max(0, columns - len(row)) for row in self.cells[:rows]]
        cells.extend([[" "] * columns for _ in range(rows - len(cells))])
        self.columns, self.rows, self.cells = columns, rows, cells
        self.x, self.y = min(self.x, columns - 1), min(self.y, rows - 1)
        self.saved = (min(self.saved[0], columns - 1), min(self.saved[1], rows - 1))

    def text(self) -> str:
        return "\n".join("".join(row).rstrip() for row in self.cells)

    def erase(self, mode: int, line_only: bool) -> None:
        cursor = self.y * self.columns + min(self.x, self.columns - 1)
        start = self.y * self.columns if line_only else 0
        end = start + self.columns if line_only else self.rows * self.columns
        if mode == 0:
            start = cursor
        elif mode == 1:
            end = cursor + 1
        elif mode not in (2, 3):
            return
        for position in range(start, end):
            row, column = divmod(position, self.columns)
            self.cells[row][column] = " "

    def csi(self, parameters: str, final: str) -> None:
        if parameters == "?2026":
            self.updating = final == "h"
            if final == "l":
                self.frames += 1
            return
        if parameters.startswith(("?", ">", "<", "=")):
            return
        values = [int(value) if value.isdigit() else 0 for value in parameters.split(";")]
        first = values[0] or 1
        if final in ("H", "f"):
            self.y = min(self.rows - 1, first - 1)
            self.x = min(self.columns - 1, (values[1] or 1) - 1 if len(values) > 1 else 0)
            return
        positions = {
            "A": (self.x, max(0, self.y - first)),
            "B": (self.x, min(self.rows - 1, self.y + first)),
            "C": (min(self.columns - 1, self.x + first), self.y),
            "D": (max(0, self.x - first), self.y),
            "G": (min(self.columns - 1, first - 1), self.y),
            "d": (self.x, min(self.rows - 1, first - 1)),
            "u": self.saved,
        }
        if final in positions:
            self.x, self.y = positions[final]
        elif final in ("J", "K"):
            self.erase(values[0], line_only=final == "K")
        elif final == "s":
            self.saved = (self.x, self.y)

    def escape_length(self, index: int) -> int:
        """Consume one terminal command, or return zero for an incomplete one."""
        if index + 1 >= len(self.pending):
            return 0
        following = self.pending[index + 1]
        if following == "[":
            match = re.match(r"\x1b\[([0-?]*)([ -/]*)([@-~])", self.pending[index:])
            if not match:
                return 0
            self.csi(match[1], match[3])
            return len(match[0])
        if following in ("]", "P", "_", "^", "X"):
            terminator = re.search(r"\x07|\x1b\\", self.pending[index + 2:])
            return 2 + terminator.end() if terminator else 0
        return 2

    def advance_line(self) -> None:
        self.y += 1
        if self.y >= self.rows:
            self.cells.pop(0)
            self.cells.append([" "] * self.columns)
            self.y = self.rows - 1

    def write_glyph(self, character: str) -> None:
        if unicodedata.combining(character):
            if self.x > 0:
                self.cells[self.y][min(self.x - 1, self.columns - 1)] += character
            return
        width = 2 if unicodedata.east_asian_width(character) in ("W", "F") else 1
        if self.x < self.columns:
            self.cells[self.y][self.x] = character
        if width == 2 and self.x + 1 < self.columns:
            self.cells[self.y][self.x + 1] = ""
        self.x += width

    def write_character(self, character: str) -> None:
        if character == "\r":
            self.x = 0
            return
        if character == "\n":
            self.advance_line()
            return
        if character == "\b":
            self.x = max(0, self.x - 1)
            return
        if character < " " or unicodedata.category(character).startswith("C"):
            return
        self.write_glyph(character)

    def feed(self, data: bytes) -> None:
        self.pending += self.decoder.decode(data)
        index = 0
        while index < len(self.pending):
            if self.pending[index] == "\x1b":
                length = self.escape_length(index)
                if length == 0:
                    break
                index += length
            else:
                self.write_character(self.pending[index])
                index += 1
        self.pending = self.pending[index:]


class Terminal:
    def __init__(self, command: list[str]) -> None:
        import fcntl
        import pty
        import struct
        import termios

        self.screen = Screen(80, 28)
        self.output = bytearray()
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 28, 80, 0, 0))
        environment = {**os.environ, "TERM": "xterm-256color", "NO_COLOR": "1", "COLUMNS": "80", "LINES": "28"}
        try:
            self.process = subprocess.Popen(command, stdin=slave, stdout=slave, stderr=slave, env=environment, start_new_session=True)
        except BaseException:
            os.close(self.master)
            raise
        finally:
            os.close(slave)

    def read(self, timeout: float = 0.1) -> None:
        readable, _, _ = select.select([self.master], [], [], timeout)
        if not readable:
            return
        try:
            data = os.read(self.master, 65_536)
        except OSError as error:
            if error.errno == errno.EIO:  # Linux reports EIO when the slave closes.
                return
            raise
        self.output.extend(data)
        self.screen.feed(data)
        if len(self.output) > 4_000_000:
            raise AssertionError("Terminal output exceeded the 4 MB safety limit")

    def wait_for(self, predicate: Callable[[str], bool], description: str, timeout: float = 15, after_frame: int = -1) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.read()
            # A PTY read can end halfway through an atomic terminal frame.
            complete = not self.screen.updating and not self.screen.pending and self.screen.frames > after_frame
            if complete and predicate(self.screen.text()):
                return
            if self.process.poll() is not None:
                raise AssertionError(f"Process exited {self.process.returncode} while waiting for {description}\n{self.screen.text()}")
        raise AssertionError(f"Timed out waiting for {description}\n{self.screen.text()}")

    def send(self, value: bytes) -> None:
        os.write(self.master, value)

    def resize(self, columns: int, rows: int) -> int:
        import fcntl
        import struct
        import termios

        frame = self.screen.frames
        self.screen.resize(columns, rows)
        fcntl.ioctl(self.master, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
        os.killpg(self.process.pid, signal.SIGWINCH)
        return frame

    def expect_exit(self, allowed_codes: tuple[int, ...]) -> None:
        deadline = time.monotonic() + 10
        while self.process.poll() is None and time.monotonic() < deadline:
            self.read()
        if self.process.poll() is None:
            raise AssertionError("Process did not exit within ten seconds")
        self.read(0)
        if self.process.returncode not in allowed_codes:
            raise AssertionError(f"Unexpected exit code {self.process.returncode}\n{self.screen.text()}")
        if b"\x1b[?1049l" not in self.output:
            raise AssertionError("Exit did not restore the original terminal screen")

    def close(self) -> None:
        if self.process.poll() is None:
            os.killpg(self.process.pid, signal.SIGTERM)
            try:
                self.process.wait(timeout=1)
            except subprocess.TimeoutExpired:
                os.killpg(self.process.pid, signal.SIGKILL)
                self.process.wait(timeout=2)
        os.close(self.master)


def ready(screen: str) -> bool:
    return "474 invocations" in screen and "12 matches" in screen and "git" in screen


def docker_selected(screen: str) -> bool:
    return re.search(r"docker\s+\|\s+61 invocations\s+\|\s+12\.9%", screen) is not None


def compact_dashboard(screen: str) -> bool:
    lines = screen.split("\n")
    return (len(lines) == 14 and lines[2].startswith(" Filter: all tools")
            and "Source:" not in screen and "Selected tool" not in screen
            and "474 invocations" in screen and "docker" in screen and "12.9%" in screen)


def check_screen_resize() -> None:
    """Check cell preservation and fragmented synchronized frames without a PTY."""
    screen = Screen(80, 28)
    screen.feed(b"\x1b[?2026h\x1b[2;2Hretained\x1b[?2026l")
    screen.resize(44, 14)
    assert screen.cells[1][1:9] == list("retained")
    assert (screen.x, screen.y) == (9, 1)
    screen.resize(80, 28)
    screen.feed(b"\x1b[?2026h\x1b[24;2Hupdated tail")
    assert screen.updating and screen.frames == 1
    screen.feed(b"\x1b[?2026")
    assert screen.pending and screen.updating
    screen.feed(b"l")
    assert not screen.updating and screen.frames == 2
    assert "retained" in screen.text() and "updated tail" in screen.text()
    assert not compact_dashboard(screen.text())


def exercise(command: list[str]) -> None:
    terminal = Terminal(command)
    try:
        terminal.wait_for(ready, "initial demo dashboard")
        terminal.send(b"/docker\r")
        terminal.wait_for(lambda screen: "1 match" in screen and docker_selected(screen), "docker filter and exact invocation share")
        terminal.send(b"\x1b")
        terminal.wait_for(ready, "Escape restoring all tools")
        terminal.send(b"j\x1b[B")
        terminal.wait_for(docker_selected, "j and Down selecting the third tool")
        frame = terminal.resize(44, 14)
        terminal.wait_for(compact_dashboard, "narrow resized dashboard", after_frame=frame)
        frame = terminal.resize(80, 28)
        terminal.wait_for(lambda screen: "Source:" in screen and docker_selected(screen), "full-sized detail after resize", after_frame=frame)
        terminal.send(b"\t")
        terminal.wait_for(lambda screen: "Calendar / UTC" in screen and "2026-09" in screen and "Sun" in screen, "calendar view")
        terminal.send(b"\t")
        terminal.wait_for(lambda screen: "Weekdays / UTC" in screen and "Mean/day" in screen and "Sun" in screen, "weekday view")
        terminal.send(b"\t")
        terminal.wait_for(docker_selected, "tools view after cycling tabs")
        terminal.send(b"q")
        terminal.expect_exit((0,))
        print("PASS: filter, shares, Escape, j/arrows, resize, Tab views, q, terminal restoration")
    finally:
        terminal.close()

    terminal = Terminal(command)
    try:
        terminal.wait_for(ready, "second demo dashboard")
        terminal.send(b"\x03")
        terminal.expect_exit((0, 130))
        print("PASS: Ctrl+C exits and restores terminal")
    finally:
        terminal.close()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", nargs=argparse.REMAINDER)
    arguments = parser.parse_args()
    if not arguments.command or "--demo" not in arguments.command or not any(flag in arguments.command for flag in ("-i", "--interactive")):
        parser.error("supply COMMAND [args...] including --demo and -i; real shell history is never used")
    if os.name != "posix":
        print("SKIP: terminal regression requires a POSIX pseudo-terminal")
        return 0
    try:
        check_screen_resize()
        exercise(arguments.command)
    except (AssertionError, OSError, subprocess.SubprocessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
