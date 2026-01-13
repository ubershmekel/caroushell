import { spawn } from "child_process";
import { exit } from "process";
import { logLine } from "./logs";

const isWin = process.platform === "win32";
const shellBinary = isWin ? "cmd.exe" : "/bin/bash";
const shellArgs = isWin ? ["/d", "/s", "/c"] : ["-lc"];
const dirStack: string[] = [];
// Track last-known cwd per drive so `E:` switches like cmd.exe
// into the folder you were in before switching drives.
const driveCwds: Record<string, string> = {};

function updateDriveCwd(cwd = process.cwd()) {
  if (!isWin) return;
  const drive = cwd.slice(0, 2).toUpperCase();
  if (/^[A-Z]:$/.test(drive)) {
    driveCwds[drive] = cwd;
  }
}

const builtInCommands: Record<string, (args: string[]) => Promise<boolean>> = {
  cd: async (args: string[]) => {
    if (args.length === 1) {
      process.stdout.write(process.cwd() + "\n");
      return true;
    }
    const dest = expandVars(args[1]);
    try {
      process.chdir(dest);
      updateDriveCwd();
    } catch (err: any) {
      process.stderr.write(`cd: ${err.message}\n`);
      return false;
    }
    return true;
  },
  pushd: async (args: string[]) => {
    const current = process.cwd();
    if (args.length === 1) {
      const next = dirStack.shift();
      if (!next) {
        process.stderr.write("pushd: no other directory\n");
        return false;
      }
      dirStack.unshift(current);
      try {
        process.chdir(next);
        updateDriveCwd();
      } catch (err: any) {
        process.stderr.write(`pushd: ${err.message}\n`);
        dirStack.shift();
        return false;
      }
      writeDirStack();
      return true;
    }
    const dest = expandVars(args[1]);
    try {
      process.chdir(dest);
      updateDriveCwd();
    } catch (err: any) {
      process.stderr.write(`pushd: ${err.message}\n`);
      return false;
    }
    dirStack.unshift(current);
    writeDirStack();
    return true;
  },
  popd: async () => {
    const next = dirStack.shift();
    if (!next) {
      process.stderr.write("popd: directory stack empty\n");
      return false;
    }
    try {
      process.chdir(next);
      updateDriveCwd();
    } catch (err: any) {
      process.stderr.write(`popd: ${err.message}\n`);
      return false;
    }
    writeDirStack();
    return true;
  },
  exit: async () => {
    exit(0);
    return false;
  },
};

function writeDirStack() {
  const parts = [process.cwd(), ...dirStack];
  process.stdout.write(parts.join(" ") + "\n");
}

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
  logLine(`Running command: ${command}`);
  const trimmed = command.trim();
  if (!trimmed) return false;

  if (isWin && /^[a-zA-Z]:$/.test(trimmed)) {
    // Windows drive switch (eg "E:") should restore that drive's last cwd.
    const drive = trimmed.toUpperCase();
    const target = driveCwds[drive] ?? `${drive}\\`;
    try {
      process.chdir(target);
      updateDriveCwd();
      return true;
    } catch (err: any) {
      process.stderr.write(`${trimmed}: ${err.message}\n`);
      return false;
    }
  }

  const args = command.split(/\s+/);
  if (typeof args[0] === "string" && builtInCommands[args[0]]) {
    return await builtInCommands[args[0]](args as string[]);
  }

  // "windowsVerbatimArguments: true" to prevent the bug of `echo "asdf"` outputting
  // \"asdf\" instead of "asdf". I wonder why node defaults to quoting args on windows.
  const proc = spawn(shellBinary, [...shellArgs, command], {
    stdio: "inherit",
    windowsVerbatimArguments: true,
  });

  await new Promise<void>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", () => resolve());
  });
  // Why save failed commands? Well eg sometimes we want to run a test
  // many times until we fix it.
  return true;
}

updateDriveCwd();
