declare const __html__: string;

declare module "*.svg?raw" {
  const content: string;
  export default content;
}

declare module "*?url" {
  const src: string;
  export default src;
}
