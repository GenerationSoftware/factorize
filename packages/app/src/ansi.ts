/** Convert terminal SGR styling to safe HTML. All emitted markup is generated here. */
export function ansiToHtml(input: unknown): string {
  const palette = ["#0f172a", "#ef4444", "#22c55e", "#eab308", "#3b82f6", "#d946ef", "#06b6d4", "#e2e8f0", "#64748b", "#f87171", "#4ade80", "#facc15", "#60a5fa", "#e879f9", "#22d3ee", "#f8fafc"];
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
  const color = (value: number) => {
    if (value < 16) return palette[value];
    if (value < 232) {
      const offset = value - 16, levels = [0, 95, 135, 175, 215, 255];
      return `rgb(${levels[Math.floor(offset / 36)]},${levels[Math.floor(offset / 6) % 6]},${levels[offset % 6]})`;
    }
    const gray = 8 + (value - 232) * 10;
    return `rgb(${gray},${gray},${gray})`;
  };
  type Style = { fg?: string; bg?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; inverse?: boolean; hidden?: boolean; strike?: boolean };
  let style: Style = {}, text = "", html = "";
  const flush = () => {
    if (!text) return;
    let fg = style.fg, bg = style.bg;
    if (style.inverse) { const originalFg = fg ?? "#e2e8f0"; fg = bg ?? "#020617"; bg = originalFg; }
    const css = [fg && `color:${fg}`, bg && `background-color:${bg}`, style.bold && "font-weight:700", style.dim && "opacity:.65", style.italic && "font-style:italic", style.underline && "text-decoration:underline", style.strike && "text-decoration:line-through", style.hidden && "visibility:hidden"].filter(Boolean).join(";");
    html += css ? `<span style="${css}">${escape(text)}</span>` : escape(text);
    text = "";
  };
  const apply = (parameters: string) => {
    const codes = (parameters === "" ? [0] : parameters.split(";").map(value => /^\d+$/.test(value) ? Number(value) : -1));
    for (let index = 0; index < codes.length; index++) {
      const code = codes[index];
      if (code === 0) style = {};
      else if (code === 1) style.bold = true;
      else if (code === 2) style.dim = true;
      else if (code === 3) style.italic = true;
      else if (code === 4) style.underline = true;
      else if (code === 7) style.inverse = true;
      else if (code === 8) style.hidden = true;
      else if (code === 9) style.strike = true;
      else if (code === 22) { style.bold = false; style.dim = false; }
      else if (code === 23) style.italic = false;
      else if (code === 24) style.underline = false;
      else if (code === 27) style.inverse = false;
      else if (code === 28) style.hidden = false;
      else if (code === 29) style.strike = false;
      else if (code >= 30 && code <= 37) style.fg = color(code - 30);
      else if (code >= 40 && code <= 47) style.bg = color(code - 40);
      else if (code >= 90 && code <= 97) style.fg = color(code - 90 + 8);
      else if (code >= 100 && code <= 107) style.bg = color(code - 100 + 8);
      else if (code === 39) delete style.fg;
      else if (code === 49) delete style.bg;
      else if ((code === 38 || code === 48) && codes[index + 1] === 5 && codes[index + 2] >= 0 && codes[index + 2] <= 255) {
        style[code === 38 ? "fg" : "bg"] = color(codes[index + 2]); index += 2;
      } else if ((code === 38 || code === 48) && codes[index + 1] === 2 && codes.slice(index + 2, index + 5).every(value => value >= 0 && value <= 255)) {
        style[code === 38 ? "fg" : "bg"] = `rgb(${codes[index + 2]},${codes[index + 3]},${codes[index + 4]})`; index += 4;
      }
    }
  };
  const value = String(input ?? "");
  for (let index = 0; index < value.length;) {
    if (value[index] !== "\u001b") { text += value[index++]; continue; }
    flush();
    if (value[index + 1] === "[") {
      let end = index + 2;
      while (end < value.length && !/[\x40-\x7e]/.test(value[end])) end++;
      if (end >= value.length) break;
      if (value[end] === "m" && /^[\d;]*$/.test(value.slice(index + 2, end))) apply(value.slice(index + 2, end));
      index = end + 1;
    } else if (value[index + 1] === "]") {
      let end = index + 2;
      while (end < value.length && value[end] !== "\u0007" && !(value[end] === "\u001b" && value[end + 1] === "\\")) end++;
      index = end < value.length ? end + (value[end] === "\u001b" ? 2 : 1) : value.length;
    } else index += Math.min(2, value.length - index);
  }
  flush();
  return html;
}

