import { NO_INSETS, type Insets } from './layout';

/**
 * What the phone has taken out of the viewport — a notch, a home indicator, a
 * rounded corner. CSS is the only thing that knows: `env(safe-area-inset-*)` is
 * not readable from script, so the values are put on a hidden element as padding
 * and read back off the computed style.
 *
 * Kept apart from `layout.ts` on purpose. The arithmetic there is pure and unit
 * tested; this touches the document, and is covered by the smoke driver with the
 * rest of the runtime layer.
 */

let probe: HTMLDivElement | undefined;

const element = (): HTMLDivElement => {
  if (probe !== undefined) return probe;

  probe = document.createElement('div');
  // Zero-sized and hidden: the element exists to be measured, never seen. The
  // insets land on its padding, which `getComputedStyle` resolves to pixels.
  probe.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'width:0',
    'height:0',
    'visibility:hidden',
    'pointer-events:none',
    'padding-top:env(safe-area-inset-top)',
    'padding-right:env(safe-area-inset-right)',
    'padding-bottom:env(safe-area-inset-bottom)',
    'padding-left:env(safe-area-inset-left)',
  ].join(';');
  document.body.append(probe);

  return probe;
};

/**
 * Re-read on every resize rather than cached: the insets change when the phone
 * is turned over, which is exactly when the layout is being recomputed anyway.
 * A browser that has never heard of `env()` resolves the padding to nothing,
 * which is the right answer for a desktop window.
 */
export const readSafeArea = (): Insets => {
  if (typeof document === 'undefined') return NO_INSETS;

  const style = getComputedStyle(element());
  const px = (value: string): number => Number.parseFloat(value) || 0;

  return {
    top: px(style.paddingTop),
    right: px(style.paddingRight),
    bottom: px(style.paddingBottom),
    left: px(style.paddingLeft),
  };
};
