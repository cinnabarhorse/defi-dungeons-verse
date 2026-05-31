import { getWearableById, getWearableBySlug } from './wearables';

export type QualityTier =
  | 'broken'
  | 'budget'
  | 'average'
  | 'excellent'
  | 'flawless';

export const QUALITY_DEFAULT_LABELS: Record<QualityTier, string> = {
  broken: 'Broken',
  budget: 'Cheap',
  average: 'Basic',
  excellent: 'Excellent',
  flawless: 'Flawless',
};

export const WEARABLE_QUALITY_OVERRIDES: Record<
  string,
  Partial<Record<QualityTier, string>>
> = {
  'jamaican-flag': {
    broken: 'Torn',
  },
  'baable-gum': {
    broken: 'Popped',
  },
};

export const WEARABLE_ITEM_TYPE_QUALITY_OVERRIDES: Record<
  string,
  Partial<Record<QualityTier, string>>
> = {
  'basic-hat': {
    broken: 'Torn',
  },
  'fancy-hat': {
    broken: 'Torn',
  },
  't-shirt': {
    broken: 'Ripped',
  },
  'fancy-shirt': {
    broken: 'Torn',
  },
  flag: {
    broken: 'Torn',
  },
  pants: {
    broken: 'Ripped',
  },
  dress: {
    broken: 'Ripped',
  },
  'fancy-suit': {
    broken: 'Ripped',
  },
  'heavy-armor': {
    broken: 'Cracked',
  },
  robe: {
    broken: 'Ripped',
  },

  athletic: {
    broken: 'Ripped',
  },
  helmet: {
    broken: 'Cracked',
  },
};

export const QUALITY_SCALARS: Record<QualityTier, number> = {
  broken: 0.5,
  budget: 0.66,
  average: 1,
  excellent: 1.5,
  flawless: 2,
};

export const DEFAULT_QUALITY_TIER: QualityTier = 'average';

export function normalizeQualityTier(
  value: string | QualityTier | null | undefined
): QualityTier {
  switch (value) {
    case 'broken':
    case 'budget':
    case 'average':
    case 'excellent':
    case 'flawless':
      return value;
    default:
      return DEFAULT_QUALITY_TIER;
  }
}

export function getQualityLabelForWearable(
  quality: QualityTier,
  wearableSlugOrId?: string | number
): string {
  const defaultLabel = QUALITY_DEFAULT_LABELS[quality] ?? quality;

  if (!wearableSlugOrId) {
    return defaultLabel;
  }

  let slug: string | undefined;
  let wearable:
    | ReturnType<typeof getWearableById>
    | ReturnType<typeof getWearableBySlug>
    | undefined;

  if (typeof wearableSlugOrId === 'string') {
    slug = wearableSlugOrId;
    wearable = getWearableBySlug(slug);
  } else if (typeof wearableSlugOrId === 'number') {
    wearable = getWearableById(wearableSlugOrId);
    slug = wearable?.slug;
  }

  if (slug) {
    const overrides = WEARABLE_QUALITY_OVERRIDES[slug];
    if (overrides && overrides[quality]) {
      return overrides[quality] as string;
    }
  }

  const itemType = wearable?.itemType;

  if (itemType) {
    const itemTypeOverrides = WEARABLE_ITEM_TYPE_QUALITY_OVERRIDES[itemType];
    if (itemTypeOverrides && itemTypeOverrides[quality]) {
      return itemTypeOverrides[quality] as string;
    }
  }

  return defaultLabel;
}

export function getQualityScalar(quality: QualityTier): number {
  const value = QUALITY_SCALARS[quality];
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  return 1;
}
