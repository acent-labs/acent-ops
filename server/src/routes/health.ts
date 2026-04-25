import { Router } from "express";
import type { Db } from "@paperclipai/db";
import { and, count, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { heartbeatRuns, instanceUserRoles, invites } from "@paperclipai/db";
import type { DeploymentExposure, DeploymentMode } from "@paperclipai/shared";
import { readPersistedDevServerStatus, toDevServerHealthStatus } from "../dev-server-status.js";
import { logger } from "../middleware/logger.js";
import { instanceSettingsService } from "../services/instance-settings.js";
import { serverVersion } from "../version.js";
import type { AuthProviderFlags } from "../auth/better-auth.js";

const DEFAULT_HEALTH_DATABASE_PROBE_TIMEOUT_MS = 5_000;

function shouldExposeFullHealthDetails(
  actorType: "none" | "board" | "agent" | null | undefined,
  deploymentMode: DeploymentMode,
) {
  if (deploymentMode !== "authenticated") return true;
  return actorType === "board" || actorType === "agent";
}

function resolveHealthTimeoutMs(value: unknown): number {
  if (typeof value !== "string") return DEFAULT_HEALTH_DATABASE_PROBE_TIMEOUT_MS;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_HEALTH_DATABASE_PROBE_TIMEOUT_MS;
}

function withHealthTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function healthRoutes(
  db?: Db,
  opts: {
    deploymentMode: DeploymentMode;
    deploymentExposure: DeploymentExposure;
    authReady: boolean;
    authProviders?: AuthProviderFlags;
    companyDeletionEnabled: boolean;
    databaseProbeTimeoutMs?: number;
  } = {
    deploymentMode: "local_trusted",
    deploymentExposure: "private",
    authReady: true,
    authProviders: { google: false },
    companyDeletionEnabled: true,
  },
) {
  const router = Router();
  const databaseProbeTimeoutMs =
    opts.databaseProbeTimeoutMs ?? resolveHealthTimeoutMs(process.env.PAPERCLIP_HEALTH_DB_TIMEOUT_MS);

  router.get("/", async (req, res) => {
    const actorType = "actor" in req ? req.actor?.type : null;
    const exposeFullDetails = shouldExposeFullHealthDetails(
      actorType,
      opts.deploymentMode,
    );

    if (!db) {
      res.json(
        exposeFullDetails
          ? { status: "ok", version: serverVersion }
          : { status: "ok", deploymentMode: opts.deploymentMode },
      );
      return;
    }

    try {
      await withHealthTimeout(
        db.execute(sql`SELECT 1`),
        databaseProbeTimeoutMs,
        "database_probe",
      );
    } catch (error) {
      logger.warn({ err: error }, "Health check database probe failed");
      res.status(503).json({
        status: "unhealthy",
        version: serverVersion,
        error: error instanceof Error && error.message === "database_probe_timeout"
          ? "database_timeout"
          : "database_unreachable",
      });
      return;
    }

    try {
      let bootstrapStatus: "ready" | "bootstrap_pending" = "ready";
      let bootstrapInviteActive = false;
      if (opts.deploymentMode === "authenticated") {
        const roleCount = await withHealthTimeout(
          db
            .select({ count: count() })
            .from(instanceUserRoles)
            .where(sql`${instanceUserRoles.role} = 'instance_admin'`)
            .then((rows) => Number(rows[0]?.count ?? 0)),
          databaseProbeTimeoutMs,
          "bootstrap_status_probe",
        );
        bootstrapStatus = roleCount > 0 ? "ready" : "bootstrap_pending";

        if (bootstrapStatus === "bootstrap_pending") {
          const now = new Date();
          const inviteCount = await withHealthTimeout(
            db
              .select({ count: count() })
              .from(invites)
              .where(
                and(
                  eq(invites.inviteType, "bootstrap_ceo"),
                  isNull(invites.revokedAt),
                  isNull(invites.acceptedAt),
                  gt(invites.expiresAt, now),
                ),
              )
              .then((rows) => Number(rows[0]?.count ?? 0)),
            databaseProbeTimeoutMs,
            "bootstrap_invite_probe",
          );
          bootstrapInviteActive = inviteCount > 0;
        }
      }

      const persistedDevServerStatus = readPersistedDevServerStatus();
      let devServer: ReturnType<typeof toDevServerHealthStatus> | undefined;
      if (persistedDevServerStatus && typeof (db as { select?: unknown }).select === "function") {
        try {
          const instanceSettings = instanceSettingsService(db);
          const experimentalSettings = await withHealthTimeout(
            instanceSettings.getExperimental(),
            databaseProbeTimeoutMs,
            "dev_server_settings_probe",
          );
          const activeRunRows = await withHealthTimeout(
            db
              .select({ id: heartbeatRuns.id })
              .from(heartbeatRuns)
              .where(inArray(heartbeatRuns.status, ["queued", "running"]))
              .limit(1),
            databaseProbeTimeoutMs,
            "dev_server_active_runs_probe",
          );

          devServer = toDevServerHealthStatus(persistedDevServerStatus, {
            autoRestartEnabled: experimentalSettings.autoRestartDevServerWhenIdle ?? false,
            activeRunCount: activeRunRows.length,
          });
        } catch (error) {
          logger.warn({ err: error }, "Health check dev server metadata probe skipped");
        }
      }

      if (!exposeFullDetails) {
        res.json({
          status: "ok",
          deploymentMode: opts.deploymentMode,
          authProviders: opts.authProviders ?? { google: false },
          bootstrapStatus,
          bootstrapInviteActive,
        });
        return;
      }

      res.json({
        status: "ok",
        version: serverVersion,
        deploymentMode: opts.deploymentMode,
        deploymentExposure: opts.deploymentExposure,
        authReady: opts.authReady,
        authProviders: opts.authProviders ?? { google: false },
        bootstrapStatus,
        bootstrapInviteActive,
        features: {
          companyDeletionEnabled: opts.companyDeletionEnabled,
        },
        ...(devServer ? { devServer } : {}),
      });
    } catch (error) {
      logger.warn({ err: error }, "Health check metadata probe failed");
      res.status(503).json({
        status: "unhealthy",
        version: serverVersion,
        error: error instanceof Error && error.message.endsWith("_timeout")
          ? "database_timeout"
          : "database_unreachable",
      });
    }
  });

  return router;
}
