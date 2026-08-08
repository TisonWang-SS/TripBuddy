export const HOTEL_GROUPS = ["Hyatt", "IHG", "Marriott", "Hilton", "Accor"] as const;

export const CHANNELS = ["direct", "ota", "other"] as const;

export const SUPPORTED_CURRENCIES = ["USD", "CNY"] as const;

export const ROOM_MATCHES = ["exact", "similar", "unknown"] as const;

export const CANCELLATION_MATCHES = ["same_or_better", "worse", "unknown"] as const;

export const DEFAULT_PROFILE_ID = "primary";

export const DEFAULT_SYSTEM_SETTING_ID = "primary";

export const HOTEL_GROUP_TIERS: Record<string, string[]> = {
  Hyatt: ["Member", "Discoverist", "Explorist", "Globalist"],
  IHG: ["Club Member", "Silver Elite", "Gold Elite", "Platinum Elite", "Diamond Elite"],
  Marriott: ["Member", "Silver Elite", "Gold Elite", "Platinum Elite", "Titanium Elite", "Ambassador Elite"],
  Hilton: ["Member", "Silver", "Gold", "Diamond"],
  Accor: ["Classic", "Silver", "Gold", "Platinum", "Diamond"]
};
