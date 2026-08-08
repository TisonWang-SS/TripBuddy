declare const safetyRules: Readonly<{
  isUnsafeBookingControl(value: string): boolean;
  unsafeBookingControlPatternSource: string;
}>;

export = safetyRules;
