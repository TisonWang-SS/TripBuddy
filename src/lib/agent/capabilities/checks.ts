import { argsBag, optionalEnum, requireString } from "@/lib/agent/args";
import { instant } from "@/lib/agent/serialize";
import type { Capability } from "@/lib/agent/types";
import { createAccountImportTask } from "@/lib/accountImportTasks";
import { currentLocalDayAsCalendarDate } from "@/lib/bookingDates";
import { HOTEL_GROUPS } from "@/lib/constants";
import { prisma } from "@/lib/db";
import { BrowserCompanionPriceCheckRunner, type BrowserTaskLaunch } from "@/lib/priceChecks";
import { buildDuePriceCheckQueue } from "@/lib/watchQueue";

const TRIGGERS = ["manual", "due_queue"] as const;

export type DueCheck = {
  bookingId: string;
  cadenceHours: number;
  consecutiveFailures: number;
  hotelName: string;
  nextCheckAt: string;
  retryDelayHours: number;
  urgency: string;
};

export const listDueChecks: Capability<Record<string, never>, { due: DueCheck[] }> = {
  name: "list_due_checks",
  summary: "List bookings whose price check is due, with cadence and retry state.",
  effect: "read",
  params: [],
  parseArgs(raw) {
    argsBag(raw, []);
    return {};
  },
  async run() {
    const now = new Date();
    const bookings = await prisma.hotelBooking.findMany({
      where: { checkIn: { gte: currentLocalDayAsCalendarDate(now) } },
      include: {
        priceCheckRuns: { where: { expiresAt: { gt: now }, status: "running" }, select: { id: true }, take: 1 },
        watchPlan: true
      }
    });

    /* Same derivation the desk uses, so the agent and the page never disagree. */
    const due = buildDuePriceCheckQueue(
      bookings.map(({ priceCheckRuns, ...booking }) => ({ ...booking, hasActiveRun: priceCheckRuns.length > 0 })),
      now
    );

    return {
      due: due.map((item) => ({
        bookingId: item.bookingId,
        cadenceHours: item.cadenceHours,
        consecutiveFailures: item.consecutiveFailures,
        hotelName: item.hotelName,
        nextCheckAt: item.nextCheckAt.toISOString(),
        retryDelayHours: item.retryDelayHours,
        urgency: item.urgency
      }))
    };
  }
};

export const runPriceCheck: Capability<{ bookingId: string; trigger: "manual" | "due_queue" }, BrowserTaskLaunch> = {
  name: "run_price_check",
  summary: "Open a Hyatt tab and collect current price evidence for one booking.",
  effect: "browser_task",
  params: [
    { description: "The booking identifier.", name: "bookingId", required: true, type: "string" },
    {
      description: "Where the check was started from. Defaults to manual.",
      enumValues: TRIGGERS,
      name: "trigger",
      required: false,
      type: "enum"
    }
  ],
  resultRoute({ bookingId }) {
    return `/bookings/${bookingId}`;
  },
  parseArgs(raw) {
    const bag = argsBag(raw, ["bookingId", "trigger"]);
    return {
      bookingId: requireString(bag, "bookingId"),
      trigger: optionalEnum(bag, "trigger", TRIGGERS) ?? "manual"
    };
  },
  async run({ bookingId, trigger }) {
    return new BrowserCompanionPriceCheckRunner().run({ bookingId, trigger });
  }
};

export const importAccountBookings: Capability<
  { hotelGroup: string },
  { expiresAt: string | null; launchUrl: string; status: string; taskId: string }
> = {
  name: "import_account_bookings",
  summary: "Open a Hyatt tab and import the stays already booked in the signed-in account.",
  effect: "browser_task",
  params: [
    {
      description: "Loyalty program to import from. Only Hyatt is collected today.",
      enumValues: HOTEL_GROUPS,
      name: "hotelGroup",
      required: false,
      type: "enum"
    }
  ],
  resultRoute() {
    /* The import button and its result notice both live on the desk. */
    return "/";
  },
  parseArgs(raw) {
    const bag = argsBag(raw, ["hotelGroup"]);
    return { hotelGroup: optionalEnum(bag, "hotelGroup", HOTEL_GROUPS) ?? "Hyatt" };
  },
  async run({ hotelGroup }) {
    const task = await createAccountImportTask({ hotelGroup });
    /* serializeTaskState is nullable for the read path; a task just created is not. */
    if (!task) {
      throw new Error("The account import task was created but its state could not be read back.");
    }
    return {
      expiresAt: instant(task.expiresAt ? new Date(task.expiresAt) : null),
      launchUrl: task.launchUrl,
      status: task.status,
      taskId: task.taskId
    };
  }
};
