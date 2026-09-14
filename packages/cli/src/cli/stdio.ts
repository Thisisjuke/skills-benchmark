import { writeSync } from "node:fs";

/**
 * Keep CLI output observable when Skillbench is executed as a child process.
 *
 * Node stdout and stderr writes can be asynchronous when their destination is a
 * pipe. A short-lived CLI may otherwise exit before its final protocol event or
 * diagnostic has reached its parent process.
 */
export function writeStdout(value: string): void {
  writeSync(process.stdout.fd, value);
}

export function writeStderr(value: string): void {
  writeSync(process.stderr.fd, value);
}
