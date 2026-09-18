/** Browser-only presentation, shared verbatim with tests. No runtime dependencies.
 * Each bounded preview is scanned once; previously appended events are never re-rendered.
 * This deliberately supports a small Markdown/XML subset, never arbitrary HTML.
 */
export const tracePresentationBrowserSource = String.raw`
const traceEscape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const traceHighlight=(source,language='')=>{
  const text=String(source),shell=/^(sh|bash|shell|zsh|console)$/.test(language),supported=shell||/^(js|javascript|ts|typescript|jsx|tsx|json|python|py|sql|css)$/.test(language);
  if(!supported)return traceEscape(text);
  const tokens=/"(?:[^"\\]|\\[\s\S])*(?:"|$)|'(?:[^'\\]|\\[\s\S])*(?:'|$)|#[^\n]*|\/\/[^\n]*|\$[A-Za-z_][A-Za-z_0-9]*|\b\d+(?:\.\d+)?\b|[A-Za-z_][A-Za-z_0-9]*|[^\w"'#$/]+|[\s\S]/g;
  const keywords=new Set((shell?'if then else elif fi for in do done case esac function export local cd echo printf cat rg git npm curl sudo set exit': 'const let var function return async await import export from class new if else for while try catch throw true false null undefined def in and or not None True False select from where insert into values').split(' '));
  return Array.from(text.matchAll(tokens),match=>{const token=match[0],kind=/^["']/.test(token)?'string':(shell?token[0]==='#':token.startsWith('//')||((language==='py'||language==='python')&&token[0]==='#'))?'comment':token[0]==='$'?'variable':/^\d/.test(token)?'number':keywords.has(token)?'keyword':'';return kind?'<span class="trace-token-'+kind+'">'+traceEscape(token)+'</span>':traceEscape(token)}).join('');
};
const traceCode=(text,language='')=>'<div class="trace-code">'+(language?'<div class="trace-code-label">'+traceEscape(language)+'</div>':'')+'<pre><code>'+traceHighlight(text,language)+'</code></pre></div>';
const traceInline=text=>{
  const parts=text.split(/(\x60|\*\*)/),out=[];let code=false,bold=false;
  const counts=parts.reduce((counts,part)=>{if(part==='\x60'||part==='**')counts[part]++;return counts},{'\x60':0,'**':0});
  for(const part of parts){if(part==='\x60'){counts[part]--;if(code||counts[part]>0){out.push(code?'</code>':'<code>');code=!code}else out.push(part)}else if(part==='**'&&!code){counts[part]--;if(bold||counts[part]>0){out.push(bold?'</strong>':'<strong>');bold=!bold}else out.push(part)}else out.push(traceEscape(part))}
  if(code)out.push('</code>');if(bold)out.push('</strong>');return out.join('');
};
const traceContent=input=>{
  const lines=String(input).split(/\r?\n/),out=[];let fence='',language='',code=[],structured='';
  const labels={task:'Task',instructions:'Instructions',environment_context:'Environment',system_reminder:'System reminder','system-reminder':'System reminder',INSTRUCTIONS:'Instructions',context:'Context'};
  for(const line of lines){
    const marker=line.match(/^\s*(\x60{3,}|~{3,})([^\s]*)\s*$/);
    if(fence){if(marker&&marker[1][0]===fence[0]&&marker[1].length>=fence.length&&!marker[2]){out.push(traceCode(code.join('\n'),language));fence='';code=[]}else code.push(line);continue}
    if(marker){fence=marker[1];language=marker[2].toLowerCase();continue}
    const tag=line.trim().match(/^<(\/?)([\w-]+)>$/);
    if(tag&&Object.hasOwn(labels,tag[2])){if(!structured&&!tag[1]){structured=tag[2];out.push('<details class="trace-structured"><summary>'+labels[structured]+'</summary><div>');continue}if(structured===tag[2]&&tag[1]){out.push('</div></details>');structured='';continue}}
    const heading=line.match(/^#{1,6} (.*)$/),bullet=line.match(/^(?:[-*] |\d+\. )(.*)$/);
    out.push(heading?'<h4>'+traceInline(heading[1])+'</h4>':bullet?'<div class="trace-bullet">'+traceInline(bullet[1])+'</div>':'<div class="trace-line">'+(traceInline(line)||'<br>')+'</div>');
  }
  if(fence)out.push(traceCode(code.join('\n'),language));if(structured)out.push('</div></details>');return out.join('');
};
const traceCard=e=>{
  const type=e.type,title=traceEscape(e.title),preview=String(e.preview||'').slice(0,32768);
  if(type==='reasoning')return '<div class="trace-thinking"><span class="trace-spinner" aria-hidden="true"></span><span class="trace-thinking-live">Thinking…</span><span class="trace-thinking-past">Thought</span></div>';
  if(type==='user_message'||type==='assistant_message')return '<article class="trace-message trace-'+type+'"><h3>'+ (type==='user_message'?'You':'Assistant')+'</h3><div class="trace-prose">'+traceContent(preview)+'</div></article>';
  const tool=['tool_call','tool_result','command','file_change'].includes(type);
  let content=traceCode(preview);
  if(type==='tool_call'){
    let args;try{args=JSON.parse(preview)}catch{}
    if(args&&typeof args==='object'&&!Array.isArray(args)){const command=args.command??args.cmd;content=typeof command==='string'?traceCode(command,'sh')+(Object.keys(args).length>1?traceCode(JSON.stringify(args,null,2),'json'):''):traceCode(JSON.stringify(args,null,2),'json')}else content=traceCode(preview,'json');
  }
  if(type==='command')content=traceCode(e.title,'sh')+traceCode(preview);
  const kind=tool?'tool':type==='error'?'error':type==='warning'?'warning':'meta';
  return '<details class="trace-event trace-'+kind+'"'+(type==='error'||type==='warning'?' open':'')+'><summary><span class="trace-event-kind">'+traceEscape(type.replaceAll('_',' '))+'</span><span>'+title+'</span></summary>'+content+'</details>';
};
`;
