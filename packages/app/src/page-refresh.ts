/** Shared browser orchestration. Completion-based timers prevent overlapping polls. */
export const pageRefreshBrowserSource = `
function pageRefresh(load,{delay=()=>3000,onError=()=>{}}={}){
  let timer,busy=false,stopped=false,failures=0;
  const clear=()=>{clearTimeout(timer);timer=undefined};
  const schedule=ms=>{clear();if(!stopped&&!document.hidden&&ms!==null)timer=setTimeout(refresh,ms)};
  async function refresh(){
    if(stopped||document.hidden||busy)return;
    clear();busy=true;
    let next;
    try{await load();failures=0;next=delay()}
    catch(error){failures++;next=Math.min(30000,5000*2**(failures-1));onError(error)}
    finally{busy=false;schedule(next)}
  }
  const resume=()=>{clear();if(!document.hidden)refresh()};
  const hide=()=>{stopped=true;clear()};
  const show=()=>{stopped=false;resume()};
  document.addEventListener('visibilitychange',resume);
  window.addEventListener('focus',resume);
  window.addEventListener('pagehide',hide);
  window.addEventListener('pageshow',show);
  refresh();
  return {refresh};
}
// Avoid replacing unchanged content; retain disclosure and keyboard position on updates.
function replacePageContent(root,html,afterReplace=()=>{}){
  const open=[...root.querySelectorAll('details')].map(x=>x.open);
  const focused=root.contains(document.activeElement)?document.activeElement:null;
  const focusId=focused?.id,focusHref=focused?.getAttribute('href'),focusPage=focused?.dataset.runPage;
  const summaryIndex=[...root.querySelectorAll('details>summary')].indexOf(focused);
  root.innerHTML=html;
  root.querySelectorAll('details').forEach((x,i)=>x.open=Boolean(open[i]));
  afterReplace();
  const target=focusPage?[...root.querySelectorAll('[data-run-page]')].find(x=>x.dataset.runPage===focusPage):summaryIndex>=0?root.querySelectorAll('details>summary')[summaryIndex]:focusId?document.getElementById(focusId):focusHref?[...root.querySelectorAll('a')].find(x=>x.getAttribute('href')===focusHref):null;
  target?.focus({preventScroll:true});
}
`;
