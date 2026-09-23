declare module "bwip-js" {
  const bwipjs: { toSVG(opts: { bcid: string; text: string; height?: number; includetext?: boolean }): string };
  export default bwipjs;
}
