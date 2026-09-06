/// <reference types="vite/client" />

declare module "plyr" {
  export interface PlyrOptions {
    controls?: string[];
    settings?: string[];
    ratio?: string;
    autoplay?: boolean;
    muted?: boolean;
    [key: string]: unknown;
  }
  export default class Plyr {
    constructor(target: HTMLElement | string, options?: PlyrOptions);
    destroy(): void;
    source: unknown;
  }
}

declare module "plyr/dist/plyr.css";
