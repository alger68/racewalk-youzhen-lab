export function assetBaseUrl(base:string,locationHref:string){
 return new URL(base,locationHref).href;
}