/**
 * Browser-safe source for the run detail page.
 *
 * Do not derive this with `ansiToHtml.toString()`: Wrangler/esbuild decorates
 * named functions with its private `__name` helper, which is not present in
 * the HTML page where the serialized function runs.
 */
export const ansiToHtmlBrowserSource = String.raw`const ansiToHtml=input=>{
  const palette=['#0f172a','#ef4444','#22c55e','#eab308','#3b82f6','#d946ef','#06b6d4','#e2e8f0','#64748b','#f87171','#4ade80','#facc15','#60a5fa','#e879f9','#22d3ee','#f8fafc'];
  const escape=value=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const color=value=>{if(value<16)return palette[value];if(value<232){const offset=value-16,levels=[0,95,135,175,215,255];return 'rgb('+levels[Math.floor(offset/36)]+','+levels[Math.floor(offset/6)%6]+','+levels[offset%6]+')'}const gray=8+(value-232)*10;return 'rgb('+gray+','+gray+','+gray+')'};
  let style={},text='',html='';
  const flush=()=>{if(!text)return;let fg=style.fg,bg=style.bg;if(style.inverse){const originalFg=fg??'#e2e8f0';fg=bg??'#020617';bg=originalFg}const css=[fg&&'color:'+fg,bg&&'background-color:'+bg,style.bold&&'font-weight:700',style.dim&&'opacity:.65',style.italic&&'font-style:italic',style.underline&&'text-decoration:underline',style.strike&&'text-decoration:line-through',style.hidden&&'visibility:hidden'].filter(Boolean).join(';');html+=css?'<span style="'+css+'">'+escape(text)+'</span>':escape(text);text=''};
  const apply=parameters=>{const codes=parameters===''?[0]:parameters.split(';').map(value=>/^\d+$/.test(value)?Number(value):-1);for(let index=0;index<codes.length;index++){const code=codes[index];if(code===0)style={};else if(code===1)style.bold=true;else if(code===2)style.dim=true;else if(code===3)style.italic=true;else if(code===4)style.underline=true;else if(code===7)style.inverse=true;else if(code===8)style.hidden=true;else if(code===9)style.strike=true;else if(code===22){style.bold=false;style.dim=false}else if(code===23)style.italic=false;else if(code===24)style.underline=false;else if(code===27)style.inverse=false;else if(code===28)style.hidden=false;else if(code===29)style.strike=false;else if(code>=30&&code<=37)style.fg=color(code-30);else if(code>=40&&code<=47)style.bg=color(code-40);else if(code>=90&&code<=97)style.fg=color(code-90+8);else if(code>=100&&code<=107)style.bg=color(code-100+8);else if(code===39)delete style.fg;else if(code===49)delete style.bg;else if((code===38||code===48)&&codes[index+1]===5&&codes[index+2]>=0&&codes[index+2]<=255){style[code===38?'fg':'bg']=color(codes[index+2]);index+=2}else if((code===38||code===48)&&codes[index+1]===2&&codes.slice(index+2,index+5).every(value=>value>=0&&value<=255)){style[code===38?'fg':'bg']='rgb('+codes[index+2]+','+codes[index+3]+','+codes[index+4]+')';index+=4}}};
  const value=String(input??'');for(let index=0;index<value.length;){if(value[index]!=='\u001b'){text+=value[index++];continue}flush();if(value[index+1]==='['){let end=index+2;while(end<value.length&&!/[\x40-\x7e]/.test(value[end]))end++;if(end>=value.length)break;if(value[end]==='m'&&/^[\d;]*$/.test(value.slice(index+2,end)))apply(value.slice(index+2,end));index=end+1}else if(value[index+1]===']'){let end=index+2;while(end<value.length&&value[end]!=='\u0007'&&!(value[end]==='\u001b'&&value[end+1]==='\\'))end++;index=end<value.length?end+(value[end]==='\u001b'?2:1):value.length}else index+=Math.min(2,value.length-index)}flush();return html
};`;
