export type CategoryId = "makeup" | "hair" | "fashion" | "accessories";

export interface TryOnOption {
  id: string;
  label: string;
  /** CSS colour used for the swatch and by the mock renderer. */
  color: string;
  /** Extra parameters forwarded to the renderer (e.g. a YouCam preset name). */
  params?: Record<string, string | number>;
}

export interface OptionGroup {
  id: string;
  label: string;
  /** Whether the intensity +/- controls apply to this group. */
  adjustable: boolean;
  options: TryOnOption[];
}

export interface Category {
  id: CategoryId;
  label: string;
  groups: OptionGroup[];
}

/** What is applied in one slot (a group such as "hair/color"). */
export interface AppliedOption {
  optionId: string;
  /** 0-100. */
  intensity: number;
}

/** A complete styling: slot key (`category/group`) to its applied option. */
export type Look = Record<string, AppliedOption>;

export const slotKey = (categoryId: string, groupId: string) => `${categoryId}/${groupId}`;
