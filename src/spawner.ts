import { spawn } from "child_process";
import os from "os";
import { exit } from "process";
import { parse, quote } from "shell-quote";

const isWin = process.platform === "win32";
const shellBinary = isWin ? "cmd.exe" : "/bin/bash";
const shellArgs = isWin ? ["/c"] : ["-lc"];

// /**
//  * Expands leading tilde references (~/foo) outside of quotes.
//  * Preserves quoted tildes so commands like `echo "~"` stay untouched.
//  */
// function expandTilde(command: string) {
//   const home = os.homedir();
//   if (!home) return command;

//   let result = "";
//   let inSingle = false;
//   let inDouble = false;

//   for (let i = 0; i < command.length; i++) {
//     const ch = command[i];

//     if (ch === "'" && !inDouble) {
//       inSingle = !inSingle;
//       result += ch;
//       continue;
//     }
//     if (ch === '"' && !inSingle) {
//       inDouble = !inDouble;
//       result += ch;
//       continue;
//     }

//     if (!inSingle && !inDouble && ch === "~") {
//       const prev = i === 0 ? "" : command[i - 1];
//       if (i === 0 || /\s/.test(prev)) {
//         const next = command[i + 1];
//         if (!next || next === "/" || next === "\\") {
//           result += home;
//           continue;
//         }
//       }
//     }

//     result += ch;
//   }

//   return result;
// }

const builtInCommands: Record<string, (args: string[]) => Promise<void>> = {
  cd: async (args: string[]) => {
    if (args.length === 1) {
      process.stdout.write(process.cwd() + "\n");
      return;
    }
    process.chdir(args[1]);
  },
  exit: async () => {
    exit(0);
  },
};

export async function runUserCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed) return;

  // const expandedCommand = expandTilde(command);
  // os.homedir()

  const args = parse(command, process.env);
  if (args.length === 0) return;
  if (typeof args[0] === "string" && builtInCommands[args[0]]) {
    await builtInCommands[args[0]](args as string[]);
    return;
  }

  // `as any` because the type system is wrong see:
  // https://github.com/ljharb/shell-quote/blob/699c5113d135f4d4591574bebf173334ffa453d4/quote.js#L4
  const commandWithVars = quote(args as any);
  const proc = spawn(shellBinary, [...shellArgs, commandWithVars], {
    stdio: ["ignore", "pipe", "pipe"],
    shell: true,
  });

  await new Promise<void>((resolve, reject) => {
    proc.stdout.on("data", (data) => process.stdout.write(data));
    proc.stderr.on("data", (data) => process.stderr.write(data));
    proc.on("error", reject);
    proc.on("close", () => resolve());
  });
}
