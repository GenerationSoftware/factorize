export function InputPreview({run}:{run:{execution_type?:string;launch_skill_key?:string|null;prompt_preview?:string}}){
 const text=[run.execution_type!=="code"&&run.launch_skill_key?"/"+run.launch_skill_key:"",run.prompt_preview??""].filter(Boolean).join(" ") || "—";
 return <span className="block truncate font-mono text-xs" title={text}>{text}</span>;
}
