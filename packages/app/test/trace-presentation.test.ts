import { describe, expect, it } from 'vitest';
import { Window } from 'happy-dom';
import { tracePresentationBrowserSource } from '../src/trace-presentation';
import { jobRunPage } from '../src/ui';

const { traceCard, traceContent, traceHighlight } = new Function(tracePresentationBrowserSource + ';return {traceCard,traceContent,traceHighlight}')();
const document = new Window().document;
const dom = (html: string) => { const node = document.createElement('div'); node.innerHTML = html; return node; };

describe('trace presentation', () => {
  it('escapes markup in messages, titles, code, and unknown XML without creating executable elements', () => {
    for (const type of ['assistant_message', 'user_message', 'tool_call', 'tool_result', 'command', 'error']) {
      const node = dom(traceCard({type, title: '<img src=x onerror=alert(1)>', preview: '<script>alert(1)</script>\n<svg onload=alert(1)>\n```js\n"<img src=x>"\n```'}));
      expect(node.querySelector('script,img,svg')).toBeNull();
      expect(node.textContent).toContain('<script>');
    }
  });
  it('renders allowed standalone XML wrappers as disclosures and preserves unknown or mismatched tags', () => {
    const node = dom(traceContent('<task>\nDo this\n</context>\n</task>\n<unknown>literal</unknown>'));
    expect(node.querySelector('summary')?.textContent).toBe('Task');
    expect(node.textContent).toContain('</context>');
    expect(node.textContent).toContain('<unknown>literal</unknown>');
    expect(dom(traceContent('<context>\nunfinished')).querySelector('details')?.textContent).toContain('unfinished');
  });
  it('highlights fenced code and shell without interpreting XML inside fences', () => {
    const node = dom(traceContent('```typescript\nconst value = "<task>";\n```\n~~~bash\ngit status # inspect\n~~~'));
    expect(node.querySelectorAll('pre')).toHaveLength(2);
    expect(node.querySelector('.trace-token-keyword')?.textContent).toBe('const');
    expect(node.querySelector('.trace-token-string')?.textContent).toBe('"<task>"');
    expect(node.querySelectorAll('details')).toHaveLength(0);
    expect(node.querySelector('.trace-token-comment')?.textContent).toBe('# inspect');
    expect(dom(traceContent('```unrecognized\n<x>')).textContent).toContain('<x>');
  });
  it('extracts shell commands from tool arguments and keeps output collapsed', () => {
    const node = dom(traceCard({type:'tool_call',title:'exec_command',preview:JSON.stringify({cmd:'git status'})}));
    expect(node.querySelector('details')?.open).toBe(false);
    expect(node.querySelector('code')?.textContent).toBe('git status');
    expect(node.querySelector('.trace-token-keyword')?.textContent).toBe('git');
    expect(dom(traceCard({type:'tool_call',title:'read',preview:'{invalid'})).textContent).toContain('{invalid');
  });
  it('replaces reasoning bodies with a compact indicator and leaves errors visible', () => {
    const node = dom(traceCard({type:'reasoning',title:'Reasoning',preview:'private reasoning'}));
    expect(node.textContent).toContain('Thinking…');
    expect(node.textContent).not.toContain('private reasoning');
    expect(node.textContent).not.toContain('Reasoning');
    expect(dom(traceCard({type:'error',title:'Failed',preview:'error'})).querySelector('details')?.open).toBe(true);
  });
  it('preserves text under adversarial delimiter input and caps previews', () => {
    const source = '"\\'.repeat(16000);
    expect(dom(traceHighlight(source,'js')).textContent).toBe(source);
    expect(dom(traceContent('<task>\n'.repeat(4000))).querySelectorAll('details')).toHaveLength(1);
    expect(dom(traceCard({type:'tool_result',title:'Output',preview:'x'.repeat(40000)})).querySelector('code')?.textContent).toHaveLength(32768);
  });
  it('keeps cursor-based append rendering and gates animation on the latest page and running state', () => {
    const html = jobRunPage({email:'test@example.com'},'run');
    expect(html).toContain("list.insertAdjacentHTML('beforeend',page.items.map(traceCard).join(''))");
    expect(html).toContain("list.classList.toggle('trace-at-end',!page.nextCursor)");
    expect(html).toContain("root.classList.toggle('trace-running',r.state==='running')");
    for(const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) expect(()=>new Function(match[1])).not.toThrow();
  });
});
