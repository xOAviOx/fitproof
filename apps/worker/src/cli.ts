import { createDb, type Database } from "@repo/db";
import pino, { type Logger } from "pino";
import { selftest } from "./commands/selftest";
import { parseWorkerEnv } from "./env";

type Command = { description: string; run: (db: Database, logger: Logger) => Promise<unknown> };

const COMMANDS: Record<string, Command> = {
  selftest: { description: "Check database connectivity and record a run in job_runs", run: selftest },
};

function usage(): string {
  const lines = Object.entries(COMMANDS).map(
    ([name, command]) => `  ${name.padEnd(12)}${command.description}`,
  );
  return ["Usage: pnpm worker <command>", "", "Commands:", ...lines].join("\n");
}

async function main(argv: string[]): Promise<number> {
  const name = argv[0];
  if (!name || name === "--help" || name === "-h") {
    console.log(usage());
    return name ? 0 : 1;
  }
  const command = COMMANDS[name];
  if (!command) {
    console.error(`Unknown command "${name}".\n\n${usage()}`);
    return 1;
  }

  const env = parseWorkerEnv(process.env);
  const logger = pino({ level: env.LOG_LEVEL, base: { app: "worker", command: name } });
  const { db, close } = createDb(env.DATABASE_URL, { max: 2 });
  try {
    await command.run(db, logger);
    return 0;
  } catch (error) {
    logger.error({ err: error }, "command failed");
    return 1;
  } finally {
    await close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
