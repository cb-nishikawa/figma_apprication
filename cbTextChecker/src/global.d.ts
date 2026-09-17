declare const __html__: string;

declare module "*.svg?raw" {
  const content: string;
  export default content;
}
