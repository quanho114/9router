import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LOCALES, normalizeLocale, isSupportedLocale } from '../../src/i18n/config.js';
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const maps = Object.fromEntries(['en','vi','zh-CN','zh-TW'].map(l=>[l,JSON.parse(read('../../public/i18n/literals/'+l+'.json'))]));
async function runtime(locale) {
  const document = { cookie: 'locale='+locale, body: {}, createTreeWalker: () => ({ nextNode: () => null }) };
  const code = read('../../src/i18n/runtime.js').replace(/^import .*;\r?\n/gm,'').replaceAll('export ', '');
  const ctx = vm.createContext({ document, window: {}, NodeFilter:{ SHOW_TEXT:4 }, DEFAULT_LOCALE:'en', LOCALE_COOKIE:'locale', normalizeLocale,
    fetch: async url => ({ok:true,json:async()=>maps[url.split('/').pop().replace('.json','')]}), MutationObserver:class {observe(){}}, console });
  vm.runInContext(code,ctx);
  await ctx.initRuntimeI18n();
  return { ctx, document };
}
describe('four supported dashboard languages',()=>{
  it('limits selection and rejects removed locales',()=>{
    expect(LOCALES).toEqual(['vi','en','zh-CN','zh-TW']);
    expect(normalizeLocale('zh')).toBe('zh-CN');
    expect(normalizeLocale('ja')).toBe('en');
    expect(isSupportedLocale('ja')).toBe(false);
  });
  it.each(['vi','zh-CN','zh-TW'])('translates endpoint, navigation and key controls in %s', async locale=>{
    const {ctx}=await runtime(locale);
    for(const key of ['Endpoint & Key','API Keys & User Quota','Generate User Key','Require API Key','Open sidebar','Select Language','Maximum input tokens']){
      expect(ctx.translate(key)).toBe(maps[locale][key]);
      expect(ctx.translate(key)).not.toBe(key);
    }
    expect(ctx.translate('  Providers ')).toBe('  '+maps[locale].Providers+' ');
    expect(ctx.translate('7 Connected')).toBe('7 '+maps[locale].Connected);
    expect(ctx.translate('∞ Unlimited')).toBe('∞ '+maps[locale].Unlimited);
  });
  it('restores original labels and attributes when switching back to US',async()=>{
    const {ctx,document}=await runtime('vi');
    const element={ tagName:'SPAN', parentElement:null, hasAttribute:()=>false };
    const node={nodeValue:'  Providers ',parentElement:element};
    ctx.processTextNode(node);
    expect(node.nodeValue).toBe('  Nhà cung cấp ');
    const attrs={title:'Open sidebar',placeholder:'Search providers...'};
    const input={getAttribute:n=>attrs[n],setAttribute:(n,v)=>{attrs[n]=v},closest:()=>null};
    ctx.processAttributes(input);
    expect(attrs.title).toBe('Mở thanh bên');
    document.cookie='locale=zh-TW'; await ctx.reloadTranslations();ctx.processTextNode(node);ctx.processAttributes(input);
    expect(attrs.title).toBe('展開側邊欄');
    document.cookie='locale=en'; await ctx.reloadTranslations();ctx.processTextNode(node);ctx.processAttributes(input);
    expect(node.nodeValue).toBe('  Providers ');
    expect(attrs.title).toBe('Open sidebar');
    expect(ctx.translate('Không giới hạn')).toBe('Unlimited');
  });
  it('preserves model names, keys and URLs',async()=>{
    const {ctx}=await runtime('vi');
    for(const value of ['Claude Code','gpt-5','sk-example','http://127.0.0.1:3999/v1'])expect(ctx.translate(value)).toBe(value);
  });
});
