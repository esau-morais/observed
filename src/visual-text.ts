import type { Visual, VisualRegion } from './comparison-model';

const count = new Intl.NumberFormat('en-US');
const plural = new Intl.PluralRules('en-US');

type Noun = Partial<Record<Intl.LDMLPluralRule, string>> & { other: string };

const pixel: Noun = { one: 'pixel', other: 'pixels' };
const changedPixel: Noun = { one: 'changed pixel', other: 'changed pixels' };
const region: Noun = { one: 'region', other: 'regions' };

function units(value: number, noun: Noun): string {
  return `${count.format(value)} ${noun[plural.select(value)] ?? noun.other}`;
}

function share(part: number, total: number): string {
  const value = (part / total) * 100;

  return value < 0.01 ? '<0.01%' : `${value.toFixed(2)}%`;
}

function area(box: Omit<VisualRegion, 'changedPixels'>): string {
  return `${box.width} × ${box.height} px at x ${box.x}, y ${box.y}`;
}

export function describeRegion(box: VisualRegion): string {
  return `${area(box)}: ${units(box.changedPixels, changedPixel)}`;
}

export function describeVisual(visual: Visual): string {
  switch (visual.kind) {
    case 'identical':
      return `Identical pixels at ${visual.width} × ${visual.height} px.`;
    case 'below-threshold':
      return `${units(visual.differingPixels, pixel)} (${share(visual.differingPixels, visual.width * visual.height)}) differ within ${area(visual.bounds)}. None exceed the ${visual.threshold} color threshold.`;
    case 'size-differs':
      return `Not compared. Before is ${visual.base.width} × ${visual.base.height} px; after is ${visual.candidate.width} × ${visual.candidate.height} px.`;
    case 'unavailable':
      return `Pixel comparison unavailable. ${visual.reason}`;
    case 'changed': {
      const listed =
        visual.regionCount > visual.regions.length
          ? ` The ${visual.regions.length} largest are listed.`
          : '';

      return `${units(visual.changedPixels, pixel)} (${share(visual.changedPixels, visual.width * visual.height)}) exceed the ${visual.threshold} color threshold, in ${units(visual.regionCount, region)}.${listed}`;
    }
  }
}

export const diffLegend =
  'In the difference image, blue pixels are darker after the change and orange pixels are lighter. Other pixels are faded.';
