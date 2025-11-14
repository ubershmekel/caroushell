import { spawn } from "child_process";
import { exit } from "process";

const isWin = process.platform === "win32";
const shellBinary = isWin ? "cmd.exe" : "/bin/bash";
const shellArgs = isWin ? ["/c"] : ["-lc"];

const builtInCommands: Record<string, (args: string[]) => Promise<void>> = {
  cd: async (args: string[]) => {
    if (args.length === 1) {
      process.stdout.write(process.cwd() + "\n");
      return;
    }
    const dest = expandVars(args[1]);
    try {
      process.chdir(dest);
    } catch (err: any) {
      process.stderr.write(`cd: ${err.message}\n`);
    }
  },
  exit: async () => {
    exit(0);
  },
};

function expandVars(input: string): string {
  let out = input;
  if (isWin) {
    // cmd-style %VAR% expansion
    out = out.replace(/%([^%]+)%/g, (_m, name) => {
      const v = process.env[String(name)];
      return v !== undefined ? v : "";
    });
  } else {
    // POSIX-style $VAR and ${VAR} expansion
    out = out.replace(/\$(\w+)|\${(\w+)}/g, (_m, a, b) => {
      const name = a || b;
      const v = process.env[name];
      return v !== undefined ? v : "";
    });
  }
  return out;
}

export async function runUserCommand(command: string) {
  const trimmed = command.trim();
  if (!trimmed) return;

  const args = command.split(/\s+/);
  if (typeof args[0] === "string" && builtInCommands[args[0]]) {
    await builtInCommands[args[0]](args as string[]);
    return;
  }

  const proc = spawn(shellBinary, [...shellArgs, command], {
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
