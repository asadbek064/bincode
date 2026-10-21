import { PREVIEW_CONSOLE } from '../../../shared/constants.ts';
import { CONSOLE_LEVELS } from './consoleTypes.ts';

export interface PreviewInput {
  html: string;
  css: string;
  js: string;
}

// A literal closing tag inside user code would terminate our wrapper element early.
function escapeStyle(css: string): string {
  return css.replace(/<\/style/gi, '<\\/style');
}

function escapeScript(js: string): string {
  return js.replace(/<\/script/gi, '<\\/script');
}

// The sandboxed frame has an opaque origin, so touching localStorage/sessionStorage
// throws a SecurityError. That breaks many user snippets, so swap in non-persistent
// in-memory stores.
// Kept on one line so it never adds lines to the document ahead of the user's code.
const STORAGE_SHIM =
  '(function(){function mem(){var d=Object.create(null);return{get length(){return Object.keys(d).length},' +
  'key:function(i){var k=Object.keys(d);return i<k.length?k[i]:null},' +
  'getItem:function(k){k=String(k);return k in d?d[k]:null},' +
  'setItem:function(k,v){d[String(k)]=String(v)},removeItem:function(k){delete d[String(k)]},' +
  'clear:function(){d=Object.create(null)}}}' +
  "['localStorage','sessionStorage'].forEach(function(n){try{window[n].length;return}catch(e){}" +
  'try{Object.defineProperty(window,n,{value:mem(),configurable:true})}catch(e){}})})();';

/**
 * Forwards the snippet's console calls and uncaught errors to the parent as
 * `{ type: PREVIEW_CONSOLE, level, text }`. Everything is pre-formatted to a string
 * here because arbitrary objects (DOM nodes, functions, cycles) can't be structured-cloned.
 * It must never throw into user code, never recurse (a getter or stack accessor may
 * itself log), and caps its output so a logging loop can't flood the parent.
 * Kept on one line for the same reason as STORAGE_SHIM. ES5 only: it runs as-is in the frame.
 */
export const CONSOLE_BRIDGE =
  '(function(){var C=window.console;if(!C)return;var P=window.parent,T=' + JSON.stringify(PREVIEW_CONSOLE) +
  ',L=' + JSON.stringify(CONSOLE_LEVELS) + ',MAX=1000,LEN=2000,n=0,done=false,busy=false,OP=Object.prototype;' +
  'function tr(s){return s.length>LEN?s.slice(0,LEN)+"\\u2026":s}' +
  'function isErr(v){try{return v instanceof Error||OP.toString.call(v)==="[object Error]"}catch(e){return false}}' +
  'function isNode(v){try{return typeof v.nodeType==="number"&&typeof v.nodeName==="string"}catch(e){return false}}' +
  'function err(v){var h=String(v.name)+": "+String(v.message),s=v.stack?String(v.stack):"";' +
  'return s?(s.indexOf(String(v.message))>=0?s:h+"\\n"+s):h}' +
  'function tag(v){if(v.nodeType!==1)return String(v.nodeName);var s="<"+String(v.nodeName).toLowerCase();' +
  'if(v.id)s+="#"+v.id;var c=typeof v.className==="string"?v.className.trim():"";' +
  'if(c)s+="."+c.split(/\\s+/).join(".");return s+">"}' +
  'function fn(v){return "\\u0192 "+(v.name||"")+"()"}' +
  'function ser(v,d,st){if(v===null)return "null";var t=typeof v;' +
  'if(t==="string")return JSON.stringify(v);if(t==="function")return fn(v);if(t!=="object")return String(v);' +
  'if(++st.k>500)return "\\u2026";if(isErr(v))return JSON.stringify(String(v.name)+": "+String(v.message));' +
  'if(isNode(v))return tag(v);if(v instanceof Date||v instanceof RegExp)return String(v);' +
  'if(st.seen.indexOf(v)>=0)return "[Circular]";var a=Array.isArray(v);if(d>=3)return a?"[Array]":"[Object]";' +
  'st.seen.push(v);try{var o=[],ks=a?null:Object.keys(v),m=a?v.length:ks.length,i,x;' +
  'for(i=0;i<m;i++){if(i>=100){o.push("\\u2026");break}try{x=ser(a?v[i]:v[ks[i]],d+1,st)}catch(e){x="[Thrown]"}' +
  'o.push(a?x:JSON.stringify(ks[i])+":"+x)}return a?"["+o.join(",")+"]":"{"+o.join(",")+"}"}finally{st.seen.pop()}}' +
  'function fmt(v){var t=typeof v;if(t==="string")return tr(v);if(t==="function")return tr(fn(v));' +
  'if(v===null||t!=="object")return String(v);if(isErr(v))return tr(err(v));if(isNode(v))return tr(tag(v));' +
  'return tr(ser(v,0,{seen:[],k:0}))}' +
  'function post(l,t){try{P.postMessage({type:T,level:l,text:t},"*")}catch(e){}}' +
  'function send(l,args){if(done||busy)return;busy=true;try{var p=[],i;for(i=0;i<args.length;i++){' +
  'try{p.push(fmt(args[i]))}catch(e){p.push("[Unformattable]")}}' +
  'if(++n>MAX){done=true;post("warn","Console output truncated");return}post(l,p.join(" "))}' +
  'catch(e){}finally{busy=false}}' +
  'L.forEach(function(l){var o=C[l];try{C[l]=function(){send(l,arguments);' +
  'if(typeof o==="function")return o.apply(C,arguments)}}catch(e){}});' +
  'try{window.addEventListener("error",function(e){var m=e.message||"Uncaught error";' +
  'if(e.lineno){m+=" ("+(e.filename&&e.filename!==location.href?e.filename+":":"line ")+e.lineno+")"}send("error",[m])});' +
  'window.addEventListener("unhandledrejection",function(e){send("error",["Uncaught (in promise)",e.reason])})}catch(e){}})();';

/** Builds the full document rendered inside the sandboxed preview frame. Pure: no DOM access. */
export function buildPreviewDocument({ html, css, js }: PreviewInput): string {
  // The bridge and shim run in their own head script, ahead of the user's markup, so they
  // also cover inline <script>s in the HTML panel and still report a SyntaxError in the JS
  // panel (a script that fails to parse runs nothing, including anything prefixed to it).
  // The user's script gets no prefix, so its line numbers are exactly the user's own.
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<script>${CONSOLE_BRIDGE}${STORAGE_SHIM}</script>` +
    `<style>${escapeStyle(css)}</style>` +
    `</head><body>${html}<script>${escapeScript(js)}</script></body></html>`
  );
}
