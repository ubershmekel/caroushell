import { spawn } from "child_process";
import { exit } from "process";

const isWin = process.platform === "win32";
const shellBinary = isWin ? "cmd.exe" : "/bin/bash";
const shellArgs = isWin ? ["/c"] : ["-lc"];

const builtInCommands: Record<string, (args: string[]) => Promise<boolean>> = {
  cd: async (args: string[]) => {
    if (args.length === 1) {
      process.stdout.write(process.cwd() + "\n");
      return true;
    }
    const dest = expandVars(args[1]);
    try {
      process.chdir(dest);
    } catch (err: any) {
      process.stderr.write(`cd: ${err.message}\n`);
      return false;
    }
    return true;
  },
  exit: async () => {
    exit(0);
    return false;
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

export async function runUserCommand(command: string): Promise<boolean> {
  const trimmed = command.trim();
  if (!trimmed) return false;

  const args = command.split(/\s+/);
  if (typeof args[0] === "string" && builtInCommands[args[0]]) {
    return await builtInCommands[args[0]](args as string[]);
  }

  // "shell: true" to prevent the bug of `echo "asdf"` outputting
  // \"Asdf\" instead of "Asdf"
  const proc = spawn(shellBinary, [...shellArgs, command], {
    stdio: "inherit",
    shell: true,
  });

  await new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", () => resolve());
  });
  // Why save failed commands? Well eg sometimes we want to run a test
  // many times until we fix it.
  return true;
}
