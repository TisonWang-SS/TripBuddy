import type { BrowserTaskKind } from "@prisma/client";
import type { BrowserTaskCapture } from "@/lib/browserTasks";

export interface BrowserTaskDefinition<TCreateInput, TLaunchResult> {
  capture(taskId: string, capture: BrowserTaskCapture): Promise<unknown>;
  create(input: TCreateInput): Promise<TLaunchResult>;
  kind: BrowserTaskKind;
}
