/**
 * Ambient types for the experimental WICG/html-in-canvas API, aligned on what
 * Chromium actually ships behind --enable-blink-features=HTMLInCanvas
 * (chrome://flags/#canvas-draw-element) — the 2D path only.
 */

export {};

declare global {
  /** Opaque snapshot of a `drawable` element, bound to its source canvas. */
  interface ElementImage {
    readonly __brand?: 'ElementImage';
  }

  interface HTMLCanvasElement {
    /** Requests a fresh layout+paint pass of the layoutsubtree. */
    requestPaint(): void;
    /** Snapshots an *immediate child* of this canvas. Deeper nodes throw. */
    captureElementImage(element: Element): ElementImage;
    /** Fired once the layoutsubtree has been painted. */
    onpaint: ((this: HTMLCanvasElement, ev: Event) => unknown) | null;
  }

  interface CanvasRenderingContext2D {
    /** Draws a snapshot taken from *this* canvas at (x, y). */
    drawElementImage(image: ElementImage, x: number, y: number): void;
  }

  interface Element {
    /** Marks a subtree as an independently drawable snapshot root. */
    drawable: boolean;
    /** Marks a <canvas> as hosting a laid-out DOM subtree. */
    layoutsubtree: boolean;
  }
}

declare module 'react' {
  interface HTMLAttributes<T> {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    drawable?: boolean | '';
    layoutsubtree?: boolean | '';
  }
}

declare module '*.css?inline' {
  const content: string;
  export default content;
}
