import * as p from "@clack/prompts";
import type { DatabaseConfig } from "../config/schema.js";
import {
  resolveDefaultEmbeddedPostgresDir,
  resolvePaperclipInstanceId,
} from "../config/home.js";

export async function promptDatabase(current?: DatabaseConfig): Promise<DatabaseConfig> {
  const instanceId = resolvePaperclipInstanceId();
  const defaultEmbeddedDir = resolveDefaultEmbeddedPostgresDir(instanceId);
  const base: DatabaseConfig = current ?? {
    mode: "embedded-postgres",
    embeddedPostgresDataDir: defaultEmbeddedDir,
    embeddedPostgresPort: 54329,
  };

  const mode = await p.select({
    message: "Database mode",
    options: [
      { value: "embedded-postgres" as const, label: "Embedded PostgreSQL (managed locally)", hint: "recommended" },
      { value: "postgres" as const, label: "PostgreSQL (external server)" },
    ],
    initialValue: base.mode,
  });

  if (p.isCancel(mode)) {
    p.cancel("Setup cancelled.");
    process.exit(0);
  }

  let connectionString: string | undefined = base.connectionString;
  let embeddedPostgresDataDir = base.embeddedPostgresDataDir || defaultEmbeddedDir;
  let embeddedPostgresPort = base.embeddedPostgresPort || 54329;

  if (mode === "postgres") {
    const value = await p.text({
      message: "PostgreSQL connection string",
      defaultValue: base.connectionString ?? "",
      placeholder: "postgres://user:pass@localhost:5432/paperclip",
      validate: (val) => {
        if (!val) return "Connection string is required for PostgreSQL mode";
        if (!val.startsWith("postgres")) return "Must be a postgres:// or postgresql:// URL";
      },
    });

    if (p.isCancel(value)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    connectionString = value;
  } else {
    const dataDir = await p.text({
      message: "Embedded PostgreSQL data directory",
      defaultValue: base.embeddedPostgresDataDir || defaultEmbeddedDir,
      placeholder: defaultEmbeddedDir,
    });

    if (p.isCancel(dataDir)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    embeddedPostgresDataDir = dataDir || defaultEmbeddedDir;

    const portValue = await p.text({
      message: "Embedded PostgreSQL port",
      defaultValue: String(base.embeddedPostgresPort || 54329),
      placeholder: "54329",
      validate: (val) => {
        const n = Number(val);
        if (!Number.isInteger(n) || n < 1 || n > 65535) return "Port must be an integer between 1 and 65535";
      },
    });

    if (p.isCancel(portValue)) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    embeddedPostgresPort = Number(portValue || "54329");
    connectionString = undefined;
  }

  return {
    mode,
    connectionString,
    embeddedPostgresDataDir,
    embeddedPostgresPort,
  };
}
